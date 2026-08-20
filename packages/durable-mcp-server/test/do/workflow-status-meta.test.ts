/**
 * Flow: `step.status(message, meta)` through the REAL executor: pollers see
 * the last meta between invocations, a message-only call keeps it, the
 * replay's duplicate delivery is idempotent, the final write replaces it
 * wholesale and survives the terminal transition, and a handler that never
 * passes one leaves the snapshot without `_meta`.
 *
 * Layers: integration (meta across suspension/replay over drains), data
 * (status_meta row, journal untouched). The HTTP layer lives in
 * http/status-meta.test.ts.
 */

import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { STATUS_META_KEY } from "../../src";
import type { TaskRunner } from "../../src";
import { runCount } from "../fixtures/task-state";
import { drainTaskAlarms } from "../support/drain";
import { createTask, readSteps, readTaskRow, uniqueTaskId } from "../support/helpers";

const NS = () => env.TASK_RUNNER_REAL;
const drain = (taskId: string) => drainTaskAlarms(taskId, { namespace: NS() });

const snapshotSchema = z.record(z.string(), z.unknown());
async function snapshotOf(stub: DurableObjectStub<TaskRunner>): Promise<Record<string, unknown>> {
  return snapshotSchema.parse(await stub.get());
}

describe("structured status meta across suspension and replay", () => {
  it("pollers see the last meta; a meta-less call keeps it; the final write replaces it and survives terminal", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "status_meta_task", input: { text: "gp" } }, NS());
    const stub = NS().getByName(taskId);

    // Tick 1: meta written, work step, message-only write keeps the meta,
    // sleep suspends. The poll shows the last message with the warmup meta.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(runCount(`${taskId}:work`)).toBe(1);
    let row = await readTaskRow(stub);
    expect(row?.status).toBe("working");
    expect(row?.status_message).toBe('sent "GP"');
    expect(JSON.parse(String(row?.status_meta))).toEqual({ phase: "warmup", lap: 0 });
    let snapshot = await snapshotOf(stub);
    expect(snapshot["statusMessage"]).toBe('sent "GP"');
    expect(snapshot["_meta"]).toEqual({ [STATUS_META_KEY]: { phase: "warmup", lap: 0 } });
    // No journal rows for the status writes: only the step and the sleep.
    expect((await readSteps(stub)).map((s) => [s.step_key, s.kind])).toEqual([
      ["work", "do"],
      ["cool-down", "sleep"],
    ]);

    // Resume: the replay re-delivers the warmup meta and the message-only
    // call harmlessly before the final write replaces the meta wholesale.
    await drain(taskId);
    expect(runCount(`${taskId}:work`)).toBe(1);
    row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(row?.status_message).toBe("wrapping up");
    expect(JSON.parse(String(row?.status_meta))).toEqual({ phase: "done", lap: 3 });
    snapshot = await snapshotOf(stub);
    expect(snapshot["status"]).toBe("completed");
    expect(snapshot["result"]).toEqual({ content: [{ type: "text", text: "done:GP" }] });
    expect(snapshot["_meta"]).toEqual({ [STATUS_META_KEY]: { phase: "done", lap: 3 } });
  });

  it("a handler that never passes a meta leaves the snapshot without _meta at every stage", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "status_task", input: { text: "quiet" } }, NS());
    const stub = NS().getByName(taskId);

    expect(await runDurableObjectAlarm(stub)).toBe(true); // mid-flight, sleeping
    let snapshot = await snapshotOf(stub);
    expect(snapshot["statusMessage"]).toBe('sent "QUIET"');
    expect("_meta" in snapshot).toBe(false);
    expect((await readTaskRow(stub))?.status_meta).toBeNull();

    await drain(taskId);
    snapshot = await snapshotOf(stub);
    expect(snapshot["status"]).toBe("completed");
    expect("_meta" in snapshot).toBe(false);
    expect((await readTaskRow(stub))?.status_meta).toBeNull();
  });
});
