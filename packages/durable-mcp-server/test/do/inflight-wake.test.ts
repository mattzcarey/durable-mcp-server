/**
 * Flow: wake requests that land while an attempt is EXECUTING. The DO awaits
 * the executor with its input gate open, so a `tasks/update` can interleave
 * with a running attempt — in particular with the window between the
 * attempt's last journal write (a recorded sleep or elicit) and its suspended
 * settlement. The settlement clears the redelivery anchor it was claimed
 * under; a wake requested in that window must survive it, and an offer
 * answered before the attempt records its sleep must still cut that sleep.
 * Also: timed elicits and standing offers coexisting (the timeout sweep
 * touches blocking rows only).
 *
 * The in-flight cases land the update FROM the executing attempt itself,
 * through the DO's own stub (the `cancel_mid_task` fixture idiom): the call
 * is delivered to the DO while its attempt is mid-flight, exactly the
 * interleaving a concurrent client produces, with no timers or gates.
 *
 * Layers: data (sleep rows, the run_next_at anchor, input_requests marks),
 * control plane (update / lease RPCs mid-attempt), integration (the chain
 * completes) against the injected fake executor.
 */

import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { callTaskRunner } from "../../src";
import {
  completedResult,
  invocations,
  resetFakeExecutor,
  setFakeBehavior,
} from "../fixtures/fake-executor";
import { drainTaskAlarms } from "../support/drain";
import {
  ageElicitTimeoutBy,
  createTask,
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
const FORK_ANSWER = { action: "accept", content: { way: "left" } };

/** Far-future sleep wake / elicit deadline (determinism rule). */
const FAR_MS = 600_000;

/** A `tasks/update` landing while the calling attempt is still executing. */
async function updateMidAttempt(taskId: string, responses: Record<string, unknown>): Promise<void> {
  await callTaskRunner(env.TASK_RUNNER, taskId, (stub) => stub.update(responses));
}

beforeEach(() => {
  resetFakeExecutor();
});

describe("an offer answered while the attempt is executing", () => {
  it("between recordSleep and the suspended settle: the sleep is cut, the wake survives the settle, the replay consumes", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async (desc, step) => {
      await step.recordOffer("act-1", OFFER);
      const nap = await step.recordSleep("nap", Date.now() + FAR_MS);
      if (nap.state === "pending") {
        await updateMidAttempt(desc.taskId, { "act-1": ANSWER }); // the window before the settle
        return { outcome: "suspended" };
      }
      const got = await step.checkInput("check-1", "act-1");
      return completedResult(got.state === "answered" ? JSON.stringify(got.response) : "none");
    });
    await createTask(taskId);
    const stub = taskStub(taskId);

    // Tick 1: the attempt records the sleep, the answer lands, the attempt
    // settles suspended. The cut sleep and the wake anchor must both stand.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    let row = await readTaskRow(stub);
    expect(row?.status).toBe("working");
    expect(row?.run_attempt).toBe(1);
    expect(row?.run_next_at).not.toBeNull(); // survived the suspended settle
    expect(await getAlarmTime(stub)).toBe(Number(row?.run_next_at));
    expect((await readSteps(stub)).at(0)).toMatchObject({ step_key: "nap", status: "completed" });
    expect((await readInputRequests(stub)).at(0)).toMatchObject({ answered: 1, consumed: 0 });

    // Tick 2: the preserved wake claims the replay, which consumes.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(row?.run_attempt).toBe(2);
    expect(invocations).toHaveLength(2);
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: JSON.stringify(ANSWER) }],
    });
    expect((await readInputRequests(stub)).at(0)?.consumed).toBe(1);
  });

  it("before the attempt records its sleep: that sleep is journaled already cut and the same attempt consumes", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async (desc, step) => {
      await step.recordOffer("act-1", OFFER);
      await updateMidAttempt(desc.taskId, { "act-1": ANSWER }); // e.g. during a slow step.do
      const nap = await step.recordSleep("nap", Date.now() + FAR_MS);
      if (nap.state === "pending") {
        return { outcome: "suspended" };
      }
      const got = await step.checkInput("check-1", "act-1");
      return completedResult(got.state === "answered" ? JSON.stringify(got.response) : "none");
    });
    await createTask(taskId);
    const stub = taskStub(taskId);

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(row?.run_attempt).toBe(1); // no replay was needed
    expect(invocations).toHaveLength(1);
    const nap = (await readSteps(stub)).find((step) => step.step_key === "nap");
    expect(nap).toMatchObject({ kind: "sleep", status: "completed" });
    expect(nap?.completed_at).not.toBeNull();
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: JSON.stringify(ANSWER) }],
    });
    expect((await readInputRequests(stub)).at(0)).toMatchObject({ answered: 1, consumed: 1 });
  });

  it("and consumed by that attempt's own checkInput: the following sleep is left intact", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async (desc, step) => {
      await step.recordOffer("act-1", OFFER);
      await updateMidAttempt(desc.taskId, { "act-1": ANSWER });
      const got = await step.checkInput("check-1", "act-1"); // consumes the in-flight answer
      const nap = await step.recordSleep("nap", Date.now() + FAR_MS);
      if (nap.state === "pending") {
        return { outcome: "suspended" };
      }
      return completedResult(got.state === "answered" ? JSON.stringify(got.response) : "none");
    });
    await createTask(taskId);
    const stub = taskStub(taskId);

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    // The wake was honored by the consume: the beat sleep is a real sleep,
    // the settle cleared the anchor, the alarm waits for the wake.
    let row = await readTaskRow(stub);
    expect(row?.status).toBe("working");
    expect(row?.run_attempt).toBe(1);
    expect(row?.run_next_at).toBeNull();
    const nap = (await readSteps(stub)).find((step) => step.step_key === "nap");
    expect(nap).toMatchObject({ status: "pending" });
    expect(await getAlarmTime(stub)).toBe(Number(nap?.wake_at));
    expect((await readInputRequests(stub)).at(0)).toMatchObject({ answered: 1, consumed: 1 });

    // The beat ends (due-on-fire): the replay finishes with the journaled hit.
    await drainTaskAlarms(taskId);
    row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(row?.run_attempt).toBe(2);
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: JSON.stringify(ANSWER) }],
    });
  });
});

describe("an elicit answered while the attempt is settling", () => {
  it("between recordElicit and the suspended settle: the resume's wake survives and the replay completes", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async (desc, step) => {
      const fork = await step.recordElicit("fork", FORK);
      if (fork.state !== "answered") {
        await updateMidAttempt(desc.taskId, { fork: FORK_ANSWER }); // answered before the settle
        return { outcome: "suspended" };
      }
      return completedResult(`fork:${JSON.stringify(fork.response)}`);
    });
    await createTask(taskId);
    const stub = taskStub(taskId);

    // Tick 1: elicit recorded (input_required), answered at once (resumed to
    // working with a wake), then the recording attempt settles suspended.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    let row = await readTaskRow(stub);
    expect(row?.status).toBe("working");
    expect(row?.run_attempt).toBe(1);
    expect(row?.run_next_at).not.toBeNull(); // the resume's wake survived the settle
    expect(await getAlarmTime(stub)).toBe(Number(row?.run_next_at));

    // Tick 2: the replay observes the answer and completes.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(row?.run_attempt).toBe(2);
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: `fork:${JSON.stringify(FORK_ANSWER)}` }],
    });
  });
});

describe("a timed elicit and a standing offer coexisting", () => {
  it("the sweep times out only the blocking row; an answered offer never blocks the resume and is consumed after it", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async (_desc, step) => {
      await step.recordOffer("act-1", OFFER);
      const gateState = await step.recordElicit("gate", FORK, Date.now() + FAR_MS);
      if (gateState.state === "pending") {
        return { outcome: "suspended" };
      }
      const got = await step.checkInput("check", "act-1");
      const action = got.state === "answered" ? JSON.stringify(got.response) : "open";
      return completedResult(`gate:${gateState.state}|act-1:${action}`);
    });
    await createTask(taskId);
    const stub = taskStub(taskId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    let row = await readTaskRow(stub);
    expect(row?.status).toBe("input_required");
    const gateRow = (await readInputRequests(stub)).find((r) => r.key === "gate");
    expect(await getAlarmTime(stub)).toBe(Number(gateRow?.timeout_at)); // the offer adds no candidate

    // The offer is answered while the fork waits: stored only, deadline untouched.
    await stub.update({ "act-1": ANSWER });
    row = await readTaskRow(stub);
    expect(row?.status).toBe("input_required");
    expect(row?.run_next_at).toBeNull();
    expect(await getAlarmTime(stub)).toBe(Number(gateRow?.timeout_at));

    // The deadline passes: the sweep marks the elicit only; the offer row is
    // not a timeout candidate and its answer stands.
    await ageElicitTimeoutBy(stub, FAR_MS * 2);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const marks = Object.fromEntries(
      (await readInputRequests(stub)).map((r) => [
        String(r.key),
        [r.blocking, r.answered, r.timed_out, r.consumed],
      ]),
    );
    expect(marks["gate"]).toEqual([1, 1, 1, 0]);
    expect(marks["act-1"]).toEqual([0, 1, 0, 1]); // consumed by the resumed replay's check

    await drainTaskAlarms(taskId);
    row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: `gate:timed_out|act-1:${JSON.stringify(ANSWER)}` }],
    });
  });
});
