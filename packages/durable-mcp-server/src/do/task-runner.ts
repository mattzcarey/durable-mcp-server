/*
 * `TaskRunner` — the standardized Durable Object every consumer exports
 * (docs/how-it-works.md §2 and §4 (layers and data flow), §4.5, §5, §6). One instance per task, DO name = taskId
 * (decision D2). Holds the task row, the step journal, and the single
 * multiplexed alarm; contains zero user code.
 *
 * The alarm reconciliation, generation-guarded claim machinery, guarded-write
 * idiom, handoff race, and schema shapes are adapted from
 * avenceslau/durability, pinned at commit 78cb099 (v2.1.0):
 * `packages/durability/src/index.ts` (`reconcileAlarm`, `armForHandoff`, the
 * alarm dispatcher, and the `execute()`/`run()` claim + settlement skeleton).
 * The in-DO handler call is replaced by the TaskRunner -> TaskExecutor RPC,
 * and `workers-qb` reads are rewritten to raw `ctx.storage.sql.exec` with zod
 * row parsing.
 * https://github.com/avenceslau/durability
 */

import { DurableObject, RpcTarget } from "cloudflare:workers";
import { z } from "zod";
import { exponential, jitter } from "../engine/backoff";
import { DuplicateStepError, ResultSerializationError, serializeError } from "../engine/errors";
import type { SerializedError } from "../engine/errors";
import { deserializeValue, serializeValue } from "../engine/serialization";
import {
  DEFAULT_TASK_EXECUTOR_BINDING,
  DEFAULT_TASK_EXECUTOR_ENTRYPOINT,
} from "../handler/bindings";
import { TASK_STATUSES } from "../wire/types";
import type { DetailedTask, InputRequests, Task } from "../wire/types";
import { StaleLeaseError } from "./protocol";
import type {
  BeginStepOptions,
  BeginStepResult,
  CheckInputState,
  DurableStepStub,
  ElicitState,
  RunOutcome,
  SleepState,
  StepFailureDisposition,
  TaskExecutorLike,
  TaskInvocation,
} from "./protocol";

/**
 * Bindings the TaskRunner reads. The executor is reached via
 * `ctx.exports.TaskExecutor` by default (decision D6 as amended); the
 * explicit `TASK_EXECUTOR` self service-binding is the configurable fallback.
 */
export interface TaskRunnerEnv {
  /** Optional explicit self service-binding to the task executor entrypoint. */
  TASK_EXECUTOR?: TaskExecutorLike;
  [binding: string]: unknown;
}

/** Payload of `TaskRunner.create` (docs/how-it-works.md §4(a) (task creation)). */
export interface CreateTaskInput {
  taskId: string;
  toolName: string;
  /** The validated tool-call input, JSON-serializable. */
  input: unknown;
  ttlMs: number | null;
  pollIntervalMs: number;
  /**
   * Opportunistic auth binding (decision D12): `authInfo.clientId` when
   * present at creation; mismatched pollers are rejected.
   */
  authKey?: string;
}

/** A `Task` snapshot as persisted at creation. */
export type TaskSnapshot = Task;

/**
 * The `_meta` key under which `tasks/get` surfaces the handler's structured
 * status (`step.status(message, meta)`), namespaced to this package.
 */
export const STATUS_META_KEY = "io.durable-mcp-server/status";

/** Size cap for a `step.status` meta object, serialized (UTF-8 bytes). */
export const STATUS_META_MAX_BYTES = 8 * 1024;

/**
 * A stored JSON value as read back on a snapshot, typed loosely (nested
 * arrays and objects are `object`): the snapshot crosses the DO RPC boundary,
 * whose type mapping cannot walk a recursive JSON type such as `JsonValue`.
 */
export type LooseJsonValue = string | number | boolean | null | object;

/** Engine-level `_meta` on a `tasks/get` snapshot (package-namespaced keys only). */
export interface TaskSnapshotMeta {
  /** The last `step.status` meta (a `JsonObject`), verbatim. Absent until the handler writes one. */
  [STATUS_META_KEY]?: { [key: string]: LooseJsonValue };
}

/**
 * A full task snapshot with terminal result/error or input requests inlined,
 * plus the engine's `_meta` (present only when there is something to carry).
 */
export type DetailedTaskSnapshot = DetailedTask & { _meta?: TaskSnapshotMeta };

/** Returned by `get()` when no task row exists (unknown or purged taskId). */
export interface TaskNotFound {
  notFound: true;
}

/**
 * Fired even if the whole alarm body fails, so a transient storage error can
 * never strand the task (workerd silently drops an alarm after 6 failed
 * retries — the engine persists its own schedule instead, docs/how-it-works.md §6 (reliability: alarm semantics)).
 */
const ALARM_BACKSTOP_MS = 60_000;

/**
 * Alarm invocations have a ~15-minute wall limit; hand off to a fresh
 * invocation before hitting it (docs/how-it-works.md §4(b) and §5 (leases, generations, replay), durability's pattern).
 */
const DEFAULT_ALARM_HANDOFF_MS = 14 * 60_000;

/** JSON-RPC internal error, used for engine-level task failures (docs/how-it-works.md §6 (reliability: limits and error taxonomy)). */
const JSON_RPC_INTERNAL_ERROR = -32603;

const TERMINAL_STATUSES = new Set<string>(["completed", "failed", "cancelled"]);

const isTerminal = (status: string): boolean => TERMINAL_STATUSES.has(status);

/**
 * DDL from docs/how-it-works.md §3 (data model) (input_requests included from day one), extended with
 * the handler's structured status (`task.status_meta`), the journaled
 * `checkInput` step kind (`steps.kind = 'check'`), and the standing-offer
 * columns on `input_requests` (`blocking`, default 1 — elicit rows are
 * unchanged — and `consumed`).
 */
const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS task (
  task_id          TEXT PRIMARY KEY,
  tool_name        TEXT NOT NULL,
  input            TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN
                     ('working','input_required','completed','failed','cancelled')),
  status_message   TEXT,
  status_meta      TEXT,
  created_at       INTEGER NOT NULL,
  last_updated_at  INTEGER NOT NULL,
  ttl_ms           INTEGER,
  poll_interval_ms INTEGER NOT NULL,
  result           TEXT,
  error            TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  run_attempt      INTEGER NOT NULL DEFAULT 0,
  run_generation   TEXT NOT NULL,
  run_next_at      INTEGER,
  auth_key         TEXT
);
CREATE TABLE IF NOT EXISTS steps (
  step_key        TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('do','sleep','check')),
  status          TEXT NOT NULL CHECK (status IN ('pending','completed','failed')),
  result          TEXT,
  attempt         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  wake_at         INTEGER,
  timeout_ms      INTEGER,
  last_error      TEXT,
  last_error_name TEXT,
  created_at      INTEGER NOT NULL,
  completed_at    INTEGER
);
CREATE INDEX IF NOT EXISTS steps_pending_idx ON steps (status, next_attempt_at, wake_at);
CREATE TABLE IF NOT EXISTS input_requests (
  key        TEXT PRIMARY KEY,
  step_key   TEXT NOT NULL,
  request    TEXT NOT NULL,
  response   TEXT,
  answered   INTEGER NOT NULL DEFAULT 0,
  timeout_at INTEGER,
  timed_out  INTEGER NOT NULL DEFAULT 0,
  blocking   INTEGER NOT NULL DEFAULT 1,
  consumed   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`;

const taskRowSchema = z.object({
  task_id: z.string(),
  tool_name: z.string(),
  input: z.string(),
  status: z.enum(TASK_STATUSES),
  status_message: z.string().nullable(),
  status_meta: z.string().nullable(),
  created_at: z.number(),
  last_updated_at: z.number(),
  ttl_ms: z.number().nullable(),
  poll_interval_ms: z.number(),
  result: z.string().nullable(),
  error: z.string().nullable(),
  cancel_requested: z.number(),
  run_attempt: z.number(),
  run_generation: z.string(),
  run_next_at: z.number().nullable(),
  auth_key: z.string().nullable(),
});

type TaskRow = z.output<typeof taskRowSchema>;

const stepRowSchema = z.object({
  step_key: z.string(),
  kind: z.enum(["do", "sleep", "check"]),
  status: z.enum(["pending", "completed", "failed"]),
  result: z.string().nullable(),
  attempt: z.number(),
  next_attempt_at: z.number().nullable(),
  wake_at: z.number().nullable(),
  timeout_ms: z.number().nullable(),
  last_error: z.string().nullable(),
  last_error_name: z.string().nullable(),
  created_at: z.number(),
  completed_at: z.number().nullable(),
});

const inputRequestRowSchema = z.object({
  key: z.string(),
  step_key: z.string(),
  request: z.string(),
  response: z.string().nullable(),
  answered: z.number(),
  timeout_at: z.number().nullable(),
  timed_out: z.number(),
  blocking: z.number(),
  consumed: z.number(),
  created_at: z.number(),
});

const answeredRequestSchema = z.object({ blocking: z.number() });

/** The stored `status_meta` column: a plain JSON object, as validated on write. */
const statusMetaSchema = z.record(z.string(), z.json());

const pendingWakeMinsSchema = z.object({
  retry_at: z.number().nullable(),
  wake_at: z.number().nullable(),
});

const claimedAttemptSchema = z.object({ run_attempt: z.number() });

const jsonRecordSchema = z.record(z.string(), z.unknown());

/** Serializes a value as plain JSON (no envelope), rejecting non-JSON data. */
const toJsonText = (value: unknown, entity: string): string => {
  try {
    return JSON.stringify(z.json().parse(value));
  } catch (reason) {
    throw new ResultSerializationError(entity, reason);
  }
};

/** Short description of a rejected value for error messages. */
const describeValue = (value: unknown): string =>
  value === null ? "null" : Array.isArray(value) ? "an array" : typeof value;

/**
 * Validates and serializes a `step.status` meta object: a plain JSON object
 * (no arrays, no non-JSON values) of at most {@link STATUS_META_MAX_BYTES}
 * serialized UTF-8 bytes. Rejections are loud and specific.
 */
const serializeStatusMeta = (meta: unknown): string => {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    throw new TypeError(`setStatus meta must be a plain JSON object, got ${describeValue(meta)}`);
  }
  const json = toJsonText(meta, "status meta");
  const bytes = new TextEncoder().encode(json).byteLength;
  if (bytes > STATUS_META_MAX_BYTES) {
    throw new RangeError(
      `setStatus meta must serialize to at most ${STATUS_META_MAX_BYTES} bytes, got ${bytes}`,
    );
  }
  return json;
};

/**
 * The per-lease step capability (docs/how-it-works.md §4(b) and §5 (leases, generations, replay)): constructed by TaskRunner for
 * exactly one claimed attempt and passed to `runTask` as an RPC argument —
 * workerd replaces it with a stub whose calls run back inside the DO and
 * which dies when the RPC settles. Every write it performs is additionally
 * generation-guarded in SQL, covering orphaned stubs the runtime can't see.
 */
export class DurableStep extends RpcTarget implements DurableStepStub {
  readonly #runner: TaskRunner;
  readonly #generation: string;
  readonly taskId: string;
  readonly attempt: number;

  constructor(runner: TaskRunner, taskId: string, attempt: number, generation: string) {
    super();
    this.#runner = runner;
    this.taskId = taskId;
    this.attempt = attempt;
    this.#generation = generation;
  }

  beginStep(stepKey: string, options?: BeginStepOptions): Promise<BeginStepResult> {
    return this.#runner.beginStep(this.#generation, stepKey, options);
  }

  completeStep(stepKey: string, value: unknown): Promise<boolean> {
    return this.#runner.completeStep(this.#generation, stepKey, value);
  }

  failStep(
    stepKey: string,
    error: SerializedError,
    disposition: StepFailureDisposition,
  ): Promise<boolean> {
    return this.#runner.failStep(this.#generation, stepKey, error, disposition);
  }

  recordSleep(stepKey: string, wakeAtMs: number): Promise<SleepState> {
    return this.#runner.recordSleep(this.#generation, stepKey, wakeAtMs);
  }

  recordElicit(stepKey: string, request: unknown, timeoutAtMs?: number): Promise<ElicitState> {
    return this.#runner.recordElicit(this.#generation, stepKey, request, timeoutAtMs);
  }

  recordOffer(key: string, request: unknown): Promise<void> {
    return this.#runner.recordOffer(this.#generation, key, request);
  }

  checkInput(stepKey: string, key: string): Promise<CheckInputState> {
    return this.#runner.checkInput(this.#generation, stepKey, key);
  }

  setStatus(message: string, meta?: unknown): Promise<void> {
    return this.#runner.setStatus(this.#generation, message, meta);
  }

  checkCancel(): Promise<boolean> {
    return this.#runner.checkCancel();
  }
}

interface InFlightAttempt {
  generation: string;
  /** Settlement promise (never rejects): runTask -> settle -> reconcile. */
  settled: Promise<void>;
  /**
   * Wake requests (`run_next_at` writes by `tasks/update`: an elicit resume
   * or an answered offer cutting a sleep) that landed while this attempt was
   * executing. The attempt's suspended settlement clears `run_next_at` only
   * when this is zero — otherwise it would wipe a wake the alarm has not
   * honored yet and strand the task until its TTL.
   */
  wakeRequests: number;
  /**
   * An offer was answered while this attempt was executing and found no
   * pending sleep to cut: the next sleep this attempt records is journaled
   * already completed (cut on arrival), so the handler reaches its next
   * `checkInput` without waiting out the beat. Cleared once honored — by that
   * cut, or by a `checkInput` that consumes an answer first.
   */
  cutNextSleep: boolean;
}

export class TaskRunner extends DurableObject<TaskRunnerEnv> {
  /**
   * The attempt currently executing, if any. In-memory only: alarm
   * invocations attach to it instead of double-claiming (docs/how-it-works.md §4(b) and §5 (leases, generations, replay)); an
   * eviction clears it, and the persisted wake re-claims with a fresh
   * generation.
   */
  #inFlight: InFlightAttempt | undefined;

  /**
   * Whether the schema DDL has been committed. Probed (pure read) in the
   * constructor and flipped by the lazy bootstrap: `tasks/get` MUST NOT
   * write on the not-found path (docs/how-it-works.md §4(h) (tasks/get through the router)) — an empty DO with no storage
   * writes is never persisted — so the DDL runs on `create()`, not on cold
   * start. While the flag is false there is no task by construction, and
   * every read short-circuits without touching SQL.
   */
  #schemaReady = false;

  constructor(ctx: DurableObjectState, env: TaskRunnerEnv) {
    super(ctx, env);
    // Greenfield bootstrap (docs/how-it-works.md §3 (data model)): idempotent DDL, no migration
    // framework — deferred to the first write (see #schemaReady). The
    // constructor only probes for an existing schema, which is a pure read.
    ctx.blockConcurrencyWhile(async () => {
      this.#schemaReady = this.#hasSchema();
    });
  }

  // ---------------------------------------------------------------- seams --

  /**
   * Resolves the executor (decision D6 as amended): `ctx.exports.TaskExecutor`
   * loopback first, the `TASK_EXECUTOR` service binding as fallback.
   * Protected so the test fixture can inject a fake without touching engine
   * logic; stage 3's real entrypoint needs no override.
   */
  protected resolveExecutor(): TaskExecutorLike {
    const exportsMap = this.ctx.exports as Partial<Record<string, unknown>>;
    const loopback = exportsMap[DEFAULT_TASK_EXECUTOR_ENTRYPOINT];
    if (loopback !== undefined && loopback !== null) {
      return loopback as TaskExecutorLike;
    }
    const bound = this.env[DEFAULT_TASK_EXECUTOR_BINDING];
    if (bound !== undefined && bound !== null) {
      return bound as TaskExecutorLike;
    }
    throw new Error(
      `TaskRunner cannot reach the task executor: no "${DEFAULT_TASK_EXECUTOR_ENTRYPOINT}" ` +
        `entrypoint in ctx.exports and no "${DEFAULT_TASK_EXECUTOR_BINDING}" service binding`,
    );
  }

  /** Handoff deadline for one alarm invocation. Protected for tests. */
  protected get alarmHandoffMs(): number {
    return DEFAULT_ALARM_HANDOFF_MS;
  }

  /**
   * Delay before an execution wake is scheduled (creation, cancellation,
   * update-resume). Production: 0 — `setAlarm(now)` is the eager path
   * (docs/how-it-works.md §4(a) (task creation)). The test fixture pushes this far into the future so
   * workerd never fires alarms on its own and `runDurableObjectAlarm` drain
   * loops stay the only driver (design/002 determinism rule).
   */
  protected get initialWakeDelayMs(): number {
    return 0;
  }

  /**
   * Redelivery backoff after a failed executor dispatch (docs/how-it-works.md §6 (reliability: alarm semantics)):
   * exponential from a 1s base to a 5-minute cap, with equal jitter. There is
   * no invocation attempt limit — the TTL bounds retries; `ttlMs: null` tasks
   * retry until cancelled. Protected for test determinism.
   */
  protected invocationRetryDelayMs(attempt: number): number {
    return Math.round(jitter(exponential(attempt)));
  }

  // ------------------------------------------------------- public surface --

  /**
   * Creates the task row and arms the immediate execution alarm, atomically,
   * before resolving (spec MUST: strong consistency at creation). Idempotent
   * — INSERT-or-ignore keyed by taskId — and therefore safe under the
   * `callTaskRunner` retry wrapper.
   */
  async create(req: CreateTaskInput): Promise<TaskSnapshot> {
    const now = Date.now();
    const generation = crypto.randomUUID();
    // Lazy schema bootstrap (see #schemaReady), outside the transaction so a
    // rolled-back create can never leave the ready flag out of sync with the
    // committed DDL.
    this.#ensureSchema();
    // NOTE: validation happens inside the transaction so a rejection is
    // raised from an async context — the workers pool reports RPC promises
    // rejected in the invocation microtask as unhandled errors.
    await this.ctx.storage.transaction(async (txn) => {
      if (req.ttlMs !== null && (!Number.isSafeInteger(req.ttlMs) || req.ttlMs < 0)) {
        throw new RangeError(`ttlMs must be null or a non-negative integer, got ${req.ttlMs}`);
      }
      if (!Number.isSafeInteger(req.pollIntervalMs) || req.pollIntervalMs <= 0) {
        throw new RangeError(
          `pollIntervalMs must be a positive integer, got ${req.pollIntervalMs}`,
        );
      }
      const input = serializeValue(req.input, `task "${req.taskId}" input`);
      this.#sql.exec(
        `INSERT INTO task
           (task_id, tool_name, input, status, created_at, last_updated_at,
            ttl_ms, poll_interval_ms, run_attempt, run_generation, run_next_at, auth_key)
         VALUES (?, ?, ?, 'working', ?, ?, ?, ?, 0, ?, ?, ?)
         ON CONFLICT(task_id) DO NOTHING`,
        req.taskId,
        req.toolName,
        input,
        now,
        now,
        req.ttlMs,
        req.pollIntervalMs,
        generation,
        now + this.initialWakeDelayMs,
        req.authKey ?? null,
      );
      const winner = this.#readTask();
      if (winner === undefined) {
        throw new Error(`Task "${req.taskId}" was not persisted`);
      }
      if (winner.task_id !== req.taskId) {
        throw new Error(
          `TaskRunner instance already holds task "${winner.task_id}", refusing "${req.taskId}"`,
        );
      }
      if (winner.tool_name !== req.toolName) {
        throw new Error(
          `Task "${req.taskId}" was created for tool "${winner.tool_name}", not "${req.toolName}"`,
        );
      }
      await this.#reconcileAlarm(txn);
    });
    const row = this.#readTask();
    if (row === undefined) {
      throw new Error(`Task "${req.taskId}" was not persisted`);
    }
    return this.#baseSnapshot(row);
  }

  /**
   * Pure idempotent read backing `tasks/get`. Performs no storage writes on
   * the not-found path (docs/how-it-works.md §4(h) (tasks/get through the router) MUST): with the schema bootstrap
   * deferred to `create()`, a poll of an unknown taskId leaves the DO with
   * zero storage writes, so it is never persisted.
   *
   * Auth (decision D12): when the task was created with an `auth_key`, a
   * caller whose `callerAuthKey` does not match is answered `notFound` —
   * mismatched pollers are rejected without leaking that the task exists.
   * Tasks created without an `auth_key` are pure bearer handles.
   */
  async get(callerAuthKey?: string): Promise<DetailedTaskSnapshot | TaskNotFound> {
    const row = this.#readTask();
    if (row === undefined) {
      return { notFound: true };
    }
    if (row.auth_key !== null && row.auth_key !== callerAuthKey) {
      return { notFound: true };
    }
    return this.#toDetailedSnapshot(row);
  }

  /**
   * Backing for `tasks/update` (decision D13 groundwork): stores responses on
   * matching outstanding input requests — blocking elicits and standing
   * offers alike (partial responses accepted, unknown and already-answered
   * keys ignored — spec MUST; first answer wins). The resume-to-working
   * bookkeeping counts ONLY blocking requests: once none remain outstanding
   * the task returns to `working` — an outstanding offer never holds it in
   * `input_required`. An answer to a standing offer on a `working` task
   * additionally wakes the story ({@link #wakeForInput}) WITHOUT touching
   * the status; while the task is `input_required` the answer is stored only
   * (the elicit's own resume replays through the next `checkInput`). A wake
   * requested while an attempt is executing is noted on it, so the attempt's
   * settlement cannot erase it. Idempotent; eventually consistent ack.
   */
  async update(inputResponses: Record<string, unknown>): Promise<void> {
    const now = Date.now();
    await this.ctx.storage.transaction(async (txn) => {
      if (
        inputResponses === null ||
        typeof inputResponses !== "object" ||
        Array.isArray(inputResponses)
      ) {
        throw new TypeError("inputResponses must be an object keyed by input-request key");
      }
      const row = this.#readTask();
      if (row === undefined || isTerminal(row.status)) {
        return; // ack; nothing to update
      }
      let answeredBlocking = false;
      let answeredOffer = false;
      for (const [key, response] of Object.entries(inputResponses)) {
        const responseJson = toJsonText(response, `input response "${key}"`);
        const stored = this.#sql
          .exec(
            `UPDATE input_requests SET response = ?, answered = 1
             WHERE key = ? AND answered = 0
             RETURNING blocking`,
            responseJson,
            key,
          )
          .toArray()
          .at(0);
        if (stored === undefined) {
          continue; // unknown key, or already answered (consumed or not): ignored
        }
        if (answeredRequestSchema.parse(stored).blocking === 1) {
          answeredBlocking = true;
        } else {
          answeredOffer = true;
        }
      }
      if (answeredBlocking || answeredOffer) {
        const resumed =
          answeredBlocking &&
          row.status === "input_required" &&
          this.#outstandingBlockingRequestCount() === 0;
        if (resumed) {
          // All blocking requests answered: resume execution. The attempt
          // that recorded the elicit may still be settling — keep the wake.
          this.#sql.exec(
            `UPDATE task SET status = 'working', run_next_at = ?, last_updated_at = ?
             WHERE status = 'input_required'`,
            now + this.initialWakeDelayMs,
            now,
          );
          this.#noteWakeRequest();
        } else {
          this.#sql.exec(`UPDATE task SET last_updated_at = ?`, now);
        }
        if (answeredOffer && row.status === "working") {
          this.#wakeForInput(now);
        }
      }
      await this.#reconcileAlarm(txn);
    });
  }

  /**
   * Cooperative cancellation: sets `cancel_requested`, schedules a wake so
   * the alarm can settle it, and acks. Ack does not mean stopped — work that
   * finishes first stays `completed` (spec-sanctioned).
   */
  async cancel(): Promise<void> {
    const row = this.#readTask();
    if (row === undefined || isTerminal(row.status)) {
      return; // idempotent ack
    }
    const now = Date.now();
    await this.ctx.storage.transaction(async (txn) => {
      this.#sql.exec(
        `UPDATE task SET cancel_requested = 1,
                         run_next_at = COALESCE(run_next_at, ?),
                         last_updated_at = ?
         WHERE status IN ('working','input_required')`,
        now + this.initialWakeDelayMs,
        now,
      );
      await this.#reconcileAlarm(txn);
    });
  }

  /**
   * The engine loop: re-arm -> deadline/cancel checks -> claim -> executor
   * RPC -> settle. Never throws (workerd drops an alarm after 6 failed
   * retries; the engine persists its own retry schedule instead), and treats
   * `info` as optional because `runDurableObjectAlarm` invokes with no
   * arguments.
   */
  override async alarm(info?: AlarmInvocationInfo): Promise<void> {
    void info;
    try {
      await this.#alarmTick();
    } catch {
      // Last resort: make sure a wake survives so the task is never stranded.
      try {
        await this.ctx.storage.setAlarm(Date.now() + ALARM_BACKSTOP_MS);
      } catch {
        // Storage is gone; nothing left to do.
      }
    }
  }

  // ---------------------------------------- DurableStep-facing (internal) --

  /**
   * Claims a step execution for the calling lease. Journal hit -> memoized
   * directive (closure MUST NOT run); miss -> `run` directive with the step
   * attempt number. Guarded by the lease generation (docs/how-it-works.md §3 (data model) idiom).
   */
  async beginStep(
    generation: string,
    stepKey: string,
    options?: BeginStepOptions,
  ): Promise<BeginStepResult> {
    return this.ctx.storage.transaction(async () => {
      const row = this.#requireLease(generation);
      if (row.cancel_requested === 1) {
        return { state: "cancelled" };
      }
      const now = Date.now();
      const step = this.#readStep(stepKey);
      if (step === undefined) {
        this.#sql.exec(
          `INSERT INTO steps (step_key, kind, status, attempt, timeout_ms, created_at)
           SELECT ?, 'do', 'pending', 1, ?, ?
           WHERE (SELECT run_generation FROM task) = ?`,
          stepKey,
          options?.timeoutMs ?? null,
          now,
          generation,
        );
        return { state: "run", attempt: 1 };
      }
      if (step.kind !== "do") {
        throw new DuplicateStepError(stepKey);
      }
      if (step.status === "completed") {
        return {
          state: "completed",
          value: step.result === null ? undefined : deserializeValue(step.result),
        };
      }
      if (step.status === "failed") {
        return {
          state: "failed",
          error: {
            name: step.last_error_name ?? "Error",
            message: step.last_error ?? `step "${stepKey}" failed`,
          },
        };
      }
      const claimed = this.#sql
        .exec(
          `UPDATE steps SET attempt = attempt + 1, next_attempt_at = NULL
           WHERE step_key = ? AND status = 'pending'
             AND (SELECT run_generation FROM task) = ?
           RETURNING attempt`,
          stepKey,
          generation,
        )
        .toArray()
        .at(0);
      if (claimed === undefined) {
        throw new StaleLeaseError(row.task_id, `step "${stepKey}" claim was superseded`);
      }
      const attempt = z.object({ attempt: z.number() }).parse(claimed).attempt;
      return { state: "run", attempt };
    });
  }

  /**
   * Persists a step result (undefined-safe envelope) with the exact guarded
   * UPDATE from docs/how-it-works.md §3 (data model). Returns whether a row was updated — `false` means
   * the step was not pending (e.g. a duplicate completion), while a dead
   * lease throws.
   */
  async completeStep(generation: string, stepKey: string, value: unknown): Promise<boolean> {
    const now = Date.now();
    let updated = false;
    await this.ctx.storage.transaction(async (txn) => {
      this.#requireLease(generation);
      const result = serializeValue(value, `step "${stepKey}"`);
      updated =
        this.#sql
          .exec(
            `UPDATE steps SET status = 'completed', result = ?, completed_at = ?,
                              next_attempt_at = NULL, last_error = NULL, last_error_name = NULL
             WHERE step_key = ? AND status = 'pending'
               AND (SELECT run_generation FROM task) = ?
             RETURNING step_key`,
            result,
            now,
            stepKey,
            generation,
          )
          .toArray().length > 0;
      await this.#reconcileAlarm(txn);
    });
    return updated;
  }

  /**
   * Records a failed step attempt: retry disposition keeps the step pending
   * with `next_attempt_at` at the executor-computed backoff time; terminal
   * disposition marks it `failed`. Generation-guarded.
   */
  async failStep(
    generation: string,
    stepKey: string,
    error: SerializedError,
    disposition: StepFailureDisposition,
  ): Promise<boolean> {
    const safeError = serializeError(error);
    let updated = false;
    await this.ctx.storage.transaction(async (txn) => {
      this.#requireLease(generation);
      const terminal = "terminal" in disposition && disposition.terminal;
      let retryAt: number | null = null;
      if (!terminal) {
        const at = "retryAtMs" in disposition ? disposition.retryAtMs : Number.NaN;
        if (!Number.isSafeInteger(at) || at < 0) {
          throw new RangeError(
            `failStep("${stepKey}") retryAtMs must be a non-negative safe integer, got ${at}`,
          );
        }
        retryAt = at;
      }
      updated =
        this.#sql
          .exec(
            `UPDATE steps SET status = ?, next_attempt_at = ?, last_error = ?, last_error_name = ?
             WHERE step_key = ? AND status = 'pending'
               AND (SELECT run_generation FROM task) = ?
             RETURNING step_key`,
            terminal ? "failed" : "pending",
            retryAt,
            safeError.message,
            safeError.name,
            stepKey,
            generation,
          )
          .toArray().length > 0;
      await this.#reconcileAlarm(txn);
    });
    return updated;
  }

  /**
   * Journals a durable sleep. The wake itself is settled DO-side: the alarm
   * invocation that honors the wake marks the sleep completed before
   * replaying, so replays observe `completed` and resolve instantly. A sleep
   * first recorded by an attempt that was told to cut its next sleep (an
   * offer answered while it was executing, see {@link #wakeForInput}) is
   * journaled completed on arrival and resolves at once.
   */
  /**
   * Whether `stepKey` is the most recently created sleep/elicit row: the last
   * suspension point the previous run recorded, where a replaying handler is
   * back on new ground (everything it replays before this is old ground).
   */
  #isLatestSuspension(stepKey: string): boolean {
    // Suspension points live in two tables: sleeps in `steps`, blocking
    // elicits in `input_requests` (offers are non-blocking and never suspend).
    const rows = this.#sql
      .exec<{ step_key: string }>(
        `SELECT step_key FROM (
           SELECT step_key, created_at FROM steps WHERE kind = 'sleep'
           UNION ALL
           SELECT step_key, created_at FROM input_requests WHERE blocking = 1
         ) ORDER BY created_at DESC LIMIT 1`,
      )
      .toArray();
    return rows.at(0)?.step_key === stepKey;
  }

  async recordSleep(generation: string, stepKey: string, wakeAtMs: number): Promise<SleepState> {
    return this.ctx.storage.transaction(async (txn) => {
      this.#requireLease(generation);
      if (!Number.isSafeInteger(wakeAtMs) || wakeAtMs < 0) {
        throw new RangeError(
          `recordSleep("${stepKey}") wakeAtMs must be a non-negative safe integer, got ${wakeAtMs}`,
        );
      }
      const step = this.#readStep(stepKey);
      if (step !== undefined && step.kind !== "sleep") {
        throw new DuplicateStepError(stepKey);
      }
      if (step?.status === "completed") {
        return { state: "completed", latest: this.#isLatestSuspension(stepKey) };
      }
      if (step === undefined) {
        const now = Date.now();
        const cut = this.#inFlight?.generation === generation && this.#inFlight.cutNextSleep;
        if (cut && this.#inFlight !== undefined) {
          this.#inFlight.cutNextSleep = false; // honored by this sleep
        }
        this.#sql.exec(
          `INSERT INTO steps (step_key, kind, status, attempt, wake_at, created_at, completed_at)
           SELECT ?, 'sleep', ?, 0, ?, ?, ?
           WHERE (SELECT run_generation FROM task) = ?`,
          stepKey,
          cut ? "completed" : "pending",
          wakeAtMs,
          now,
          cut ? now : null,
          generation,
        );
        await this.#reconcileAlarm(txn);
        if (cut) {
          // Just inserted, so it IS the latest suspension row: live ground.
          return { state: "completed", latest: true };
        }
      }
      return { state: "pending" };
    });
  }

  /**
   * Records an input request under a lifetime-unique key (decision D13) and
   * moves the task to `input_required`. Once `tasks/update` answers it, the
   * replay observes `answered` and the step resolves with the response.
   *
   * `timeoutAtMs` (ms epoch) is the answer deadline, journaled with the
   * request on first record and immutable across replays — a later
   * invocation's recomputed deadline is ignored. The alarm reconciliation
   * includes the deadline in its computed min; when it elapses unanswered,
   * the alarm sweep marks the request answered-by-timeout (`timed_out = 1`),
   * so late `tasks/update` responses to the key are ignored by the
   * answered guard, and the replay observes `timed_out` here.
   */
  async recordElicit(
    generation: string,
    stepKey: string,
    request: unknown,
    timeoutAtMs?: number,
  ): Promise<ElicitState> {
    return this.ctx.storage.transaction(async (txn) => {
      this.#requireLease(generation);
      if (timeoutAtMs !== undefined && (!Number.isSafeInteger(timeoutAtMs) || timeoutAtMs < 0)) {
        throw new RangeError(
          `recordElicit("${stepKey}") timeoutAtMs must be a non-negative safe integer, got ${timeoutAtMs}`,
        );
      }
      const existing = this.#readInputRequest(stepKey);
      if (existing !== undefined && existing.blocking === 0) {
        throw new DuplicateStepError(stepKey); // the key is a standing offer
      }
      if (existing !== undefined && existing.answered === 1) {
        if (existing.timed_out === 1) {
          return { state: "timed_out", latest: this.#isLatestSuspension(stepKey) };
        }
        return {
          state: "answered",
          latest: this.#isLatestSuspension(stepKey),
          response: existing.response === null ? undefined : JSON.parse(existing.response),
        };
      }
      const now = Date.now();
      if (existing === undefined) {
        const requestJson = toJsonText(request, `input request "${stepKey}"`);
        this.#sql.exec(
          `INSERT INTO input_requests (key, step_key, request, answered, timeout_at, created_at)
           SELECT ?, ?, ?, 0, ?, ?
           WHERE (SELECT run_generation FROM task) = ?`,
          stepKey,
          stepKey,
          requestJson,
          timeoutAtMs ?? null,
          now,
          generation,
        );
      }
      // An existing pending row keeps its stored deadline: first record wins.
      this.#sql.exec(
        `UPDATE task SET status = 'input_required', run_next_at = NULL, last_updated_at = ?
         WHERE status = 'working' AND run_generation = ?`,
        now,
        generation,
      );
      await this.#reconcileAlarm(txn);
      return { state: "pending" };
    });
  }

  /**
   * Registers a standing, NON-blocking input request (`step.offer`) under a
   * lifetime-unique key: an `input_requests` row with `blocking = 0`. The
   * task stays `working`, `status_message` is untouched, nothing suspends,
   * and no alarm candidate is added (offers have no deadline). Journal-safe:
   * a replay's re-offer finds the existing row and returns (the first
   * recorded request stands — immutable, like an elicit's). The key shares
   * the table with elicit names, so reusing an elicit key throws
   * {@link DuplicateStepError}. Generation-guarded.
   */
  async recordOffer(generation: string, key: string, request: unknown): Promise<void> {
    await this.ctx.storage.transaction(async () => {
      this.#requireLease(generation);
      if (typeof key !== "string" || key.length === 0) {
        throw new TypeError("recordOffer requires a non-empty key");
      }
      const existing = this.#readInputRequest(key);
      if (existing !== undefined) {
        if (existing.blocking === 1) {
          throw new DuplicateStepError(key); // the key is a blocking elicit
        }
        return; // replay: the standing offer already exists
      }
      const requestJson = toJsonText(request, `input request "${key}"`);
      this.#sql.exec(
        `INSERT INTO input_requests (key, step_key, request, answered, blocking, created_at)
         SELECT ?, ?, ?, 0, 0, ?
         WHERE (SELECT run_generation FROM task) = ?`,
        key,
        key,
        requestJson,
        Date.now(),
        generation,
      );
    });
  }

  /**
   * Journaled, non-blocking consume (`step.checkInput`) of the offer under
   * `key`, as the step `stepKey` (a `steps` row of kind `check`, completed
   * on creation). A journal hit returns the journaled value — hit or miss —
   * so replays are deterministic regardless of what landed since. On a
   * journal miss: an answered, not-yet-consumed offer is marked `consumed`
   * and its response journaled and returned; anything else journals a
   * miss (`null`). The offer stays open after a miss (a later answer is
   * consumed by the NEXT check). Throws for a key that is not a registered
   * offer (unknown, or a blocking elicit) and for a `stepKey` journaled as
   * another step kind. Generation-guarded; no scheduling effect.
   */
  async checkInput(generation: string, stepKey: string, key: string): Promise<CheckInputState> {
    return this.ctx.storage.transaction(async () => {
      this.#requireLease(generation);
      if (typeof key !== "string" || key.length === 0) {
        throw new TypeError(`checkInput("${stepKey}") requires a non-empty offer key`);
      }
      const step = this.#readStep(stepKey);
      if (step !== undefined) {
        if (step.kind !== "check") {
          throw new DuplicateStepError(stepKey);
        }
        const journaled = step.result === null ? null : deserializeValue(step.result);
        return journaled === null
          ? { state: "unanswered" }
          : { state: "answered", response: journaled };
      }
      const offer = this.#readInputRequest(key);
      if (offer === undefined) {
        throw new TypeError(
          `checkInput("${stepKey}"): no input request is registered under key "${key}"`,
        );
      }
      if (offer.blocking === 1) {
        throw new TypeError(
          `checkInput("${stepKey}"): key "${key}" is a blocking elicit, not a standing offer`,
        );
      }
      let response: unknown = null;
      if (offer.answered === 1 && offer.consumed === 0 && offer.response !== null) {
        const consumed =
          this.#sql
            .exec(
              `UPDATE input_requests SET consumed = 1
               WHERE key = ? AND consumed = 0
                 AND (SELECT run_generation FROM task) = ?
               RETURNING key`,
              key,
              generation,
            )
            .toArray().length > 0;
        if (consumed) {
          response = JSON.parse(offer.response);
          if (this.#inFlight?.generation === generation) {
            this.#inFlight.cutNextSleep = false; // the in-flight wake is honored by this consume
          }
        }
      }
      const now = Date.now();
      this.#sql.exec(
        `INSERT INTO steps (step_key, kind, status, attempt, result, created_at, completed_at)
         SELECT ?, 'check', 'completed', 0, ?, ?, ?
         WHERE (SELECT run_generation FROM task) = ?`,
        stepKey,
        serializeValue(response, `step "${stepKey}"`),
        now,
        now,
        generation,
      );
      return response === null ? { state: "unanswered" } : { state: "answered", response };
    });
  }

  /**
   * Durable handler telemetry backing `step.status`. The handler is the ONLY
   * writer of `status_message` and `status_meta` — the engine never narrates
   * its own transitions — so the columns stay NULL until the first call and
   * the last written values stand, through suspensions, replays, and terminal
   * transitions alike (terminal settles store result/error as usual and leave
   * them untouched). `meta`, when passed, REPLACES `status_meta` wholesale
   * (validated: a plain JSON object of at most {@link STATUS_META_MAX_BYTES}
   * serialized bytes); a call without `meta` leaves the stored meta alone.
   * Not a journal write: no step row is created, replay ordering is
   * undisturbed, and duplicate delivery on replay (the handler body re-runs
   * from the top) harmlessly rewrites the same values. Generation-guarded: a
   * superseded lease throws {@link StaleLeaseError}; once the task is
   * terminal the call is a no-op.
   */
  async setStatus(generation: string, message: string, meta?: unknown): Promise<void> {
    const now = Date.now();
    await this.ctx.storage.transaction(async () => {
      // Validation inside the transaction: rejections must be raised from an
      // async context (see the NOTE in create()).
      if (typeof message !== "string") {
        throw new TypeError(`setStatus message must be a string, got ${typeof message}`);
      }
      const metaJson = meta === undefined ? undefined : serializeStatusMeta(meta);
      const row = this.#readTask();
      if (row === undefined) {
        throw new StaleLeaseError("<purged>", "the task no longer exists");
      }
      if (isTerminal(row.status)) {
        return; // terminal no-op: message and meta keep their last values
      }
      if (row.run_generation !== generation) {
        throw new StaleLeaseError(row.task_id, "the attempt was superseded by a newer claim");
      }
      if (metaJson === undefined) {
        this.#sql.exec(
          `UPDATE task SET status_message = ?, last_updated_at = ?
           WHERE run_generation = ? AND status IN ('working','input_required')`,
          message,
          now,
          generation,
        );
      } else {
        this.#sql.exec(
          `UPDATE task SET status_message = ?, status_meta = ?, last_updated_at = ?
           WHERE run_generation = ? AND status IN ('working','input_required')`,
          message,
          metaJson,
          now,
          generation,
        );
      }
    });
  }

  /** Cooperative cancellation check (docs/how-it-works.md §4(b) and §5 (leases, generations, replay)). Pure read. */
  async checkCancel(): Promise<boolean> {
    const row = this.#readTask();
    return row !== undefined && row.cancel_requested === 1;
  }

  // ------------------------------------------------------------- internals --

  get #sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  /** Pure read: whether the schema DDL was ever committed on this DO. */
  #hasSchema(): boolean {
    return (
      this.#sql
        .exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task'`)
        .toArray().length > 0
    );
  }

  /** Commits the schema DDL once (lazy bootstrap, see #schemaReady). */
  #ensureSchema(): void {
    if (!this.#schemaReady) {
      this.#sql.exec(SCHEMA_DDL);
      this.#schemaReady = true;
    }
  }

  #readTask(): TaskRow | undefined {
    if (!this.#schemaReady) {
      return undefined; // no schema -> no task, and reads must not write
    }
    const raw = this.#sql.exec(`SELECT * FROM task LIMIT 1`).toArray().at(0);
    return raw === undefined ? undefined : taskRowSchema.parse(raw);
  }

  #readStep(stepKey: string): z.output<typeof stepRowSchema> | undefined {
    const raw = this.#sql.exec(`SELECT * FROM steps WHERE step_key = ?`, stepKey).toArray().at(0);
    return raw === undefined ? undefined : stepRowSchema.parse(raw);
  }

  #readInputRequest(key: string): z.output<typeof inputRequestRowSchema> | undefined {
    const raw = this.#sql.exec(`SELECT * FROM input_requests WHERE key = ?`, key).toArray().at(0);
    return raw === undefined ? undefined : inputRequestRowSchema.parse(raw);
  }

  /**
   * Unanswered BLOCKING requests (elicits). Standing offers are excluded on
   * purpose: they never hold the task in `input_required` and never block a
   * resume.
   */
  #outstandingBlockingRequestCount(): number {
    const raw = this.#sql
      .exec(
        `SELECT COUNT(*) AS outstanding FROM input_requests
         WHERE answered = 0 AND blocking = 1`,
      )
      .toArray()
      .at(0);
    return z.object({ outstanding: z.number() }).parse(raw).outstanding;
  }

  /**
   * The `inputRequests` an `input_required` snapshot carries: unanswered
   * BLOCKING requests only. Standing offers are ambient — announced in-story,
   * never on the wire (the field is tied to `input_required`).
   */
  #outstandingBlockingRequests(): InputRequests {
    const requests: Record<string, unknown> = {};
    for (const raw of this.#sql
      .exec(
        `SELECT * FROM input_requests
         WHERE answered = 0 AND blocking = 1
         ORDER BY created_at`,
      )
      .toArray()) {
      const row = inputRequestRowSchema.parse(raw);
      requests[row.key] = JSON.parse(row.request);
    }
    return requests as InputRequests;
  }

  /**
   * Notes a wake request (`run_next_at` written by `tasks/update`) on the
   * attempt executing right now, if any, so its suspended settlement keeps
   * the wake instead of clearing the anchor it was claimed under.
   */
  #noteWakeRequest(): void {
    if (this.#inFlight !== undefined) {
      this.#inFlight.wakeRequests += 1;
    }
  }

  /**
   * The wake an answered standing offer triggers on a `working` task (status
   * untouched). A `step.sleep` pending at this moment is cut short — marked
   * completed, so the resumed replay resolves it at once and reaches the next
   * `checkInput` — and the wake anchor is set to now, so the caller's
   * reconcile arms the alarm immediately; if the sleeping attempt is still
   * settling, the wake is noted on it and survives. With no sleep pending and
   * an attempt executing, that attempt is told to cut the next sleep it
   * records (its next `checkInput` consumes the answer either way). With no
   * sleep pending and nothing executing — a step retry backoff, or a
   * redelivery already scheduled — the schedule stands and the next run's
   * `checkInput` consumes the answer; a retry backoff is never pre-empted.
   */
  #wakeForInput(now: number): void {
    const cut =
      this.#sql
        .exec(
          `UPDATE steps SET status = 'completed', completed_at = ?
           WHERE kind = 'sleep' AND status = 'pending'
           RETURNING step_key`,
          now,
        )
        .toArray().length > 0;
    if (cut) {
      this.#sql.exec(
        `UPDATE task SET run_next_at = ? WHERE status = 'working'`,
        now + this.initialWakeDelayMs,
      );
      this.#noteWakeRequest();
      return;
    }
    if (this.#inFlight !== undefined) {
      this.#inFlight.cutNextSleep = true;
    }
  }

  /** Validates that the calling lease still owns the task, else throws. */
  #requireLease(generation: string): TaskRow {
    const row = this.#readTask();
    if (row === undefined) {
      throw new StaleLeaseError("<purged>", "the task no longer exists");
    }
    if (isTerminal(row.status)) {
      throw new StaleLeaseError(row.task_id, `the task is already ${row.status}`);
    }
    if (row.run_generation !== generation) {
      throw new StaleLeaseError(row.task_id, "the attempt was superseded by a newer claim");
    }
    return row;
  }

  /**
   * The earliest pending execution wake: the task-level redelivery anchor
   * (`run_next_at`), step retry backoffs, and sleep wakes (docs/how-it-works.md §3 (data model)).
   * Execution wakes are treated as due whenever the alarm fires — production
   * only fires at/after the scheduled minimum, and deterministic tests fire
   * early on purpose (design/002 §8.2).
   */
  #earliestExecutionWake(row: TaskRow): number | undefined {
    const candidates: number[] = [];
    if (row.run_next_at !== null) {
      candidates.push(row.run_next_at);
    }
    const mins = pendingWakeMinsSchema.parse(
      this.#sql
        .exec(
          `SELECT MIN(CASE WHEN kind = 'do' THEN next_attempt_at END) AS retry_at,
                  MIN(CASE WHEN kind = 'sleep' THEN wake_at END) AS wake_at
           FROM steps WHERE status = 'pending'`,
        )
        .toArray()
        .at(0),
    );
    if (mins.retry_at !== null) {
      candidates.push(mins.retry_at);
    }
    if (mins.wake_at !== null) {
      candidates.push(mins.wake_at);
    }
    return candidates.length === 0 ? undefined : Math.min(...candidates);
  }

  /**
   * The earliest unanswered elicit answer deadline, or undefined. Kept apart
   * from {@link #earliestExecutionWake} on purpose: execution wakes are
   * due-on-fire, while elicit deadlines are wall-clock honest (like the TTL)
   * — an early alarm fire must not resolve a timeout before its time.
   */
  #earliestElicitDeadline(): number | undefined {
    const raw = this.#sql
      .exec(
        `SELECT MIN(timeout_at) AS deadline FROM input_requests
         WHERE answered = 0 AND blocking = 1 AND timeout_at IS NOT NULL`,
      )
      .toArray()
      .at(0);
    const deadline = z.object({ deadline: z.number().nullable() }).parse(raw).deadline;
    return deadline ?? undefined;
  }

  /**
   * Computed alarm bookkeeping (docs/how-it-works.md §3 (data model) — deviation from durability, which
   * stored it): min of the execution wakes, the pending elicit answer
   * deadlines, and the TTL deadline (which doubles as expiry for live tasks
   * and purge time for terminal ones).
   */
  #nextScheduledAt(row: TaskRow): number | undefined {
    const deadline = row.ttl_ms === null ? undefined : row.created_at + row.ttl_ms;
    if (isTerminal(row.status)) {
      return deadline;
    }
    const candidates: number[] = [];
    if (deadline !== undefined) {
      candidates.push(deadline);
    }
    const execution = this.#earliestExecutionWake(row);
    if (execution !== undefined) {
      candidates.push(execution);
    }
    const elicitDeadline = this.#earliestElicitDeadline();
    if (elicitDeadline !== undefined) {
      candidates.push(elicitDeadline);
    }
    return candidates.length === 0 ? undefined : Math.min(...candidates);
  }

  /** durability's reconcileAlarm, keyed to the computed schedule. */
  async #reconcileAlarm(txn: DurableObjectTransaction): Promise<void> {
    const row = this.#readTask();
    const next = row === undefined ? undefined : this.#nextScheduledAt(row);
    const currentAlarm = await txn.getAlarm();
    if (next === undefined) {
      if (currentAlarm !== null) {
        await txn.deleteAlarm();
      }
      return;
    }
    const target = Math.max(next, Date.now());
    if (currentAlarm !== target) {
      await txn.setAlarm(target);
    }
  }

  async #reconcileNow(): Promise<void> {
    await this.ctx.storage.transaction(async (txn) => {
      await this.#reconcileAlarm(txn);
    });
  }

  /** durability's armForHandoff: hand the in-flight attempt to a fresh invocation. */
  async #armForHandoff(timestamp: number): Promise<void> {
    await this.ctx.storage.transaction(async (txn) => {
      const currentAlarm = await txn.getAlarm();
      if (currentAlarm === null || currentAlarm > timestamp) {
        await txn.setAlarm(timestamp);
      }
    });
  }

  async #alarmTick(): Promise<void> {
    // Re-arm is the first durable act on entry (docs/how-it-works.md §6 (reliability: alarm semantics)): even if
    // everything below fails, a wake survives.
    await this.ctx.storage.setAlarm(Date.now() + ALARM_BACKSTOP_MS);

    const row = this.#readTask();
    if (row === undefined) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    // An attempt is already executing: attach to it instead of double-claiming.
    if (this.#inFlight !== undefined) {
      await this.#awaitWithHandoff(this.#inFlight.settled);
      return;
    }

    const now = Date.now();
    const deadline = row.ttl_ms === null ? undefined : row.created_at + row.ttl_ms;

    // TTL enforcement (wall-clock honest): expire live tasks, purge terminal
    // ones — the DO evaporates and tasks/get finds nothing (-32602).
    if (deadline !== undefined && now >= deadline) {
      if (isTerminal(row.status)) {
        await this.#purge();
        return;
      }
      await this.#expire(row, now);
      return;
    }

    if (isTerminal(row.status)) {
      await this.#reconcileNow(); // waiting for the purge deadline (or none)
      return;
    }

    // Cooperative cancellation fast-path: nothing in flight, flag set.
    if (row.cancel_requested === 1) {
      await this.#settleCancelled(now);
      return;
    }

    // Elicit answer deadlines are wall-clock honest, like the TTL: resolve
    // the ones that have genuinely passed, then re-read the row the sweep
    // may have returned to `working`.
    await this.#resolveDueElicitTimeouts(now);
    const current = this.#readTask() ?? row;

    if (current.status === "input_required") {
      await this.#reconcileNow(); // waiting on tasks/update (deadline/TTL armed)
      return;
    }

    const wake = this.#earliestExecutionWake(current);
    if (wake === undefined) {
      await this.#reconcileNow(); // nothing scheduled; TTL (if any) bounds it
      return;
    }

    // Honor due sleep wakes DO-side before replaying: everything scheduled at
    // or before the wake this invocation is delivering.
    const wakeHorizon = Math.max(now, wake);
    this.#sql.exec(
      `UPDATE steps SET status = 'completed', completed_at = ?
       WHERE kind = 'sleep' AND status = 'pending' AND wake_at <= ?`,
      now,
      wakeHorizon,
    );

    // Claim the attempt: fresh generation, guarded (docs/how-it-works.md §2 and §4 (layers and data flow).2).
    const generation = crypto.randomUUID();
    const claimed = this.#sql
      .exec(
        `UPDATE task
         SET run_attempt = run_attempt + 1,
             run_generation = ?,
             last_updated_at = ?
         WHERE status = 'working'
         RETURNING run_attempt`,
        generation,
        now,
      )
      .toArray()
      .at(0);
    if (claimed === undefined) {
      await this.#reconcileNow();
      return;
    }
    const attempt = claimedAttemptSchema.parse(claimed).run_attempt;

    await this.#dispatch(current, generation, attempt);
  }

  /**
   * Resolves elicit answer deadlines that have passed: due unanswered
   * BLOCKING requests are marked answered-by-timeout (`answered = 1,
   * timed_out = 1`, no response) — so a late `tasks/update` to their key is
   * ignored by the answered guard — and once none remain outstanding the
   * task returns to `working` with an immediate wake. Standing offers carry
   * no deadline and are never swept. The resumed replay's `recordElicit`
   * observes the marker and resolves the elicit with the timeout outcome.
   */
  async #resolveDueElicitTimeouts(now: number): Promise<void> {
    await this.ctx.storage.transaction(async (txn) => {
      const due = this.#sql
        .exec(
          `UPDATE input_requests SET answered = 1, timed_out = 1
           WHERE answered = 0 AND blocking = 1 AND timeout_at IS NOT NULL AND timeout_at <= ?
           RETURNING key`,
          now,
        )
        .toArray().length;
      if (due === 0) {
        return;
      }
      if (this.#outstandingBlockingRequestCount() === 0) {
        this.#sql.exec(
          `UPDATE task SET status = 'working', run_next_at = ?, last_updated_at = ?
           WHERE status = 'input_required'`,
          now + this.initialWakeDelayMs,
          now,
        );
        this.#noteWakeRequest();
      } else {
        this.#sql.exec(`UPDATE task SET last_updated_at = ?`, now);
      }
      await this.#reconcileAlarm(txn);
    });
  }

  async #dispatch(row: TaskRow, generation: string, attempt: number): Promise<void> {
    let executor: TaskExecutorLike;
    try {
      executor = this.resolveExecutor();
    } catch (error) {
      await this.#settleDispatchFailure(generation, attempt, error);
      return;
    }
    const desc: TaskInvocation = {
      taskId: row.task_id,
      toolName: row.tool_name,
      input: deserializeValue(row.input),
      attempt,
    };
    const lease = new DurableStep(this, row.task_id, attempt, generation);
    const settled = (async () => {
      try {
        const outcome = await executor.runTask(desc, lease);
        await this.#settleOutcome(generation, attempt, outcome);
      } catch (error) {
        await this.#settleDispatchFailure(generation, attempt, error);
      } finally {
        if (this.#inFlight?.generation === generation) {
          this.#inFlight = undefined;
        }
      }
    })().catch(() => undefined);
    this.#inFlight = { generation, settled, wakeRequests: 0, cutNextSleep: false };
    await this.#awaitWithHandoff(settled);
  }

  /**
   * Race the in-flight attempt against the handoff deadline (durability's
   * pattern): on handoff, re-arm for now and return — the next invocation
   * attaches to the same in-memory promise instead of double-invoking.
   */
  async #awaitWithHandoff(settled: Promise<void>): Promise<void> {
    const handoff = Symbol("alarm handoff");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let result: void | typeof handoff;
    try {
      result = await Promise.race([
        settled,
        new Promise<typeof handoff>((resolve) => {
          timer = setTimeout(() => resolve(handoff), Math.max(this.alarmHandoffMs, 0));
        }),
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
    if (result === handoff) {
      await this.#armForHandoff(Date.now());
    }
  }

  #validOutcome(outcome: RunOutcome): RunOutcome | undefined {
    if (outcome === null || typeof outcome !== "object") {
      return undefined;
    }
    if (
      outcome.outcome === "suspended" ||
      (outcome.outcome === "completed" && "result" in outcome) ||
      (outcome.outcome === "failed" && "error" in outcome)
    ) {
      return outcome;
    }
    return undefined;
  }

  async #settleOutcome(generation: string, attempt: number, rawOutcome: RunOutcome): Promise<void> {
    const outcome = this.#validOutcome(rawOutcome);
    if (outcome === undefined) {
      await this.#settleDispatchFailure(
        generation,
        attempt,
        new Error("executor returned a malformed RunOutcome"),
      );
      return;
    }
    const now = Date.now();
    await this.ctx.storage.transaction(async (txn) => {
      switch (outcome.outcome) {
        case "completed": {
          let resultJson: string;
          try {
            resultJson = toJsonText(outcome.result, "task result");
          } catch (reason) {
            // Engine failure (docs/how-it-works.md §6 (reliability: limits and error taxonomy)): serialization -> task failed.
            const detail = serializeError(reason);
            this.#failTask(generation, now, `${detail.name}: ${detail.message}`);
            break;
          }
          this.#sql.exec(
            `UPDATE task SET status = 'completed', result = ?, error = NULL,
                             run_next_at = NULL, last_updated_at = ?
             WHERE run_generation = ? AND status = 'working'`,
            resultJson,
            now,
            generation,
          );
          break;
        }
        case "suspended": {
          // Journal writes made during the run carry the wakes; clear the
          // redelivery anchor so the settled attempt is not re-claimed —
          // unless a wake was requested while this attempt executed (an
          // elicit resume, or an answered offer that cut its sleep): that
          // anchor is the alarm's only route to the next run, so it stays.
          const wakeRequested =
            this.#inFlight?.generation === generation && this.#inFlight.wakeRequests > 0;
          if (!wakeRequested) {
            this.#sql.exec(
              `UPDATE task SET run_next_at = NULL, last_updated_at = ?
               WHERE run_generation = ? AND status = 'working'`,
              now,
              generation,
            );
          }
          // Cooperative cancellation observed mid-run: the invocation aborted
          // on the `cancelled` beginStep directive (or suspended while a
          // cancel was pending) and nothing else is scheduled to settle it —
          // this settlement is the engine's chance (docs/how-it-works.md §4(b) and §5 (leases, generations, replay)). Work that
          // finished first took the `completed` branch and stays completed.
          this.#sql.exec(
            `UPDATE task SET status = 'cancelled', run_next_at = NULL, last_updated_at = ?
             WHERE run_generation = ? AND status IN ('working','input_required')
               AND cancel_requested = 1`,
            now,
            generation,
          );
          break;
        }
        case "failed": {
          const detail = serializeError(outcome.error);
          this.#failTask(generation, now, `${detail.name}: ${detail.message}`);
          break;
        }
      }
      await this.#reconcileAlarm(txn);
    });
  }

  #failTask(generation: string, now: number, message: string): void {
    const errorJson = JSON.stringify({ code: JSON_RPC_INTERNAL_ERROR, message });
    this.#sql.exec(
      `UPDATE task SET status = 'failed', error = ?, result = NULL,
                       run_next_at = NULL, last_updated_at = ?
       WHERE run_generation = ? AND status IN ('working','input_required')`,
      errorJson,
      now,
      generation,
    );
  }

  /**
   * A failed executor dispatch is recorded as a failed invocation attempt and
   * redelivered by the alarm with backoff and a fresh lease (docs/how-it-works.md §6 (reliability: DO RPC retries) —
   * deliberately NOT inline-retried).
   */
  async #settleDispatchFailure(generation: string, attempt: number, error: unknown): Promise<void> {
    // The failure detail stays engine-internal: `status_message` is the
    // handler's channel (single writer), never engine diagnostics.
    void error;
    const now = Date.now();
    const retryAt = now + this.invocationRetryDelayMs(attempt);
    await this.ctx.storage.transaction(async (txn) => {
      this.#sql.exec(
        `UPDATE task SET run_next_at = ?, last_updated_at = ?
         WHERE run_generation = ? AND status IN ('working','input_required')`,
        retryAt,
        now,
        generation,
      );
      await this.#reconcileAlarm(txn);
    });
  }

  async #settleCancelled(now: number): Promise<void> {
    await this.ctx.storage.transaction(async (txn) => {
      this.#sql.exec(
        `UPDATE task SET status = 'cancelled', run_next_at = NULL, last_updated_at = ?
         WHERE status IN ('working','input_required') AND cancel_requested = 1`,
        now,
      );
      await this.#reconcileAlarm(txn);
    });
  }

  async #expire(row: TaskRow, now: number): Promise<void> {
    const errorJson = JSON.stringify({
      code: JSON_RPC_INTERNAL_ERROR,
      message: `Task expired after ${row.ttl_ms}ms`,
    });
    await this.ctx.storage.transaction(async (txn) => {
      this.#sql.exec(
        `UPDATE task SET status = 'failed', error = ?, run_next_at = NULL, last_updated_at = ?
         WHERE status IN ('working','input_required')`,
        errorJson,
        now,
      );
      // The purge deadline (same instant, already past) re-arms clamped to
      // now: the next invocation purges.
      await this.#reconcileAlarm(txn);
    });
  }

  /**
   * Terminal retention sweep: the task evaporates (docs/how-it-works.md §3 (data model)) — all storage
   * (schema included) is deleted and nothing is re-bootstrapped, so the DO is
   * left with zero writes and is never re-persisted. The live instance stays
   * consistent through the cleared #schemaReady flag: subsequent `get()` /
   * lease calls short-circuit to notFound / StaleLeaseError without touching
   * SQL.
   */
  async #purge(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.#schemaReady = false;
  }

  #baseSnapshot(row: TaskRow): Task {
    const snapshot: Task = {
      taskId: row.task_id,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      lastUpdatedAt: new Date(row.last_updated_at).toISOString(),
      ttlMs: row.ttl_ms,
      pollIntervalMs: row.poll_interval_ms,
    };
    if (row.status_message !== null) {
      snapshot.statusMessage = row.status_message;
    }
    return snapshot;
  }

  /**
   * The engine's `_meta` for a `tasks/get` snapshot: the handler's status
   * meta under {@link STATUS_META_KEY} — omitted entirely while NULL.
   */
  #snapshotMeta(row: TaskRow): { _meta?: TaskSnapshotMeta } {
    if (row.status_meta === null) {
      return {};
    }
    return { _meta: { [STATUS_META_KEY]: statusMetaSchema.parse(JSON.parse(row.status_meta)) } };
  }

  #toDetailedSnapshot(row: TaskRow): DetailedTaskSnapshot {
    const base = { ...this.#baseSnapshot(row), ...this.#snapshotMeta(row) };
    switch (row.status) {
      case "completed":
        return {
          ...base,
          status: "completed",
          result: row.result === null ? {} : jsonRecordSchema.parse(JSON.parse(row.result)),
        };
      case "failed":
        return {
          ...base,
          status: "failed",
          error: row.error === null ? {} : jsonRecordSchema.parse(JSON.parse(row.error)),
        };
      case "input_required":
        return {
          ...base,
          status: "input_required",
          inputRequests: this.#outstandingBlockingRequests(),
        };
      case "cancelled":
        return { ...base, status: "cancelled" };
      case "working":
        return { ...base, status: "working" };
    }
  }
}
