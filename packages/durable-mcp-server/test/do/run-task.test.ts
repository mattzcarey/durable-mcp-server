/**
 * Flow: the real executor's `runTask` outcome mapping (docs/how-it-works.md §2 (the three layers) and §7 (wire contract)), called
 * directly against a live RealTaskRunner with a genuinely-minted lease —
 * the control-plane layer of the stage-3 matrix.
 *
 * Layers here: control plane (runTask outcome per scenario), data (journal
 * side effects of a direct invocation). Integration drains live in the
 * workflow-*.test.ts files; the HTTP layer arrives with stage 4's router.
 */

import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { DurableStep } from "../../src";
import type { DurableStepStub, RunOutcome, TaskInvocation, TaskRunner } from "../../src";
import {
  createTask,
  currentGeneration,
  readSteps,
  readTaskRow,
  uniqueTaskId,
} from "../support/helpers";

/** Mints a lease on the task's CURRENT generation and dispatches, exactly
 * as the engine's alarm claim does — from inside the DO's context. */
async function dispatch(
  taskId: string,
  toolName: string,
  input: unknown,
  generationOverride?: string,
): Promise<RunOutcome> {
  const stub = env.TASK_RUNNER_REAL.getByName(taskId);
  const generation = generationOverride ?? (await currentGeneration(stub));
  return runInDurableObject(stub, async (instance, state) => {
    const desc: TaskInvocation = { taskId, toolName, input, attempt: 1 };
    const lease: DurableStepStub = new DurableStep(instance as TaskRunner, taskId, 1, generation);
    return state.exports.TaskExecutor.runTask(desc, lease);
  });
}

describe("runTask outcome mapping (control plane)", () => {
  it("a plain handler return maps to completed with the CallToolResult", async () => {
    const taskId = uniqueTaskId();
    await createTask(
      taskId,
      { toolName: "echo_task", input: { text: "ping" } },
      env.TASK_RUNNER_REAL,
    );
    const outcome = await dispatch(taskId, "echo_task", { text: "ping" });
    expect(outcome).toEqual({
      outcome: "completed",
      result: { content: [{ type: "text", text: "ping:object" }] },
    });
  });

  it("an unknown tool is an engine failure outcome (never a rejection)", async () => {
    const outcome = await env.TASK_EXECUTOR.runTask(
      { taskId: "t", toolName: "no_such_task", input: {}, attempt: 1 },
      {} as DurableStepStub,
    );
    expect(outcome).toEqual({
      outcome: "failed",
      error: { name: "UnknownTaskError", message: 'No task named "no_such_task" is registered' },
    });
  });

  it("a handler throw maps to completed + isError, never a bare RPC rejection", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "throwing_task", input: {} }, env.TASK_RUNNER_REAL);
    const outcome = await dispatch(taskId, "throwing_task", {});
    expect(outcome).toEqual({
      outcome: "completed",
      result: {
        content: [{ type: "text", text: "Error: handler exploded" }],
        isError: true,
      },
    });
  });

  it("a durable sleep suspends the invocation after journaling the first step", async () => {
    const taskId = uniqueTaskId();
    await createTask(
      taskId,
      { toolName: "pipeline_task", input: { text: "s" } },
      env.TASK_RUNNER_REAL,
    );
    const outcome = await dispatch(taskId, "pipeline_task", { text: "s" });
    expect(outcome).toEqual({ outcome: "suspended" });

    // Data layer: the direct invocation journaled through the live lease.
    const stub = env.TASK_RUNNER_REAL.getByName(taskId);
    const steps = await readSteps(stub);
    expect(steps).toHaveLength(2);
    expect(steps.at(0)).toMatchObject({ step_key: "step-1", kind: "do", status: "completed" });
    expect(JSON.parse(String(steps.at(0)?.result))).toEqual({ kind: "value", value: "s-1" });
    expect(steps.at(1)).toMatchObject({ step_key: "nap", kind: "sleep", status: "pending" });
  });

  it("a stale lease is abandoned as suspended and journals nothing", async () => {
    const taskId = uniqueTaskId();
    await createTask(
      taskId,
      { toolName: "pipeline_task", input: { text: "x" } },
      env.TASK_RUNNER_REAL,
    );
    const outcome = await dispatch(taskId, "pipeline_task", { text: "x" }, "superseded-generation");
    expect(outcome).toEqual({ outcome: "suspended" });

    const stub = env.TASK_RUNNER_REAL.getByName(taskId);
    expect(await readSteps(stub)).toHaveLength(0);
    expect((await readTaskRow(stub))?.status).toBe("working"); // untouched
  });
});
