/**
 * Flow: standing offers through the REAL executor (the datacenter-adventure
 * shape): offer -> beats keep flowing (status stays working) -> tasks/update
 * lands mid-sleep -> immediate wake -> checkInput consumes -> sub-branch runs
 * -> re-offer under a fresh key; a blocking fork elicit WHILE an offer is
 * outstanding (both answer orders); eviction mid-offer preserving everything.
 *
 * Layers: integration (full lifecycles over drains and eviction), data
 * (offer/consumed rows, check journal rows, cut sleeps), control plane
 * (update RPC on offers). The HTTP layer lives in http/offer-flows.test.ts.
 */

import { evictDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { callTaskRunner } from "../../src";
import type { TaskRunner } from "../../src";
import { runCount } from "../fixtures/task-state";
import { drainTaskAlarms } from "../support/drain";
import {
  createTask,
  getAlarmTime,
  readInputRequests,
  readSteps,
  readTaskRow,
  uniqueTaskId,
} from "../support/helpers";

const NS = () => env.TASK_RUNNER_REAL;
const drain = (taskId: string) => drainTaskAlarms(taskId, { namespace: NS() });

const ACTION = { action: "accept", content: { action: "enter" } };
const ENCORE = { action: "accept", content: { action: "bow" } };
const LATE = { action: "accept", content: { action: "leave" } };
const FORK_ANSWER = { action: "accept", content: { way: "left" } };

const snapshotSchema = z.record(z.string(), z.unknown());
async function snapshotOf(stub: DurableObjectStub<TaskRunner>): Promise<Record<string, unknown>> {
  return snapshotSchema.parse(await stub.get());
}

/** The journal keyed by step name (rows created in one tick may share a ms). */
async function journalOf(stub: DurableObjectStub<TaskRunner>): Promise<Record<string, unknown[]>> {
  return Object.fromEntries(
    (await readSteps(stub)).map((step) => [String(step.step_key), [step.kind, step.status]]),
  );
}

/** Input requests keyed by key: `[blocking, answered, consumed]` (order-free). */
async function requestsOf(stub: DurableObjectStub<TaskRunner>): Promise<Record<string, unknown[]>> {
  return Object.fromEntries(
    (await readInputRequests(stub)).map((row) => [
      String(row.key),
      [row.blocking, row.answered, row.consumed],
    ]),
  );
}

describe("story: offer -> beats -> update mid-sleep -> wake -> consume -> sub-branch -> re-offer", () => {
  it("runs the whole shape tick by tick", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "story_task", input: { beats: 3 } }, NS());
    const stub = NS().getByName(taskId);

    // Tick 1: the offer stands, beat 1 narrates, the beat sleep suspends.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    let row = await readTaskRow(stub);
    expect(row?.status).toBe("working");
    expect(row?.status_message).toBe("beat 1");
    expect(await requestsOf(stub)).toEqual({ "act-1": [0, 0, 0] });
    expect(await journalOf(stub)).toEqual({ "beat-1": ["sleep", "pending"] });
    const snapshot = await snapshotOf(stub);
    expect(snapshot["status"]).toBe("working");
    expect("inputRequests" in snapshot).toBe(false); // ambient offer, never on the wire

    // Tick 2 (the early fire honors beat-1): check-1 misses, beat 2 flows on.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    row = await readTaskRow(stub);
    expect(row?.status).toBe("working");
    expect(row?.status_message).toBe("beat 2");
    expect(await journalOf(stub)).toEqual({
      "beat-1": ["sleep", "completed"],
      "check-1": ["check", "completed"],
      "beat-2": ["sleep", "pending"],
    });
    const miss = (await readSteps(stub)).find((step) => step.step_key === "check-1");
    expect(JSON.parse(String(miss?.result))).toEqual({ kind: "value", value: null });

    // The update lands mid-sleep: stored, status untouched, beat-2 cut short, wake armed.
    await callTaskRunner(NS(), taskId, (s) => s.update({ "act-1": ACTION }));
    row = await readTaskRow(stub);
    expect(row?.status).toBe("working");
    expect(row?.status_message).toBe("beat 2");
    expect(row?.run_next_at).not.toBeNull();
    expect(await getAlarmTime(stub)).toBe(Number(row?.run_next_at));
    expect((await journalOf(stub))["beat-2"]).toEqual(["sleep", "completed"]);
    expect(await requestsOf(stub)).toEqual({ "act-1": [0, 1, 0] });

    // Tick 3: immediate wake -> check-2 consumes -> sub-branch -> re-offer -> epilogue sleep.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(runCount(`${taskId}:sub-branch`)).toBe(1);
    row = await readTaskRow(stub);
    expect(row?.status).toBe("working");
    expect(row?.status_message).toBe("epilogue");
    expect(await journalOf(stub)).toEqual({
      "beat-1": ["sleep", "completed"],
      "check-1": ["check", "completed"],
      "beat-2": ["sleep", "completed"],
      "check-2": ["check", "completed"],
      "sub-branch": ["do", "completed"],
      epilogue: ["sleep", "pending"],
    });
    const hit = (await readSteps(stub)).find((step) => step.step_key === "check-2");
    expect(JSON.parse(String(hit?.result))).toEqual({ kind: "value", value: ACTION });
    expect(await requestsOf(stub)).toEqual({ "act-1": [0, 1, 1], "act-2": [0, 0, 0] });

    // A late answer to the consumed offer: nothing changes — no store, no wake.
    const beforeLate = await readTaskRow(stub);
    await callTaskRunner(NS(), taskId, (s) => s.update({ "act-1": LATE }));
    expect(await readTaskRow(stub)).toEqual(beforeLate);
    const act1 = (await readInputRequests(stub)).find((r) => r.key === "act-1");
    expect(JSON.parse(String(act1?.response))).toEqual(ACTION);
    expect((await journalOf(stub))["epilogue"]).toEqual(["sleep", "pending"]);

    // The fresh offer takes an answer: wake, the epilogue check consumes it, the story completes.
    await callTaskRunner(NS(), taskId, (s) => s.update({ "act-2": ENCORE }));
    expect((await journalOf(stub))["epilogue"]).toEqual(["sleep", "completed"]);
    await drain(taskId);
    row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [
        { type: "text", text: `branch:${JSON.stringify(ACTION)}|act-2:${JSON.stringify(ENCORE)}` },
      ],
    });
    expect(runCount(`${taskId}:sub-branch`)).toBe(1); // memoized across every resume
    expect(await requestsOf(stub)).toEqual({ "act-1": [0, 1, 1], "act-2": [0, 1, 1] });
  });

  it("a story nobody answers runs its beats to the end; the offer stands, harmless", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "story_task", input: { beats: 2 } }, NS());
    const stub = NS().getByName(taskId);

    await drain(taskId);

    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: "no action taken" }],
    });
    expect(await requestsOf(stub)).toEqual({ "act-1": [0, 0, 0] });
    expect(runCount(`${taskId}:sub-branch`)).toBe(0);
  });
});

describe("eviction mid-offer", () => {
  it("the offer, its answer, the journal, and the armed wake survive a cold start; the story resumes once", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "story_task", input: { beats: 3 } }, NS());
    let stub = NS().getByName(taskId);
    expect(await runDurableObjectAlarm(stub)).toBe(true); // beat 1 sleeping
    await callTaskRunner(NS(), taskId, (s) => s.update({ "act-1": ACTION })); // lands mid-sleep
    const requestsBefore = await readInputRequests(stub);
    const stepsBefore = await readSteps(stub);
    const alarmBefore = await getAlarmTime(stub);
    expect(alarmBefore).not.toBeNull();

    await evictDurableObject(stub); // in-memory instance gone, SQLite kept
    stub = NS().getByName(taskId);

    expect(await readInputRequests(stub)).toEqual(requestsBefore);
    expect(await readSteps(stub)).toEqual(stepsBefore);
    expect(await getAlarmTime(stub)).toBe(alarmBefore);

    await drain(taskId);
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: `branch:${JSON.stringify(ACTION)}|act-2:open` }],
    });
    expect(runCount(`${taskId}:sub-branch`)).toBe(1);
    expect(await requestsOf(stub)).toEqual({ "act-1": [0, 1, 1], "act-2": [0, 0, 0] });
  });
});

describe("a blocking fork while an offer is outstanding", () => {
  it("the fork parks the task; tasks/get shows only the fork; its answer resumes despite the open offer", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "fork_task", input: {} }, NS());
    const stub = NS().getByName(taskId);

    await drain(taskId);
    let row = await readTaskRow(stub);
    expect(row?.status).toBe("input_required");
    expect(await requestsOf(stub)).toEqual({ "act-1": [0, 0, 0], fork: [1, 0, 0] });
    const waiting = await snapshotOf(stub);
    expect(waiting["status"]).toBe("input_required");
    expect(Object.keys(snapshotSchema.parse(waiting["inputRequests"]))).toEqual(["fork"]);

    await callTaskRunner(NS(), taskId, (s) => s.update({ fork: FORK_ANSWER }));
    row = await readTaskRow(stub);
    expect(row?.status).toBe("working"); // resumed: the outstanding offer never blocks it

    await drain(taskId);
    row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: `fork:${JSON.stringify(FORK_ANSWER)}|act-1:open` }],
    });
  });

  it("an offer answered during the fork is stored silently and consumed after the resume", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "fork_task", input: {} }, NS());
    const stub = NS().getByName(taskId);
    await drain(taskId);
    expect((await readTaskRow(stub))?.status).toBe("input_required");

    await callTaskRunner(NS(), taskId, (s) => s.update({ "act-1": ACTION }));
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("input_required"); // no resume, no wake
    expect(row?.run_next_at).toBeNull();
    expect(await requestsOf(stub)).toEqual({ "act-1": [0, 1, 0], fork: [1, 0, 0] });
    await drain(taskId);
    expect((await readTaskRow(stub))?.status).toBe("input_required"); // quiescent

    await callTaskRunner(NS(), taskId, (s) => s.update({ fork: FORK_ANSWER }));
    await drain(taskId);
    const done = await readTaskRow(stub);
    expect(done?.status).toBe("completed");
    expect(JSON.parse(String(done?.result))).toEqual({
      content: [
        {
          type: "text",
          text: `fork:${JSON.stringify(FORK_ANSWER)}|act-1:${JSON.stringify(ACTION)}`,
        },
      ],
    });
    expect(await requestsOf(stub)).toEqual({ "act-1": [0, 1, 1], fork: [1, 1, 0] });
  });
});
