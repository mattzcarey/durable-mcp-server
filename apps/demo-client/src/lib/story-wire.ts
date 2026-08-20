/**
 * Pure parsing for the story contract's wire strings and structured status
 * (story contract v3). The client is story-agnostic: everything here is
 * text-in / model-out, and every field is optional on the wire so a missing
 * or malformed piece degrades to prose instead of breaking play.
 *
 *   - statusMessage: pure prose beats (v1's "[phase] … (build n%)" tags are
 *     still stripped and used as fallbacks when the structured meta is
 *     silent, so an older server still plays)
 *   - _meta["io.durable-mcp-server/status"]: the visual state riding each
 *     tasks/get — scene, sprite, phase, build fraction, ambient actions
 *   - forks: the only elicitations — key = node id, message = scene text
 *     trailed by "- {id}: {label}" option lines, requestedSchema enum of ids
 *   - endings: result text "[ending:{id}] {prose}"
 */
import { z } from "zod";
import type { DetailedTask, InputRequest, InputResponses, TaskStatus } from "../mcp-tasks/schema";

/** The engine's structured status meta key on `tasks/get` snapshots. */
export const STATUS_META_KEY = "io.durable-mcp-server/status";

export type ActionOption = { id: string; label: string };
export type ActionSet = { key: string; options: ActionOption[] };

/** The visual state one beat carries (every field optional on the wire). */
export type StatusMeta = {
  scene?: string;
  sprite?: { uri: string; persist: boolean };
  phase?: string;
  /** Build fraction, clamped to 0..1. */
  build?: number;
  actions?: ActionSet;
};

const OptionSchema = z.looseObject({ id: z.string().min(1), label: z.string().min(1) });

const StatusMetaSchema = z.looseObject({
  scene: z.string().min(1).optional(),
  sprite: z.looseObject({ uri: z.string().min(1), persist: z.boolean().optional() }).optional(),
  phase: z.string().min(1).optional(),
  build: z.number().optional(),
  actions: z.looseObject({ key: z.string().min(1), options: z.array(OptionSchema) }).optional(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Clamps a build value onto 0..1; a percentage (1..100] is tolerated. */
export function normalizeBuild(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0) {
    return undefined;
  }
  const fraction = value > 1 ? value / 100 : value;
  return Math.min(fraction, 1);
}

/**
 * Reads the structured status meta off a task snapshot. Anything missing or
 * malformed reads as an empty meta — the log keeps the prose regardless.
 */
export function readStatusMeta(task: Pick<DetailedTask, "_meta"> | DetailedTask): StatusMeta {
  const meta = task["_meta"];
  if (!isRecord(meta)) {
    return {};
  }
  const parsed = StatusMetaSchema.safeParse(meta[STATUS_META_KEY]);
  if (!parsed.success) {
    return {};
  }
  const { scene, sprite, phase, build, actions } = parsed.data;
  const result: StatusMeta = {};
  if (scene !== undefined) result.scene = scene;
  if (sprite !== undefined) result.sprite = { uri: sprite.uri, persist: sprite.persist === true };
  if (phase !== undefined) result.phase = phase;
  if (build !== undefined) {
    const fraction = normalizeBuild(build);
    if (fraction !== undefined) result.build = fraction;
  }
  if (actions !== undefined) {
    result.actions = {
      key: actions.key,
      options: actions.options.map((option) => ({ id: option.id, label: option.label })),
    };
  }
  return result;
}

/* Beats */

export type Beat = {
  prose: string;
  /** v1 "[phase]" tag, when present (fallback for meta.phase). */
  phase?: string;
  /** v1 "(build n%)" suffix as a 0..1 fraction (fallback for meta.build). */
  build?: number;
};

const BEAT_TAG_RE = /^\[([a-z0-9]+(?:-[a-z0-9]+)*)\]\s+/;
const BEAT_BUILD_RE = /\s*\(build (\d{1,3})%\)\s*$/;

/**
 * A statusMessage beat. v3 lines are pure prose and pass through untouched;
 * a v1 "[phase] prose (build n%)" line is unwrapped so the tags never leak
 * into the narrative, and the tags survive as fallbacks.
 */
export function parseBeat(statusMessage: string): Beat {
  let prose = statusMessage.trim();
  const beat: Beat = { prose };
  const tag = BEAT_TAG_RE.exec(prose);
  if (tag !== null) {
    const [, phase] = tag;
    if (phase !== undefined) {
      beat.phase = phase;
    }
    prose = prose.slice(tag[0].length);
  }
  const build = BEAT_BUILD_RE.exec(prose);
  if (build !== null) {
    const [, percent] = build;
    if (percent !== undefined) {
      const fraction = normalizeBuild(Number(percent));
      if (fraction !== undefined) {
        beat.build = fraction;
      }
    }
    prose = prose.slice(0, build.index);
  }
  beat.prose = prose.trim();
  return beat;
}

/* Forks */

export type ForkOption = { id: string; label: string };

export type Fork = {
  /** The inputRequest key — the `tasks/update` response MUST reuse it. */
  key: string;
  /** The scene text, option lines stripped. Third-party text: render as text. */
  scene: string;
  options: ForkOption[];
  /** The crisis window when the ask announces one; absent = no known deadline. */
  windowMs?: number;
};

const OPTION_LINE_RE = /^-\s+([^:\s]+)\s*:\s*(.+)$/;
const WINDOW_RE = /(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i;

function enumIds(schema: unknown): string[] {
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    return [];
  }
  const choice = schema.properties["choice"];
  if (!isRecord(choice) || !Array.isArray(choice.enum)) {
    return [];
  }
  return choice.enum.filter((id): id is string => typeof id === "string");
}

/**
 * The crisis window a fork announces, when it does: a numeric `timeoutMs`
 * on the request params, else a "{n} seconds" mention in the message.
 * Cosmetic only — the SERVER owns the deadline.
 */
export function forkWindowMs(request: InputRequest): number | undefined {
  const params = isRecord(request.params) ? request.params : {};
  const timeoutMs = params["timeoutMs"];
  if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }
  const message = params["message"];
  if (typeof message !== "string") {
    return undefined;
  }
  const match = WINDOW_RE.exec(message);
  const seconds = match?.[1];
  if (seconds === undefined) {
    return undefined;
  }
  const ms = Number(seconds) * 1000;
  return ms > 0 ? ms : undefined;
}

/**
 * Parses a fork ask: the scene is the message minus its trailing
 * "- {id}: {label}" lines; options come from the schema enum (labels from
 * the lines, the id itself when a line is missing) — or from the lines
 * alone when the schema carries no enum.
 */
export function parseFork(key: string, request: InputRequest): Fork {
  const params = isRecord(request.params) ? request.params : {};
  const message = typeof params["message"] === "string" ? params["message"] : "";
  const lines = message.split(/\r?\n/);
  const labels = new Map<string, string>();
  const lineIds: string[] = [];
  let sceneEnd = lines.length;
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]?.trim() ?? "";
    if (line === "") {
      continue;
    }
    const match = OPTION_LINE_RE.exec(line);
    const id = match?.[1];
    const label = match?.[2];
    if (id === undefined || label === undefined) {
      break;
    }
    labels.set(id, label.trim());
    lineIds.unshift(id);
    sceneEnd = index;
  }
  const ids = enumIds(params["requestedSchema"]);
  const orderedIds = ids.length > 0 ? ids : lineIds;
  const options = orderedIds.map((id) => ({ id, label: labels.get(id) ?? id }));
  const scene = lines.slice(0, sceneEnd).join("\n").trim();
  const fork: Fork = { key, scene, options };
  const windowMs = forkWindowMs(request);
  if (windowMs !== undefined) {
    fork.windowMs = windowMs;
  }
  return fork;
}

/** The first outstanding fork of an `input_required` task, if any. */
export function findFork(
  inputRequests: Record<string, InputRequest> | undefined,
): Fork | undefined {
  if (inputRequests === undefined) {
    return undefined;
  }
  const entry = Object.entries(inputRequests).at(0);
  if (entry === undefined) {
    return undefined;
  }
  const [key, request] = entry;
  return parseFork(key, request);
}

/**
 * The `tasks/update` payload choosing an option — identical for fork
 * answers and ambient action presses: an accept carrying the option id.
 */
export function choiceResponse(key: string, choiceId: string): InputResponses {
  return { [key]: { action: "accept", content: { choice: choiceId } } };
}

/* Endings */

export type Ending = { id: string; prose: string };

const ENDING_RE = /^\[ending:([a-z0-9]+(?:-[a-z0-9]+)*)\]\s*/;

/** Parses "[ending:{id}] {prose}"; any other text yields undefined. */
export function parseEnding(text: string): Ending | undefined {
  const match = ENDING_RE.exec(text);
  const id = match?.[1];
  if (match === null || id === undefined) {
    return undefined;
  }
  return { id, prose: text.slice(match[0].length).trim() };
}

const TextContentSchema = z.looseObject({ type: z.literal("text"), text: z.string() });

/** The joined text content of a CallToolResult, untruncated. */
export function resultText(result: Record<string, unknown> | undefined): string | undefined {
  const content = result?.content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  const texts: string[] = [];
  for (const item of content) {
    const parsed = TextContentSchema.safeParse(item);
    if (parsed.success) {
      texts.push(parsed.data.text);
    }
  }
  return texts.length > 0 ? texts.join("\n") : undefined;
}

export type EndingTone = "triumph" | "disaster" | "abandoned" | "neutral";

const TRIUMPH_WORDS = [
  "triumph",
  "online",
  "home",
  "victory",
  "glory",
  "success",
  "golden",
  "legend",
  "crown",
  "reunion",
  "throne",
  "training",
  "serving",
  "ithaca",
];
const DISASTER_WORDS = [
  "disaster",
  "ruin",
  "bankrupt",
  "dead",
  "death",
  "drown",
  "lost",
  "fail",
  "collapse",
  "fire",
  "flood",
  "doom",
  "wreck",
  "sunk",
  "devour",
  "shipwreck",
  "blackout",
  "abandon",
  "cancel",
  "error",
];

/**
 * The card tone for an ending: the task status decides first (cancelled =
 * abandoned, failed = disaster), then an `isError` result, then the ending
 * id's own words. Unknown ids read neutral.
 */
export function endingTone(
  id: string,
  flags: { status?: TaskStatus; isError?: boolean } = {},
): EndingTone {
  if (flags.status === "cancelled") return "abandoned";
  if (flags.status === "failed" || flags.isError === true) return "disaster";
  const words = id.toLowerCase().split(/[^a-z0-9]+/);
  if (words.some((word) => DISASTER_WORDS.some((hit) => word.startsWith(hit)))) {
    return "disaster";
  }
  if (words.some((word) => TRIUMPH_WORDS.some((hit) => word.startsWith(hit)))) {
    return "triumph";
  }
  return "neutral";
}

/** The story a `story://{id}/…` URI belongs to, if it is one. */
export function storyIdFromUri(uri: string | undefined): string | undefined {
  if (uri === undefined) {
    return undefined;
  }
  const match = /^story:\/\/([^/]+)\//.exec(uri);
  return match?.[1];
}
