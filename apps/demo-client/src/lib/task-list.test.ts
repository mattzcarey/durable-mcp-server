import { describe, expect, it } from "vitest";
import {
  forgetTask,
  isKnownRunning,
  type KnownTask,
  orderKnownTasks,
  parseKnownTasks,
  reconcileKnownTasks,
  rememberTask,
  serializeKnownTasks,
} from "./task-list";

const T0 = Date.parse("2026-08-22T09:00:00Z");

const known = (taskId: string, overrides: Partial<KnownTask> = {}): KnownTask => ({
  taskId,
  storyId: "odyssey",
  storyTitle: "The Odyssey",
  startedAt: T0,
  ...overrides,
});

describe("parse / serialize", () => {
  it("round-trips a list through storage, dropping undefined optionals", () => {
    const list = [known("a"), known("b", { status: "completed", storyTitle: undefined })];
    const raw = serializeKnownTasks(list);
    expect(raw).not.toContain("undefined");
    expect(parseKnownTasks(raw)).toEqual([
      { taskId: "a", storyId: "odyssey", storyTitle: "The Odyssey", startedAt: T0 },
      { taskId: "b", storyId: "odyssey", startedAt: T0, status: "completed" },
    ]);
  });

  it("reads nothing, garbage, and malformed entries as an empty list", () => {
    expect(parseKnownTasks(null)).toEqual([]);
    expect(parseKnownTasks("not json")).toEqual([]);
    expect(parseKnownTasks('{"taskId":"a"}')).toEqual([]);
    expect(parseKnownTasks('[{"taskId":"a"}]')).toEqual([]);
    expect(parseKnownTasks('[{"taskId":"a","storyId":"x","startedAt":1,"status":"odd"}]')).toEqual(
      [],
    );
  });
});

describe("remember / forget", () => {
  it("appends a new task and refreshes a known one in place", () => {
    const one = rememberTask([], known("a"));
    const two = rememberTask(one, known("b"));
    expect(two.map((task) => task.taskId)).toEqual(["a", "b"]);
    const refreshed = rememberTask(two, known("a", { status: "working" }));
    expect(refreshed.map((task) => task.taskId)).toEqual(["a", "b"]);
    expect(refreshed.at(0)?.status).toBe("working");
  });

  it("forgets a task, and is reference-stable for an unknown id", () => {
    const list = [known("a"), known("b")];
    expect(forgetTask(list, "a").map((task) => task.taskId)).toEqual(["b"]);
    expect(forgetTask(list, "zzz")).toBe(list);
  });
});

describe("reconcileKnownTasks — the agent's playthroughs are the truth", () => {
  const sources = {
    a: {
      taskId: "a",
      storyId: "odyssey",
      storyTitle: "The Odyssey",
      startedAt: T0,
      status: "working" as const,
    },
    c: { taskId: "c", storyId: "datacenter", startedAt: T0 + 5, status: "completed" as const },
  };

  it("drops local ids the agent no longer has, adopts the agent's, refreshes status", () => {
    const local = [known("a"), known("b")];
    const next = reconcileKnownTasks(local, sources);
    expect(next).toEqual([
      {
        taskId: "a",
        storyId: "odyssey",
        storyTitle: "The Odyssey",
        startedAt: T0,
        status: "working",
      },
      { taskId: "c", storyId: "datacenter", startedAt: T0 + 5, status: "completed" },
    ]);
  });

  it("returns the same reference when nothing changed, so storage is written only on change", () => {
    const local = [
      known("a", { status: "working" }),
      { taskId: "c", storyId: "datacenter", startedAt: T0 + 5, status: "completed" as const },
    ];
    expect(reconcileKnownTasks(local, sources)).toBe(local);
  });

  it("empties the list when the agent has no playthroughs", () => {
    expect(reconcileKnownTasks([known("a")], {})).toEqual([]);
  });
});

describe("order", () => {
  it("lists running tasks first (newest first), finished ones below (newest first)", () => {
    const list = [
      known("done-old", { startedAt: T0 - 10, status: "completed" }),
      known("run-old", { startedAt: T0 - 5, status: "working" }),
      known("done-new", { startedAt: T0 + 10, status: "cancelled" }),
      known("run-new", { startedAt: T0 + 5, status: "input_required" }),
      known("fresh", { startedAt: T0 + 1 }), // no status yet: still running
    ];
    expect(orderKnownTasks(list).map((task) => task.taskId)).toEqual([
      "run-new",
      "fresh",
      "run-old",
      "done-new",
      "done-old",
    ]);
    expect(isKnownRunning(known("x"))).toBe(true);
    expect(isKnownRunning(known("x", { status: "failed" }))).toBe(false);
  });
});
