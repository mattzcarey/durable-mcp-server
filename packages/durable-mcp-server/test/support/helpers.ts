/**
 * Shared data-layer helpers for the TaskRunner suites: raw SQLite reads via
 * runInDurableObject (the four-layer matrix's data layer), plus deterministic
 * TTL aging — tests rewind `created_at` instead of waiting for wall-clock
 * time, keeping deadline behavior wall-clock-honest AND deterministic.
 */

import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { CreateTaskInput, TaskRunner, TaskSnapshot } from "../../src";
import { callTaskRunner } from "../../src/engine/call-task-runner";
import { taskStub } from "./drain";

type Row = Record<string, unknown>;

/**
 * User table names present on the DO (pure read; internal `_cf_` tables
 * filtered out). `[]` proves the DO carries ZERO storage writes — the docs/how-it-works.md
 * §3.3 MUST for the tasks/get not-found path, and the post-purge state.
 */
export async function listTableNames(stub: DurableObjectStub<TaskRunner>): Promise<string[]> {
  return runInDurableObject(stub, (_instance, state) =>
    state.storage.sql
      .exec(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name`,
      )
      .toArray()
      .map((row) => String(row.name)),
  );
}

/** Reads a whole table, or `undefined` when the schema was never bootstrapped. */
async function readTable(
  stub: DurableObjectStub<TaskRunner>,
  table: "task" | "steps" | "input_requests",
  orderBy: string,
): Promise<Row[] | undefined> {
  return runInDurableObject(stub, (_instance, state) => {
    const exists =
      state.storage.sql
        .exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, table)
        .toArray().length > 0;
    if (!exists) {
      return undefined; // lazy bootstrap: no writes ever happened (or purged)
    }
    return state.storage.sql.exec(`SELECT * FROM ${table} ORDER BY ${orderBy}`).toArray();
  });
}

export function baseCreateInput(
  taskId: string,
  overrides?: Partial<CreateTaskInput>,
): CreateTaskInput {
  return {
    taskId,
    toolName: "echo_task",
    input: { text: "hello" },
    ttlMs: 86_400_000,
    pollIntervalMs: 5_000,
    ...overrides,
  };
}

/** Creates a task through the retry wrapper (package rule: no bare stub calls). */
export async function createTask(
  taskId: string,
  overrides?: Partial<CreateTaskInput>,
  namespace?: DurableObjectNamespace<TaskRunner>,
): Promise<TaskSnapshot> {
  return callTaskRunner(namespace ?? env.TASK_RUNNER, taskId, (stub) =>
    stub.create(baseCreateInput(taskId, overrides)),
  );
}

export async function readTaskRow(stub: DurableObjectStub<TaskRunner>): Promise<Row | undefined> {
  return (await readTable(stub, "task", "task_id"))?.at(0);
}

export async function readSteps(stub: DurableObjectStub<TaskRunner>): Promise<Row[]> {
  return (await readTable(stub, "steps", "created_at, step_key")) ?? [];
}

export async function readInputRequests(stub: DurableObjectStub<TaskRunner>): Promise<Row[]> {
  return (await readTable(stub, "input_requests", "created_at")) ?? [];
}

export async function getAlarmTime(stub: DurableObjectStub<TaskRunner>): Promise<number | null> {
  return runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());
}

/**
 * Rewinds `created_at` by `ms`, moving the TTL deadline into the past without
 * waiting. The scheduled alarm is untouched (still far-future), so nothing
 * auto-fires: the next deterministic tick observes the aged deadline.
 */
export async function ageTaskBy(stub: DurableObjectStub<TaskRunner>, ms: number): Promise<void> {
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec(`UPDATE task SET created_at = created_at - ?`, ms);
  });
}

/**
 * Rewinds every stored elicit answer deadline by `ms`, moving it into the
 * past without waiting — the elicit-timeout analogue of {@link ageTaskBy}
 * (deadline behavior stays wall-clock-honest AND deterministic). The
 * scheduled alarm is untouched; the next deterministic tick observes the
 * aged deadline.
 */
export async function ageElicitTimeoutBy(
  stub: DurableObjectStub<TaskRunner>,
  ms: number,
): Promise<void> {
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec(
      `UPDATE input_requests SET timeout_at = timeout_at - ? WHERE timeout_at IS NOT NULL`,
      ms,
    );
  });
}

/** The current run_generation, for stale-lease and rotation assertions. */
export async function currentGeneration(stub: DurableObjectStub<TaskRunner>): Promise<string> {
  const row = await readTaskRow(stub);
  if (row === undefined || typeof row.run_generation !== "string") {
    throw new Error("no task row (or run_generation missing)");
  }
  return row.run_generation;
}

export function uniqueTaskId(): string {
  return crypto.randomUUID();
}

export { taskStub };
