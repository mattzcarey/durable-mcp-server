/**
 * Flow: TTL enforcement + terminal purge.
 *
 * Deadlines are wall-clock-honest, so tests age the task by rewinding
 * `created_at` (data-layer manipulation) instead of waiting: the scheduled
 * alarm stays far-future (nothing auto-fires) and the next deterministic tick
 * observes the elapsed deadline.
 *
 * Layers: data (row transitions, empty tables after purge), control plane
 * (get -> notFound after purge), integration (expire -> failed -> purged ->
 * notFound over the alarm chain). HTTP layer arrives with stage 4.
 */

import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { TaskRunner } from "../../src";
import { invocations, resetFakeExecutor, setFakeBehavior } from "../fixtures/fake-executor";
import { drainTaskAlarms } from "../support/drain";
import {
  ageTaskBy,
  createTask,
  getAlarmTime,
  listTableNames,
  readTaskRow,
  taskStub,
  uniqueTaskId,
} from "../support/helpers";

const TTL = 86_400_000;

beforeEach(() => {
  resetFakeExecutor();
});

describe("TTL expiry of a live task", () => {
  it("expires to failed with a task-expired JSON-RPC error, then purges (integration)", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { ttlMs: TTL });
    const stub = taskStub(taskId);

    await ageTaskBy(stub, TTL * 2);

    // Tick 1: the deadline passed -> non-terminal task fails as expired.
    // Expiry wins over the pending execution wake: the executor never runs.
    // The purge deadline is the SAME instant, so the failed state must be
    // captured atomically inside the DO context — once the tick's reconcile
    // arms the (already-due) purge wake, workerd fires it on its own.
    const failedRow = await runInDurableObject(stub, async (instance, state) => {
      await (instance as TaskRunner).alarm();
      return state.storage.sql.exec(`SELECT * FROM task`).toArray().at(0);
    });
    expect(failedRow?.status).toBe("failed");
    expect(JSON.parse(String(failedRow?.error))).toEqual({
      code: -32603,
      message: `Task expired after ${TTL}ms`,
    });
    expect(failedRow?.run_next_at).toBeNull();
    expect(invocations).toHaveLength(0);

    // The purge deadline (same instant) evaporates the DO: all tables gone,
    // nothing re-bootstrapped — zero storage writes remain, so the DO is
    // never re-persisted (docs/how-it-works.md §3 (data model)).
    await drainTaskAlarms(taskId);
    expect(await listTableNames(stub)).toEqual([]);
    expect(await readTaskRow(stub)).toBeUndefined();
    expect(await getAlarmTime(stub)).toBeNull();

    // Post-purge tasks/get: no row -> notFound (-32602 at the stage-4 router).
    expect(await stub.get()).toEqual({ notFound: true });

    // Nothing left to drain.
    expect(await runDurableObjectAlarm(stub)).toBe(false);
  });
});

describe("terminal retention", () => {
  it("a completed task stays pollable until the deadline, then purges", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior("complete");
    await createTask(taskId, { ttlMs: TTL });
    const stub = taskStub(taskId);

    await drainTaskAlarms(taskId);

    // Completed and still visible: the drain stopped at the future purge
    // deadline instead of purging early.
    expect(await stub.get()).toMatchObject({ status: "completed" });
    const row = await readTaskRow(stub);
    expect(await getAlarmTime(stub)).toBe(Number(row?.created_at) + TTL);

    // Deadline passes -> purge -> notFound.
    await ageTaskBy(stub, TTL * 2);
    await drainTaskAlarms(taskId);
    expect(await readTaskRow(stub)).toBeUndefined();
    expect(await stub.get()).toEqual({ notFound: true });
    expect(await getAlarmTime(stub)).toBeNull();
  });

  it("a cancelled task is purged at the deadline too", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { ttlMs: TTL });
    const stub = taskStub(taskId);
    await stub.cancel();
    await drainTaskAlarms(taskId);
    expect((await readTaskRow(stub))?.status).toBe("cancelled");

    await ageTaskBy(stub, TTL * 2);
    await drainTaskAlarms(taskId);
    expect(await stub.get()).toEqual({ notFound: true });
  });
});

describe("ttlMs: null (unlimited retention)", () => {
  it("never arms a TTL alarm and is never purged", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior("complete");
    await createTask(taskId, { ttlMs: null });
    const stub = taskStub(taskId);

    await drainTaskAlarms(taskId);

    expect(await stub.get()).toMatchObject({ status: "completed", ttlMs: null });
    // Terminal with no deadline: no alarm at all.
    expect(await getAlarmTime(stub)).toBeNull();
  });
});
