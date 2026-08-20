import { describe, expect, it } from "vitest";
import { type DetailedTask, DetailedTaskSchema } from "../mcp-tasks/schema";
import {
  elapsedMs,
  isPollOverdue,
  isStaleSnapshot,
  nextPollCountdownMs,
  observeTask,
  type TaskObservation,
  type TaskView,
  TELEMETRY_META_KEY,
} from "./tasks";

const SERVER_ID = "srv-1";
const TASK_ID = "3f2c8a54-6b1d-4f7e-9c3a-222222222222";

const CREATED_AT = "2026-08-20T10:00:00Z";
const CREATED_AT_MS = Date.parse(CREATED_AT);

const workingTask = (overrides: Record<string, unknown> = {}): DetailedTask =>
  DetailedTaskSchema.parse({
    taskId: TASK_ID,
    status: "working",
    createdAt: CREATED_AT,
    lastUpdatedAt: "2026-08-20T10:00:01Z",
    ttlMs: null,
    ...overrides,
  });

const observed = (
  seq: number,
  task: DetailedTask,
  overrides: Partial<TaskObservation> = {},
): TaskObservation => ({
  serverId: SERVER_ID,
  taskId: TASK_ID,
  seq,
  observedAt: CREATED_AT_MS + seq * 1000,
  task,
  ...overrides,
});

const telemetry = (data: Record<string, unknown>) => ({
  _meta: { [TELEMETRY_META_KEY]: data },
});

describe("isStaleSnapshot — overlapping polls land in either order", () => {
  const older = workingTask({ lastUpdatedAt: "2026-08-20T10:00:01.000Z", statusMessage: "ask" });
  const newer = workingTask({ lastUpdatedAt: "2026-08-20T10:00:01.250Z", statusMessage: "moved" });

  it("reads an older lastUpdatedAt as stale against the one persisted, never the reverse", () => {
    expect(isStaleSnapshot(older, newer)).toBe(true);
    expect(isStaleSnapshot(newer, older)).toBe(false);
    expect(isStaleSnapshot(newer, newer)).toBe(false); // a tie is a no-change poll
  });

  it("is never stale against nothing, or an unparseable timestamp", () => {
    expect(isStaleSnapshot(older, undefined)).toBe(false);
    expect(isStaleSnapshot(older, workingTask({ lastUpdatedAt: "not a date" }))).toBe(false);
    expect(isStaleSnapshot(workingTask({ lastUpdatedAt: "not a date" }), newer)).toBe(false);
  });
});

describe("observeTask", () => {
  it("creates a view from the first observed snapshot", () => {
    const view = observeTask(
      undefined,
      observed(1, workingTask({ statusMessage: "crunching", pollIntervalMs: 500 }), {
        toolName: "start",
        nextPollAt: CREATED_AT_MS + 1500,
      }),
    );

    expect(view).toMatchObject({
      serverId: SERVER_ID,
      taskId: TASK_ID,
      toolName: "start",
      status: "working",
      statusMessage: "crunching",
      seq: 1,
      updates: 1,
      createdAtMs: CREATED_AT_MS,
      lastUpdatedAtMs: Date.parse("2026-08-20T10:00:01Z"),
      nextPollAtMs: CREATED_AT_MS + 1500,
      pollIntervalMs: 500,
      terminal: false,
    });
    expect(view.progress).toBeUndefined();
  });

  it("treats a null statusMessage as pre-telemetry — no message on the view", () => {
    // Null until the task's first step.status call (no auto-narration).
    const view = observeTask(undefined, observed(1, workingTask({ statusMessage: null })));
    expect(view.status).toBe("working");
    expect(view.statusMessage).toBeUndefined();
  });

  it("drops stale and duplicate observations by seq, returning the same reference", () => {
    const first = observeTask(undefined, observed(2, workingTask()));
    const replay = observeTask(first, observed(2, workingTask({ statusMessage: "late" })));
    const older = observeTask(first, observed(1, workingTask()));

    expect(replay).toBe(first);
    expect(older).toBe(first);
  });

  it("refreshes poll bookkeeping from an equal-seq no-change poll", () => {
    // A poll that observes nothing new keeps the seq but carries a fresher
    // observedAt/nextPollAt — how "poll now" and the last-poll readout stay
    // live between changes.
    const first = observeTask(
      undefined,
      observed(2, workingTask({ statusMessage: "The crew sets sail." }), {
        nextPollAt: CREATED_AT_MS + 3000,
      }),
    );
    const view = observeTask(
      first,
      observed(2, workingTask({ statusMessage: "stale content is ignored" }), {
        observedAt: CREATED_AT_MS + 5000,
        nextPollAt: CREATED_AT_MS + 5500,
      }),
    );

    expect(view.polledAtMs).toBe(CREATED_AT_MS + 5000);
    expect(view.nextPollAtMs).toBe(CREATED_AT_MS + 5500);
    // The snapshot itself is unchanged: content stays as first observed, and
    // observedAtMs stays anchored (a crisis countdown must not reset).
    expect(view.statusMessage).toBe("The crew sets sail.");
    expect(view.observedAtMs).toBe(CREATED_AT_MS + 2000);
    expect(view.seq).toBe(2);
    expect(view.updates).toBe(2);
  });

  it("drops an equal-seq observation that is not a fresher poll", () => {
    const first = observeTask(undefined, observed(2, workingTask()));
    const sameInstant = observeTask(first, observed(2, workingTask()));
    const older = observeTask(
      first,
      observed(2, workingTask(), { observedAt: CREATED_AT_MS + 1500 }),
    );

    expect(sameInstant).toBe(first);
    expect(older).toBe(first);
  });

  it("anchors both poll and observation clocks on a real state change", () => {
    const view = observeTask(undefined, observed(1, workingTask()));
    expect(view.polledAtMs).toBe(CREATED_AT_MS + 1000);
    expect(view.observedAtMs).toBe(CREATED_AT_MS + 1000);
  });

  it("anchors statusSinceMs to the FIRST observation of the current status", () => {
    // A new snapshot (new seq) that keeps the status — a beat landing during
    // a crisis ask — must not restart the fate countdown.
    const inputTask = (statusMessage: string) =>
      workingTask({
        status: "input_required",
        statusMessage,
        inputRequests: { "bag-of-winds": { method: "elicitation/create" } },
      });
    let view = observeTask(undefined, observed(1, workingTask()));
    view = observeTask(view, observed(2, inputTask("The crew eyes the bag.")));
    view = observeTask(
      view,
      observed(3, inputTask("The crew reaches for the bag."), {
        observedAt: CREATED_AT_MS + 3000,
      }),
    );
    expect(view.observedAtMs).toBe(CREATED_AT_MS + 3000);
    expect(view.statusSinceMs).toBe(CREATED_AT_MS + 2000);

    // Leaving and re-entering the status re-anchors it.
    view = observeTask(
      view,
      observed(4, workingTask({ statusMessage: "The winds escape." }), {
        observedAt: CREATED_AT_MS + 4000,
      }),
    );
    expect(view.statusSinceMs).toBe(CREATED_AT_MS + 4000);
  });

  it("re-anchors statusSinceMs when one ask follows another with the gap unobserved", () => {
    const ask = (key: string) =>
      workingTask({
        status: "input_required",
        statusMessage: key,
        inputRequests: { [key]: { method: "elicitation/create" } },
      });
    let view = observeTask(undefined, observed(1, ask("bag-of-winds")));
    view = observeTask(
      view,
      observed(2, ask("scylla-or-charybdis"), { observedAt: CREATED_AT_MS + 9000 }),
    );
    // Same status, different ask: the new fork's clock starts now, not at the old one.
    expect(view.statusSinceMs).toBe(CREATED_AT_MS + 9000);
    // The same ask on a later snapshot keeps its anchor.
    view = observeTask(
      view,
      observed(3, ask("scylla-or-charybdis"), { observedAt: CREATED_AT_MS + 10_000 }),
    );
    expect(view.statusSinceMs).toBe(CREATED_AT_MS + 9000);
  });

  it("counts distinct updates", () => {
    let view = observeTask(undefined, observed(1, workingTask()));
    view = observeTask(view, observed(2, workingTask({ statusMessage: "half way" })));
    view = observeTask(view, observed(3, workingTask({ statusMessage: "nearly" })));

    expect(view.updates).toBe(3);
  });

  it("lands a mid-game first sight at the true count — updates derives from seq", () => {
    const rebuilt = observeTask(undefined, observed(7, workingTask()));
    expect(rebuilt.updates).toBe(7);

    // A seq gap catches the counter up instead of undercounting.
    let view = observeTask(undefined, observed(1, workingTask()));
    view = observeTask(view, observed(4, workingTask({ statusMessage: "back online" })));
    expect(view.updates).toBe(4);
  });

  it("derives a progress fraction from telemetry step counts", () => {
    const view = observeTask(
      undefined,
      observed(1, workingTask(telemetry({ stepsCompleted: 3, stepsTotal: 4 }))),
    );

    expect(view.progress).toBe(0.75);
    expect(view.rawProgress).toBe(0.75);
  });

  it("clamps displayed progress to the max seen when a replayed step regresses", () => {
    let view = observeTask(
      undefined,
      observed(1, workingTask(telemetry({ stepsCompleted: 3, stepsTotal: 4 }))),
    );
    view = observeTask(
      view,
      observed(2, workingTask(telemetry({ stepsCompleted: 2, stepsTotal: 4 }))),
    );

    expect(view.progress).toBe(0.75); // shown position never drives backwards
    expect(view.rawProgress).toBe(0.5); // the regression stays visible
  });

  it("parses telemetry sleepUntil into epoch ms", () => {
    const view = observeTask(
      undefined,
      observed(1, workingTask(telemetry({ sleepUntil: "2026-08-20T10:05:00Z" }))),
    );
    expect(view.sleepUntilMs).toBe(Date.parse("2026-08-20T10:05:00Z"));
  });

  it("captures inputRequests while input_required", () => {
    const task = workingTask({
      status: "input_required",
      inputRequests: { "elicit-1": { method: "elicitation/create" } },
    });
    const view = observeTask(undefined, observed(1, task));

    expect(view.status).toBe("input_required");
    expect(Object.keys(view.inputRequests ?? {})).toEqual(["elicit-1"]);
  });

  it("marks completed terminal with the result inlined, reaching the finish line in fraction mode", () => {
    let view = observeTask(
      undefined,
      observed(1, workingTask(telemetry({ stepsCompleted: 1, stepsTotal: 2 }))),
    );
    view = observeTask(
      view,
      observed(2, workingTask({ status: "completed", result: { content: [] } })),
    );

    expect(view).toMatchObject({ terminal: true, result: { content: [] }, progress: 1 });
  });

  it("invents no progress on completion without telemetry", () => {
    let view = observeTask(undefined, observed(1, workingTask()));
    view = observeTask(
      view,
      observed(2, workingTask({ status: "completed", result: { content: [] } })),
    );

    expect(view.terminal).toBe(true);
    expect(view.progress).toBeUndefined();
  });

  it("marks failed terminal with the JSON-RPC error inlined", () => {
    const view = observeTask(
      undefined,
      observed(1, workingTask({ status: "failed", error: { code: -32603, message: "boom" } })),
    );
    expect(view).toMatchObject({ terminal: true, error: { code: -32603, message: "boom" } });
  });

  it("keeps the tool name across later observations that omit it", () => {
    let view = observeTask(undefined, observed(1, workingTask(), { toolName: "start" }));
    view = observeTask(view, observed(2, workingTask({ statusMessage: "still going" })));

    expect(view.toolName).toBe("start");
  });

  it("falls back to observedAt when a timestamp is unparseable", () => {
    const view = observeTask(undefined, observed(1, workingTask({ createdAt: "not-a-date" })));
    expect(view.createdAtMs).toBe(CREATED_AT_MS + 1000);
  });
});

const view = (overrides: Partial<TaskView> = {}): TaskView => ({
  serverId: SERVER_ID,
  taskId: TASK_ID,
  status: "working",
  seq: 1,
  updates: 1,
  createdAtMs: CREATED_AT_MS,
  lastUpdatedAtMs: CREATED_AT_MS + 1000,
  observedAtMs: CREATED_AT_MS + 1000,
  statusSinceMs: CREATED_AT_MS + 1000,
  polledAtMs: CREATED_AT_MS + 1000,
  terminal: false,
  ...overrides,
});

describe("elapsedMs", () => {
  it("runs with the clock while the task is live", () => {
    expect(elapsedMs(view(), CREATED_AT_MS + 42_000)).toBe(42_000);
  });

  it("freezes at the final update once terminal", () => {
    const done = view({
      status: "completed",
      terminal: true,
      lastUpdatedAtMs: CREATED_AT_MS + 5000,
    });
    expect(elapsedMs(done, CREATED_AT_MS + 60_000)).toBe(5000);
  });

  it("never goes negative on clock skew", () => {
    expect(elapsedMs(view(), CREATED_AT_MS - 1000)).toBe(0);
  });
});

describe("nextPollCountdownMs", () => {
  it("counts down to the scheduled poll", () => {
    const v = view({ nextPollAtMs: CREATED_AT_MS + 3000 });
    expect(nextPollCountdownMs(v, CREATED_AT_MS + 1000)).toBe(2000);
  });

  it("clamps at zero when the poll is overdue", () => {
    const v = view({ nextPollAtMs: CREATED_AT_MS + 3000 });
    expect(nextPollCountdownMs(v, CREATED_AT_MS + 9000)).toBe(0);
  });

  it("is undefined when nothing more will be polled", () => {
    expect(nextPollCountdownMs(view(), CREATED_AT_MS)).toBeUndefined();
    const done = view({ terminal: true, nextPollAtMs: CREATED_AT_MS + 3000 });
    expect(nextPollCountdownMs(done, CREATED_AT_MS)).toBeUndefined();
  });
});

describe("isPollOverdue", () => {
  it("flags a live task whose expected poll time has passed", () => {
    const v = view({ nextPollAtMs: CREATED_AT_MS + 3000 });
    expect(isPollOverdue(v, CREATED_AT_MS + 2000)).toBe(false);
    expect(isPollOverdue(v, CREATED_AT_MS + 4000)).toBe(true);
  });

  it("never flags terminal tasks", () => {
    const done = view({ terminal: true, nextPollAtMs: CREATED_AT_MS + 3000 });
    expect(isPollOverdue(done, CREATED_AT_MS + 9000)).toBe(false);
  });
});
