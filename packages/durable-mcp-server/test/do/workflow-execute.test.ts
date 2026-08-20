/**
 * Flow: execute + replay through the REAL TaskExecutor (stage 3): multi-step
 * handler with a durable sleep, replay memoization, eviction mid-workflow —
 * driven end to end by alarm drains against RealTaskRunner (real ctx.exports
 * dispatch, deterministic scheduling seams only).
 *
 * Layers: integration (drain to completion; eviction), data (journal rows,
 * claim bookkeeping), with module-level closure counters proving exactly-once
 * execution (docs/testing.md). HTTP layer arrives with stage 4.
 */

import { evictDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { runCount } from "../fixtures/task-state";
import { drainTaskAlarms } from "../support/drain";
import { createTask, readSteps, readTaskRow, uniqueTaskId } from "../support/helpers";

const NS = () => env.TASK_RUNNER_REAL;
const drain = (taskId: string) => drainTaskAlarms(taskId, { namespace: NS() });

describe("real dispatch happy path", () => {
  it("a stepless task completes through ctx.exports (integration)", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "echo_task", input: { text: "hi" } }, NS());
    await drain(taskId);

    const stub = NS().getByName(taskId);
    expect(await stub.get()).toMatchObject({
      taskId,
      status: "completed",
      result: { content: [{ type: "text", text: "hi:object" }] },
    });
    const row = await readTaskRow(stub);
    expect(row?.run_attempt).toBe(1);
    expect(row?.status_message).toBeNull();
  });
});

describe("multi-step workflow with durable sleep", () => {
  it("journals, sleeps, replays with memoization, completes (integration + data)", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "pipeline_task", input: { text: "hi" } }, NS());
    const stub = NS().getByName(taskId);

    // Tick 1: claim -> real dispatch -> step-1 runs -> sleep recorded -> suspend.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(runCount(`${taskId}:step-1`)).toBe(1);
    expect(runCount(`${taskId}:step-2`)).toBe(0);

    let row = await readTaskRow(stub);
    expect(row?.status).toBe("working");
    expect(row?.run_attempt).toBe(1);
    expect(row?.run_next_at).toBeNull(); // suspended settle cleared the anchor

    let steps = await readSteps(stub);
    expect(steps.at(0)).toMatchObject({ step_key: "step-1", kind: "do", status: "completed" });
    expect(steps.at(1)).toMatchObject({ step_key: "nap", kind: "sleep", status: "pending" });

    // Drain: the wake is honored, the replay memoizes step-1 (closure does
    // NOT re-run), step-2 executes, the task completes.
    await drain(taskId);
    expect(runCount(`${taskId}:step-1`)).toBe(1); // exactly once
    expect(runCount(`${taskId}:step-2`)).toBe(1);

    row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(row?.run_attempt).toBe(2); // initial run + post-sleep replay
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: "hi-1-2" }],
    });
    steps = await readSteps(stub);
    expect(steps.at(1)).toMatchObject({ step_key: "nap", status: "completed" });
    expect(steps.at(2)).toMatchObject({ step_key: "step-2", status: "completed" });
  });
});

describe("undefined step results (envelope round-trip)", () => {
  it("journals {kind:'undefined'} and replays it as genuine undefined", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "void_task", input: {} }, NS());
    await drain(taskId);
    expect(runCount(`${taskId}:void-step`)).toBe(1);

    const stub = NS().getByName(taskId);
    const steps = await readSteps(stub);
    expect(steps.at(0)).toMatchObject({ step_key: "void-step", status: "completed" });
    expect(JSON.parse(String(steps.at(0)?.result))).toEqual({ kind: "undefined" });

    // The final text is computed on the replay from the journal hit: the
    // memoized value must be genuinely `undefined`.
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: "undef:true" }],
    });
  });
});

describe("eviction mid-workflow", () => {
  it("cold-starts from the journal; completed steps never re-execute (integration)", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "pipeline_task", input: { text: "ev" } }, NS());
    let stub = NS().getByName(taskId);

    // Step 1 completes, sleep pending.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(runCount(`${taskId}:step-1`)).toBe(1);

    await evictDurableObject(stub); // in-memory instance gone, SQLite kept

    // Fresh stub, cold start: constructor re-bootstraps, drain resumes from
    // the persisted journal.
    stub = NS().getByName(taskId);
    await drain(taskId);

    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: "ev-1-2" }],
    });
    // The at-least-once unit is one step closure — step-1 ran exactly once
    // across the eviction, step-2 exactly once after it.
    expect(runCount(`${taskId}:step-1`)).toBe(1);
    expect(runCount(`${taskId}:step-2`)).toBe(1);
  });
});
