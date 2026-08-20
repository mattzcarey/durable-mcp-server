/**
 * The materialized playthrough: ONE per task, keyed by taskId. The agent
 * folds every snapshot its watch observes into that task's playthrough
 * (beats, forks, choices, fate, ambient actions, endings — arrival order)
 * and the visual state the stage renders from (scene, sprites, phase,
 * build, ambient actions), persists it, and the page reads it as-is for the
 * task in the URL. No shared reducer, no self-binding, no replay: a
 * playthrough only ever sees its own task's snapshots.
 *
 * Pure and reference-stable: no React, no DOM, no I/O; "now" is always
 * passed in, and anything that changes nothing returns the same object.
 *
 * Future work (not built): the log could store pointers (seq + the
 * agent's snapshot) instead of materialized lines to save space; an
 * extension of this module, not a change to its shape.
 */
import { isTerminalStatus, type TaskStatus } from "../mcp-tasks/schema";
import {
  type ActionSet,
  endingTone,
  type EndingTone,
  findFork,
  type Fork,
  type ForkOption,
  parseBeat,
  parseEnding,
  readStatusMeta,
  resultText,
} from "./story-wire";
import { observeTask, type TaskObservation, type TaskView } from "./tasks";

/** How long a non-persistent sprite overlays the scene before it fades out. */
export const SPRITE_TTL_MS = 6000;

/**
 * Log lines kept per playthrough (the datacenter runs ~210 beats; forks,
 * choices, and notes ride along). The oldest lines drop first.
 */
export const LOG_MAX = 500;

export type LogEntry =
  | { kind: "beat"; id: number; seq: number; text: string; phase?: string; atMs: number }
  | { kind: "fork"; id: number; key: string; scene: string; options: ForkOption[]; atMs: number }
  | { kind: "choice"; id: number; key: string; label: string; atMs: number }
  | { kind: "fate"; id: number; key: string; atMs: number }
  | { kind: "action"; id: number; key: string; label: string; atMs: number }
  | { kind: "note"; id: number; text: string; atMs: number }
  | { kind: "ending"; id: number; endingId: string; text: string; tone: EndingTone; atMs: number };

/** A log entry before it is numbered. */
type LogEntryInput = LogEntry extends infer E
  ? E extends LogEntry
    ? Omit<E, "id">
    : never
  : never;

export type Sprite = {
  /** Unique per firing, so the same art can fire twice. */
  id: string;
  uri: string;
  persist: boolean;
  sinceMs: number;
};

export type Visual = {
  /** Current scene resource URI (the stage crossfades when it changes). */
  scene?: string;
  /** Every sprite fired since the last scene change; `liveSprites` expires them. */
  sprites: Sprite[];
  /** Current manifest phase id. */
  phase?: string;
  /** Every phase seen so far, in first-sighting order — lights the checklist. */
  phasesSeen: string[];
  /** Build fraction 0..1, monotonic (a replayed lower value never regresses it). */
  build: number;
  /** The latest ambient action set; each new key replaces it. */
  actions?: ActionSet;
  /** Change detection for sprite firings across snapshots. */
  lastSpriteKey?: string;
  /**
   * How many sprites have fired this playthrough. Increments only on a
   * firing (never on expiry or a scene change), so the stage can nudge on
   * each new sprite and stay still when one merely fades out.
   */
  spriteFirings: number;
};

export type EndingCardModel = {
  endingId: string;
  text: string;
  tone: EndingTone;
  /** Art for the card: the final meta's scene when present. */
  scene?: string;
};

/** The open ask, with the clock it is anchored to (the crisis countdown). */
export type OpenFork = Fork & { sinceMs: number };

export type Playthrough = {
  taskId: string;
  serverId: string;
  storyId: string;
  /** The manifest title at start, so the list reads well before the shelf loads. */
  storyTitle?: string;
  startedAt: number;
  /** The last observed task status (the create result's until the first poll). */
  status: TaskStatus;
  /** The last observed task view (poll clocks, the ask). Absent until the first poll lands. */
  view?: TaskView;
  log: LogEntry[];
  visual: Visual;
  /** The outstanding fork while the task is `input_required`. */
  openFork?: OpenFork;
  /** Fork keys answered (key -> chosen label), pending or taken by the server. */
  answeredForks: Record<string, string>;
  /** The ambient action key already pressed; locks the bar until a fresh key. */
  spentActionKey?: string;
  ending?: EndingCardModel;
  /** A cancel was requested; the cancelled ending is expected, not a surprise. */
  abandonRequested: boolean;
  /** Epoch ms of the last fold. */
  updatedAt: number;
  nextId: number;
};

const EMPTY_VISUAL: Visual = { sprites: [], phasesSeen: [], build: 0, spriteFirings: 0 };

export type NewPlaythrough = {
  taskId: string;
  serverId: string;
  storyId: string;
  storyTitle?: string;
  /** The manifest's default scene, shown until the first meta names one. */
  defaultScene?: string;
  /** The status the create result reported. */
  status: TaskStatus;
  nowMs: number;
};

/** A fresh playthrough for a task that was just created. */
export function newPlaythrough(input: NewPlaythrough): Playthrough {
  const visual: Visual = { ...EMPTY_VISUAL };
  if (input.defaultScene !== undefined && input.defaultScene !== "") {
    visual.scene = input.defaultScene;
  }
  const playthrough: Playthrough = {
    taskId: input.taskId,
    serverId: input.serverId,
    storyId: input.storyId,
    startedAt: input.nowMs,
    status: input.status,
    log: [],
    visual,
    answeredForks: {},
    abandonRequested: false,
    updatedAt: input.nowMs,
    nextId: 1,
  };
  if (input.storyTitle !== undefined) {
    playthrough.storyTitle = input.storyTitle;
  }
  return playthrough;
}

/** Appends one numbered entry, dropping the oldest past LOG_MAX. */
function append(playthrough: Playthrough, entry: LogEntryInput): Playthrough {
  const log = [...playthrough.log, { ...entry, id: playthrough.nextId }];
  return {
    ...playthrough,
    log: log.length > LOG_MAX ? log.slice(log.length - LOG_MAX) : log,
    nextId: playthrough.nextId + 1,
  };
}

/** A local system line (errors, a watch that stopped, …). */
export function note(playthrough: Playthrough, text: string, nowMs: number): Playthrough {
  return { ...append(playthrough, { kind: "note", text, atMs: nowMs }), updatedAt: nowMs };
}

/** The player answered a fork (the tasks/update is in flight). */
export function markChoice(
  playthrough: Playthrough,
  key: string,
  label: string,
  nowMs: number,
): Playthrough {
  return {
    ...append(playthrough, { kind: "choice", key, label, atMs: nowMs }),
    answeredForks: { ...playthrough.answeredForks, [key]: label },
    updatedAt: nowMs,
  };
}

/** The fork answer failed to send: reopen the ask and say so. */
export function unmarkChoice(
  playthrough: Playthrough,
  key: string,
  text: string,
  nowMs: number,
): Playthrough {
  const { [key]: failed, ...answeredForks } = playthrough.answeredForks;
  void failed;
  return { ...note(playthrough, text, nowMs), answeredForks };
}

/** The player pressed an ambient action. */
export function markAction(
  playthrough: Playthrough,
  key: string,
  label: string,
  nowMs: number,
): Playthrough {
  return {
    ...append(playthrough, { kind: "action", key, label, atMs: nowMs }),
    spentActionKey: key,
    updatedAt: nowMs,
  };
}

/** The press failed to send: unlock the bar for that key and say so. */
export function unmarkAction(
  playthrough: Playthrough,
  key: string,
  text: string,
  nowMs: number,
): Playthrough {
  const noted = note(playthrough, text, nowMs);
  if (playthrough.spentActionKey !== key) {
    return noted;
  }
  const { spentActionKey, ...rest } = noted;
  void spentActionKey;
  return rest;
}

/** The player asked to cancel the task. */
export function markAbandon(playthrough: Playthrough, nowMs: number): Playthrough {
  return {
    ...note(playthrough, "You walk away. The task is being cancelled…", nowMs),
    abandonRequested: true,
  };
}

/** tasks/cancel failed to send: the task is still running, re-enable cancel. */
export function unmarkAbandon(playthrough: Playthrough, text: string, nowMs: number): Playthrough {
  return { ...note(playthrough, text, nowMs), abandonRequested: false };
}

/**
 * Folds the visual state of one new snapshot. Every meta field is
 * state-like: present applies, absent keeps the last value. Sprite and
 * action firings are change-detected (a new sprite object, a new action
 * key), so a meta that merely repeats never re-fires.
 */
function foldVisual(
  visual: Visual,
  task: TaskObservation["task"],
  beatPhase: string | undefined,
  beatBuild: number | undefined,
  nowMs: number,
): Visual {
  const meta = readStatusMeta(task);
  let next: Visual = visual;
  const touch = (): Visual => {
    if (next === visual) {
      next = { ...visual, sprites: [...visual.sprites], phasesSeen: [...visual.phasesSeen] };
    }
    return next;
  };

  if (meta.scene !== undefined && meta.scene !== visual.scene) {
    const changed = touch();
    changed.scene = meta.scene;
    changed.sprites = []; // pinned sprites live until the next scene change
  }

  const spriteKey =
    meta.sprite === undefined ? undefined : `${meta.sprite.uri}#${meta.sprite.persist}`;
  if (spriteKey !== visual.lastSpriteKey) {
    const changed = touch();
    if (spriteKey === undefined) {
      delete changed.lastSpriteKey;
    } else {
      changed.lastSpriteKey = spriteKey;
    }
    if (meta.sprite !== undefined) {
      changed.spriteFirings = visual.spriteFirings + 1;
      // Expired sprites leave the record here, on a firing — the page
      // filters them every render anyway (`liveSprites`).
      changed.sprites = [
        ...liveSprites(changed, nowMs),
        {
          id: `${changed.spriteFirings}#${meta.sprite.uri}`,
          uri: meta.sprite.uri,
          persist: meta.sprite.persist,
          sinceMs: nowMs,
        },
      ];
    }
  }

  const phase = meta.phase ?? beatPhase;
  if (phase !== undefined && phase !== visual.phase) {
    const changed = touch();
    changed.phase = phase;
    if (!changed.phasesSeen.includes(phase)) {
      changed.phasesSeen = [...changed.phasesSeen, phase];
    }
  }

  const build = meta.build ?? beatBuild;
  if (build !== undefined && build > visual.build) {
    touch().build = build;
  }

  if (meta.actions !== undefined && meta.actions.key !== visual.actions?.key) {
    touch().actions = meta.actions;
  }

  return next;
}

/**
 * Folds one observed snapshot of THIS playthrough's task. A stale or
 * same-instant observation returns the same object; a no-change poll
 * refreshes the view's poll clocks only; a changed snapshot narrates.
 */
export function observePlaythrough(
  playthrough: Playthrough,
  observation: TaskObservation,
  nowMs: number,
): Playthrough {
  if (observation.taskId !== playthrough.taskId) {
    return playthrough; // Not this task's snapshot — never narrated here.
  }
  const prev = playthrough.view;
  const next = observeTask(prev, observation);
  if (next === prev) {
    return playthrough; // Stale seq or a same-instant replay.
  }
  if (prev !== undefined && prev.seq === next.seq) {
    // A no-change poll (poll bookkeeping only): nothing to narrate.
    return { ...playthrough, view: next };
  }

  let folded: Playthrough = { ...playthrough, view: next, status: next.status, updatedAt: nowMs };
  const meta = readStatusMeta(observation.task);

  // Fate first: the task left an ask we never answered — the server decided,
  // and whatever beat rides this snapshot is the consequence.
  if (prev?.status === "input_required" && prev.inputRequests !== undefined) {
    const still = next.status === "input_required" ? (next.inputRequests ?? {}) : {};
    for (const askKey of Object.keys(prev.inputRequests)) {
      if (!(askKey in still) && !(askKey in playthrough.answeredForks)) {
        folded = append(folded, { kind: "fate", key: askKey, atMs: nowMs });
      }
    }
  }

  // The beat: a changed, non-empty statusMessage is one narrative line.
  const beat =
    next.statusMessage !== undefined && next.statusMessage !== prev?.statusMessage
      ? parseBeat(next.statusMessage)
      : undefined;
  if (beat !== undefined && beat.prose !== "") {
    const phase = meta.phase ?? beat.phase;
    const entry: LogEntryInput = { kind: "beat", seq: next.seq, text: beat.prose, atMs: nowMs };
    folded = append(folded, phase === undefined ? entry : { ...entry, phase });
  }

  folded.visual = foldVisual(playthrough.visual, observation.task, beat?.phase, beat?.build, nowMs);

  // Forks: a fresh input_required ask becomes a log entry once per key, and
  // the open ask rides the playthrough while the task waits.
  const fork = next.status === "input_required" ? findFork(next.inputRequests) : undefined;
  if (fork === undefined) {
    if (folded.openFork !== undefined) {
      const { openFork, ...rest } = folded;
      void openFork;
      folded = rest;
    }
  } else {
    if (!folded.log.some((entry) => entry.kind === "fork" && entry.key === fork.key)) {
      folded = append(folded, {
        kind: "fork",
        key: fork.key,
        scene: fork.scene,
        options: fork.options,
        atMs: nowMs,
      });
    }
    folded.openFork = { ...fork, sinceMs: next.statusSinceMs };
  }

  // Endings: every terminal status is an ending card.
  if (next.terminal && playthrough.ending === undefined) {
    folded = finish(folded, next, meta.scene, nowMs);
  }

  return folded;
}

/**
 * Closes the playthrough on a terminal view: the ending line in the log,
 * the ending card (with the final scene when the last meta named one), and
 * the ambient bar retired.
 */
function finish(
  playthrough: Playthrough,
  view: TaskView,
  scene: string | undefined,
  nowMs: number,
): Playthrough {
  const ending = endingFor(view);
  const card: EndingCardModel = { ...ending };
  if (scene !== undefined) {
    card.scene = scene;
  }
  const finished = append(playthrough, {
    kind: "ending",
    endingId: ending.endingId,
    text: ending.text,
    tone: ending.tone,
    atMs: nowMs,
  });
  finished.ending = card;
  if (finished.visual.actions !== undefined) {
    const { actions, ...rest } = finished.visual;
    void actions;
    finished.visual = rest;
  }
  return finished;
}

function endingFor(view: TaskView): Omit<EndingCardModel, "scene"> {
  if (view.status === "cancelled") {
    return {
      endingId: "abandoned",
      text: "You walked away. The story stops here, unfinished.",
      tone: "abandoned",
    };
  }
  if (view.status === "failed") {
    const message = view.error?.message;
    return {
      endingId: "failed",
      text: typeof message === "string" ? message : "The task failed before the story could end.",
      tone: "disaster",
    };
  }
  const isError = view.result?.isError === true;
  const text = resultText(view.result);
  const parsed = text === undefined ? undefined : parseEnding(text);
  const endingId = parsed?.id ?? (isError ? "error" : "the-end");
  const prose = parsed?.prose ?? text ?? "The story ends.";
  return { endingId, text: prose, tone: endingTone(endingId, { status: view.status, isError }) };
}

/* Selectors */

/** The sprites still on stage at `nowMs`: pinned ones, and faders inside their TTL. */
export function liveSprites(visual: Visual, nowMs: number): Sprite[] {
  return visual.sprites.filter(
    (sprite) => sprite.persist || nowMs - sprite.sinceMs < SPRITE_TTL_MS,
  );
}

/** Whether the task is still running (not yet observed terminal). */
export function isRunning(playthrough: Playthrough): boolean {
  return !isTerminalStatus(playthrough.status);
}

/* The map of playthroughs */

/**
 * Folds one observation into ITS task's playthrough in the map — the one
 * way an observation reaches a playthrough, keyed by the snapshot's own
 * taskId, so two tasks' observations can never cross. A task with no
 * playthrough (the generic tasks surface) folds nowhere; a fold that
 * changes nothing returns the same map.
 */
export function foldObservationInto(
  playthroughs: Record<string, Playthrough>,
  observation: TaskObservation,
): Record<string, Playthrough> {
  const playthrough = playthroughs[observation.taskId];
  if (playthrough === undefined) {
    return playthroughs;
  }
  const folded = observePlaythrough(playthrough, observation, observation.observedAt);
  return folded === playthrough ? playthroughs : { ...playthroughs, [observation.taskId]: folded };
}

/** Appends a note to one task's playthrough in the map; the same map when it has none. */
export function noteInto(
  playthroughs: Record<string, Playthrough>,
  taskId: string,
  text: string,
  nowMs: number,
): Record<string, Playthrough> {
  const playthrough = playthroughs[taskId];
  return playthrough === undefined
    ? playthroughs
    : { ...playthroughs, [taskId]: note(playthrough, text, nowMs) };
}

/**
 * Caps the map: when it holds more than `max` playthroughs, the oldest
 * FINISHED ones go first (a running story is never dropped). Returns the
 * same map when nothing is dropped.
 */
export function prunePlaythroughs(
  playthroughs: Record<string, Playthrough>,
  max: number,
): Record<string, Playthrough> {
  const all = Object.values(playthroughs);
  if (all.length <= max) {
    return playthroughs;
  }
  const finished = all
    .filter((playthrough) => !isRunning(playthrough))
    .toSorted((a, b) => a.startedAt - b.startedAt);
  const drop = new Set(
    finished.slice(0, all.length - max).map((playthrough) => playthrough.taskId),
  );
  if (drop.size === 0) {
    return playthroughs;
  }
  return Object.fromEntries(Object.entries(playthroughs).filter(([taskId]) => !drop.has(taskId)));
}
