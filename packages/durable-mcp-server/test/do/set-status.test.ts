/**
 * Flow: handler telemetry (`step.status` -> TaskRunner.setStatus): the
 * handler is the SINGLE writer of `status_message` — the engine never
 * narrates its own transitions — with the write generation-guarded,
 * `last_updated_at` bumped, journal untouched, terminal calls no-ops, and
 * stale leases rejected.
 *
 * Layers here: data (status_message row, journal untouched, guarded write),
 * control plane (setStatus RPC through a minted lease and directly) against
 * the injected fake executor. Real-executor and HTTP layers live in
 * workflow-status.test.ts and http/flows.test.ts.
 */

import { runDurableObjectAlarm } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetFakeExecutor, setFakeBehavior } from "../fixtures/fake-executor";
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

describe("setStatus write semantics (data)", () => {
  it("writes status_message, bumps last_updated_at, and leaves the journal alone", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async (_desc, step) => {
      await step.setStatus("lap 1 of 3");
      const nap = await step.recordSleep("nap", Date.now() + 600_000);
      if (nap.state === "pending") {
        return { outcome: "suspended" };
      }
      return { outcome: "completed", result: { content: [{ type: "text", text: "done" }] } };
    });
    await createTask(taskId);
    const stub = taskStub(taskId);
    const created = await readTaskRow(stub);

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const row = await readTaskRow(stub);
    expect(row?.status_message).toBe("lap 1 of 3");
    expect(Number(row?.last_updated_at)).toBeGreaterThanOrEqual(Number(created?.last_updated_at));

    // Not a journaled step: the only journal row is the sleep, and the alarm
    // schedule is untouched by the status write (min = the sleep wake).
    const steps = await readSteps(stub);
    expect(steps.map((step) => [step.step_key, step.kind])).toEqual([["nap", "sleep"]]);
    expect(await getAlarmTime(stub)).toBe(Number(steps.at(0)?.wake_at));

    // tasks/get surfaces it.
    expect(await stub.get()).toMatchObject({ status: "working", statusMessage: "lap 1 of 3" });
  });

  it("a step transition after setStatus never clobbers the handler's message", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async (_desc, step) => {
      await step.setStatus("handler owns this");
      // A full step transition (begin -> complete) plus a suspension settle:
      // every write that used to narrate.
      const directive = await step.beginStep("send");
      if (directive.state === "run") {
        await step.completeStep("send", "sent");
      }
      const nap = await step.recordSleep("nap", Date.now() + 600_000);
      if (nap.state === "pending") {
        return { outcome: "suspended" };
      }
      return { outcome: "completed", result: { content: [{ type: "text", text: "done" }] } };
    });
    await createTask(taskId);
    const stub = taskStub(taskId);

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    // The poll after the transitions shows the handler's message, nothing else.
    expect((await readTaskRow(stub))?.status_message).toBe("handler owns this");
    expect(await stub.get()).toMatchObject({ statusMessage: "handler owns this" });
  });

  it("the last write stands across a terminal transition", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async (_desc, step) => {
      await step.setStatus("final answer");
      return { outcome: "completed", result: { content: [{ type: "text", text: "done" }] } };
    });
    await createTask(taskId);
    await drainTaskAlarms(taskId);

    const stub = taskStub(taskId);
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(row?.status_message).toBe("final answer"); // terminal settle left it alone
    expect(await stub.get()).toMatchObject({
      status: "completed",
      statusMessage: "final answer",
      result: { content: [{ type: "text", text: "done" }] },
    });
  });
});

describe("setStatus guards (control plane)", () => {
  it("a stale generation is rejected and writes nothing", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    const stub = taskStub(taskId);
    const before = await readTaskRow(stub);

    await expectRejects(stub.setStatus(crypto.randomUUID(), "sneaky write"), /Stale lease/);

    const after = await readTaskRow(stub);
    expect(after?.status_message).toBeNull();
    expect(after?.last_updated_at).toBe(before?.last_updated_at);
  });

  it("a call after a terminal state is a no-op", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior("complete");
    await createTask(taskId);
    await drainTaskAlarms(taskId);
    const stub = taskStub(taskId);
    const generation = await currentGeneration(stub);
    const before = await readTaskRow(stub);

    await stub.setStatus(generation, "too late"); // resolves, writes nothing

    expect(await readTaskRow(stub)).toEqual(before);
  });

  it("a task that never calls setStatus keeps status_message NULL at every stage", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async (_desc, step) => {
      const directive = await step.beginStep("work");
      if (directive.state === "run") {
        await step.completeStep("work", "ok");
      }
      return { outcome: "completed", result: { content: [{ type: "text", text: "ok" }] } };
    });
    await createTask(taskId);
    const stub = taskStub(taskId);
    expect((await readTaskRow(stub))?.status_message).toBeNull(); // at creation

    await drainTaskAlarms(taskId);

    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(row?.status_message).toBeNull(); // claim + steps + settle wrote nothing
    const snapshot = await stub.get();
    expect(snapshot !== null && typeof snapshot === "object" && "statusMessage" in snapshot).toBe(
      false,
    ); // omitted from the wire while NULL
  });
});
