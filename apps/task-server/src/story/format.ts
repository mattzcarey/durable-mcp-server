/**
 * The story format (story contract v3): the zod-validated schema content
 * authors write as plain data modules, plus the pure formatting and
 * randomness helpers the interpreter applies to it. The format is generic —
 * a story declares its own phases, resources, scenes, and sprites — so the
 * same interpreter plays a datacenter build-out and the Odyssey.
 *
 * Authoring model: a story is a graph of nodes keyed by kebab-case id. A
 * node plays in a fixed order — gate (entry routing) -> effects -> visuals
 * (scene / phase / build / sprite) -> actions (a new standing set) -> beats
 * (each paced by a durable sleep, each followed by a non-blocking check of
 * the standing action set) -> sleepMs -> exactly one continuation
 * (`ending` | `decision` | `roll` | `next` | `return`). Graphs must be
 * acyclic (validated in ./validate): a playthrough always terminates, and
 * decision elicit keys (node ids) stay lifetime-unique per task.
 *
 * Ambient actions: the standing set (story-level default, replaced by any
 * node that declares `actions`) is offered as a NON-blocking input request
 * under a fresh key (`actions-1`, `actions-2`, ...). A press branches into
 * the action's sub-story — nodes reachable from an action `goto`, which
 * carry no decisions and end in `return` (back to the interrupted beat) or
 * an `ending` — after which the set is re-offered under a fresh key.
 *
 * Every prose field may reference the protagonist by writing "{name}".
 *
 * Wire formatting (what the demo-client parses):
 *   - beats:     statusMessage = the prose line; the visual state rides the
 *                structured status meta (see ./walk buildMeta)
 *   - decisions: elicit key = the node id; message = the scene (ending with
 *                its question, plus "You have N seconds." when timed)
 *                followed by one "- {id}: {label}" line per option;
 *                requestedSchema = enum of the option ids under "choice";
 *                timed asks also carry params.timeoutMs
 *   - endings:   the task completes with result text "[ending:{id}] {prose}"
 *
 * Everything in this module is deterministic; the only randomness in a
 * playthrough (a missing seed) lives in the handler's journaled setup step.
 */

import type { InputRequest, InputResponse } from "durable-mcp-server";
import { z } from "zod";

/** Node ids, option ids, phase ids, resource names, and ending ids are all kebab-case. */
export const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Pacing between beats when neither the story nor the node declares one. */
export const DEFAULT_BEAT_SLEEP_MS = 2_500;

const kebabId = z.string().regex(KEBAB_CASE, "must be kebab-case");
const prose = z.string().min(1);
const nodeRef = z.string().min(1);
const svgMarkup = z.string().regex(/<svg[\s>]/, "must be an <svg> document");

/** Resource deltas over the story's declared resources (checked in ./validate). */
export const effectsSchema = z.record(kebabId, z.number());
export type Effects = z.output<typeof effectsSchema>;

/** The resource state; the story header declares every starting value. */
export const resourcesSchema = z.record(kebabId, z.number());
export type ResourceState = z.output<typeof resourcesSchema>;

export const phaseSchema = z.strictObject({
  id: kebabId,
  /** The checklist label the client shows for this phase. */
  label: z.string().min(1),
});
export type StoryPhase = z.output<typeof phaseSchema>;

/** A sprite overlay firing: by default it fades after a few seconds; `persist` pins it until the next scene change. */
export const spriteRefSchema = z.strictObject({
  id: kebabId,
  persist: z.boolean().optional(),
});
export type SpriteRef = z.output<typeof spriteRefSchema>;

export const optionSchema = z.strictObject({
  id: kebabId,
  label: prose,
  goto: nodeRef,
  effects: effectsSchema.optional(),
});
export type StoryOption = z.output<typeof optionSchema>;

/**
 * A decision (a fork — the only elicitation): the scene text (ending with
 * the question) becomes the elicit message together with the generated
 * option lines. `timeoutMs` makes it a timed crisis and must be paired with
 * `fateGoto` — the branch an unanswered (or declined/malformed) ask takes:
 * fate decides. An untimed decision falls back to its first option when the
 * answer names no option.
 */
export const decisionSchema = z.strictObject({
  scene: prose,
  options: z.array(optionSchema).min(1),
  timeoutMs: z.number().int().min(1).optional(),
  fateGoto: nodeRef.optional(),
});
export type StoryDecision = z.output<typeof decisionSchema>;

export const rollBranchSchema = z.strictObject({
  weight: z.number().positive().finite(),
  goto: nodeRef,
  /** Optional extra beat narrating the branch fate rolled. */
  beat: prose.optional(),
  /** A sprite fired with that beat (requires `beat`). */
  sprite: spriteRefSchema.optional(),
  /** Resource deltas applied when this branch is rolled. */
  effects: effectsSchema.optional(),
});
export type RollBranch = z.output<typeof rollBranchSchema>;

/** A weighted random branch, resolved inside a journaled step with the seeded rng. */
export const rollSchema = z.strictObject({
  branches: z.array(rollBranchSchema).min(1),
});
export type StoryRoll = z.output<typeof rollSchema>;

/** Entry gate: when `resource < min`, the node is skipped for `elseGoto`. */
export const gateSchema = z.strictObject({
  resource: kebabId,
  min: z.number(),
  elseGoto: nodeRef,
});
export type StoryGate = z.output<typeof gateSchema>;

export const endingSchema = z.strictObject({
  id: kebabId,
  prose,
});
export type StoryEnding = z.output<typeof endingSchema>;

/** One ambient action: a button label and the sub-story it starts. */
export const actionSchema = z.strictObject({
  id: kebabId,
  label: prose,
  goto: nodeRef,
});
export type StoryAction = z.output<typeof actionSchema>;

export const actionSetSchema = z.array(actionSchema).min(1);
export type ActionSet = z.output<typeof actionSetSchema>;

export const nodeSchema = z.strictObject({
  /** One of the story's declared phase ids (lights the client checklist); absent keeps the current one. */
  phase: kebabId.optional(),
  /** Prose lines, one statusMessage each. */
  beats: z.array(prose),
  /** Switches the centerpiece to this scene (with the node's first beat). */
  scene: kebabId.optional(),
  /** Fires this sprite with the node's first beat. */
  sprite: spriteRefSchema.optional(),
  /** Progress percentage (construction, voyage...); rides the meta as 0..1. */
  buildPercent: z.number().int().min(0).max(100).optional(),
  effects: effectsSchema.optional(),
  gate: gateSchema.optional(),
  /** Replaces the standing ambient action set from this node on (main line only). */
  actions: actionSetSchema.optional(),
  /** Per-node pacing override for this node's beats (0 = unpaced). */
  beatSleepMs: z.number().int().min(0).max(60_000).optional(),
  /** Extra time after the beats (a durable sleep) — kept short. */
  sleepMs: z.number().int().min(1).max(60_000).optional(),
  decision: decisionSchema.optional(),
  roll: rollSchema.optional(),
  next: nodeRef.optional(),
  /** Sub-story continuation: back to the beat the action interrupted. */
  return: z.literal(true).optional(),
  ending: endingSchema.optional(),
});
export type StoryNode = z.output<typeof nodeSchema>;

export const storySchema = z.strictObject({
  id: kebabId,
  title: z.string().min(1),
  /** The picker card's subtitle. */
  blurb: z.string().min(1),
  /** Optional CSS accent color for the client. */
  accent: z.string().min(1).optional(),
  /** The protagonist's name when the player gives none. */
  defaultName: z.string().min(1),
  /** The phase checklist, in story order. */
  phases: z.array(phaseSchema).min(1),
  resources: resourcesSchema,
  start: nodeRef,
  /** The scene shown before the first beat (a key of `scenes`). */
  defaultScene: kebabId,
  /** Pacing between beats (a durable sleep after each one). Default 2500. */
  beatSleepMs: z.number().int().min(0).max(60_000).optional(),
  /** The ambient action set standing from the start (nodes may replace it). */
  actions: actionSetSchema.optional(),
  /** Self-contained SVG documents, served as story://{id}/scenes/{key}. */
  scenes: z.record(kebabId, svgMarkup),
  /** Self-contained SVG overlays, served as story://{id}/sprites/{key}. */
  sprites: z.record(kebabId, svgMarkup),
  nodes: z.record(kebabId, nodeSchema),
});
export type Story = z.output<typeof storySchema>;
/** What authors write (identical shape; use this for plain data modules). */
export type StoryInput = z.input<typeof storySchema>;

/** Replaces every "{name}" placeholder with the protagonist's name. */
export function fillName(text: string, name: string): string {
  return text.replaceAll("{name}", name);
}

/** The contract's option list: one "- {id}: {label}" line per option. */
export function optionLines(options: readonly { id: string; label: string }[]): string[] {
  return options.map((option) => `- ${option.id}: ${option.label}`);
}

/** The contract's decision message: the scene, then the option lines. */
export function decisionMessage(
  scene: string,
  options: readonly { id: string; label: string }[],
): string {
  return [scene, ...optionLines(options)].join("\n");
}

/** The crisis window in words, appended to a timed decision's scene. */
export function windowSentence(timeoutMs: number): string {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return `You have ${seconds} ${seconds === 1 ? "second" : "seconds"}.`;
}

/** The contract's ending result text: "[ending:{id}] {prose}". */
export function endingText(ending: StoryEnding): string {
  return `[ending:${ending.id}] ${ending.prose}`;
}

/** The enum-of-ids requestedSchema every choice ask (fork or ambient) carries. */
export type ChoiceSchema = {
  type: "object";
  properties: { choice: { type: "string"; enum: string[] } };
  required: string[];
};

/** Elicitation form params for a choice ask (structurally an SDK form request). */
export type ChoiceParams = {
  message: string;
  requestedSchema: ChoiceSchema;
  /** A timed fork's window in ms — the same value passed to `step.elicit`. */
  timeoutMs?: number;
};

/**
 * A choice ask: a fork elicit or a standing ambient offer. Assignable to the
 * wire's `InputRequest` (an elicitation/create form request); typed here so
 * the interpreter and its tests can read the params without narrowing.
 */
export type ChoiceRequest = {
  method: "elicitation/create";
  params: ChoiceParams;
};

function choiceSchema(optionIds: readonly string[]): ChoiceSchema {
  return {
    type: "object",
    properties: { choice: { type: "string", enum: [...optionIds] } },
    required: ["choice"],
  };
}

/**
 * The contract's exact decision ask. A timed crisis also carries the window
 * on the request itself (`params.timeoutMs`, the same value passed to
 * `step.elicit`) — the wire carries no deadlines otherwise — so the client
 * can light its crisis timer from it.
 */
export function decisionRequest(
  message: string,
  optionIds: readonly string[],
  timeoutMs?: number,
): ChoiceRequest {
  const params: ChoiceParams = { message, requestedSchema: choiceSchema(optionIds) };
  if (timeoutMs !== undefined) {
    params.timeoutMs = timeoutMs;
  }
  return { method: "elicitation/create", params };
}

/** The standing (non-blocking) ambient-action offer: same answer shape as a fork. */
export function actionRequest(options: readonly { id: string; label: string }[]): ChoiceRequest {
  return {
    method: "elicitation/create",
    params: {
      message: ["Standing orders — answer at any time.", ...optionLines(options)].join("\n"),
      requestedSchema: choiceSchema(options.map((option) => option.id)),
    },
  };
}

/** The wire form of a choice request (type-level proof it is an InputRequest). */
export function asInputRequest(request: ChoiceRequest): InputRequest {
  return request;
}

/** Mulberry32: tiny deterministic PRNG over a uint32 seed. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** FNV-1a 32-bit over a string, for deriving per-roll seeds. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Clamps any numeric seed input onto mulberry32's uint32 domain. */
export function normalizeSeed(seed: number): number {
  return Math.trunc(seed) >>> 0;
}

/**
 * The seeded roll for one journaled roll step, in [0, 1): a pure function of
 * (story seed, step name), so the same seed lands the same branches on every
 * replay and every rerun, independent of how the walk reached the roll.
 */
export function rollValue(seed: number, stepName: string): number {
  return mulberry32((normalizeSeed(seed) ^ fnv1a(stepName)) >>> 0)();
}

/** Weighted branch pick from a roll value in [0, 1). */
export function pickBranchIndex(branches: readonly RollBranch[], value: number): number {
  const total = branches.reduce((sum, branch) => sum + branch.weight, 0);
  let remaining = value * total;
  for (const [index, branch] of branches.entries()) {
    remaining -= branch.weight;
    if (remaining < 0) {
      return index;
    }
  }
  return branches.length - 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The id a choice answer selects: an accept whose form content names one of
 * the ids. Anything else — decline, cancel, malformed content, an unknown
 * id — selects nothing.
 */
export function chosenId(response: InputResponse, ids: readonly string[]): string | undefined {
  if (!isRecord(response) || response["action"] !== "accept") {
    return undefined;
  }
  const content = response["content"];
  if (!isRecord(content)) {
    return undefined;
  }
  const choice = content["choice"];
  return typeof choice === "string" && ids.includes(choice) ? choice : undefined;
}

/**
 * The option a decision answer selects, or undefined when the interpreter
 * should fall back (the fate branch when the decision declares one, else
 * the first option).
 */
export function chosenOption(
  decision: StoryDecision,
  response: InputResponse,
): StoryOption | undefined {
  const id = chosenId(
    response,
    decision.options.map((option) => option.id),
  );
  return decision.options.find((option) => option.id === id);
}

/** Applies resource deltas to a walk state, returning the new state. */
export function applyEffects(state: ResourceState, effects: Effects | undefined): ResourceState {
  if (effects === undefined) {
    return state;
  }
  const updated = { ...state };
  for (const [resource, delta] of Object.entries(effects)) {
    updated[resource] = (updated[resource] ?? 0) + delta;
  }
  return updated;
}
