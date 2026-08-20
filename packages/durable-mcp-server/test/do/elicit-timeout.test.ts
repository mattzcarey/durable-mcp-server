/**
 * Flow: elicit answer deadlines (timed `step.elicit`): recordElicit stores
 * the deadline with the request, the alarm min includes it, and when it
 * elapses unanswered the sweep marks the request answered-by-timeout —
 * late `tasks/update` responses to the key are ignored by the answered
 * guard — and the resumed replay observes `timed_out`.
 *
 * Layers here: data (input_requests deadline + timed_out marker, alarm min),
 * control plane (recordElicit deadline validation and immutability, update
 * after timeout, timeout resolution via drained alarms) against the injected
 * fake executor. Real-executor and HTTP layers live in
 * workflow-elicit-timeout.test.ts and http/flows.test.ts.
 */

import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { callTaskRunner } from "../../src";
import { resetFakeExecutor, setFakeBehavior } from "../fixtures/fake-executor";
import { drainTaskAlarms } from "../support/drain";
import { expectRejects } from "../support/expect-rejects";
import {
  ageElicitTimeoutBy,
  createTask,
  currentGeneration,
  getAlarmTime,
  readInputRequests,
  readTaskRow,
  taskStub,
  uniqueTaskId,
} from "../support/helpers";

const REQUEST = {
  method: "elicitation/create",
  params: { message: "box this lap?", requestedSchema: { type: "object" } },
};

const RESPONSE = { action: "accept", content: { box: true } };

/** Far-future deadline: rewound with ageElicitTimeoutBy, never waited on. */
const DEADLINE_IN_MS = 600_000;

/**
 * Behavior: one timed elicit; the timed-out branch parks on a far-future
 * sleep (an observable working window) before completing, the answered
 * branch completes with the response.
 */
function timedElicitBehavior(): void {
  setFakeBehavior(async (_desc, step) => {
    const elicit = await step.recordElicit("gate", REQUEST, Date.now() + DEADLINE_IN_MS);
    if (elicit.state === "pending") {
      return { outcome: "suspended" };
    }
    if (elicit.state === "timed_out") {
      const nap = await step.recordSleep("limp", Date.now() + DEADLINE_IN_MS);
      if (nap.state === "pending") {
        return { outcome: "suspended" };
      }
      return {
        outcome: "completed",
        result: { content: [{ type: "text", text: "gate:timed-out" }] },
      };
    }
    return {
      outcome: "completed",
      result: { content: [{ type: "text", text: `gate:${JSON.stringify(elicit.response)}` }] },
    };
  });
}

beforeEach(() => {
  resetFakeExecutor();
});

describe("elicit deadline bookkeeping (data)", () => {
  it("stores the deadline on the request row and arms the alarm at it", async () => {
    const taskId = uniqueTaskId();
    timedElicitBehavior();
    await createTask(taskId);
    const stub = taskStub(taskId);

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const row = await readTaskRow(stub);
    expect(row?.status).toBe("input_required");
    const request = (await readInputRequests(stub)).at(0);
    expect(request).toMatchObject({ key: "gate", answered: 0, timed_out: 0 });
    expect(Number(request?.timeout_at)).toBeGreaterThan(Date.now());
    expect(Number(request?.timeout_at)).toBeLessThan(Number(row?.created_at) + 86_400_000);

    // The computed alarm min is the deadline (earlier than the TTL).
    expect(await getAlarmTime(stub)).toBe(Number(request?.timeout_at));

    // Wall-clock honest: draining before the deadline resolves nothing.
    await drainTaskAlarms(taskId);
    expect((await readTaskRow(stub))?.status).toBe("input_required");
    expect((await readInputRequests(stub)).at(0)?.timed_out).toBe(0);
  });

  it("an undated elicit stores no deadline and the alarm falls back to the TTL", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async (_desc, step) => {
      const elicit = await step.recordElicit("gate", REQUEST);
      if (elicit.state !== "answered") {
        return { outcome: "suspended" };
      }
      return {
        outcome: "completed",
        result: { content: [{ type: "text", text: "answered" }] },
      };
    });
    await createTask(taskId);
    const stub = taskStub(taskId);

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const row = await readTaskRow(stub);
    expect((await readInputRequests(stub)).at(0)?.timeout_at).toBeNull();
    expect(await getAlarmTime(stub)).toBe(Number(row?.created_at) + 86_400_000);
  });
});

describe("timeout resolution (control plane)", () => {
  it("past the deadline: marked answered-by-timeout, resumed, replay observes timed_out", async () => {
    const taskId = uniqueTaskId();
    timedElicitBehavior();
    await createTask(taskId);
    const stub = taskStub(taskId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    await ageElicitTimeoutBy(stub, DEADLINE_IN_MS * 2);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    // Data: the marker, no synthetic response, the task resumed and replayed
    // straight into the timed-out branch (suspended on the limp sleep).
    const request = (await readInputRequests(stub)).at(0);
    expect(request).toMatchObject({ key: "gate", answered: 1, timed_out: 1 });
    expect(request?.response).toBeNull();

    const row = await readTaskRow(stub);
    expect(row?.status).toBe("working");
    expect(row?.run_attempt).toBe(2); // initial claim + the resume claim
    expect(row?.status_message).toBeNull(); // single writer: no engine narration

    // Drain to the end: the limp sleep is due-on-fire; the timeout branch wins.
    await drainTaskAlarms(taskId);
    const settled = await readTaskRow(stub);
    expect(settled?.status).toBe("completed");
    expect(JSON.parse(String(settled?.result))).toEqual({
      content: [{ type: "text", text: "gate:timed-out" }],
    });
  });

  it("a late tasks/update to a timed-out key acks but changes nothing", async () => {
    const taskId = uniqueTaskId();
    timedElicitBehavior();
    await createTask(taskId);
    const stub = taskStub(taskId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    await ageElicitTimeoutBy(stub, DEADLINE_IN_MS * 2);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const before = await readTaskRow(stub);
    expect(before?.status).toBe("working"); // resumed, parked on the limp sleep

    // The answered guard treats the timed-out key exactly like any answered
    // key: the update acks, stores nothing, resumes nothing.
    await stub.update({ gate: RESPONSE });

    const request = (await readInputRequests(stub)).at(0);
    expect(request).toMatchObject({ answered: 1, timed_out: 1 });
    expect(request?.response).toBeNull();
    const after = await readTaskRow(stub);
    expect(after?.status).toBe("working");
    expect(after?.run_attempt).toBe(before?.run_attempt);

    // The handler still lands on the timeout branch, never the late answer.
    await drainTaskAlarms(taskId);
    expect(JSON.parse(String((await readTaskRow(stub))?.result))).toEqual({
      content: [{ type: "text", text: "gate:timed-out" }],
    });
  });

  it("an answer in time wins: no timeout marker, response delivered", async () => {
    const taskId = uniqueTaskId();
    timedElicitBehavior();
    await createTask(taskId);
    const stub = taskStub(taskId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    await stub.update({ gate: RESPONSE });
    await drainTaskAlarms(taskId);

    const request = (await readInputRequests(stub)).at(0);
    expect(request).toMatchObject({ answered: 1, timed_out: 0 });
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: `gate:${JSON.stringify(RESPONSE)}` }],
    });
  });

  it("an answer past the deadline but before the sweep tick wins: first durable write, deterministic", async () => {
    const taskId = uniqueTaskId();
    timedElicitBehavior();
    await createTask(taskId);
    const stub = taskStub(taskId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    // The deadline has already passed on the wall clock, but no alarm tick
    // has swept it yet: the update's guarded write (answered = 0) commits
    // first, so the answer wins — never both, never neither.
    await ageElicitTimeoutBy(stub, DEADLINE_IN_MS * 2);
    await stub.update({ gate: RESPONSE });
    expect((await readInputRequests(stub)).at(0)).toMatchObject({ answered: 1, timed_out: 0 });

    // The sweep tick finds nothing due (answered guard): no timeout marker
    // ever lands, and the replay resolves with the client's response.
    await drainTaskAlarms(taskId);
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect((await readInputRequests(stub)).at(0)).toMatchObject({ answered: 1, timed_out: 0 });
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: `gate:${JSON.stringify(RESPONSE)}` }],
    });
  });

  it("the recorded deadline is immutable: a replay's recomputed deadline is ignored", async () => {
    const taskId = uniqueTaskId();
    timedElicitBehavior();
    await createTask(taskId);
    const stub = taskStub(taskId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const first = (await readInputRequests(stub)).at(0);
    const generation = await currentGeneration(stub);

    // An orphaned-stub replay re-records with a later deadline: pending, and
    // the stored deadline stands (first record wins).
    const state = await callTaskRunner(env.TASK_RUNNER, taskId, async (s) => {
      const result = await s.recordElicit(
        generation,
        "gate",
        REQUEST,
        Number(first?.timeout_at) + 500_000,
      );
      return result.state;
    });
    expect(state).toBe("pending");
    expect((await readInputRequests(stub)).at(0)?.timeout_at).toBe(first?.timeout_at);
  });

  it("rejects an invalid deadline", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    const stub = taskStub(taskId);
    const generation = await currentGeneration(stub);
    await expectRejects(
      stub.recordElicit(generation, "gate", REQUEST, -5),
      /non-negative safe integer/,
    );
    expect(await readInputRequests(stub)).toHaveLength(0);
  });
});
