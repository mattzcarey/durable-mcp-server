import { describe, expect, it } from "vitest";
import { type DetailedTask, DetailedTaskSchema } from "../mcp-tasks/schema";
import {
  foldObservationInto,
  isRunning,
  liveSprites,
  LOG_MAX,
  markAbandon,
  markAction,
  markChoice,
  newPlaythrough,
  note,
  noteInto,
  observePlaythrough,
  type Playthrough,
  prunePlaythroughs,
  SPRITE_TTL_MS,
  unmarkAbandon,
  unmarkAction,
  unmarkChoice,
} from "./playthrough";
import { STATUS_META_KEY } from "./story-wire";
import type { TaskObservation } from "./tasks";

const SERVER_ID = "srv-1";
const TASK_ID = "3f2c8a54-6b1d-4f7e-9c3a-999999999999";
const T0 = Date.parse("2026-08-21T12:00:00Z");

const snapshot = (overrides: Record<string, unknown> = {}): DetailedTask =>
  DetailedTaskSchema.parse({
    taskId: TASK_ID,
    status: "working",
    createdAt: "2026-08-21T12:00:00Z",
    lastUpdatedAt: "2026-08-21T12:00:01Z",
    ttlMs: null,
    ...overrides,
  });

const meta = (status: Record<string, unknown>) => ({ _meta: { [STATUS_META_KEY]: status } });

const observed = (
  seq: number,
  task: DetailedTask,
  overrides: Partial<TaskObservation> = {},
): TaskObservation => ({
  serverId: SERVER_ID,
  taskId: TASK_ID,
  toolName: "start",
  seq,
  observedAt: T0 + seq * 1000,
  nextPollAt: T0 + seq * 1000 + 1000,
  task,
  ...overrides,
});

const apply = (
  playthrough: Playthrough,
  observation: TaskObservation,
  nowMs = observation.observedAt,
): Playthrough => observePlaythrough(playthrough, observation, nowMs);

const begun = newPlaythrough({
  taskId: TASK_ID,
  serverId: SERVER_ID,
  storyId: "odyssey",
  storyTitle: "The Odyssey",
  defaultScene: "story://odyssey/scenes/troy",
  status: "working",
  nowMs: T0,
});

const fork = (message: string, ids: string[]) => ({
  method: "elicitation/create",
  params: {
    message,
    requestedSchema: {
      type: "object",
      properties: { choice: { type: "string", enum: ids } },
      required: ["choice"],
    },
  },
});

describe("newPlaythrough", () => {
  it("records the task, the story, seeds the default scene, and starts empty", () => {
    expect(begun).toMatchObject({
      taskId: TASK_ID,
      serverId: SERVER_ID,
      storyId: "odyssey",
      storyTitle: "The Odyssey",
      startedAt: T0,
      status: "working",
      log: [],
      answeredForks: {},
      abandonRequested: false,
    });
    expect(begun.visual.scene).toBe("story://odyssey/scenes/troy");
    expect(begun.view).toBeUndefined();
    expect(isRunning(begun)).toBe(true);
  });

  it("leaves the stage dark when the manifest names no default scene", () => {
    const dark = newPlaythrough({
      taskId: "t",
      serverId: SERVER_ID,
      storyId: "x",
      defaultScene: "",
      status: "working",
      nowMs: T0,
    });
    expect(dark.visual.scene).toBeUndefined();
    expect(dark.storyTitle).toBeUndefined();
  });
});

describe("one playthrough per task", () => {
  it("narrates only its own task's snapshots — another task's beats never land here", () => {
    const state = apply(begun, observed(1, snapshot({ statusMessage: "First line." })));
    const other = apply(
      state,
      observed(1, snapshot({ taskId: "other", statusMessage: "Noise." }), { taskId: "other" }),
    );
    expect(other).toBe(state);
    expect(other.log.map((entry) => entry.kind)).toEqual(["beat"]);
  });

  it("lands a task that is terminal on first sight as an ending", () => {
    const ended = apply(
      begun,
      observed(
        1,
        snapshot({ status: "completed", result: { content: [{ type: "text", text: "Fin." }] } }),
      ),
    );
    expect(ended.status).toBe("completed");
    expect(isRunning(ended)).toBe(false);
    expect(ended.ending).toEqual({ endingId: "the-end", text: "Fin.", tone: "neutral" });
    expect(ended.log.at(-1)).toMatchObject({
      kind: "ending",
      endingId: "the-end",
      atMs: T0 + 1000,
    });
  });
});

describe("beats", () => {
  it("appends one log line per changed statusMessage, in arrival order, with the meta phase", () => {
    let state = apply(
      begun,
      observed(
        1,
        snapshot({ statusMessage: "We leave Troy burning.", ...meta({ phase: "troy" }) }),
      ),
    );
    state = apply(state, observed(2, snapshot({ statusMessage: "The Cicones fight back." })));
    state = apply(
      state,
      observed(3, snapshot({ statusMessage: "The Cicones fight back." }), {
        observedAt: T0 + 3500,
      }),
    );
    expect(state.log).toEqual([
      {
        kind: "beat",
        id: 1,
        seq: 1,
        text: "We leave Troy burning.",
        phase: "troy",
        atMs: T0 + 1000,
      },
      { kind: "beat", id: 2, seq: 2, text: "The Cicones fight back.", atMs: T0 + 2000 },
    ]);
    expect(state.status).toBe("working");
    expect(state.updatedAt).toBe(T0 + 3500);
  });

  it("returns the same playthrough for stale seqs, and only the poll clocks for a no-change poll", () => {
    const state = apply(begun, observed(2, snapshot({ statusMessage: "Line." })));
    expect(apply(state, observed(1, snapshot({ statusMessage: "Old." })))).toBe(state);
    const refreshed = apply(
      state,
      observed(2, snapshot({ statusMessage: "Line." }), { observedAt: T0 + 2500 }),
    );
    expect(refreshed.log).toBe(state.log);
    expect(refreshed.view?.polledAtMs).toBe(T0 + 2500);
    expect(refreshed.view?.observedAtMs).toBe(T0 + 2000);
  });

  it("unwraps v1 tags as fallbacks for phase and build", () => {
    const state = apply(
      begun,
      observed(1, snapshot({ statusMessage: "[gpus] Racks roll in. (build 45%)" })),
    );
    expect(state.log.at(0)).toMatchObject({ kind: "beat", text: "Racks roll in.", phase: "gpus" });
    expect(state.visual.phase).toBe("gpus");
    expect(state.visual.build).toBe(0.45);
  });

  it("ignores a pre-telemetry snapshot with no statusMessage", () => {
    const state = apply(begun, observed(1, snapshot()));
    expect(state.log).toEqual([]);
    expect(state.view?.status).toBe("working");
  });

  it("keeps the newest LOG_MAX lines, dropping the oldest first", () => {
    let state = begun;
    for (let seq = 1; seq <= LOG_MAX + 5; seq++) {
      state = apply(state, observed(seq, snapshot({ statusMessage: `beat ${seq}` })));
    }
    expect(state.log).toHaveLength(LOG_MAX);
    expect(state.log.at(0)).toMatchObject({ kind: "beat", text: "beat 6" });
    expect(state.log.at(-1)).toMatchObject({ kind: "beat", text: `beat ${LOG_MAX + 5}` });
    // Ids keep counting past the cap, so React keys never collide.
    expect(state.log.at(-1)?.id).toBe(LOG_MAX + 5);
  });
});

describe("visual state", () => {
  it("swaps the scene and pins persistent sprites until the next scene", () => {
    let state = apply(
      begun,
      observed(
        1,
        snapshot({
          statusMessage: "A one-eyed shape fills the cave mouth.",
          ...meta({
            scene: "story://odyssey/scenes/cave",
            sprite: { uri: "story://odyssey/sprites/cyclops", persist: true },
            phase: "polyphemus",
          }),
        }),
      ),
    );
    expect(state.visual.scene).toBe("story://odyssey/scenes/cave");
    expect(state.visual.sprites).toHaveLength(1);
    expect(state.visual.sprites.at(0)).toMatchObject({
      uri: "story://odyssey/sprites/cyclops",
      persist: true,
    });

    // The pinned sprite outlives SPRITE_TTL.
    expect(liveSprites(state.visual, T0 + 1000 + SPRITE_TTL_MS + 10)).toHaveLength(1);

    // A new scene clears the pinned sprite.
    state = apply(
      state,
      observed(
        2,
        snapshot({
          statusMessage: "Out to sea.",
          ...meta({ scene: "story://odyssey/scenes/boat" }),
        }),
      ),
    );
    expect(state.visual.sprites).toEqual([]);
    expect(state.visual.scene).toBe("story://odyssey/scenes/boat");
  });

  it("fades non-persistent sprites out after SPRITE_TTL_MS, read through liveSprites", () => {
    const state = apply(
      begun,
      observed(
        1,
        snapshot({
          statusMessage: "Bats!",
          ...meta({ sprite: { uri: "story://dc/sprites/bats" } }),
        }),
      ),
    );
    expect(state.visual.sprites).toHaveLength(1);
    expect(liveSprites(state.visual, T0 + 1000 + 2000)).toHaveLength(1);
    expect(liveSprites(state.visual, T0 + 1000 + SPRITE_TTL_MS)).toEqual([]);
  });

  it("fires a sprite once per new sprite object, never on a repeated meta", () => {
    const sprite = meta({ sprite: { uri: "story://odyssey/sprites/storm" } });
    let state = apply(begun, observed(1, snapshot({ statusMessage: "Clouds.", ...sprite })));
    state = apply(state, observed(2, snapshot({ statusMessage: "Wind.", ...sprite })));
    expect(state.visual.sprites).toHaveLength(1);
    expect(state.visual.spriteFirings).toBe(1);
    state = apply(state, observed(3, snapshot({ statusMessage: "Calm." })));
    state = apply(state, observed(4, snapshot({ statusMessage: "Clouds again.", ...sprite })));
    expect(state.visual.sprites).toHaveLength(2);
    expect(state.visual.spriteFirings).toBe(2);
    expect(new Set(state.visual.sprites.map((fired) => fired.id)).size).toBe(2);
  });

  it("drops expired faders from the record on the next firing, and never nudges on expiry or a scene change", () => {
    let state = apply(
      begun,
      observed(
        1,
        snapshot({
          statusMessage: "Bats!",
          ...meta({ sprite: { uri: "story://dc/sprites/bats", persist: true } }),
        }),
      ),
    );
    state = apply(
      state,
      observed(
        2,
        snapshot({
          statusMessage: "Fish!",
          ...meta({ sprite: { uri: "story://dc/sprites/fish" } }),
        }),
      ),
    );
    expect(state.visual.spriteFirings).toBe(2);
    // Long after the fish faded, a third firing drops it from the record;
    // the pinned bats remain.
    state = apply(
      state,
      observed(
        3,
        snapshot({
          statusMessage: "Owls!",
          ...meta({ sprite: { uri: "story://dc/sprites/owls" } }),
        }),
        { observedAt: T0 + 2000 + SPRITE_TTL_MS + 500 },
      ),
    );
    expect(state.visual.sprites.map((sprite) => sprite.uri)).toEqual([
      "story://dc/sprites/bats",
      "story://dc/sprites/owls",
    ]);
    expect(state.visual.spriteFirings).toBe(3);
    // A new scene clears every sprite — still no new firing.
    const moved = apply(
      state,
      observed(
        4,
        snapshot({ statusMessage: "Night.", ...meta({ scene: "story://dc/scenes/night" }) }),
      ),
    );
    expect(moved.visual.sprites).toEqual([]);
    expect(moved.visual.spriteFirings).toBe(3);
  });

  it("lights phases in first-sighting order and keeps build monotonic", () => {
    let state = apply(
      begun,
      observed(1, snapshot({ statusMessage: "a", ...meta({ phase: "site", build: 0.1 }) })),
    );
    state = apply(
      state,
      observed(2, snapshot({ statusMessage: "b", ...meta({ phase: "power", build: 0.3 }) })),
    );
    state = apply(
      state,
      observed(3, snapshot({ statusMessage: "c", ...meta({ phase: "site", build: 0.2 }) })),
    );
    expect(state.visual.phasesSeen).toEqual(["site", "power"]);
    expect(state.visual.phase).toBe("site");
    expect(state.visual.build).toBe(0.3);
  });

  it("replaces the ambient action set on each new key and unlocks a spent bar", () => {
    const actions = (key: string) =>
      meta({ actions: { key, options: [{ id: "consult-the-gods", label: "Consult the gods" }] } });
    let state = apply(
      begun,
      observed(1, snapshot({ statusMessage: "a", ...actions("actions-1") })),
    );
    expect(state.visual.actions?.key).toBe("actions-1");
    state = markAction(state, "actions-1", "Consult the gods", T0 + 1500);
    expect(state.spentActionKey).toBe("actions-1");
    expect(state.log.at(-1)).toMatchObject({ kind: "action", label: "Consult the gods" });
    // A beat without actions keeps the set; a fresh key replaces it.
    state = apply(state, observed(2, snapshot({ statusMessage: "b" })));
    expect(state.visual.actions?.key).toBe("actions-1");
    state = apply(state, observed(3, snapshot({ statusMessage: "c", ...actions("actions-2") })));
    expect(state.visual.actions?.key).toBe("actions-2");
    expect(state.spentActionKey).toBe("actions-1");
  });

  it("unlocks the bar again when a press failed to send", () => {
    let state = markAction(begun, "actions-1", "Consult the gods", T0);
    // A failure for some other key leaves the lock alone…
    state = unmarkAction(state, "actions-0", "stale", T0);
    expect(state.spentActionKey).toBe("actions-1");
    // …the pressed key's failure clears it, with a note.
    state = unmarkAction(state, "actions-1", "the story did not take it", T0);
    expect(state.spentActionKey).toBeUndefined();
    expect(state.log.at(-1)).toMatchObject({ kind: "note", text: "the story did not take it" });
  });
});

describe("forks", () => {
  const ask = snapshot({
    status: "input_required",
    statusMessage: "The crew eyes the bag.",
    inputRequests: {
      "bag-of-winds": fork(
        "The crew reaches for Aeolus's bag. Stop them?\n- stop: Stop them\n- sleep: Sleep on",
        ["stop", "sleep"],
      ),
    },
  });

  it("logs the fork once with its options, opens it on the playthrough, and 'you chose' on an answer", () => {
    let state = apply(begun, observed(1, ask));
    state = apply(state, observed(2, ask, { observedAt: T0 + 2500 }));
    expect(state.log.filter((entry) => entry.kind === "fork")).toHaveLength(1);
    expect(state.log.at(-1)).toMatchObject({
      kind: "fork",
      key: "bag-of-winds",
      scene: "The crew reaches for Aeolus's bag. Stop them?",
      options: [
        { id: "stop", label: "Stop them" },
        { id: "sleep", label: "Sleep on" },
      ],
    });
    // The open ask rides the playthrough, anchored to when it was first seen.
    expect(state.openFork).toMatchObject({ key: "bag-of-winds", sinceMs: T0 + 1000 });
    state = markChoice(state, "bag-of-winds", "Stop them", T0 + 3000);
    expect(state.answeredForks).toEqual({ "bag-of-winds": "Stop them" });
    expect(state.log.at(-1)).toMatchObject({ kind: "choice", label: "Stop them" });
    // The server moves on: no fate line, because we answered; the ask closes.
    state = apply(state, observed(3, snapshot({ statusMessage: "You stop them in time." })));
    expect(state.log.map((entry) => entry.kind)).toEqual(["beat", "fork", "choice", "beat"]);
    expect(state.openFork).toBeUndefined();
  });

  it("logs 'fate decided' when the task leaves an ask nobody answered", () => {
    let state = apply(begun, observed(1, ask));
    state = apply(
      state,
      observed(2, snapshot({ statusMessage: "The bag is opened. The winds howl." })),
    );
    expect(state.log.map((entry) => entry.kind)).toEqual(["beat", "fork", "fate", "beat"]);
    expect(state.log.at(2)).toMatchObject({ kind: "fate", key: "bag-of-winds" });
  });

  it("reopens the ask when the answer failed to send", () => {
    let state = apply(begun, observed(1, ask));
    state = markChoice(state, "bag-of-winds", "Stop them", T0);
    state = unmarkChoice(state, "bag-of-winds", "the ask had already closed", T0);
    expect(state.answeredForks).toEqual({});
    expect(state.log.at(-1)).toMatchObject({ kind: "note", text: "the ask had already closed" });
  });
});

describe("endings", () => {
  it("parses a completed [ending:id] result into a toned card with the final scene", () => {
    let state = apply(begun, observed(1, snapshot({ statusMessage: "Ithaca on the horizon." })));
    state = apply(
      state,
      observed(
        2,
        snapshot({
          status: "completed",
          result: {
            content: [{ type: "text", text: "[ending:home-at-last] The suitors are gone." }],
          },
          ...meta({ scene: "story://odyssey/scenes/ithaca", actions: { key: "a", options: [] } }),
        }),
      ),
    );
    expect(state.ending).toEqual({
      endingId: "home-at-last",
      text: "The suitors are gone.",
      tone: "triumph",
      scene: "story://odyssey/scenes/ithaca",
    });
    expect(state.log.at(-1)).toMatchObject({ kind: "ending", endingId: "home-at-last" });
    expect(state.visual.actions).toBeUndefined();
    expect(state.status).toBe("completed");
  });

  it("reads an isError result as a disaster and an unprefixed text as the-end", () => {
    const error = apply(
      begun,
      observed(
        1,
        snapshot({
          status: "completed",
          result: { isError: true, content: [{ type: "text", text: "unknown story" }] },
        }),
      ),
    );
    expect(error.ending).toEqual({ endingId: "error", text: "unknown story", tone: "disaster" });

    let state = apply(begun, observed(1, snapshot({ statusMessage: "…" })));
    state = apply(
      state,
      observed(
        2,
        snapshot({ status: "completed", result: { content: [{ type: "text", text: "Fin." }] } }),
      ),
    );
    expect(state.ending).toEqual({ endingId: "the-end", text: "Fin.", tone: "neutral" });
  });

  it("turns cancelled and failed into endings, not errors", () => {
    let state = apply(begun, observed(1, snapshot({ statusMessage: "…" })));
    state = markAbandon(state, T0 + 1500);
    expect(state.abandonRequested).toBe(true);
    const cancelled = apply(state, observed(2, snapshot({ status: "cancelled" })));
    expect(cancelled.ending).toMatchObject({ endingId: "abandoned", tone: "abandoned" });

    // A cancel that never reached the server re-arms the button.
    const failedCancel = unmarkAbandon(state, "cancel failed", T0 + 1600);
    expect(failedCancel.abandonRequested).toBe(false);
    expect(failedCancel.log.at(-1)).toMatchObject({ kind: "note", text: "cancel failed" });
    expect(failedCancel.ending).toBeUndefined();

    const failed = apply(
      apply(begun, observed(1, snapshot({ statusMessage: "…" }))),
      observed(
        2,
        snapshot({ status: "failed", error: { code: -32000, message: "engine stalled" } }),
      ),
    );
    expect(failed.ending).toEqual({ endingId: "failed", text: "engine stalled", tone: "disaster" });
  });
});

describe("the map: every observation folds into ITS task's playthrough", () => {
  const other = newPlaythrough({
    taskId: "other",
    serverId: SERVER_ID,
    storyId: "datacenter",
    status: "working",
    nowMs: T0,
  });
  const observedFor = (taskId: string, seq: number, text: string): TaskObservation =>
    observed(seq, snapshot({ taskId, statusMessage: text }), { taskId });

  it("keeps two running tasks' logs disjoint however their polls interleave", () => {
    // An older story (begun) and a newer one (other) polled turn and turn
    // about — the way the agent's two watches fire — with seqs per watch.
    let map: Record<string, Playthrough> = { [TASK_ID]: begun, other };
    map = foldObservationInto(map, observedFor(TASK_ID, 1, "We leave Troy burning."));
    map = foldObservationInto(map, observedFor("other", 1, "Survey stakes go in at dawn."));
    map = foldObservationInto(map, observedFor(TASK_ID, 2, "The Cicones fight back."));
    map = foldObservationInto(map, observedFor("other", 2, "Permits clear."));
    map = foldObservationInto(map, observedFor(TASK_ID, 3, "We row for open sea."));
    const texts = (taskId: string) =>
      map[taskId]?.log.map((entry) => (entry.kind === "beat" ? entry.text : entry.kind));
    expect(texts(TASK_ID)).toEqual([
      "We leave Troy burning.",
      "The Cicones fight back.",
      "We row for open sea.",
    ]);
    expect(texts("other")).toEqual(["Survey stakes go in at dawn.", "Permits clear."]);
  });

  it("folds nowhere for a task without a playthrough, and is the same map when nothing changed", () => {
    const map = { [TASK_ID]: begun };
    expect(foldObservationInto(map, observedFor("unknown", 1, "Noise."))).toBe(map);
    const once = foldObservationInto(map, observedFor(TASK_ID, 1, "Line."));
    expect(once).not.toBe(map);
    // The same observation again (a replay) changes nothing.
    expect(foldObservationInto(once, observedFor(TASK_ID, 1, "Line."))).toBe(once);
    // The other entries keep their references.
    const two = { [TASK_ID]: begun, other };
    const folded = foldObservationInto(two, observedFor(TASK_ID, 1, "Line."));
    expect(folded.other).toBe(other);
  });

  it("notes into one task's playthrough only", () => {
    const map = { [TASK_ID]: begun, other };
    const noted = noteInto(map, "other", "stopped watching", T0 + 5);
    expect(noted.other?.log).toEqual([
      { kind: "note", id: 1, text: "stopped watching", atMs: T0 + 5 },
    ]);
    expect(noted[TASK_ID]).toBe(begun);
    expect(noteInto(map, "unknown", "lost", T0)).toBe(map);
  });
});

describe("notes and the map", () => {
  it("appends a note line", () => {
    const noted = note(begun, "art missing: story://x", T0 + 10);
    expect(noted.log).toEqual([
      { kind: "note", id: 1, text: "art missing: story://x", atMs: T0 + 10 },
    ]);
  });

  it("a restart is a NEW playthrough under a new task id; the old one stays", () => {
    const ended = apply(
      begun,
      observed(
        1,
        snapshot({ status: "completed", result: { content: [{ type: "text", text: "Fin." }] } }),
      ),
    );
    const again = newPlaythrough({
      taskId: "second-run",
      serverId: SERVER_ID,
      storyId: ended.storyId,
      defaultScene: "story://odyssey/scenes/troy",
      status: "working",
      nowMs: T0 + 9000,
    });
    const map = { [ended.taskId]: ended, [again.taskId]: again };
    expect(Object.keys(map)).toEqual([TASK_ID, "second-run"]);
    expect(map[TASK_ID]?.ending).toBeDefined();
    expect(map["second-run"]?.log).toEqual([]);
    expect(map["second-run"]?.storyId).toBe("odyssey");
  });

  it("prunes the oldest finished playthroughs past the cap, never a running one", () => {
    const finished = (taskId: string, startedAt: number) =>
      apply(
        newPlaythrough({
          taskId,
          serverId: SERVER_ID,
          storyId: "x",
          status: "working",
          nowMs: startedAt,
        }),
        observed(1, snapshot({ taskId, status: "cancelled" }), { taskId }),
      );
    const running = newPlaythrough({
      taskId: "live",
      serverId: SERVER_ID,
      storyId: "x",
      status: "working",
      nowMs: T0 - 99_000,
    });
    const map = {
      live: running,
      a: finished("a", T0 - 3000),
      b: finished("b", T0 - 2000),
      c: finished("c", T0 - 1000),
    };
    expect(prunePlaythroughs(map, 4)).toBe(map);
    expect(Object.keys(prunePlaythroughs(map, 2))).toEqual(["live", "c"]);
    // Only running ones left to drop: nothing is dropped.
    expect(prunePlaythroughs({ live: running }, 0)).toEqual({ live: running });
  });
});
