/**
 * Flow: standing (non-blocking) input channels — recordOffer / checkInput /
 * tasks/update on offers — against the injected fake executor.
 *
 * Layers here: data (blocking + consumed columns, offer rows, journal rows
 * for checkInput hits and misses, generation guards), control plane (offer
 * idempotent across replays; update answering an offer wakes without a
 * status change; checkInput consume-once and replay determinism; the
 * blocking-only resume bookkeeping). Real-executor and HTTP layers live in
 * workflow-offer.test.ts and http/offer-flows.test.ts.
 */

import { runDurableObjectAlarm } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { TaskRunner } from "../../src";
import { completedResult, resetFakeExecutor, setFakeBehavior } from "../fixtures/fake-executor";
import { drainTaskAlarms } from "../support/drain";
import { expectRejects } from "../support/expect-rejects";
import {
  createTask,
  currentGeneration,
  getAlarmTime,
  readInputRequests,
  readSteps,
  readTaskRow,
  taskStub,
  uniqueTaskId,
} from "../support/helpers";

const OFFER = {
  method: "elicitation/create",
  params: { message: "what do you do?", requestedSchema: { type: "object" } },
};
const FORK = {
  method: "elicitation/create",
  params: { message: "left or right?", requestedSchema: { type: "object" } },
};
const ANSWER = { action: "accept", content: { action: "enter" } };
const OTHER = { action: "accept", content: { action: "leave" } };
const FORK_ANSWER = { action: "accept", content: { way: "left" } };

/** Far-future sleep wake (determinism rule): honored by early-firing drains. */
const NAP_MS = 600_000;

const snapshotSchema = z.record(z.string(), z.unknown());
async function snapshotOf(stub: DurableObjectStub<TaskRunner>): Promise<Record<string, unknown>> {
  return snapshotSchema.parse(await stub.get());
}

/** Behavior: offer, then a blocking fork; after the resume, check the offer. */
function forkWithOfferBehavior(): void {
  setFakeBehavior(async (_desc, step) => {
    await step.recordOffer("act-1", OFFER);
    const fork = await step.recordElicit("fork", FORK);
    if (fork.state !== "answered") {
      return { outcome: "suspended" };
    }
    const got = await step.checkInput("check-after-fork", "act-1");
    const action = got.state === "answered" ? JSON.stringify(got.response) : "open";
    return completedResult(`fork:${JSON.stringify(fork.response)}|act-1:${action}`);
  });
}

beforeEach(() => {
  resetFakeExecutor();
});

describe("offer rows (data)", () => {
  it("recordOffer registers a non-blocking row: task working, no narration, no inputRequests, no alarm candidate", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async (_desc, step) => {
      await step.recordOffer("act-1", OFFER);
      return { outcome: "suspended" }; // nothing scheduled: the offer must not arm anything
    });
    await createTask(taskId);
    const stub = taskStub(taskId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const row = await readTaskRow(stub);
    expect(row?.status).toBe("working");
    expect(row?.status_message).toBeNull();
    expect(row?.run_next_at).toBeNull();
    const requests = await readInputRequests(stub);
    expect(requests).toHaveLength(1);
    expect(requests.at(0)).toMatchObject({
      key: "act-1",
      step_key: "act-1",
      answered: 0,
      blocking: 0,
      consumed: 0,
      timed_out: 0,
    });
    expect(requests.at(0)?.timeout_at).toBeNull();
    expect(requests.at(0)?.response).toBeNull();
    expect(JSON.parse(String(requests.at(0)?.request))).toEqual(OFFER);
    // Only the TTL deadline is armed: an offer has no deadline and no wake.
    expect(await getAlarmTime(stub)).toBe(Number(row?.created_at) + 86_400_000);
    // tasks/get: working, and the ambient offer is NOT an inputRequest.
    const snapshot = await snapshotOf(stub);
    expect(snapshot["status"]).toBe("working");
    expect("inputRequests" in snapshot).toBe(false);
  });

  it("an elicit row keeps the blocking default; an offer key cannot become an elicit nor vice versa", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    const stub = taskStub(taskId);
    const generation = await currentGeneration(stub);

    await stub.recordOffer(generation, "act-1", OFFER);
    expect(await stub.recordElicit(generation, "fork", FORK)).toEqual({ state: "pending" });
    const rows = await readInputRequests(stub);
    expect(rows.map((row) => [row.key, row.blocking])).toEqual([
      ["act-1", 0],
      ["fork", 1],
    ]);

    await expectRejects(stub.recordElicit(generation, "act-1", FORK), /already used in this task/);
    await expectRejects(stub.recordOffer(generation, "fork", OFFER), /already used in this task/);
    await expectRejects(stub.recordOffer(generation, "", OFFER), /non-empty key/);
    expect(await readInputRequests(stub)).toHaveLength(2);
  });
});

describe("offer replay + checkInput journal (control plane + data)", () => {
  it("re-offering the key on replay is a no-op: one row, the first request stands", async () => {
    const taskId = uniqueTaskId();
    let runs = 0;
    setFakeBehavior(async (_desc, step) => {
      runs += 1;
      // The replay re-offers with a DIFFERENT body: the first record wins.
      await step.recordOffer("act-1", runs === 1 ? OFFER : { ...OFFER, params: { message: "x" } });
      const nap = await step.recordSleep("nap", Date.now() + NAP_MS);
      if (nap.state === "pending") {
        return { outcome: "suspended" };
      }
      return completedResult("done");
    });
    await createTask(taskId);
    const stub = taskStub(taskId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const first = await readInputRequests(stub);
    expect(first).toHaveLength(1);

    await drainTaskAlarms(taskId);
    expect(runs).toBe(2);
    expect((await readTaskRow(stub))?.status).toBe("completed");
    expect(await readInputRequests(stub)).toEqual(first); // same single row, untouched
    expect(JSON.parse(String(first.at(0)?.request))).toEqual(OFFER);
  });

  it("checkInput on an open offer journals a miss (check row, null) and leaves the offer open", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    const stub = taskStub(taskId);
    const generation = await currentGeneration(stub);
    await stub.recordOffer(generation, "act-1", OFFER);
    const alarmBefore = await getAlarmTime(stub);

    expect(await stub.checkInput(generation, "check-1", "act-1")).toEqual({ state: "unanswered" });

    const steps = await readSteps(stub);
    expect(steps).toHaveLength(1);
    expect(steps.at(0)).toMatchObject({
      step_key: "check-1",
      kind: "check",
      status: "completed",
      attempt: 0,
    });
    expect(JSON.parse(String(steps.at(0)?.result))).toEqual({ kind: "value", value: null });
    expect(steps.at(0)?.completed_at).not.toBeNull();
    expect((await readInputRequests(stub)).at(0)).toMatchObject({ answered: 0, consumed: 0 });
    expect(await getAlarmTime(stub)).toBe(alarmBefore); // no scheduling effect
  });

  it("checkInput consumes an answered offer exactly once: hit journaled, consumed mark set, later checks miss", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    const stub = taskStub(taskId);
    const generation = await currentGeneration(stub);
    await stub.recordOffer(generation, "act-1", OFFER);
    await stub.update({ "act-1": ANSWER });
    expect((await readInputRequests(stub)).at(0)).toMatchObject({ answered: 1, consumed: 0 });

    expect(await stub.checkInput(generation, "check-1", "act-1")).toEqual({
      state: "answered",
      response: ANSWER,
    });
    expect((await readInputRequests(stub)).at(0)).toMatchObject({ answered: 1, consumed: 1 });
    expect(JSON.parse(String((await readSteps(stub)).at(0)?.result))).toEqual({
      kind: "value",
      value: ANSWER,
    });

    // Consume-once: a later check (new step name) misses and journals null.
    expect(await stub.checkInput(generation, "check-2", "act-1")).toEqual({ state: "unanswered" });
    const steps = await readSteps(stub);
    expect(steps.map((step) => [step.step_key, step.kind])).toEqual([
      ["check-1", "check"],
      ["check-2", "check"],
    ]);
    expect(JSON.parse(String(steps.at(1)?.result))).toEqual({ kind: "value", value: null });
  });

  it("a journaled checkInput is deterministic on replay: the stored value stands even after an answer lands", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    const stub = taskStub(taskId);
    const generation = await currentGeneration(stub);
    await stub.recordOffer(generation, "act-1", OFFER);
    expect(await stub.checkInput(generation, "check-1", "act-1")).toEqual({ state: "unanswered" });

    await stub.update({ "act-1": ANSWER });
    // Same step name (a replay): the journaled miss stands; nothing is consumed.
    expect(await stub.checkInput(generation, "check-1", "act-1")).toEqual({ state: "unanswered" });
    expect((await readInputRequests(stub)).at(0)).toMatchObject({ answered: 1, consumed: 0 });
    // The NEXT check consumes it...
    expect(await stub.checkInput(generation, "check-2", "act-1")).toEqual({
      state: "answered",
      response: ANSWER,
    });
    expect((await readInputRequests(stub)).at(0)?.consumed).toBe(1);
    // ...and its replay returns the journaled hit without a second consume.
    expect(await stub.checkInput(generation, "check-2", "act-1")).toEqual({
      state: "answered",
      response: ANSWER,
    });
    expect(await readSteps(stub)).toHaveLength(2);
  });

  it("checkInput rejects an unknown key and a blocking key, and its step name collides like any step (D8)", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    const stub = taskStub(taskId);
    const generation = await currentGeneration(stub);

    await expectRejects(
      stub.checkInput(generation, "check-1", "nope"),
      /no input request is registered/,
    );
    await expectRejects(stub.checkInput(generation, "check-1", ""), /non-empty offer key/);
    await stub.recordOffer(generation, "act-1", OFFER);
    expect(await stub.recordElicit(generation, "fork", FORK)).toEqual({ state: "pending" });
    await expectRejects(stub.checkInput(generation, "check-1", "fork"), /blocking elicit/);
    expect(await readSteps(stub)).toHaveLength(0); // nothing journaled by the rejections

    expect(await stub.checkInput(generation, "shared", "act-1")).toEqual({ state: "unanswered" });
    await expectRejects(stub.beginStep(generation, "shared"), /already used in this task/);
    await expectRejects(
      stub.recordSleep(generation, "shared", Date.now() + NAP_MS),
      /already used in this task/,
    );
    expect(await stub.beginStep(generation, "work")).toEqual({ state: "run", attempt: 1 });
    await expectRejects(stub.checkInput(generation, "work", "act-1"), /already used in this task/);
  });
});

describe("tasks/update on offers (control plane)", () => {
  it("answering an offer wakes a sleeping task without touching status: sleep cut short, anchor pulled to now, alarm re-armed", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async (_desc, step) => {
      await step.setStatus("beat 1");
      await step.recordOffer("act-1", OFFER);
      const nap = await step.recordSleep("nap", Date.now() + NAP_MS);
      if (nap.state === "pending") {
        return { outcome: "suspended" };
      }
      const got = await step.checkInput("check-1", "act-1");
      return completedResult(got.state === "answered" ? JSON.stringify(got.response) : "none");
    });
    await createTask(taskId);
    const stub = taskStub(taskId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const before = await readTaskRow(stub);
    expect(before?.status).toBe("working");
    expect(before?.run_next_at).toBeNull();
    const nap = (await readSteps(stub)).at(0);
    expect(nap).toMatchObject({ step_key: "nap", kind: "sleep", status: "pending" });
    expect(await getAlarmTime(stub)).toBe(Number(nap?.wake_at));

    await stub.update({ "act-1": ANSWER, bogus: OTHER });

    const after = await readTaskRow(stub);
    expect(after?.status).toBe("working"); // untouched
    expect(after?.status_message).toBe("beat 1"); // untouched
    expect(after?.run_next_at).not.toBeNull(); // the wake anchor
    expect(Number(after?.last_updated_at)).toBeGreaterThanOrEqual(Number(before?.last_updated_at));
    expect((await readSteps(stub)).at(0)).toMatchObject({ step_key: "nap", status: "completed" });
    expect(await getAlarmTime(stub)).toBe(Number(after?.run_next_at)); // reconcile-armed
    const requests = await readInputRequests(stub);
    expect(requests).toHaveLength(1); // the bogus key created nothing
    expect(requests.at(0)).toMatchObject({ key: "act-1", answered: 1, consumed: 0 });
    expect(JSON.parse(String(requests.at(0)?.response))).toEqual(ANSWER);

    // One tick: the resumed replay sails past the cut sleep and consumes.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const done = await readTaskRow(stub);
    expect(done?.status).toBe("completed");
    expect(done?.run_attempt).toBe(2);
    expect(JSON.parse(String(done?.result))).toEqual({
      content: [{ type: "text", text: JSON.stringify(ANSWER) }],
    });
    expect((await readInputRequests(stub)).at(0)?.consumed).toBe(1);
  });

  it("late answers to an answered or consumed offer ack and change nothing", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    const stub = taskStub(taskId);
    const generation = await currentGeneration(stub);
    await stub.recordOffer(generation, "act-1", OFFER);
    await stub.update({ "act-1": ANSWER });
    const answered = await readInputRequests(stub);
    const rowAfterAnswer = await readTaskRow(stub);

    // A second answer before consumption: the first answer wins.
    await stub.update({ "act-1": OTHER });
    expect(await readInputRequests(stub)).toEqual(answered);
    expect(await readTaskRow(stub)).toEqual(rowAfterAnswer);

    // After consumption: still ignored — no store, no wake, no bump.
    await stub.checkInput(generation, "check-1", "act-1");
    const consumed = await readInputRequests(stub);
    const rowAfterConsume = await readTaskRow(stub);
    await stub.update({ "act-1": OTHER });
    expect(await readInputRequests(stub)).toEqual(consumed);
    expect(await readTaskRow(stub)).toEqual(rowAfterConsume);
    expect(JSON.parse(String(consumed.at(0)?.response))).toEqual(ANSWER);
  });

  it("an answer to an offer while the task is input_required is stored only: no resume, no wake; the fork's resume consumes it", async () => {
    const taskId = uniqueTaskId();
    forkWithOfferBehavior();
    await createTask(taskId);
    const stub = taskStub(taskId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    let row = await readTaskRow(stub);
    expect(row?.status).toBe("input_required");
    expect(row?.run_next_at).toBeNull();
    // tasks/get shows ONLY the blocking request.
    const waiting = await snapshotOf(stub);
    expect(waiting["status"]).toBe("input_required");
    expect(waiting["inputRequests"]).toEqual({ fork: FORK });

    await stub.update({ "act-1": ANSWER });
    row = await readTaskRow(stub);
    expect(row?.status).toBe("input_required"); // an offer is never blocking...
    expect(row?.run_next_at).toBeNull(); // ...and no wake while input_required
    expect((await readInputRequests(stub)).find((r) => r.key === "act-1")).toMatchObject({
      answered: 1,
      consumed: 0,
    });
    await drainTaskAlarms(taskId);
    expect((await readTaskRow(stub))?.status).toBe("input_required"); // quiescent

    // The fork's answer resumes; the replay's check consumes the stored answer.
    await stub.update({ fork: FORK_ANSWER });
    expect((await readTaskRow(stub))?.status).toBe("working");
    await drainTaskAlarms(taskId);
    const done = await readTaskRow(stub);
    expect(done?.status).toBe("completed");
    expect(JSON.parse(String(done?.result))).toEqual({
      content: [
        {
          type: "text",
          text: `fork:${JSON.stringify(FORK_ANSWER)}|act-1:${JSON.stringify(ANSWER)}`,
        },
      ],
    });
    expect((await readInputRequests(stub)).find((r) => r.key === "act-1")?.consumed).toBe(1);
  });

  it("resume counts only blocking requests: a fork answered while an offer is outstanding resumes the task", async () => {
    const taskId = uniqueTaskId();
    forkWithOfferBehavior();
    await createTask(taskId);
    const stub = taskStub(taskId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await readTaskRow(stub))?.status).toBe("input_required");

    await stub.update({ fork: FORK_ANSWER }); // act-1 still outstanding
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("working");
    expect(row?.run_next_at).not.toBeNull();
    expect((await readInputRequests(stub)).find((r) => r.key === "act-1")?.answered).toBe(0);

    await drainTaskAlarms(taskId);
    const done = await readTaskRow(stub);
    expect(done?.status).toBe("completed");
    expect(JSON.parse(String(done?.result))).toEqual({
      content: [{ type: "text", text: `fork:${JSON.stringify(FORK_ANSWER)}|act-1:open` }],
    });
  });
});

describe("generation guards (stale leases)", () => {
  it("recordOffer and checkInput from a bogus lease are rejected and write nothing", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    const stub = taskStub(taskId);
    await expectRejects(stub.recordOffer(crypto.randomUUID(), "act-1", OFFER), /Stale lease/);
    await expectRejects(stub.checkInput(crypto.randomUUID(), "check-1", "act-1"), /Stale lease/);
    expect(await readInputRequests(stub)).toHaveLength(0);
    expect(await readSteps(stub)).toHaveLength(0);
  });

  it("a lease is dead for offers once the task is terminal", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior("complete");
    await createTask(taskId);
    await drainTaskAlarms(taskId);
    const stub = taskStub(taskId);
    const generation = await currentGeneration(stub);
    await expectRejects(stub.recordOffer(generation, "act-1", OFFER), /already completed/);
    await expectRejects(stub.checkInput(generation, "check-1", "act-1"), /already completed/);
    expect(await readInputRequests(stub)).toHaveLength(0);
    expect(await readSteps(stub)).toHaveLength(0);
  });
});
