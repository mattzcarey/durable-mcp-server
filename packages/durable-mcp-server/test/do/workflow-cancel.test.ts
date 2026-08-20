/**
 * Flow: cooperative cancellation against the REAL executor (stage 3): cancel
 * between invocations (alarm fast-path), cancel observed MID-RUN via the
 * `cancelled` beginStep directive (a step closure cancels its own task), and
 * cancel that lands after the last step (work that finishes first stays
 * completed — spec-sanctioned).
 *
 * Layers: integration (drains to the settled state), data (flag + settled
 * rows, journal shape), control plane (cancel RPC mid-workflow). HTTP layer
 * arrives with stage 4.
 */

import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { callTaskRunner } from "../../src";
import { runCount } from "../fixtures/task-state";
import { drainTaskAlarms } from "../support/drain";
import { createTask, readSteps, readTaskRow, uniqueTaskId } from "../support/helpers";

const NS = () => env.TASK_RUNNER_REAL;
const drain = (taskId: string) => drainTaskAlarms(taskId, { namespace: NS() });

describe("cancel between invocations", () => {
  it("a task suspended on a sleep settles to cancelled; later steps never run", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "pipeline_task", input: { text: "c" } }, NS());
    const stub = NS().getByName(taskId);

    // Tick 1: step-1 completes, the workflow sleeps.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(runCount(`${taskId}:step-1`)).toBe(1);

    await callTaskRunner(NS(), taskId, (s) => s.cancel());
    await drain(taskId);

    const row = await readTaskRow(stub);
    expect(row?.status).toBe("cancelled");
    expect(row?.status_message).toBeNull(); // single writer: no engine narration
    expect(runCount(`${taskId}:step-2`)).toBe(0); // never dispatched again
    expect(await stub.get()).toMatchObject({ taskId, status: "cancelled" });
  });
});

describe("cancel observed mid-run (cancelled beginStep directive)", () => {
  it("the invocation aborts at the next step and the settle lands on cancelled", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "cancel_mid_task", input: { taskId } }, NS());
    await drain(taskId);

    const stub = NS().getByName(taskId);
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("cancelled");
    expect(row?.cancel_requested).toBe(1);
    expect(row?.status_message).toBeNull(); // single writer: no engine narration
    expect(row?.run_next_at).toBeNull();

    // step-1 and the cancelling step completed before the abort; step-2's
    // beginStep returned the cancelled directive and its closure never ran.
    const steps = await readSteps(stub);
    expect(steps.map((s) => [s.step_key, s.status])).toEqual([
      ["step-1", "completed"],
      ["request-cancel", "completed"],
    ]);
    expect(runCount(`${taskId}:step-1`)).toBe(1);
    expect(runCount(`${taskId}:step-2`)).toBe(0);
  });
});

describe("cancel after the last step", () => {
  it("work that finishes first stays completed (spec-sanctioned)", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "cancel_late_task", input: { taskId } }, NS());
    await drain(taskId);

    const stub = NS().getByName(taskId);
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(row?.cancel_requested).toBe(1); // the flag was set mid-run...
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: "finished anyway" }], // ...but work won
    });
  });
});
