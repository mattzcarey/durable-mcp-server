/**
 * Flow: auth binding (decision D12) at the data + control-plane layers:
 * `TaskRunner.get(callerAuthKey)` rejects mismatched pollers as notFound
 * (no existence leak) while the matching key — and any caller on an unkeyed
 * task — reads normally. The HTTP layer's mismatch rejection rides in
 * test/http/conformance.test.ts.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetFakeExecutor } from "../fixtures/fake-executor";
import { createTask, readTaskRow, taskStub, uniqueTaskId } from "../support/helpers";

beforeEach(() => {
  resetFakeExecutor();
});

describe("TaskRunner.get auth_key check (control plane)", () => {
  it("rejects a missing or mismatched caller key on a keyed task", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { authKey: "client-1" });
    const stub = taskStub(taskId);

    await expect(stub.get()).resolves.toEqual({ notFound: true });
    await expect(stub.get("client-2")).resolves.toEqual({ notFound: true });

    // The task row itself is untouched by rejected reads (data layer).
    const row = await readTaskRow(stub);
    expect(row?.auth_key).toBe("client-1");
    expect(row?.status).toBe("working");
  });

  it("serves the matching caller key", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { authKey: "client-1" });

    const snapshot = await taskStub(taskId).get("client-1");
    expect(snapshot).toMatchObject({ taskId, status: "working" });
  });

  it("an unkeyed task ignores whatever key the caller offers", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    const stub = taskStub(taskId);

    await expect(stub.get()).resolves.toMatchObject({ taskId, status: "working" });
    await expect(stub.get("anything")).resolves.toMatchObject({ taskId, status: "working" });
  });
});
