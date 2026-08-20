/**
 * The page's list of known tasks, kept in localStorage so the home list is
 * instant and survives a reload. A pointer list only — taskId, story,
 * when it started, the last status seen. The agent's playthroughs are the
 * truth for content, and the list reconciles against them on every state
 * push: ids the agent no longer has are dropped, ids it has are adopted.
 * Pure: the page owns the storage calls.
 */
import { z } from "zod";
import { isTerminalStatus, type TaskStatus, TaskStatusSchema } from "../mcp-tasks/schema";

export type KnownTask = {
  taskId: string;
  storyId: string;
  storyTitle?: string;
  startedAt: number;
  /** The last status seen for the task (absent until the agent reported one). */
  status?: TaskStatus;
};

const KnownTaskSchema = z.object({
  taskId: z.string().min(1),
  storyId: z.string().min(1),
  storyTitle: z.string().optional(),
  startedAt: z.number(),
  status: TaskStatusSchema.optional(),
});

/** Parses the stored list; anything malformed reads as an empty list. */
export function parseKnownTasks(raw: string | null): KnownTask[] {
  if (raw === null) {
    return [];
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  const parsed = z.array(KnownTaskSchema).safeParse(value);
  if (!parsed.success) {
    return [];
  }
  return parsed.data.map(tidy);
}

export function serializeKnownTasks(tasks: readonly KnownTask[]): string {
  return JSON.stringify(tasks);
}

/** Drops undefined optionals so the stored JSON stays compact. */
function tidy(task: KnownTask): KnownTask {
  const known: KnownTask = {
    taskId: task.taskId,
    storyId: task.storyId,
    startedAt: task.startedAt,
  };
  if (task.storyTitle !== undefined) {
    known.storyTitle = task.storyTitle;
  }
  if (task.status !== undefined) {
    known.status = task.status;
  }
  return known;
}

/** Adds (or refreshes) one task. */
export function rememberTask(tasks: readonly KnownTask[], task: KnownTask): KnownTask[] {
  const fresh = tidy(task);
  const index = tasks.findIndex((known) => known.taskId === task.taskId);
  if (index === -1) {
    return [...tasks, fresh];
  }
  return tasks.map((known, at) => (at === index ? fresh : known));
}

/** Forgets one task. Same reference when it was not known. */
export function forgetTask(tasks: readonly KnownTask[], taskId: string): readonly KnownTask[] {
  return tasks.some((known) => known.taskId === taskId)
    ? tasks.filter((known) => known.taskId !== taskId)
    : tasks;
}

/** What the reconcile needs to know about each of the agent's playthroughs. */
export type KnownSource = {
  taskId: string;
  storyId: string;
  storyTitle?: string;
  startedAt: number;
  status: TaskStatus;
};

function sameKnown(a: KnownTask, b: KnownTask): boolean {
  return (
    a.taskId === b.taskId &&
    a.storyId === b.storyId &&
    a.storyTitle === b.storyTitle &&
    a.startedAt === b.startedAt &&
    a.status === b.status
  );
}

/**
 * Reconciles the local list against the agent's playthroughs (the truth):
 * drops ids the agent no longer has, adopts ids it has that the list lacks
 * (another tab started them), and refreshes title/status. Returns the same
 * reference when nothing changed, so the page writes storage only on a
 * real change.
 */
export function reconcileKnownTasks(
  tasks: readonly KnownTask[],
  sources: Record<string, KnownSource>,
): readonly KnownTask[] {
  const next: KnownTask[] = [];
  for (const known of tasks) {
    const source = sources[known.taskId];
    if (source === undefined) {
      continue;
    }
    next.push(tidy({ ...known, ...source }));
  }
  const listed = new Set(next.map((known) => known.taskId));
  for (const source of Object.values(sources)) {
    if (!listed.has(source.taskId)) {
      next.push(tidy(source));
    }
  }
  const unchanged =
    next.length === tasks.length && next.every((known, at) => sameKnown(known, tasks[at] ?? known));
  return unchanged ? tasks : next;
}

/** A task with no status yet, or a non-terminal one, counts as running. */
export function isKnownRunning(task: KnownTask): boolean {
  return task.status === undefined || !isTerminalStatus(task.status);
}

const newestFirst = (a: KnownTask, b: KnownTask) => b.startedAt - a.startedAt;

/** Display order: running tasks first (newest first), finished ones below (newest first). */
export function orderKnownTasks(tasks: readonly KnownTask[]): KnownTask[] {
  return [
    ...tasks.filter(isKnownRunning).toSorted(newestFirst),
    ...tasks.filter((task) => !isKnownRunning(task)).toSorted(newestFirst),
  ];
}
