/**
 * Flow: the step journal — beginStep/completeStep/failStep/recordSleep via
 * the per-lease DurableStep capability, replay memoization, retry
 * bookkeeping, and generation-guarded rejection of stale leases.
 *
 * Layers: data (exact steps rows), control plane (lease methods called
 * directly on the stub / captured leases), integration (multi-tick replay to
 * completion). HTTP layer arrives with stage 4.
 */

import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  completedResult,
  leases,
  resetFakeExecutor,
  setFakeBehavior,
} from "../fixtures/fake-executor";
import { drainTaskAlarms } from "../support/drain";
import { expectRejects } from "../support/expect-rejects";
import {
  createTask,
  currentGeneration,
  getAlarmTime,
  readSteps,
  readTaskRow,
  taskStub,
  uniqueTaskId,
} from "../support/helpers";

beforeEach(() => {
  resetFakeExecutor();
});

describe("step.do journaling + step.sleep + replay", () => {
  it("journals, suspends on sleep, memoizes on replay (integration + data)", async () => {
    const taskId = uniqueTaskId();
    let closureRuns = 0;
    const wakeAt = Date.now() + 3_600_000; // long sleep: determinism rule
    setFakeBehavior(async (_desc, step) => {
      const s1 = await step.beginStep("fetch-data", { timeoutMs: 120_000 });
      let value: unknown;
      if (s1.state === "run") {
        closureRuns += 1;
        value = { rows: 3 };
        expect(await step.completeStep("fetch-data", value)).toBe(true);
      } else if (s1.state === "completed") {
        value = s1.value;
      } else {
        throw new Error(`unexpected directive ${s1.state}`);
      }
      const nap = await step.recordSleep("cool-off", wakeAt);
      if (nap.state === "pending") {
        return { outcome: "suspended" };
      }
      return {
        outcome: "completed",
        result: { content: [{ type: "text", text: JSON.stringify(value) }] },
      };
    });

    await createTask(taskId);
    const stub = taskStub(taskId);

    // Tick 1: step runs, result journaled, sleep recorded, invocation suspends.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(closureRuns).toBe(1);

    let steps = await readSteps(stub);
    expect(steps).toHaveLength(2);
    const [fetchRow, napRow] = [steps.at(0), steps.at(1)];
    expect(fetchRow).toMatchObject({
      step_key: "fetch-data",
      kind: "do",
      status: "completed",
      attempt: 1,
      timeout_ms: 120_000,
    });
    expect(JSON.parse(String(fetchRow?.result))).toEqual({
      kind: "value",
      value: { rows: 3 },
    });
    expect(fetchRow?.completed_at).not.toBeNull();
    expect(napRow).toMatchObject({
      step_key: "cool-off",
      kind: "sleep",
      status: "pending",
      wake_at: wakeAt,
    });

    let row = await readTaskRow(stub);
    expect(row?.status).toBe("working");
    expect(row?.run_next_at).toBeNull(); // suspended settle cleared the anchor
    expect(await getAlarmTime(stub)).toBe(wakeAt); // alarm follows the sleep

    // Tick 2 (drain): the wake is honored DO-side, the replay memoizes the
    // completed step (closure does NOT re-run) and finishes.
    await drainTaskAlarms(taskId);
    expect(closureRuns).toBe(1);

    row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: JSON.stringify({ rows: 3 }) }],
    });
    steps = await readSteps(stub);
    expect(steps.at(1)).toMatchObject({ step_key: "cool-off", status: "completed" });
    expect(steps.at(1)?.completed_at).not.toBeNull();
  });
});

describe("step retries via failStep", () => {
  it("keeps the step pending with next_attempt_at, then succeeds on the next claim", async () => {
    const taskId = uniqueTaskId();
    const retryAt = Date.now() + 600_000;
    const seenAttempts: number[] = [];
    setFakeBehavior(async (_desc, step) => {
      const s = await step.beginStep("flaky");
      if (s.state === "run") {
        seenAttempts.push(s.attempt);
        if (s.attempt === 1) {
          expect(
            await step.failStep(
              "flaky",
              { name: "Error", message: "boom" },
              { retryAtMs: retryAt },
            ),
          ).toBe(true);
          return { outcome: "suspended" };
        }
        expect(await step.completeStep("flaky", "ok")).toBe(true);
      }
      return completedResult("flaky-done");
    });

    await createTask(taskId);
    const stub = taskStub(taskId);

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    // Data: failed attempt recorded, backoff schedule persisted.
    let steps = await readSteps(stub);
    expect(steps.at(0)).toMatchObject({
      step_key: "flaky",
      kind: "do",
      status: "pending",
      attempt: 1,
      next_attempt_at: retryAt,
      last_error: "boom",
      last_error_name: "Error",
    });
    expect(await getAlarmTime(stub)).toBe(retryAt);

    // The drain walks the engine's own persisted retry schedule.
    await drainTaskAlarms(taskId);
    expect(seenAttempts).toEqual([1, 2]);

    steps = await readSteps(stub);
    expect(steps.at(0)).toMatchObject({
      step_key: "flaky",
      status: "completed",
      attempt: 2,
      next_attempt_at: null,
      last_error: null,
      last_error_name: null,
    });
    expect((await readTaskRow(stub))?.status).toBe("completed");
    expect((await readTaskRow(stub))?.run_attempt).toBe(2);
  });

  it("terminal disposition marks the step failed and replays surface it", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async (_desc, step) => {
      const s = await step.beginStep("doomed");
      if (s.state === "run") {
        await step.failStep(
          "doomed",
          { name: "NonRetryableError", message: "永 bad input" },
          { terminal: true },
        );
      }
      return { outcome: "suspended" };
    });
    await createTask(taskId);
    const stub = taskStub(taskId);

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const steps = await readSteps(stub);
    expect(steps.at(0)).toMatchObject({
      step_key: "doomed",
      status: "failed",
      last_error_name: "NonRetryableError",
    });

    // A fresh lease's beginStep reports the terminal failure as a directive.
    const generation = await currentGeneration(stub);
    const directive = await stub.beginStep(generation, "doomed");
    expect(directive).toEqual({
      state: "failed",
      error: { name: "NonRetryableError", message: "永 bad input" },
    });
  });
});

describe("generation guards (stale leases)", () => {
  it("a lease from a superseded claim is rejected while the successor works", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior("throw"); // dispatch fails AFTER the lease is minted
    await createTask(taskId);
    const stub = taskStub(taskId);

    expect(await runDurableObjectAlarm(stub)).toBe(true); // claim 1, lease 1
    expect(await runDurableObjectAlarm(stub)).toBe(true); // claim 2, lease 2
    expect(leases).toHaveLength(2);
    const staleLease = leases.at(0);
    if (staleLease === undefined) {
      throw new Error("unreachable");
    }

    // Captured leases can only be exercised from inside the owning DO's
    // context (workerd forbids cross-actor I/O within the isolate) — exactly
    // where an orphaned executor's calls would land.
    await expectRejects(
      runInDurableObject(stub, () => staleLease.beginStep("anything")),
      /superseded by a newer claim/,
    );
    await expectRejects(
      runInDurableObject(stub, () => staleLease.completeStep("anything", 1)),
      /superseded by a newer claim/,
    );
    await expectRejects(
      runInDurableObject(stub, () => staleLease.recordSleep("anything", Date.now() + 60_000)),
      /superseded by a newer claim/,
    );

    // The journal is untouched by the rejected calls.
    expect(await readSteps(stub)).toHaveLength(0);
  });

  it("a lease is dead once the task is terminal", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior("complete");
    await createTask(taskId);
    await drainTaskAlarms(taskId);
    const lease = leases.at(0);
    if (lease === undefined) {
      throw new Error("unreachable");
    }
    await expectRejects(
      runInDurableObject(taskStub(taskId), () => lease.beginStep("late")),
      /already completed/,
    );
  });

  it("direct control-plane writes with a bogus generation are rejected", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    const stub = taskStub(taskId);
    await expectRejects(stub.completeStep("not-the-generation", "s", 1), /superseded/);
    await expectRejects(
      stub.failStep("not-the-generation", "s", { name: "E", message: "m" }, { terminal: true }),
      /superseded/,
    );
    expect(await readSteps(stub)).toHaveLength(0);
  });

  it("completeStep on a non-pending step returns false (guarded UPDATE)", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async (_desc, step) => {
      const s = await step.beginStep("once");
      if (s.state === "run") {
        expect(await step.completeStep("once", 42)).toBe(true);
        expect(await step.completeStep("once", 43)).toBe(false); // already completed
      }
      return completedResult("done");
    });
    await createTask(taskId);
    await drainTaskAlarms(taskId);

    const steps = await readSteps(taskStub(taskId));
    expect(JSON.parse(String(steps.at(0)?.result))).toEqual({ kind: "value", value: 42 });
  });
});

describe("step name collisions (decision D8)", () => {
  it("reusing a sleep key as a do step is a hard DuplicateStepError", async () => {
    const taskId = uniqueTaskId();
    const wakeAt = Date.now() + 3_600_000;
    setFakeBehavior(async (_desc, step) => {
      await step.recordSleep("cool-off", wakeAt);
      return { outcome: "suspended" };
    });
    await createTask(taskId);
    const stub = taskStub(taskId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const generation = await currentGeneration(stub);
    await expectRejects(stub.beginStep(generation, "cool-off"), /already used in this task/);
    // Same key with the MATCHING kind is an idempotent replay, not an error.
    expect(await stub.recordSleep(generation, "cool-off", wakeAt)).toEqual({ state: "pending" });
  });
});
