/**
 * Flow: timed `step.elicit` through the REAL executor (stage 3): the
 * discriminated ElicitOutcome both ways — answered in time vs timed out —
 * plus eviction while the request is pending (the journaled deadline
 * survives the cold start).
 *
 * Layers: integration (full lifecycle over drains and eviction), data
 * (deadline + marker rows, alarm min), control plane (update RPC on the
 * timed request). The HTTP layer lives in http/flows.test.ts.
 */

import { evictDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { callTaskRunner } from "../../src";
import { runCount } from "../fixtures/task-state";
import { drainTaskAlarms } from "../support/drain";
import {
  ageElicitTimeoutBy,
  createTask,
  getAlarmTime,
  readInputRequests,
  readSteps,
  readTaskRow,
  uniqueTaskId,
} from "../support/helpers";

const NS = () => env.TASK_RUNNER_REAL;
const drain = (taskId: string) => drainTaskAlarms(taskId, { namespace: NS() });

/** Far-future deadline: rewound with ageElicitTimeoutBy, never waited on. */
const DEADLINE_IN_MS = 600_000;

const RESPONSE = { action: "accept", content: { box: true } };

async function startTimedElicit(taskId: string): Promise<void> {
  await createTask(
    taskId,
    { toolName: "timed_elicit_task", input: { timeoutMs: DEADLINE_IN_MS } },
    NS(),
  );
}

describe("timed elicit answered in time", () => {
  it("resolves the discriminated answered outcome with the client's response", async () => {
    const taskId = uniqueTaskId();
    await startTimedElicit(taskId);
    const stub = NS().getByName(taskId);

    await drain(taskId);
    expect((await readTaskRow(stub))?.status).toBe("input_required");
    expect((await readInputRequests(stub)).at(0)?.timeout_at).not.toBeNull();

    await callTaskRunner(NS(), taskId, (s) => s.update({ "pit-call": RESPONSE }));
    await drain(taskId);

    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: `ready:${JSON.stringify(RESPONSE)}` }],
    });
    expect((await readInputRequests(stub)).at(0)).toMatchObject({ answered: 1, timed_out: 0 });
    expect(runCount(`${taskId}:prep`)).toBe(1); // memoized across the resume
  });
});

describe("timed elicit unanswered past the deadline", () => {
  it("resumes on the timeout branch; a late answer acks but changes nothing", async () => {
    const taskId = uniqueTaskId();
    await startTimedElicit(taskId);
    const stub = NS().getByName(taskId);

    await drain(taskId);
    expect((await readTaskRow(stub))?.status).toBe("input_required");

    // Wall-clock honest: before the deadline nothing resolves.
    await drain(taskId);
    expect((await readInputRequests(stub)).at(0)?.timed_out).toBe(0);

    // Deadline passes (rewound): one tick sweeps the timeout, resumes, and
    // the replay takes the timed_out branch into the limp-home sleep.
    await ageElicitTimeoutBy(stub, DEADLINE_IN_MS * 2);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const request = (await readInputRequests(stub)).at(0);
    expect(request).toMatchObject({ key: "pit-call", answered: 1, timed_out: 1 });
    expect(request?.response).toBeNull(); // never a synthetic wire response

    let row = await readTaskRow(stub);
    expect(row?.status).toBe("working"); // resumed, parked on limp-home
    expect((await readSteps(stub)).map((s) => [s.step_key, s.status])).toEqual([
      ["prep", "completed"],
      ["limp-home", "pending"],
    ]);
    expect(runCount(`${taskId}:prep`)).toBe(1); // memoized, not re-run

    // Late answer: empty ack, nothing stored, handler unaffected.
    await callTaskRunner(NS(), taskId, (s) => s.update({ "pit-call": RESPONSE }));
    expect((await readInputRequests(stub)).at(0)?.response).toBeNull();
    expect((await readTaskRow(stub))?.status).toBe("working");

    await drain(taskId);
    row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: "ready:timed-out" }],
    });
  });
});

describe("eviction mid-pending timed elicit", () => {
  it("the journaled deadline survives the cold start and still resolves the timeout", async () => {
    const taskId = uniqueTaskId();
    await startTimedElicit(taskId);
    let stub = NS().getByName(taskId);

    await drain(taskId);
    const before = (await readInputRequests(stub)).at(0);
    expect(before?.timeout_at).not.toBeNull();
    const deadline = Number(before?.timeout_at);

    await evictDurableObject(stub); // in-memory instance gone, SQLite kept
    stub = NS().getByName(taskId);

    // The persisted deadline and its armed alarm survived (min vs the TTL).
    expect((await readInputRequests(stub)).at(0)?.timeout_at).toBe(deadline);
    expect(await getAlarmTime(stub)).toBe(deadline);

    // The fresh instance's reconcile recomputes the deadline into its min —
    // an early fire (which deletes the pending alarm before invoking) sweeps
    // nothing and re-arms AT the deadline instead of dropping it.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await readInputRequests(stub)).at(0)?.timed_out).toBe(0);
    expect(await getAlarmTime(stub)).toBe(deadline);

    await ageElicitTimeoutBy(stub, DEADLINE_IN_MS * 2);
    await drain(taskId);

    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: "ready:timed-out" }],
    });
    expect(runCount(`${taskId}:prep`)).toBe(1); // journal survived the eviction
  });
});
