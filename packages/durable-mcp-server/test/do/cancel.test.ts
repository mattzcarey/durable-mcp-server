/**
 * Flow: cooperative cancellation (cancel-flag).
 *
 * Layers: data (cancel_requested flag, settled row), control plane
 * (cancel/checkCancel RPC, idempotency), integration (cancel -> drain ->
 * cancelled without dispatch; cancel after completion stays completed).
 * HTTP layer arrives with stage 4.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { invocations, resetFakeExecutor, setFakeBehavior } from "../fixtures/fake-executor";
import { drainTaskAlarms } from "../support/drain";
import { createTask, getAlarmTime, readTaskRow, taskStub, uniqueTaskId } from "../support/helpers";

beforeEach(() => {
  resetFakeExecutor();
});

describe("tasks/cancel semantics", () => {
  it("acks and sets the flag; the task is still working until the engine settles it", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    const stub = taskStub(taskId);

    await stub.cancel();

    // Data layer: flag set, wake scheduled, nothing else settled yet.
    const row = await readTaskRow(stub);
    expect(row?.cancel_requested).toBe(1);
    expect(row?.status).toBe("working");
    expect(row?.run_next_at).not.toBeNull();
    expect(Number(row?.last_updated_at)).toBeGreaterThanOrEqual(Number(row?.created_at));

    // Ack != stopped: tasks/get still shows working.
    expect(await stub.get()).toMatchObject({ status: "working" });

    // Control plane: the cooperative check the executor wrapper polls.
    expect(await stub.checkCancel()).toBe(true);
  });

  it("cancel before any execution settles to cancelled without dispatching (integration)", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    const stub = taskStub(taskId);

    await stub.cancel();
    await drainTaskAlarms(taskId);

    const row = await readTaskRow(stub);
    expect(row?.status).toBe("cancelled");
    expect(row?.status_message).toBeNull(); // single writer: no engine narration
    expect(row?.run_next_at).toBeNull();
    expect(invocations).toHaveLength(0); // executor never invoked

    const snapshot = await stub.get();
    expect(snapshot).toMatchObject({ taskId, status: "cancelled" });
    expect(snapshot !== null && typeof snapshot === "object" && "result" in snapshot).toBe(false);

    // Terminal: retention alarm armed at the purge deadline.
    expect(await getAlarmTime(stub)).toBe(Number(row?.created_at) + 86_400_000);
  });

  it("work that finishes first stays completed (spec-sanctioned)", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior("complete");
    await createTask(taskId);
    await drainTaskAlarms(taskId);

    const stub = taskStub(taskId);
    await stub.cancel(); // idempotent ack on a terminal task
    await drainTaskAlarms(taskId);

    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(row?.cancel_requested).toBe(0); // terminal guard: flag never set
  });

  it("double cancel is idempotent", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    const stub = taskStub(taskId);
    await stub.cancel();
    const rowAfterFirst = await readTaskRow(stub);
    await stub.cancel();
    const rowAfterSecond = await readTaskRow(stub);
    expect(rowAfterSecond?.cancel_requested).toBe(1);
    expect(rowAfterSecond?.run_next_at).toBe(rowAfterFirst?.run_next_at);
  });

  it("cancel on an unknown task is a no-op ack", async () => {
    const taskId = uniqueTaskId();
    const stub = taskStub(taskId);
    await stub.cancel();
    expect(await readTaskRow(stub)).toBeUndefined();
    expect(await getAlarmTime(stub)).toBeNull();
  });
});
