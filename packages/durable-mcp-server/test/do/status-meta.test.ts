/**
 * Flow: structured status meta (`step.status(message, meta)` ->
 * TaskRunner.setStatus): `status_meta` is handler-owned like the message,
 * REPLACED wholesale by every call that passes a meta, kept by calls that do
 * not, capped at 8 KiB serialized, surfaced by tasks/get under the
 * package-namespaced `_meta` key (absent while NULL), and guarded exactly
 * like the message (generation, terminal no-op).
 *
 * Layers here: data (status_meta column, replace/keep semantics, journal
 * untouched), control plane (validation + guards through the RPC) against
 * the injected fake executor. Real-executor and HTTP layers live in
 * workflow-status-meta.test.ts and http/status-meta.test.ts.
 */

import { runDurableObjectAlarm } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { STATUS_META_KEY, STATUS_META_MAX_BYTES } from "../../src";
import type { TaskRunner } from "../../src";
import { completedResult, resetFakeExecutor, setFakeBehavior } from "../fixtures/fake-executor";
import { drainTaskAlarms } from "../support/drain";
import { expectRejects } from "../support/expect-rejects";
import {
  createTask,
  currentGeneration,
  readSteps,
  readTaskRow,
  taskStub,
  uniqueTaskId,
} from "../support/helpers";

const snapshotSchema = z.record(z.string(), z.unknown());
async function snapshotOf(stub: DurableObjectStub<TaskRunner>): Promise<Record<string, unknown>> {
  return snapshotSchema.parse(await stub.get());
}

/** The stored meta, parsed. */
function metaOf(row: Record<string, unknown> | undefined): unknown {
  return row?.status_meta === null ? null : JSON.parse(String(row?.status_meta));
}

const utf8Bytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

beforeEach(() => {
  resetFakeExecutor();
});

describe("status_meta write semantics (data)", () => {
  it("stores the meta as JSON next to the message, keeps it across meta-less calls, surfaces it on tasks/get", async () => {
    const taskId = uniqueTaskId();
    const meta = { scene: "lobby", offers: ["act-1"], depth: { level: 2 } };
    setFakeBehavior(async (_desc, step) => {
      await step.setStatus("act 1", meta);
      await step.setStatus("act 1, beat 2"); // no meta: the stored meta stands
      const nap = await step.recordSleep("nap", Date.now() + 600_000);
      if (nap.state === "pending") {
        return { outcome: "suspended" };
      }
      return completedResult("done");
    });
    await createTask(taskId);
    const stub = taskStub(taskId);
    expect((await readTaskRow(stub))?.status_meta).toBeNull(); // at creation

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const row = await readTaskRow(stub);
    expect(row?.status_message).toBe("act 1, beat 2");
    expect(metaOf(row)).toEqual(meta);
    // Not a journaled step: the only journal row is the sleep.
    expect((await readSteps(stub)).map((s) => [s.step_key, s.kind])).toEqual([["nap", "sleep"]]);
    // tasks/get: the namespaced _meta key carries the meta verbatim.
    const snapshot = await snapshotOf(stub);
    expect(snapshot["statusMessage"]).toBe("act 1, beat 2");
    expect(snapshot["_meta"]).toEqual({ [STATUS_META_KEY]: meta });
  });

  it("replaces the meta wholesale on every call that passes one", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    const stub = taskStub(taskId);
    const generation = await currentGeneration(stub);

    await stub.setStatus(generation, "a", { x: 1, y: 2 });
    expect(metaOf(await readTaskRow(stub))).toEqual({ x: 1, y: 2 });
    await stub.setStatus(generation, "b", { z: 3 });
    expect(metaOf(await readTaskRow(stub))).toEqual({ z: 3 }); // no x, no y
    await stub.setStatus(generation, "c", {});
    expect(metaOf(await readTaskRow(stub))).toEqual({}); // an empty object is a replacement, not a keep
    await stub.setStatus(generation, "d");
    expect(metaOf(await readTaskRow(stub))).toEqual({}); // kept
    expect((await readTaskRow(stub))?.status_message).toBe("d");
  });

  it("stays NULL — and absent from tasks/get — until the handler writes one", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async (_desc, step) => {
      await step.setStatus("message only");
      return completedResult("done");
    });
    await createTask(taskId);
    const stub = taskStub(taskId);
    expect("_meta" in (await snapshotOf(stub))).toBe(false);

    await drainTaskAlarms(taskId);

    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(row?.status_message).toBe("message only");
    expect(row?.status_meta).toBeNull();
    const snapshot = await snapshotOf(stub);
    expect(snapshot["statusMessage"]).toBe("message only");
    expect("_meta" in snapshot).toBe(false);
  });

  it("the last meta survives the terminal transition", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async (_desc, step) => {
      await step.setStatus("final", { done: true, laps: 3 });
      return completedResult("done");
    });
    await createTask(taskId);
    await drainTaskAlarms(taskId);

    const stub = taskStub(taskId);
    const row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(metaOf(row)).toEqual({ done: true, laps: 3 });
    const snapshot = await snapshotOf(stub);
    expect(snapshot["status"]).toBe("completed");
    expect(snapshot["result"]).toEqual({ content: [{ type: "text", text: "done" }] });
    expect(snapshot["_meta"]).toEqual({ [STATUS_META_KEY]: { done: true, laps: 3 } });
  });
});

describe("status_meta validation + guards (control plane)", () => {
  it("accepts exactly 8 KiB serialized and rejects one byte more with a clear error, writing nothing", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    const stub = taskStub(taskId);
    const generation = await currentGeneration(stub);

    const padding = STATUS_META_MAX_BYTES - utf8Bytes({ pad: "" });
    const exact = { pad: "a".repeat(padding) };
    expect(utf8Bytes(exact)).toBe(STATUS_META_MAX_BYTES);
    await stub.setStatus(generation, "big", exact);
    expect(metaOf(await readTaskRow(stub))).toEqual(exact);

    const over = { pad: "a".repeat(padding + 1) };
    await expectRejects(
      stub.setStatus(generation, "too big", over),
      /at most 8192 bytes, got 8193/,
    );
    // Bytes, not characters: 2-byte code points count double.
    const wide = { pad: "ü".repeat(padding / 2 + 1) };
    expect(JSON.stringify(wide).length).toBeLessThan(STATUS_META_MAX_BYTES);
    await expectRejects(stub.setStatus(generation, "too wide", wide), /at most 8192 bytes/);

    // The rejected calls wrote nothing: message and meta are the accepted ones.
    const row = await readTaskRow(stub);
    expect(row?.status_message).toBe("big");
    expect(metaOf(row)).toEqual(exact);
  });

  it("rejects a non-object or non-JSON meta before writing anything", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    const stub = taskStub(taskId);
    const generation = await currentGeneration(stub);
    const before = await readTaskRow(stub);

    await expectRejects(stub.setStatus(generation, "m", [1, 2]), /plain JSON object, got an array/);
    await expectRejects(stub.setStatus(generation, "m", null), /plain JSON object, got null/);
    await expectRejects(stub.setStatus(generation, "m", "text"), /plain JSON object, got string/);
    await expectRejects(
      stub.setStatus(generation, "m", { n: Number.NaN }),
      /not JSON-serializable/,
    );

    expect(await readTaskRow(stub)).toEqual(before); // no message, no meta, no bump
  });

  it("a stale generation is rejected; a call after a terminal state is a no-op", async () => {
    const taskId = uniqueTaskId();
    setFakeBehavior(async (_desc, step) => {
      await step.setStatus("final", { done: true });
      return completedResult("done");
    });
    await createTask(taskId);
    const stub = taskStub(taskId);
    const before = await readTaskRow(stub);
    await expectRejects(
      stub.setStatus(crypto.randomUUID(), "sneaky", { hacked: true }),
      /Stale lease/,
    );
    expect(await readTaskRow(stub)).toEqual(before);

    await drainTaskAlarms(taskId);
    const terminal = await readTaskRow(stub);
    expect(terminal?.status).toBe("completed");
    await stub.setStatus(await currentGeneration(stub), "too late", { late: true }); // resolves, writes nothing
    expect(await readTaskRow(stub)).toEqual(terminal);
    expect(metaOf(terminal)).toEqual({ done: true });
  });
});
