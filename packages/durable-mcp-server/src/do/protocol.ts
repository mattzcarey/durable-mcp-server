/**
 * The TaskRunner <-> TaskExecutor protocol (docs/how-it-works.md §2 (the three layers) and §7 (wire contract), §4.5): the shapes
 * that cross the DO -> WorkerEntrypoint RPC boundary in both directions. Kept
 * in one module so `task-runner.ts` and `task-entrypoint.ts` share them
 * without importing each other.
 *
 * Everything here must survive structured serialization: plain JSON in, plain
 * JSON out. The one capability that crosses as a stub — the per-lease
 * `DurableStep` — is typed here as {@link DurableStepStub}, the surface the
 * executor sees.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { SerializedError } from "../engine/errors";

/** One claimed execution attempt, as dispatched by the TaskRunner alarm. */
export interface TaskInvocation {
  taskId: string;
  toolName: string;
  input: unknown;
  /** The task-level claim counter (`run_attempt` after this claim). */
  attempt: number;
}

/** How a `runTask` invocation settled. */
export type RunOutcome =
  /** The handler returned; the DO persists the result and completes the task. */
  | { outcome: "completed"; result: CallToolResult }
  /** Sleep recorded / step retry scheduled / input requested / cancelled — the DO already knows why. */
  | { outcome: "suspended" }
  /** Engine-level failure only (e.g. unknown tool) — never a handler throw. */
  | { outcome: "failed"; error: SerializedError };

/** Directive returned by `beginStep`: what the executor should do with a step. */
export type BeginStepResult =
  /** Journal miss (or pending retry): run the closure as this step attempt. */
  | { state: "run"; attempt: number }
  /** Journal hit: the persisted result, closure MUST NOT run. */
  | { state: "completed"; value: unknown }
  /** The step already failed terminally in an earlier attempt. */
  | { state: "failed"; error: SerializedError }
  /** Cancellation was requested: abort the invocation (suspend). */
  | { state: "cancelled" };

/** State of a journaled sleep after `recordSleep`. */
/**
 * `latest` on a completed sleep / resolved elicit: this row is the LAST
 * suspension point the previous run recorded (greatest `created_at` among
 * sleep + elicit rows). A resumed handler replays earlier suspension points
 * as plain hits; the latest one is where it goes back on new ground.
 */
export type SleepState = { state: "pending" } | { state: "completed"; latest: boolean };

/**
 * State of an input request after `recordElicit` (decision D13). `timed_out`
 * means the request's deadline elapsed unanswered: the engine marked it
 * answered-by-timeout (late `tasks/update` responses to the key are ignored
 * per the answered rule) and the replay resolves the elicit with a timeout
 * outcome instead of a response.
 */
export type ElicitState =
  | { state: "pending" }
  | { state: "answered"; response: unknown; latest: boolean }
  | { state: "timed_out"; latest: boolean };

/**
 * Result of a journaled `checkInput` against a standing (non-blocking) offer:
 * the offer's answer, consumed by this step (or journaled by it earlier —
 * replays observe the same value), or nothing to consume. Never suspends.
 */
export type CheckInputState = { state: "answered"; response: unknown } | { state: "unanswered" };

/** How a failed `step.do` attempt should be disposed of. */
export type StepFailureDisposition =
  /** Retry: the alarm redelivers at `retryAtMs` (executor computed the backoff). */
  | { retryAtMs: number }
  /** Terminal: no further attempts; the step is marked `failed`. */
  | { terminal: true };

/**
 * The per-lease step capability TaskRunner passes to `runTask`: constructed
 * for exactly one execution attempt, its method calls run back inside the DO
 * and every write is guarded by the attempt's `run_generation`. When the
 * `runTask` RPC settles the stub dies with it; a superseded lease's calls
 * throw {@link StaleLeaseError}. Downstream code never constructs one.
 */
export interface DurableStepStub {
  /** The task this lease belongs to. */
  readonly taskId: string;
  /** The claim counter of the attempt this lease was minted for. */
  readonly attempt: number;
  beginStep(stepKey: string, options?: BeginStepOptions): Promise<BeginStepResult>;
  completeStep(stepKey: string, value: unknown): Promise<boolean>;
  failStep(
    stepKey: string,
    error: SerializedError,
    disposition: StepFailureDisposition,
  ): Promise<boolean>;
  recordSleep(stepKey: string, wakeAtMs: number): Promise<SleepState>;
  /**
   * Journals an input request. `timeoutAtMs` (ms epoch) is the answer
   * deadline, stored with the request on first record and immutable across
   * replays — recomputed deadlines from later invocations are ignored.
   * Omitted = no deadline (waits forever).
   */
  recordElicit(stepKey: string, request: unknown, timeoutAtMs?: number): Promise<ElicitState>;
  /**
   * Registers a standing, NON-blocking input request (`step.offer`) under a
   * lifetime-unique key without suspending: the task stays `working`, the
   * status is untouched, and the offer never appears in `tasks/get`
   * `inputRequests`. Journal-safe: a replay's re-offer of the same key finds
   * the existing row (the first recorded request stands). A key already used
   * by a blocking elicit throws `DuplicateStepError`.
   */
  recordOffer(key: string, request: unknown): Promise<void>;
  /**
   * Journaled, non-blocking consume (`step.checkInput`) of the offer under
   * `key`, as the step named `stepKey`: an unconsumed answer is returned and
   * marked consumed; otherwise the step journals a miss. Either outcome is
   * journaled under `stepKey`, so a replay observes the same value. Throws
   * for a key that is not a registered offer (unknown, or a blocking elicit).
   */
  checkInput(stepKey: string, key: string): Promise<CheckInputState>;
  /**
   * Durable handler telemetry (`step.status`): writes `status_message` (and,
   * when `meta` is passed, `status_meta`) on the task row. The handler is the
   * single writer of both — the engine never narrates its own transitions —
   * so the values stay absent until the first call and the last written ones
   * stand, including across terminal transitions. `meta` replaces the stored
   * meta wholesale; a call without `meta` leaves it untouched. Not a journal
   * write: replays may deliver the same message again, harmlessly. A no-op
   * once the task is terminal; a superseded lease's call throws
   * {@link StaleLeaseError}.
   */
  setStatus(message: string, meta?: unknown): Promise<void>;
  checkCancel(): Promise<boolean>;
}

/** Options recorded when a `do` step first enters the journal. */
export interface BeginStepOptions {
  /** Per-attempt closure timeout, ms (journaled for observability). */
  timeoutMs?: number;
}

/**
 * The executor surface TaskRunner dispatches to (decision D6): satisfied by
 * the entrypoint from `createTaskEntrypoint` — reached via `ctx.exports` or
 * the `TASK_EXECUTOR` service binding — and, in tests, by an injected fake.
 */
export interface TaskExecutorLike {
  runTask(desc: TaskInvocation, step: DurableStepStub): Promise<RunOutcome>;
}

/**
 * Thrown by lease methods when the calling lease no longer owns the task —
 * its `run_generation` was superseded by a newer claim, the task reached a
 * terminal state, or the task was purged. The executor must abandon the
 * attempt (docs/how-it-works.md §6 (reliability: DO RPC retries)): the alarm re-drives with a fresh lease.
 */
export class StaleLeaseError extends Error {
  constructor(taskId: string, detail: string) {
    super(`Stale lease for task "${taskId}": ${detail}`);
    this.name = "StaleLeaseError";
  }
}

/**
 * Duck-typed {@link StaleLeaseError} check for the executor side of the RPC
 * boundary: matches an instance, the preserved `name`, or the distinctive
 * message prefix (whichever survives serialization), defensively against
 * hostile getters.
 */
export const isStaleLeaseError = (error: unknown): boolean => {
  if (error instanceof StaleLeaseError) {
    return true;
  }
  if ((typeof error !== "object" && typeof error !== "function") || error === null) {
    return false;
  }
  try {
    if (Reflect.get(error, "name") === "StaleLeaseError") {
      return true;
    }
    const message = Reflect.get(error, "message");
    return typeof message === "string" && message.startsWith("Stale lease for task");
  } catch {
    return false;
  }
};
