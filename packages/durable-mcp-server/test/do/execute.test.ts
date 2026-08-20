/**
 * Flow: claim + alarm chain + executor dispatch + outcome settlement,
 * against the injected fake executor (stage-2 seam).
 *
 * Layers: data (claim bookkeeping, generation rotation, result rows),
 * control plane (alarm() never rejects; direct instance.alarm()),
 * integration (create -> drain -> completed; eviction mid-chain; handoff).
 * HTTP layer arrives with stage 4's front-door router.
 */

import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { TaskRunner } from "../../src";
import {
  invocations,
  resetFakeExecutor,
  setFakeBehavior,
  setHandoffMs,
} from "../fixtures/fake-executor";
import { drainTaskAlarms } from "../support/drain";
import {
  createTask,
  currentGeneration,
  getAlarmTime,
  readTaskRow,
  taskStub,
  uniqueTaskId,
} from "../support/helpers";

beforeEach(() => {
  resetFakeExecutor();
});

describe("execution happy path", () => {
  it("create -> drain -> completed, result inlined on tasks/get (integration)", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { input: { text: "hi" } });
    const initialGeneration = await currentGeneration(taskStub(taskId));

    await drainTaskAlarms(taskId);

    const stub = taskStub(taskId);
    const snapshot = await stub.get();
    expect(snapshot).toMatchObject({
      taskId,
      status: "completed",
      result: { content: [{ type: "text", text: "done:echo_task:1" }] },
    });

    // Data layer: exact claim + settlement bookkeeping.
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(row?.run_attempt).toBe(1);
    expect(row?.run_generation).not.toBe(initialGeneration); // rotated at claim
    expect(row?.run_next_at).toBeNull();
    expect(row?.status_message).toBeNull();
    expect(row?.error).toBeNull();
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: "done:echo_task:1" }],
    });

    // Executor saw exactly one invocation with the deserialized input.
    expect(invocations).toEqual([
      { taskId, toolName: "echo_task", input: { text: "hi" }, attempt: 1 },
    ]);

    // Terminal task: the alarm now waits on the purge deadline.
    const alarm = await getAlarmTime(stub);
    expect(alarm).toBe(Number(row?.created_at) + 86_400_000);
  });
});

describe("dispatch failure and redelivery", () => {
  it("records the failed invocation attempt and redelivers with a fresh generation", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior("throw");
    await createTask(taskId);
    const stub = taskStub(taskId);
    const before = Date.now();

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    // Data layer: attempt consumed, redelivery anchor re-armed with backoff
    // (fixture pins the delay to +300s for determinism).
    let row = await readTaskRow(stub);
    expect(row?.status).toBe("working");
    expect(row?.run_attempt).toBe(1);
    expect(row?.status_message).toBeNull(); // single writer: no engine diagnostics
    expect(Number(row?.run_next_at)).toBeGreaterThanOrEqual(before + 300_000);
    const failedGeneration = String(row?.run_generation);

    // Alarm follows the persisted schedule.
    expect(await getAlarmTime(stub)).toBe(Number(row?.run_next_at));

    setFakeBehavior("complete");
    await drainTaskAlarms(taskId);

    row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(row?.run_attempt).toBe(2);
    expect(row?.run_generation).not.toBe(failedGeneration); // fresh lease per claim
    expect(invocations.map((desc) => desc.attempt)).toEqual([1, 2]);
  });

  it("a missing/broken outcome shape is treated as a dispatch failure", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async () => ({ outcome: "nonsense" }) as never);
    await createTask(taskId);
    const stub = taskStub(taskId);

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const row = await readTaskRow(stub);
    expect(row?.status).toBe("working");
    expect(row?.run_attempt).toBe(1); // attempt consumed, redelivery scheduled
    expect(row?.status_message).toBeNull(); // single writer: no engine diagnostics
    expect(row?.run_next_at).not.toBeNull();
  });
});

describe("engine-level failed outcome", () => {
  it("marks the task failed with a JSON-RPC error object", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async () => ({
      outcome: "failed",
      error: { name: "Error", message: "unknown tool" },
    }));
    await createTask(taskId);

    await drainTaskAlarms(taskId);

    const stub = taskStub(taskId);
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("failed");
    expect(JSON.parse(String(row?.error))).toEqual({
      code: -32603,
      message: "Error: unknown tool",
    });
    expect(row?.result).toBeNull();

    const snapshot = await stub.get();
    expect(snapshot).toMatchObject({
      status: "failed",
      error: { code: -32603, message: "Error: unknown tool" },
    });
  });

  it("a non-JSON-serializable completed result fails the task (engine failure)", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async () => ({
      outcome: "completed",
      result: { content: [{ type: "text", text: "x" }], bad: () => "not json" } as never,
    }));
    await createTask(taskId);

    await drainTaskAlarms(taskId);

    const row = await readTaskRow(taskStub(taskId));
    expect(row?.status).toBe("failed");
    expect(String(JSON.parse(String(row?.error)).message)).toContain("ResultSerializationError");
  });
});

describe("suspended outcome with no recorded wake", () => {
  it("clears the redelivery anchor and waits on the TTL deadline", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior("suspend");
    await createTask(taskId);

    await drainTaskAlarms(taskId);

    const stub = taskStub(taskId);
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("working");
    expect(row?.run_attempt).toBe(1);
    expect(row?.run_next_at).toBeNull();
    expect(await getAlarmTime(stub)).toBe(Number(row?.created_at) + 86_400_000);
  });
});

describe("alarm() reliability", () => {
  it("never rejects, even when the executor throws (control plane)", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior("throw");
    await createTask(taskId);
    const stub = taskStub(taskId);

    // Direct instance.alarm() with no arguments — exactly how
    // runDurableObjectAlarm invokes it; must resolve, not reject.
    await runInDurableObject(stub, async (instance) => {
      await (instance as TaskRunner).alarm();
    });

    const row = await readTaskRow(stub);
    expect(row?.run_attempt).toBe(1);
    expect(row?.status).toBe("working");
  });

  it("a stray alarm on an empty DO clears itself without writing a task row", async () => {
    const taskId = uniqueTaskId();
    const stub = taskStub(taskId);
    await runInDurableObject(stub, async (instance) => {
      await (instance as TaskRunner).alarm();
    });
    expect(await readTaskRow(stub)).toBeUndefined();
    expect(await getAlarmTime(stub)).toBeNull();
  });
});

describe("eviction mid-chain", () => {
  it("resumes from persisted claim state after eviction (integration)", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior("throw");
    await createTask(taskId);
    const stub = taskStub(taskId);

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await readTaskRow(stub))?.run_attempt).toBe(1);

    await evictDurableObject(stub); // in-memory instance gone, SQLite kept

    setFakeBehavior("complete");
    await drainTaskAlarms(taskId);

    const row = await readTaskRow(taskStub(taskId));
    expect(row?.status).toBe("completed");
    expect(row?.run_attempt).toBe(2); // claim counter survived the cold start
  });
});

describe("handoff race (hang behavior)", () => {
  it("hands off without double-claiming, and eviction recovers the hung attempt", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior("hang");
    setHandoffMs(50);
    await createTask(taskId);
    const stub = taskStub(taskId);

    // Tick 1: claims and dispatches; the RPC never settles; the handoff
    // timer (50ms) wins and re-arms the alarm for now. NOTE: because workerd
    // fires genuinely-due alarms on its own, the re-armed handoff alarm keeps
    // redelivering and every redelivery ATTACHES to the same in-flight
    // attempt — the assertions below hold at any point in that loop.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    let row = await readTaskRow(stub);
    expect(row?.status).toBe("working");
    expect(row?.run_attempt).toBe(1);
    // Never left unarmed — modulo the runtime's own delivery window: workerd
    // deletes a due alarm just before invoking alarm(), and the handler's
    // first act re-arms, so a single read can legitimately catch the
    // in-between null while the handoff loop spins. Poll briefly: a DROPPED
    // wake would stay null forever and still fail here.
    await (async () => {
      const deadline = Date.now() + 2_000;
      for (;;) {
        if ((await getAlarmTime(stub)) !== null) {
          return;
        }
        if (Date.now() > deadline) {
          throw new Error("alarm stayed unarmed: the handoff wake was dropped");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    })();

    // Tick 2 (explicit): still attaches — no second claim, no second dispatch.
    await runDurableObjectAlarm(stub);
    row = await readTaskRow(stub);
    expect(row?.run_attempt).toBe(1);
    expect(invocations).toHaveLength(1);

    // Eviction clears the in-memory attempt; the redelivery anchor
    // (run_next_at, untouched by the unsettled claim) re-claims fresh.
    setFakeBehavior("complete");
    await evictDurableObject(stub);
    await drainTaskAlarms(taskId);

    row = await readTaskRow(taskStub(taskId));
    expect(row?.status).toBe("completed");
    expect(row?.run_attempt).toBe(2);
  });
});
