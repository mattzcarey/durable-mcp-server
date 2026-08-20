/**
 * Flow: alarm reconciliation — the computed min over run_next_at, pending
 * step retries, pending sleep wakes, and the TTL deadline (docs/how-it-works.md §3 (data model)),
 * asserted at the data layer against the real DO alarm (no storage fakes:
 * reconcile-min is tested through the fixture DO per Matt's testing update).
 */

import { runDurableObjectAlarm } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { completedResult, resetFakeExecutor, setFakeBehavior } from "../fixtures/fake-executor";
import { drainTaskAlarms } from "../support/drain";
import {
  createTask,
  getAlarmTime,
  readSteps,
  readTaskRow,
  taskStub,
  uniqueTaskId,
} from "../support/helpers";

beforeEach(() => {
  resetFakeExecutor();
});

describe("computed alarm min", () => {
  it("tracks min(step retry, sleep wake), then follows as work drains", async () => {
    const taskId = uniqueTaskId();
    const retryAt = Date.now() + 600_000; // earliest
    const wakeAt = Date.now() + 3_600_000;
    setFakeBehavior(async (_desc, step) => {
      const flaky = await step.beginStep("flaky");
      if (flaky.state === "run" && flaky.attempt === 1) {
        await step.failStep("flaky", { name: "Error", message: "first" }, { retryAtMs: retryAt });
        await step.recordSleep("later", wakeAt);
        return { outcome: "suspended" };
      }
      if (flaky.state === "run") {
        await step.completeStep("flaky", "ok");
      }
      const nap = await step.recordSleep("later", wakeAt);
      if (nap.state === "pending") {
        return { outcome: "suspended" };
      }
      return completedResult("all-done");
    });

    await createTask(taskId); // ttl 24h — never the min here
    const stub = taskStub(taskId);

    // Tick 1: retry (+600s) and sleep (+3600s) both pending -> min is retry.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await getAlarmTime(stub)).toBe(retryAt);

    // Tick 2: the retry succeeds; only the sleep remains -> min moves to it.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await getAlarmTime(stub)).toBe(wakeAt);
    expect((await readSteps(stub)).at(0)).toMatchObject({ step_key: "flaky", status: "completed" });

    // Tick 3: the sleep wake is honored, the task completes -> min is the
    // purge deadline.
    await drainTaskAlarms(taskId);
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(await getAlarmTime(stub)).toBe(Number(row?.created_at) + 86_400_000);
  });

  it("deletes the alarm when nothing is pending (working task, no TTL)", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior("suspend"); // suspends without journaling any wake
    await createTask(taskId, { ttlMs: null });
    const stub = taskStub(taskId);

    await drainTaskAlarms(taskId);

    // No execution wake, no deadline: nothing to arm. (Stuck-until-cancel is
    // the documented consequence of suspending without recording a wake.)
    expect((await readTaskRow(stub))?.status).toBe("working");
    expect(await getAlarmTime(stub)).toBeNull();

    // cancel() re-arms: the cancel wake is an execution wake.
    await stub.cancel();
    expect(await getAlarmTime(stub)).not.toBeNull();
    await drainTaskAlarms(taskId);
    expect((await readTaskRow(stub))?.status).toBe("cancelled");
    // Terminal + no TTL -> alarm deleted again.
    expect(await getAlarmTime(stub)).toBeNull();
  });
});
