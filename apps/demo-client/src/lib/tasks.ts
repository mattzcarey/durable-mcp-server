/**
 * Pure per-task view model: folds the snapshots the agent's watch observes
 * (`TaskObservation`) into the `TaskView` the utilities drawer and the
 * playthrough fold read from. No timers, no I/O — "now" is always passed in.
 */
import { z } from "zod";
import type { DetailedTask, InputRequest, TaskStatus } from "../mcp-tasks/schema";

/**
 * `_meta` key our own TaskRunner engine uses for structured telemetry on
 * `tasks/get` responses. Third-party servers won't send it; every field is
 * optional and the view renders fully without it.
 */
export const TELEMETRY_META_KEY = "com.durable-mcp-server/telemetry";

const TelemetrySchema = z.looseObject({
  stepsCompleted: z.number().optional(),
  stepsTotal: z.number().optional(),
  /** ISO 8601 — the task is in `step.sleep` until this instant. */
  sleepUntil: z.string().optional(),
});
type Telemetry = z.infer<typeof TelemetrySchema>;

/**
 * One observed task snapshot, as the agent's watch sees it on a `tasks/get`
 * poll. The sole input of the view fold (`observeTask`) and, through it, of
 * the playthrough fold (`lib/playthrough.ts`).
 */
export type TaskObservation = {
  serverId: string;
  taskId: string;
  /** Tool-name label, when the watch was started by `callToolAsTask`. */
  toolName?: string;
  /**
   * Monotonic per-watch sequence number: it advances only when the observed
   * snapshot CHANGED. An equal-seq observation is a no-change poll (poll
   * bookkeeping only); a lower one is stale and ignored.
   */
  seq: number;
  /** Epoch ms when the agent observed this snapshot. */
  observedAt: number;
  /** Epoch ms when the next poll is scheduled; absent on terminal states. */
  nextPollAt?: number;
  /** The full task snapshot from `tasks/get` (result/error/inputRequests inlined). */
  task: DetailedTask;
};

/** Per-task UI model, derived purely from the observation stream. */
export type TaskView = {
  serverId: string;
  taskId: string;
  /** Tool-name label when the watch knows it. */
  toolName?: string;
  status: TaskStatus;
  statusMessage?: string;
  /** Last applied observation seq; stale/duplicate observations are dropped. */
  seq: number;
  /**
   * Count of distinct observed state changes. Derived from the watch's seq
   * (never a local message count), so a rebuild or a seq gap lands at the
   * true count.
   */
  updates: number;
  createdAtMs: number;
  lastUpdatedAtMs: number;
  /**
   * Epoch ms when the agent FIRST observed the current snapshot. Equal-seq
   * poll refreshes never move it — only a real state change (a new seq)
   * re-anchors.
   */
  observedAtMs: number;
  /**
   * Epoch ms when the CURRENT status was first observed. Survives snapshot
   * changes that keep the status, so a crisis countdown anchors to when the
   * ask appeared — never to the latest snapshot. For `input_required` the
   * "status" is the ask itself: a different set of outstanding request keys
   * (one fork straight into the next, the `working` gap unobserved)
   * re-anchors, so a new ask never inherits the old one's clock.
   */
  statusSinceMs: number;
  /**
   * Epoch ms of the last successful poll, change or not. No-change polls
   * are equal-seq observations and advance only this (and `nextPollAtMs`) —
   * how a manual "poll now" stays visible even when nothing changed.
   */
  polledAtMs: number;
  /** Epoch ms of the next scheduled poll; absent on terminal states. */
  nextPollAtMs?: number;
  /** The server's poll-interval hint, when present on the snapshot. */
  pollIntervalMs?: number;
  /**
   * Progress fraction (0..1) when telemetry gives step totals, clamped to
   * the max ever seen — at-least-once replays must not drive it backwards.
   * Absent without telemetry.
   */
  progress?: number;
  /** Unclamped progress as reported. */
  rawProgress?: number;
  /** Epoch ms the engine says the task sleeps until (telemetry). */
  sleepUntilMs?: number;
  terminal: boolean;
  /** Outstanding input requests while `input_required`. */
  inputRequests?: Record<string, InputRequest>;
  /** Final CallToolResult once `completed`. */
  result?: Record<string, unknown>;
  /** JSON-RPC error once `failed`. */
  error?: Record<string, unknown>;
};

function parseIsoMs(value: string, fallback: number): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readTelemetry(task: DetailedTask): Telemetry {
  const meta = z.record(z.string(), z.unknown()).safeParse(task["_meta"]);
  if (!meta.success) {
    return {};
  }
  const parsed = TelemetrySchema.safeParse(meta.data[TELEMETRY_META_KEY]);
  return parsed.success ? parsed.data : {};
}

function stepFraction(telemetry: Telemetry): number | undefined {
  const { stepsCompleted, stepsTotal } = telemetry;
  if (
    stepsCompleted === undefined ||
    stepsTotal === undefined ||
    !Number.isFinite(stepsCompleted) ||
    !Number.isFinite(stepsTotal) ||
    stepsTotal <= 0
  ) {
    return undefined;
  }
  return Math.min(Math.max(stepsCompleted / stepsTotal, 0), 1);
}

/**
 * Applies one observation to a task's view. Pure: returns a new view, or
 * the SAME reference when the observation is stale (a lower seq, or an
 * equal seq that is not a fresher poll). An equal-seq observation with a
 * NEWER observedAt is a no-change poll: the snapshot content is identical,
 * but the poll bookkeeping (`polledAtMs`, `nextPollAtMs`) is fresher —
 * apply just that, leaving `observedAtMs` anchored so a countdown never
 * resets on a poll that observed nothing new.
 */
export function observeTask(prev: TaskView | undefined, observation: TaskObservation): TaskView {
  if (prev !== undefined && observation.seq < prev.seq) {
    return prev;
  }
  if (prev !== undefined && observation.seq === prev.seq) {
    if (observation.observedAt <= prev.polledAtMs) {
      return prev; // A replay, not a fresher poll.
    }
    const refreshed: TaskView = { ...prev, polledAtMs: observation.observedAt };
    if (observation.nextPollAt !== undefined) {
      refreshed.nextPollAtMs = observation.nextPollAt;
    }
    return refreshed;
  }
  return makeTaskView(prev, observation);
}

/** Whether two snapshots carry the same outstanding ask (same request keys). */
function sameAsk(
  prev: Record<string, InputRequest> | undefined,
  next: Record<string, InputRequest> | undefined,
): boolean {
  const prevKeys = Object.keys(prev ?? {});
  const nextKeys = new Set(Object.keys(next ?? {}));
  return prevKeys.length === nextKeys.size && prevKeys.every((key) => nextKeys.has(key));
}

function makeTaskView(prev: TaskView | undefined, observation: TaskObservation): TaskView {
  const { task } = observation;
  const telemetry = readTelemetry(task);
  const rawProgress = stepFraction(telemetry);
  const sameStatus =
    prev !== undefined &&
    prev.status === task.status &&
    (task.status !== "input_required" || sameAsk(prev.inputRequests, task.inputRequests));

  const view: TaskView = {
    serverId: observation.serverId,
    taskId: observation.taskId,
    status: task.status,
    seq: observation.seq,
    updates: Math.max(observation.seq, (prev?.updates ?? 0) + 1),
    createdAtMs: parseIsoMs(task.createdAt, observation.observedAt),
    lastUpdatedAtMs: parseIsoMs(task.lastUpdatedAt, observation.observedAt),
    observedAtMs: observation.observedAt,
    statusSinceMs: sameStatus ? prev.statusSinceMs : observation.observedAt,
    polledAtMs: observation.observedAt,
    terminal:
      task.status === "completed" || task.status === "failed" || task.status === "cancelled",
  };

  const toolName = observation.toolName ?? prev?.toolName;
  if (toolName !== undefined) {
    view.toolName = toolName;
  }
  // Null and absent both mean pre-telemetry (the engine writes no
  // auto-narration before the task's first step.status call) — the view
  // simply carries no statusMessage until real telemetry lands.
  if (typeof task.statusMessage === "string") {
    view.statusMessage = task.statusMessage;
  }
  if (observation.nextPollAt !== undefined) {
    view.nextPollAtMs = observation.nextPollAt;
  }
  if (task.pollIntervalMs !== undefined) {
    view.pollIntervalMs = task.pollIntervalMs;
  }
  if (rawProgress !== undefined) {
    view.rawProgress = rawProgress;
    view.progress = Math.max(prev?.progress ?? 0, rawProgress);
  } else if (prev?.progress !== undefined) {
    // Telemetry went quiet; keep showing the furthest point reached.
    view.progress = prev.progress;
  }
  if (telemetry.sleepUntil !== undefined) {
    const sleepUntilMs = Date.parse(telemetry.sleepUntil);
    if (Number.isFinite(sleepUntilMs)) {
      view.sleepUntilMs = sleepUntilMs;
    }
  }
  if (task.status === "input_required") {
    view.inputRequests = task.inputRequests;
  }
  if (task.status === "completed") {
    view.result = task.result;
    // In fraction mode the finish line is real — completion reaches it.
    if (view.progress !== undefined) {
      view.progress = 1;
    }
  }
  if (task.status === "failed") {
    view.error = task.error;
  }
  return view;
}

/**
 * Whether `candidate` is an OLDER snapshot of the task than `current`, by
 * the server's `lastUpdatedAt` (the engine bumps it on every status or
 * statusMessage change, ms precision). Two polls of one task can overlap
 * in flight — an alarm poll and the re-poll after `tasks/update` — and
 * return in either order; the older snapshot must never overwrite the
 * newer one. Unparseable timestamps never read as stale.
 */
export function isStaleSnapshot(
  candidate: DetailedTask,
  current: DetailedTask | undefined,
): boolean {
  if (current === undefined) {
    return false;
  }
  const candidateMs = Date.parse(candidate.lastUpdatedAt);
  const currentMs = Date.parse(current.lastUpdatedAt);
  return Number.isFinite(candidateMs) && Number.isFinite(currentMs) && candidateMs < currentMs;
}

/**
 * Milliseconds the task has been running. Frozen at the final
 * `lastUpdatedAt` once terminal — the clock stops with the story.
 */
export function elapsedMs(view: TaskView, nowMs: number): number {
  const end = view.terminal ? view.lastUpdatedAtMs : nowMs;
  return Math.max(0, end - view.createdAtMs);
}

/**
 * Milliseconds until the next poll, for the utilities readout. Undefined
 * when nothing more will be polled (terminal, or no scheduled poll known).
 */
export function nextPollCountdownMs(view: TaskView, nowMs: number): number | undefined {
  if (view.terminal || view.nextPollAtMs === undefined) {
    return undefined;
  }
  return Math.max(0, view.nextPollAtMs - nowMs);
}

/** A poll is overdue (no update past the expected next poll time). */
export function isPollOverdue(view: TaskView, nowMs: number): boolean {
  return !view.terminal && view.nextPollAtMs !== undefined && nowMs > view.nextPollAtMs;
}
