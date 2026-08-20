/**
 * Flow: step retries through the REAL executor (stage 3): attempt/backoff
 * progression in the journal, retry-to-success, attempts exhausted,
 * NonRetryableError immediate terminal, per-attempt timeout, and same-run
 * duplicate step names — all mapping to the docs/how-it-works.md §7 (the wire contract served) rule (handler/step
 * failures complete the task with isError; `failed` is engine-only).
 *
 * Layers: data (journal attempt/next_attempt_at/last_error progression),
 * integration (drains walk the engine's own persisted retry schedule).
 * HTTP layer arrives with stage 4.
 */

import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { runCount } from "../fixtures/task-state";
import { drainTaskAlarms } from "../support/drain";
import { createTask, getAlarmTime, readSteps, readTaskRow, uniqueTaskId } from "../support/helpers";

const NS = () => env.TASK_RUNNER_REAL;
const drain = (taskId: string) => drainTaskAlarms(taskId, { namespace: NS() });

describe("step retry to success", () => {
  it("records attempt + jittered backoff, then succeeds on redelivery", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "flaky_task", input: { failures: 1 } }, NS());
    const stub = NS().getByName(taskId);
    const before = Date.now();

    // Tick 1: attempt 1 fails; the retry is scheduled by the step policy
    // (base=cap=600s, equal jitter -> [300s, 600s] from now).
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(runCount(`${taskId}:wobbly`)).toBe(1);

    let steps = await readSteps(stub);
    const wobbly = steps.at(0);
    expect(wobbly).toMatchObject({
      step_key: "wobbly",
      kind: "do",
      status: "pending",
      attempt: 1,
      last_error: "wobble 1",
      last_error_name: "Error",
    });
    const retryAt = Number(wobbly?.next_attempt_at);
    expect(retryAt).toBeGreaterThanOrEqual(before + 300_000);
    expect(retryAt).toBeLessThanOrEqual(Date.now() + 600_000);
    // The alarm follows the persisted step schedule.
    expect(await getAlarmTime(stub)).toBe(retryAt);

    // Drain: the engine redelivers, attempt 2 succeeds.
    await drain(taskId);
    expect(runCount(`${taskId}:wobbly`)).toBe(2);

    steps = await readSteps(stub);
    expect(steps.at(0)).toMatchObject({
      step_key: "wobbly",
      status: "completed",
      attempt: 2,
      next_attempt_at: null,
      last_error: null,
    });
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: "steady after 2" }],
    });
  });
});

describe("attempts exhausted", () => {
  it("the limit-th failure is terminal: step failed, task completed + isError", async () => {
    const taskId = uniqueTaskId();
    // failures=99 with limit=3 (task-level policy): never succeeds.
    await createTask(taskId, { toolName: "flaky_task", input: { failures: 99 } }, NS());
    await drain(taskId);
    expect(runCount(`${taskId}:wobbly`)).toBe(3); // exactly `limit` executions

    const stub = NS().getByName(taskId);
    const steps = await readSteps(stub);
    expect(steps.at(0)).toMatchObject({
      step_key: "wobbly",
      status: "failed",
      attempt: 3,
      last_error: "wobble 3",
    });
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed"); // handler/step failure, NOT `failed`
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: "Error: wobble 3" }],
      isError: true,
    });
    expect(row?.error).toBeNull();
  });
});

describe("NonRetryableError", () => {
  it("is immediately terminal: no retry scheduled, completed + isError", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "doomed_task", input: {} }, NS());
    await drain(taskId);
    expect(runCount(`${taskId}:explode`)).toBe(1); // exactly one execution

    const stub = NS().getByName(taskId);
    const steps = await readSteps(stub);
    expect(steps.at(0)).toMatchObject({
      step_key: "explode",
      status: "failed",
      attempt: 1,
      next_attempt_at: null,
      last_error_name: "NonRetryableError",
    });
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(row?.run_attempt).toBe(1);
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: "NonRetryableError: bad input, giving up" }],
      isError: true,
    });
  });
});

describe("per-attempt timeout", () => {
  it("a hung attempt fails with StepTimeoutError and the retry succeeds", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "slow_task", input: {} }, NS());
    const stub = NS().getByName(taskId);

    // Tick 1: the closure hangs; the 50ms per-attempt race loses it.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    let steps = await readSteps(stub);
    expect(steps.at(0)).toMatchObject({
      step_key: "slow",
      status: "pending",
      attempt: 1,
      timeout_ms: 50,
      last_error_name: "StepTimeoutError",
    });
    expect(String(steps.at(0)?.last_error)).toContain("timed out after 50ms");
    expect(steps.at(0)?.next_attempt_at).not.toBeNull();

    // Drain: attempt 2 returns quickly.
    await drain(taskId);
    expect(runCount(`${taskId}:slow`)).toBe(2);
    steps = await readSteps(stub);
    expect(steps.at(0)).toMatchObject({ step_key: "slow", status: "completed", attempt: 2 });
    expect((await readTaskRow(stub))?.status).toBe("completed");
    expect(JSON.parse(String((await readTaskRow(stub))?.result))).toEqual({
      content: [{ type: "text", text: "quick 2" }],
    });
  });
});

describe("same-run duplicate step names (decision D8)", () => {
  it("is a hard DuplicateStepError -> completed + isError; the journal keeps the first", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "duplicate_task", input: {} }, NS());
    await drain(taskId);

    const stub = NS().getByName(taskId);
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    const result = JSON.parse(String(row?.result));
    expect(result.isError).toBe(true);
    expect(String(result.content.at(0)?.text)).toContain('"twice" was already used in this task');

    // Only the first "twice" execution reached the journal.
    const steps = await readSteps(stub);
    expect(steps).toHaveLength(1);
    expect(steps.at(0)).toMatchObject({ step_key: "twice", status: "completed" });
    expect(JSON.parse(String(steps.at(0)?.result))).toEqual({ kind: "value", value: 1 });
  });
});
