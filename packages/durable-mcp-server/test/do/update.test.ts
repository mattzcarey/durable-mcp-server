/**
 * Flow: tasks/update + input_requests rows (decision D13 groundwork):
 * recordElicit -> input_required -> tasks/update stores responses (unknown
 * keys ignored) -> task resumes -> replay observes the answer.
 *
 * Layers: data (input_requests rows, task transitions), control plane
 * (update RPC idempotency, validation), integration (elicit roundtrip to
 * completion over the alarm chain). HTTP layer arrives with stage 4.
 */

import { runDurableObjectAlarm } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetFakeExecutor, setFakeBehavior } from "../fixtures/fake-executor";
import { drainTaskAlarms } from "../support/drain";
import { expectRejects } from "../support/expect-rejects";
import {
  createTask,
  getAlarmTime,
  readInputRequests,
  readTaskRow,
  taskStub,
  uniqueTaskId,
} from "../support/helpers";

const REQUEST = {
  method: "elicitation/create",
  params: { message: "pick a color", requestedSchema: { type: "object" } },
};

const RESPONSE = { action: "accept", content: { color: "blue" } };

/** Behavior: one elicit step; completes with the response once answered. */
function elicitingBehavior(): void {
  setFakeBehavior(async (_desc, step) => {
    const elicit = await step.recordElicit("color", REQUEST);
    if (elicit.state !== "answered") {
      return { outcome: "suspended" };
    }
    return {
      outcome: "completed",
      result: { content: [{ type: "text", text: JSON.stringify(elicit.response) }] },
    };
  });
}

beforeEach(() => {
  resetFakeExecutor();
});

describe("input_required roundtrip", () => {
  it("elicit -> input_required -> update -> resume -> completed (integration + data)", async () => {
    const taskId = uniqueTaskId();
    elicitingBehavior();
    await createTask(taskId);
    const stub = taskStub(taskId);

    // Tick 1: the invocation records the request and suspends.
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    let row = await readTaskRow(stub);
    expect(row?.status).toBe("input_required");
    expect(row?.status_message).toBeNull(); // single writer: no engine narration
    expect(row?.run_next_at).toBeNull(); // waiting on the client, not the alarm

    let requests = await readInputRequests(stub);
    expect(requests).toHaveLength(1);
    expect(requests.at(0)).toMatchObject({ key: "color", step_key: "color", answered: 0 });
    expect(JSON.parse(String(requests.at(0)?.request))).toEqual(REQUEST);
    expect(requests.at(0)?.response).toBeNull();

    // Only the TTL deadline is armed while waiting.
    expect(await getAlarmTime(stub)).toBe(Number(row?.created_at) + 86_400_000);

    // tasks/get inlines the outstanding requests (spec shape).
    expect(await stub.get()).toMatchObject({
      taskId,
      status: "input_required",
      inputRequests: { color: REQUEST },
    });

    // The chain is quiescent while input is outstanding.
    await drainTaskAlarms(taskId);
    expect((await readTaskRow(stub))?.status).toBe("input_required");

    // tasks/update: unknown keys ignored, matching key resolves (partial ok).
    await stub.update({ bogus: { action: "decline" }, color: RESPONSE });

    row = await readTaskRow(stub);
    expect(row?.status).toBe("working"); // resumed
    expect(row?.status_message).toBeNull();
    expect(row?.run_next_at).not.toBeNull();
    requests = await readInputRequests(stub);
    expect(requests).toHaveLength(1); // bogus key created nothing
    expect(requests.at(0)?.answered).toBe(1);
    expect(JSON.parse(String(requests.at(0)?.response))).toEqual(RESPONSE);

    // Resume: the replay observes the answer and completes.
    await drainTaskAlarms(taskId);
    row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(row?.run_attempt).toBe(2);
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: JSON.stringify(RESPONSE) }],
    });
  });

  it("an update naming only unknown keys changes nothing", async () => {
    const taskId = uniqueTaskId();
    elicitingBehavior();
    await createTask(taskId);
    const stub = taskStub(taskId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    await stub.update({ nonexistent: RESPONSE });

    const row = await readTaskRow(stub);
    expect(row?.status).toBe("input_required");
    expect((await readInputRequests(stub)).at(0)?.answered).toBe(0);
  });

  it("update is idempotent: a second answer for an answered key is ignored", async () => {
    const taskId = uniqueTaskId();
    elicitingBehavior();
    await createTask(taskId);
    const stub = taskStub(taskId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    await stub.update({ color: RESPONSE });
    const afterFirst = await readInputRequests(stub);
    await stub.update({ color: { action: "decline" } }); // answered=0 guard: no overwrite
    const afterSecond = await readInputRequests(stub);

    expect(afterSecond).toEqual(afterFirst);
    expect(JSON.parse(String(afterSecond.at(0)?.response))).toEqual(RESPONSE);
  });
});

describe("update edge cases (control plane)", () => {
  it("acks on an unknown task without creating a row", async () => {
    const taskId = uniqueTaskId();
    const stub = taskStub(taskId);
    await stub.update({ color: RESPONSE });
    expect(await readTaskRow(stub)).toBeUndefined();
    expect(await stub.get()).toEqual({ notFound: true });
  });

  it("acks on a terminal task without touching it", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior("complete");
    await createTask(taskId);
    await drainTaskAlarms(taskId);
    const stub = taskStub(taskId);

    const before = await readTaskRow(stub);
    await stub.update({ color: RESPONSE });
    expect(await readTaskRow(stub)).toEqual(before);
  });

  it("rejects a non-object inputResponses payload", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    const stub = taskStub(taskId);
    await expectRejects(stub.update([] as unknown as Record<string, unknown>), /must be an object/);
  });
});
