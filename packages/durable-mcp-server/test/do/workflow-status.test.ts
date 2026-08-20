/**
 * Flow: `step.status` telemetry through the REAL executor (stage 3): the
 * handler-owned statusMessage is visible to pollers between invocations,
 * duplicate delivery on replay is harmless, the final write survives the
 * terminal transition, and a handler that never calls it leaves the field
 * absent everywhere (single-writer rule, revision 2).
 *
 * Layers: integration (telemetry across suspension/replay over drains),
 * data (status_message row, journal untouched). The HTTP layer lives in
 * http/flows.test.ts.
 */

import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { runCount } from "../fixtures/task-state";
import { drainTaskAlarms } from "../support/drain";
import { createTask, readSteps, readTaskRow, uniqueTaskId } from "../support/helpers";

const NS = () => env.TASK_RUNNER_REAL;
const drain = (taskId: string) => drainTaskAlarms(taskId, { namespace: NS() });

describe("handler telemetry across suspension and replay", () => {
  it("pollers see the last handler write; the terminal transition keeps it", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "status_task", input: { text: "gp" } }, NS());
    const stub = NS().getByName(taskId);

    // Tick 1: "warming up" -> work step -> `sent "GP"` -> sleep suspends.
    // The step transitions and the suspension settle write no narration:
    // the poll shows the handler's last message.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(runCount(`${taskId}:work`)).toBe(1);

    let row = await readTaskRow(stub);
    expect(row?.status).toBe("working");
    expect(row?.status_message).toBe('sent "GP"');
    expect(await stub.get()).toMatchObject({ status: "working", statusMessage: 'sent "GP"' });

    // No journal rows for the status writes: only the step and the sleep.
    expect((await readSteps(stub)).map((s) => [s.step_key, s.kind])).toEqual([
      ["work", "do"],
      ["cool-down", "sleep"],
    ]);

    // Resume: the replay must NOT re-publish "warming up" or `sent "GP"`.
    // Those beats were delivered by the first run; a poller that already
    // moved past them would otherwise see them come back as fresh changes
    // (the "old events replay after a fork" bug). The replay re-runs the
    // handler from the top but `step.status` stays silent until the handler
    // passes its first journal miss, so the only new write is "wrapping up".
    const beforeResume = await readTaskRow(stub);
    expect(beforeResume?.status_message).toBe('sent "GP"');
    const lastWriteBeforeResume = beforeResume?.last_updated_at;
    await drain(taskId);
    expect(runCount(`${taskId}:work`)).toBe(1);

    row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(row?.status_message).toBe("wrapping up"); // survived the terminal settle
    // The handler CALLED step.status five times in total (three on the first
    // run, then "warming up" and `sent "GP"` again during the replay, then
    // the new "wrapping up"), but only the live call wrote: the row moved
    // straight from `sent "GP"` to "wrapping up" with a single later
    // last_updated_at, never back to an earlier beat.
    expect(runCount(`${taskId}:status`)).toBe(5);
    expect(row?.last_updated_at).toBeGreaterThan(Number(lastWriteBeforeResume ?? 0));
    expect(await stub.get()).toMatchObject({
      status: "completed",
      statusMessage: "wrapping up",
      result: { content: [{ type: "text", text: "done:GP" }] },
    });
  });

  it("a handler that never calls step.status leaves statusMessage absent everywhere", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "pipeline_task", input: { text: "quiet" } }, NS());
    const stub = NS().getByName(taskId);

    // Mid-flight: claimed, step-1 completed, sleeping — no narration.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await readTaskRow(stub))?.status_message).toBeNull();
    const working = await stub.get();
    expect(working !== null && typeof working === "object" && "statusMessage" in working).toBe(
      false,
    );

    await drain(taskId);
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(row?.status_message).toBeNull();
    const done = await stub.get();
    expect(done !== null && typeof done === "object" && "statusMessage" in done).toBe(false);
  });
});
