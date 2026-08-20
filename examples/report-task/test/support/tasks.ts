/**
 * Task-flow helpers for the integration suite. The example exports the
 * library TaskRunner untouched (PRODUCTION scheduling — immediate wakes), so
 * workerd fires genuinely-due alarms on its own here; a pure
 * `runDurableObjectAlarm` drain loop can observe "no alarm pending" while an
 * engine attempt is still in flight. `drainTaskUntil` therefore combines
 * deterministic alarm ticks (which fire not-yet-due execution wakes such as
 * the "cool-off" `step.sleep` early) with bounded polling of the wire
 * snapshot — the same wait pattern apps/task-server uses.
 *
 * Wire shapes are validated with the PACKAGE's exported zod schemas
 * (createTaskResultSchema / getTaskResultSchema), never SDK task types.
 */

import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createTaskResultSchema, getTaskResultSchema } from "durable-mcp-server";
import { z } from "zod";
import { callResult } from "./jsonrpc";

export type TaskSnapshot = z.output<typeof getTaskResultSchema>;

export const TERMINAL = ["completed", "failed", "cancelled"] as const;

/** Unique recipient per test: report-api counts are keyed by recipient. */
export function uniqueRecipient(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

/** A recipient whose first `failures` POST /send attempts get a 500. */
export function flakyRecipient(failures: number): string {
  return `flaky-${failures}-${crypto.randomUUID()}@example.com`;
}

/**
 * How often the report API was hit for a recipient. The fetch goes through
 * the example worker's outbound service to the auxiliary report-api worker.
 */
export async function reportApiCounts(to: string): Promise<{ data: number; send: number }> {
  const response = await fetch(`${env.REPORT_API_URL}/__counts?to=${encodeURIComponent(to)}`);
  return z.object({ data: z.number(), send: z.number() }).parse(await response.json());
}

/** `tools/call` with the tasks extension declared; validates the flat CreateTaskResult. */
export async function startTask(
  name: string,
  args: Record<string, unknown>,
): Promise<z.output<typeof createTaskResultSchema>> {
  const created = createTaskResultSchema.parse(
    await callResult("tools/call", { name, arguments: args }),
  );
  if (created.status !== "working") {
    throw new Error(`expected a working task from tools/call, got ${created.status}`);
  }
  return created;
}

/** `tasks/get` over the wire, validated with the package's wire schema. */
export async function getTask(taskId: string): Promise<TaskSnapshot> {
  return getTaskResultSchema.parse(await callResult("tasks/get", { taskId }));
}

/**
 * Drives the task's alarm chain with `runDurableObjectAlarm` until the wire
 * snapshot reaches one of the wanted statuses.
 */
export async function drainTaskUntil(
  taskId: string,
  statuses: readonly TaskSnapshot["status"][],
  timeoutMs = 15_000,
): Promise<TaskSnapshot> {
  const stub = env.TASK_RUNNER.getByName(taskId); // per-task DO: taskId IS the DO name (D2)
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await runDurableObjectAlarm(stub);
    const snapshot = await getTask(taskId);
    if (statuses.includes(snapshot.status)) {
      return snapshot;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `task "${taskId}" did not reach ${statuses.join("/")} within ${timeoutMs}ms ` +
          `(last status: ${snapshot.status})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Polls `probe` until it returns a value (undefined = keep waiting). */
export async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  what: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Eviction choreography for send_report: resolves once the FIRST invocation
 * has settled on the "cool-off" sleep — fetch-data journaled, nothing in
 * flight — so an eviction here tests replay, not a crashed attempt.
 *
 * Wire snapshots cannot distinguish "executing fetch-data" from "suspended on
 * the sleep" (both are `working`), so the probe reads the DO's alarm clock:
 * while an attempt is in flight the pending alarm is an immediate redelivery
 * wake or the 60s in-flight backstop; once the attempt settles it is the
 * sleep's wake, a few seconds out. The [2s, 30s] window selects exactly that
 * state.
 */
export async function waitForCoolOffSuspension(taskId: string, to: string): Promise<void> {
  const stub = env.TASK_RUNNER.getByName(taskId);
  await waitFor(async () => {
    const { data } = await reportApiCounts(to);
    if (data < 1) {
      return undefined; // fetch-data has not run yet
    }
    const alarm = await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());
    if (alarm === null) {
      return undefined; // mid-delivery window
    }
    const untilWake = alarm - Date.now();
    return untilWake > 2_000 && untilWake < 30_000 ? true : undefined;
  }, `task "${taskId}" to settle on the cool-off sleep`);
}
