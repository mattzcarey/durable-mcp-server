/**
 * Flows: create + poll/get.
 *
 * Layers covered here: data (exact SQLite rows via runInDurableObject),
 * control plane (DO RPC: create/get idempotency, notFound), integration
 * (create -> get working before any alarm fires — strong consistency MUST).
 * HTTP layer arrives with stage 4's front-door router.
 */

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { callTaskRunner } from "../../src/engine/call-task-runner";
import { resetFakeExecutor } from "../fixtures/fake-executor";
import { expectRejects } from "../support/expect-rejects";
import {
  baseCreateInput,
  createTask,
  getAlarmTime,
  listTableNames,
  readTaskRow,
  taskStub,
  uniqueTaskId,
} from "../support/helpers";

beforeEach(() => {
  resetFakeExecutor();
});

describe("TaskRunner.create (control plane)", () => {
  it("returns a working snapshot with ISO timestamps and server policy", async () => {
    const taskId = uniqueTaskId();
    const before = Date.now();
    const snapshot = await createTask(taskId, { ttlMs: 86_400_000, pollIntervalMs: 2_500 });

    expect(snapshot.taskId).toBe(taskId);
    expect(snapshot.status).toBe("working");
    expect(snapshot.ttlMs).toBe(86_400_000);
    expect(snapshot.pollIntervalMs).toBe(2_500);
    expect(Date.parse(snapshot.createdAt)).toBeGreaterThanOrEqual(before - 1);
    expect(Date.parse(snapshot.createdAt)).toBeLessThanOrEqual(Date.now() + 1);
    expect(snapshot.lastUpdatedAt).toBe(snapshot.createdAt);
  });

  it("is idempotent: a duplicate create returns the same task and writes nothing", async () => {
    const taskId = uniqueTaskId();
    const first = await createTask(taskId);
    const rowAfterFirst = await readTaskRow(taskStub(taskId));

    const second = await createTask(taskId);
    const rowAfterSecond = await readTaskRow(taskStub(taskId));

    expect(second.taskId).toBe(first.taskId);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.status).toBe("working");
    expect(rowAfterSecond).toEqual(rowAfterFirst); // no counters, no new generation
  });

  it("rejects a re-create for a different tool on the same task id", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);
    await expectRejects(
      createTask(taskId, { toolName: "other_tool" }),
      /created for tool "echo_task"/,
    );
  });

  it("validates ttlMs and pollIntervalMs", async () => {
    const stub = taskStub(uniqueTaskId());
    await expectRejects(stub.create(baseCreateInput(uniqueTaskId(), { ttlMs: -5 })), /ttlMs/);
    await expectRejects(
      stub.create(baseCreateInput(uniqueTaskId(), { pollIntervalMs: 0 })),
      /pollIntervalMs/,
    );
  });

  it("goes through the callTaskRunner retry wrapper against the real namespace", async () => {
    const taskId = uniqueTaskId();
    const attempts: number[] = [];
    const snapshot = await callTaskRunner(env.TASK_RUNNER, taskId, (stub, attempt) => {
      attempts.push(attempt);
      return stub.create(baseCreateInput(taskId));
    });
    expect(snapshot.status).toBe("working");
    expect(attempts).toEqual([1]); // healthy DO: single attempt
  });
});

describe("TaskRunner.create (data layer)", () => {
  it("persists the exact task row and arms the execution alarm atomically", async () => {
    const taskId = uniqueTaskId();
    const before = Date.now();
    await createTask(taskId, { input: { text: "row-check" }, authKey: "client-1" });
    const after = Date.now();

    const stub = taskStub(taskId);
    const row = await readTaskRow(stub);
    expect(row).toBeDefined();
    expect(row?.task_id).toBe(taskId);
    expect(row?.tool_name).toBe("echo_task");
    expect(JSON.parse(String(row?.input))).toEqual({ kind: "value", value: { text: "row-check" } });
    expect(row?.status).toBe("working");
    expect(row?.status_message).toBeNull();
    expect(row?.created_at).toBeGreaterThanOrEqual(before);
    expect(row?.created_at).toBeLessThanOrEqual(after);
    expect(row?.last_updated_at).toBe(row?.created_at);
    expect(row?.ttl_ms).toBe(86_400_000);
    expect(row?.poll_interval_ms).toBe(5_000);
    expect(row?.result).toBeNull();
    expect(row?.error).toBeNull();
    expect(row?.cancel_requested).toBe(0);
    expect(row?.run_attempt).toBe(0); // no claim yet
    expect(typeof row?.run_generation).toBe("string");
    expect(row?.auth_key).toBe("client-1");

    // The redelivery anchor and the armed alarm: fixture wakes are pushed
    // +300s so workerd never fires them on its own (design/002 determinism).
    const createdAt = Number(row?.created_at);
    expect(row?.run_next_at).toBe(createdAt + 300_000);
    const alarm = await getAlarmTime(stub);
    expect(alarm).toBe(createdAt + 300_000);
  });

  it("stores an undefined input faithfully through the envelope", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { input: undefined });
    const row = await readTaskRow(taskStub(taskId));
    expect(JSON.parse(String(row?.input))).toEqual({ kind: "undefined" });
  });
});

describe("TaskRunner.get", () => {
  it("returns notFound for an unknown task and never writes (control plane)", async () => {
    const taskId = uniqueTaskId();
    const stub = taskStub(taskId);

    await expect(stub.get()).resolves.toEqual({ notFound: true });
    // Still notFound on repeat, and the not-found path performed ZERO storage
    // writes (docs/how-it-works.md §4(h) (tasks/get through the router) MUST): not even the schema DDL — the empty DO is
    // never persisted.
    await expect(stub.get()).resolves.toEqual({ notFound: true });
    expect(await listTableNames(stub)).toEqual([]);
    expect(await readTaskRow(stub)).toBeUndefined();
    expect(await getAlarmTime(stub)).toBeNull();
  });

  it("create -> get shows working before any alarm fires (integration, strong consistency)", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId);

    const snapshot = await callTaskRunner(env.TASK_RUNNER, taskId, async (stub) => stub.get());
    expect(snapshot).toMatchObject({ taskId, status: "working", ttlMs: 86_400_000 });
    if ("notFound" in snapshot) {
      throw new Error("unreachable");
    }
    expect(snapshot.pollIntervalMs).toBe(5_000);
    expect("result" in snapshot).toBe(false);
    expect("error" in snapshot).toBe(false);
  });
});
