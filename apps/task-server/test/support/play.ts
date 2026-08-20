/**
 * Wire-side play helpers for the `start` task: start a story, answer forks
 * (or press ambient actions) the way the UI's buttons do, collect every
 * (statusMessage, meta) beat exactly once, really wait a crisis window out,
 * and play a task to a terminal state from a projection script. Shared by
 * the adventure suite (the real datacenter story) and any story-specific
 * wire test.
 *
 * Beat observation: every beat is followed by a durable pace sleep, so
 * between suspensions at most one new beat appears; drainTaskUntil ticks one
 * suspension at a time and polls only settled snapshots, which makes the
 * collected sequence complete, not sampled. Elicit deadlines are wall-clock
 * honest: waitOutCrisis polls without ticking until the deadline fires.
 */

import { expect } from "vitest";
import { createTaskResultSchema, STATUS_META_KEY } from "durable-mcp-server";
import { z } from "zod";
import type { ProjectedBeat, Script } from "./story-sim";
import { callResult } from "./jsonrpc";
import { drainTaskUntil, getTask, type TaskSnapshot } from "./tasks";

export const TERMINAL = ["completed", "failed", "cancelled"] as const;
export const WAITING = ["input_required", ...TERMINAL] as const;

/** Calls `start` for a story and returns the working task's id. */
export async function startStory(
  storyId: string,
  name: string | undefined,
  seed: number,
): Promise<string> {
  const args: Record<string, unknown> = { story: storyId, seed };
  if (name !== undefined) {
    args["name"] = name;
  }
  const result = createTaskResultSchema.parse(
    await callResult("tools/call", { name: "start", arguments: args }),
  );
  expect(result.resultType).toBe("task");
  expect(result.status).toBe("working");
  return result.taskId;
}

/** Answers a fork — or presses an ambient action — the way the UI's buttons do. */
export async function sendChoice(taskId: string, key: string, choice: string): Promise<void> {
  const ack = await callResult("tasks/update", {
    taskId,
    inputResponses: { [key]: { action: "accept", content: { choice } } },
  });
  expect(ack["resultType"]).toBe("complete");
}

/** The structured status meta riding a snapshot (absent until the first beat). */
export function metaOf(snapshot: TaskSnapshot): Record<string, unknown> | undefined {
  const meta = snapshot["_meta"]?.[STATUS_META_KEY];
  return typeof meta === "object" && meta !== null ? (meta as Record<string, unknown>) : undefined;
}

/** Collects each new (statusMessage, meta) pair exactly once (consecutive dedupe). */
export function collectBeats(seen: ProjectedBeat[]): (snapshot: TaskSnapshot) => void {
  return (snapshot) => {
    const message = snapshot.statusMessage;
    if (message !== undefined && seen.at(-1)?.text !== message) {
      const meta = metaOf(snapshot);
      seen.push({
        text: message,
        meta: z.record(z.string(), z.unknown()).parse(meta ?? {}) as ProjectedBeat["meta"],
      });
    }
  };
}

export function expectInputRequired(
  snapshot: TaskSnapshot,
): Extract<TaskSnapshot, { status: "input_required" }> {
  if (snapshot.status !== "input_required") {
    throw new Error(`expected input_required, got ${snapshot.status}`);
  }
  return snapshot;
}

/** The completed task's result text (the contract's "[ending:{id}] {prose}"). */
export function resultText(snapshot: TaskSnapshot): string {
  if (snapshot.status !== "completed") {
    throw new Error(`expected a completed task, got ${snapshot.status}`);
  }
  const content = z
    .array(z.object({ type: z.literal("text"), text: z.string() }))
    .parse(snapshot.result["content"]);
  const first = content.at(0);
  if (first === undefined) {
    throw new Error("completed playthrough with empty result content");
  }
  return first.text;
}

/** The ending id inside a result text. */
export function endingIdOf(text: string): string {
  const match = /^\[ending:([a-z0-9-]+)\] /.exec(text);
  if (match === null) {
    throw new Error(`not an ending result: ${text}`);
  }
  return match[1] ?? "";
}

/**
 * Polls WITHOUT driving alarms until the task shows progress past
 * `lastMessage`: the first beat of a freshly started or freshly resumed
 * attempt, the next fork, or a terminal state. The engine wakes a started or
 * answered task on its own (an immediate alarm); ticking while that attempt
 * is in flight would find no alarm, and the next tick would fast-forward the
 * pace sleep past the beat it wrote — so observation waits for the attempt
 * to land before the drain ticks resume.
 */
export async function awaitProgress(
  taskId: string,
  lastMessage: string | undefined,
  observe: (snapshot: TaskSnapshot) => void,
  timeoutMs = 15_000,
): Promise<TaskSnapshot> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = await getTask(taskId);
    observe(snapshot);
    if (snapshot.status !== "working" || snapshot.statusMessage !== lastMessage) {
      return snapshot;
    }
    if (Date.now() > deadline) {
      throw new Error(`task "${taskId}" showed no progress within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Really waits a crisis window out, WITHOUT driving alarms (the deadline is
 * wall-clock honest and fires on its own), polling the snapshot the whole
 * time so the beats the resumed story paces out meanwhile are all observed.
 */
export async function waitOutCrisis(
  taskId: string,
  windowMs: number,
  observe: (snapshot: TaskSnapshot) => void,
): Promise<void> {
  const deadline = Date.now() + windowMs + 10_000;
  for (;;) {
    const snapshot = await getTask(taskId);
    observe(snapshot);
    if (snapshot.status !== "input_required") {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`crisis ask on "${taskId}" never timed out`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export interface PlayOptions {
  /** Stop (and return the input_required snapshot) when this fork comes up, unanswered. */
  stopAtKey?: string;
  drainTimeoutMs?: number;
}

/**
 * Plays a task to a terminal state: drains to each fork, presses any
 * scripted ambient action for it (to the key the latest meta announced),
 * answers it from the script (or really waits out the deadline on
 * "timeout"), and collects every beat along the way.
 */
export async function playThrough(
  taskId: string,
  script: Script,
  seen: ProjectedBeat[],
  options?: PlayOptions,
): Promise<TaskSnapshot> {
  const observe = collectBeats(seen);
  const drainTimeoutMs = options?.drainTimeoutMs ?? 30_000;
  // A freshly started task's first attempt is in flight: let its first beat land before ticking.
  await awaitProgress(taskId, seen.at(-1)?.text, observe);
  for (;;) {
    const snapshot = await drainTaskUntil(taskId, WAITING, { observe, timeoutMs: drainTimeoutMs });
    if (snapshot.status !== "input_required") {
      return snapshot;
    }
    // Forks are the only wire inputRequests: never an ambient offer.
    const keys = Object.keys(snapshot.inputRequests);
    expect(keys).toHaveLength(1);
    const key = keys.at(0);
    if (key === undefined) {
      throw new Error("input_required with no outstanding request");
    }
    expect(key).not.toMatch(/^actions-/);
    if (key === options?.stopAtKey) {
      return snapshot;
    }
    for (const press of script.presses ?? []) {
      if (press.at === key) {
        const actions = z.object({ key: z.string() }).parse(seen.at(-1)?.meta["actions"]);
        await sendChoice(taskId, actions.key, press.choice);
      }
    }
    const scripted = script.answers[key];
    if (scripted === undefined) {
      throw new Error(`no scripted answer for ask "${key}"`);
    }
    const lastMessage = seen.at(-1)?.text;
    if (scripted === "timeout") {
      const windowMs = z
        .object({ timeoutMs: z.number() })
        .parse(snapshot.inputRequests[key]?.params).timeoutMs;
      await waitOutCrisis(taskId, windowMs, observe);
    } else {
      await sendChoice(taskId, key, scripted.choice);
    }
    // The resumed attempt wakes on its own: let its first beat land before ticking again.
    await awaitProgress(taskId, lastMessage, observe);
  }
}
