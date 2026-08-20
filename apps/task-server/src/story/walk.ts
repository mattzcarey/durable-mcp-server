/**
 * The pure story interpreter core: a generator that walks a validated story
 * graph and yields the effects the task handler must perform — status beats
 * (prose + the structured visual meta), durable sleeps, journaled rolls,
 * fork asks, standing action offers, and non-blocking input checks —
 * receiving journal results back through `next()`. The `start` handler
 * adapts these events onto the durable step API; the test projection drives
 * the same generator purely. One walk definition, so wire behavior and test
 * expectations cannot drift.
 *
 * Determinism: the walk is a pure function of (story, name, seed) and the
 * feedbacks fed back in. On an engine replay the handler re-drives the
 * generator from the top and the journal supplies identical feedbacks, so
 * the walk repeats exactly; the same seed and the same inputs always tell
 * the same story.
 *
 * Step names (journal keys; the engine shares one namespace across do /
 * sleep / elicit / offer / checkInput, so these use ":" — never valid in a
 * kebab-case node id — and valid graphs are acyclic):
 *   - beat pacing sleeps:  "pace:{nodeId}:{beatIndex}", "pace:{nodeId}:roll"
 *   - construction sleeps: "wait:{nodeId}"
 *   - rolls:               "roll:{nodeId}"
 *   - action checks:       "check:{nodeId}:{beatIndex}"
 *   - sub-story steps:     the same names prefixed "a{n}:" per sub-walk entry
 *   - fork elicits:        the node id itself (the contract's key)
 *   - action offers:       "actions-{n}" (the contract's key; reserved ids)
 */

import type { InputResponse, JsonObject } from "durable-mcp-server";
import {
  type ActionSet,
  actionRequest,
  applyEffects,
  type ChoiceRequest,
  chosenId,
  chosenOption,
  DEFAULT_BEAT_SLEEP_MS,
  decisionMessage,
  decisionRequest,
  endingText,
  fillName,
  pickBranchIndex,
  type ResourceState,
  rollValue,
  type SpriteRef,
  type Story,
  windowSentence,
} from "./format";
import { sceneUri, spriteUri } from "./uris";

/** A narrative line for `step.status(text, meta)`: prose plus the visual state. */
export interface BeatEvent {
  kind: "beat";
  nodeId: string;
  text: string;
  meta: JsonObject;
}

/** A durable sleep for `step.sleep`. */
export interface SleepEvent {
  kind: "sleep";
  stepName: string;
  ms: number;
}

/**
 * A seeded branch pick for `step.do`: journal `pick()` under `stepName` and
 * feed `{ kind: "rolled", index }` back into `next()`.
 */
export interface RollEvent {
  kind: "roll";
  stepName: string;
  pick: () => number;
}

/**
 * A fork ask for `step.elicit` (key = the node id; timed when `timeoutMs`):
 * feed `{ kind: "answered", response }` or `{ kind: "timed-out" }` back.
 */
export interface AskEvent {
  kind: "ask";
  key: string;
  request: ChoiceRequest;
  optionIds: readonly string[];
  timeoutMs?: number;
}

/** A standing ambient-action offer for `step.offer` (non-blocking). */
export interface OfferEvent {
  kind: "offer";
  key: string;
  request: ChoiceRequest;
}

/**
 * A journaled, non-blocking `step.checkInput(stepName, key)`: feed
 * `{ kind: "checked", response }` back (`null` when nothing was pressed).
 */
export interface CheckEvent {
  kind: "check";
  stepName: string;
  key: string;
}

export type WalkEvent = BeatEvent | SleepEvent | RollEvent | AskEvent | OfferEvent | CheckEvent;

/** What `next()` accepts: the journal result of the previous event, or nothing. */
export type WalkFeedback =
  | undefined
  | { kind: "rolled"; index: number }
  | { kind: "answered"; response: InputResponse }
  | { kind: "timed-out" }
  | { kind: "checked"; response: InputResponse | null };

export interface WalkInput {
  /** The protagonist's name, substituted for "{name}" in all prose. */
  name: string;
  /** The playthrough seed (already normalized to uint32 by the caller). */
  seed: number;
}

/** The status meta the interpreter writes with every beat (story contract v3). */
export interface StoryMeta {
  scene?: string;
  sprite?: { uri: string; persist: boolean };
  phase?: string;
  build?: number;
  actions?: { key: string; options: { id: string; label: string }[] };
}

interface Visual {
  scene?: string;
  phase?: string;
  build?: number;
}

interface Standing {
  key: string;
  set: ActionSet;
}

interface WalkContext {
  story: Story;
  name: string;
  seed: number;
  resources: ResourceState;
  visual: Visual;
  standing: Standing | undefined;
  offers: number;
  subWalks: number;
}

interface Frame {
  /** Step-name prefix: "" on the main line, "a{n}:" inside a sub-story. */
  prefix: string;
  /** The main line checks and runs ambient actions; sub-stories do not nest. */
  main: boolean;
}

type LineOutcome = { kind: "ending"; text: string } | { kind: "return" };

/** Builds the JSON meta for one beat: the standing visual state plus an optional sprite firing. */
function buildMeta(context: WalkContext, sprite: SpriteRef | undefined): JsonObject {
  const meta: JsonObject = {};
  const { scene, phase, build } = context.visual;
  if (scene !== undefined) {
    meta["scene"] = scene;
  }
  if (sprite !== undefined) {
    meta["sprite"] = {
      uri: spriteUri(context.story.id, sprite.id),
      persist: sprite.persist === true,
    };
  }
  if (phase !== undefined) {
    meta["phase"] = phase;
  }
  if (build !== undefined) {
    meta["build"] = build;
  }
  if (context.standing !== undefined) {
    meta["actions"] = {
      key: context.standing.key,
      options: context.standing.set.map((action) => ({
        id: action.id,
        label: fillName(action.label, context.name),
      })),
    };
  }
  return meta;
}

function expectFeedback<K extends NonNullable<WalkFeedback>["kind"]>(
  feedback: WalkFeedback,
  kind: K,
  what: string,
): Extract<NonNullable<WalkFeedback>, { kind: K }> {
  if (feedback !== undefined && feedback.kind === kind) {
    return feedback as Extract<NonNullable<WalkFeedback>, { kind: K }>;
  }
  throw new Error(`story walk expected ${what}`);
}

/** A fresh standing offer of the current action set under the next lifetime-unique key. */
function* offerActions(
  context: WalkContext,
  set: ActionSet,
): Generator<WalkEvent, void, WalkFeedback> {
  context.offers += 1;
  const key = `actions-${context.offers}`;
  context.standing = { key, set };
  yield {
    kind: "offer",
    key,
    request: actionRequest(
      set.map((action) => ({ id: action.id, label: fillName(action.label, context.name) })),
    ),
  };
}

/** Walks one line (the main line, or one sub-story entry) from `startId`. */
function* walkLine(
  context: WalkContext,
  startId: string,
  frame: Frame,
): Generator<WalkEvent, LineOutcome, WalkFeedback> {
  const { story } = context;
  const fill = (text: string): string => fillName(text, context.name);
  const name = (stepName: string): string => `${frame.prefix}${stepName}`;
  let nodeId = startId;
  const nodeCount = Object.keys(story.nodes).length;

  for (let visited = 0; visited < nodeCount; visited++) {
    const node = story.nodes[nodeId];
    if (node === undefined) {
      throw new Error(`story "${story.id}" walked to unknown node "${nodeId}"`);
    }

    // Entry gate: a depleted resource skips the node altogether.
    if (node.gate !== undefined && (context.resources[node.gate.resource] ?? 0) < node.gate.min) {
      nodeId = node.gate.elseGoto;
      continue;
    }

    context.resources = applyEffects(context.resources, node.effects);

    // Visual state changes take effect with this node's first beat.
    if (node.scene !== undefined) {
      context.visual.scene = sceneUri(story.id, node.scene);
    }
    if (node.phase !== undefined) {
      context.visual.phase = node.phase;
    }
    if (node.buildPercent !== undefined) {
      context.visual.build = node.buildPercent / 100;
    }
    if (frame.main && node.actions !== undefined) {
      yield* offerActions(context, node.actions);
    }

    const pace = node.beatSleepMs ?? story.beatSleepMs ?? DEFAULT_BEAT_SLEEP_MS;
    for (const [index, beat] of node.beats.entries()) {
      yield {
        kind: "beat",
        nodeId,
        text: fill(beat),
        meta: buildMeta(context, index === 0 ? node.sprite : undefined),
      };
      if (pace > 0) {
        yield { kind: "sleep", stepName: name(`pace:${nodeId}:${index}`), ms: pace };
      }

      // Beat boundary: consume a standing action press, run its sub-story,
      // then re-offer the set under a fresh key (a consumed key is spent).
      const standing = context.standing;
      if (frame.main && standing !== undefined) {
        const { response } = expectFeedback(
          yield { kind: "check", stepName: name(`check:${nodeId}:${index}`), key: standing.key },
          "checked",
          `an action check result at node "${nodeId}"`,
        );
        if (response !== null) {
          const pressed = chosenId(
            response,
            standing.set.map((action) => action.id),
          );
          const action = standing.set.find((candidate) => candidate.id === pressed);
          if (action !== undefined) {
            context.subWalks += 1;
            const outcome = yield* walkLine(context, action.goto, {
              prefix: `a${context.subWalks}:`,
              main: false,
            });
            if (outcome.kind === "ending") {
              return outcome;
            }
          }
          yield* offerActions(context, standing.set);
        }
      }
    }

    if (node.sleepMs !== undefined) {
      yield { kind: "sleep", stepName: name(`wait:${nodeId}`), ms: node.sleepMs };
    }

    if (node.ending !== undefined) {
      return {
        kind: "ending",
        text: endingText({ id: node.ending.id, prose: fill(node.ending.prose) }),
      };
    }

    if (node.return !== undefined) {
      if (frame.main) {
        throw new Error(`main-line node "${nodeId}" has nowhere to return to`);
      }
      return { kind: "return" };
    }

    if (node.decision !== undefined) {
      const decision = node.decision;
      const options = decision.options.map((option) => ({
        id: option.id,
        label: fill(option.label),
      }));
      const optionIds = options.map((option) => option.id);
      const scene =
        decision.timeoutMs === undefined
          ? fill(decision.scene)
          : `${fill(decision.scene)} ${windowSentence(decision.timeoutMs)}`;
      const request = decisionRequest(
        decisionMessage(scene, options),
        optionIds,
        decision.timeoutMs,
      );
      const ask: AskEvent =
        decision.timeoutMs === undefined
          ? { kind: "ask", key: nodeId, request, optionIds }
          : { kind: "ask", key: nodeId, request, optionIds, timeoutMs: decision.timeoutMs };
      const feedback = yield ask;
      if (
        feedback === undefined ||
        (feedback.kind !== "answered" && feedback.kind !== "timed-out")
      ) {
        throw new Error(`story walk expected a fork answer for node "${nodeId}"`);
      }
      const option =
        feedback.kind === "answered" ? chosenOption(decision, feedback.response) : undefined;
      if (option !== undefined) {
        context.resources = applyEffects(context.resources, option.effects);
        nodeId = option.goto;
      } else if (decision.fateGoto !== undefined) {
        // Timed out, declined, or malformed: fate decides.
        nodeId = decision.fateGoto;
      } else {
        // No fate branch declared: the first option carries the day.
        const first = decision.options.at(0);
        if (first === undefined) {
          throw new Error(`node "${nodeId}" decision has no options`);
        }
        context.resources = applyEffects(context.resources, first.effects);
        nodeId = first.goto;
      }
      continue;
    }

    if (node.roll !== undefined) {
      const roll = node.roll;
      const stepName = name(`roll:${nodeId}`);
      const { index: picked } = expectFeedback(
        yield {
          kind: "roll",
          stepName,
          pick: () => pickBranchIndex(roll.branches, rollValue(context.seed, stepName)),
        },
        "rolled",
        `a roll pick for node "${nodeId}"`,
      );
      const branch = roll.branches.at(picked);
      if (branch === undefined) {
        throw new Error(`node "${nodeId}" roll pick ${picked} is out of range`);
      }
      context.resources = applyEffects(context.resources, branch.effects);
      if (branch.beat !== undefined) {
        yield {
          kind: "beat",
          nodeId,
          text: fill(branch.beat),
          meta: buildMeta(context, branch.sprite),
        };
        if (pace > 0) {
          yield { kind: "sleep", stepName: name(`pace:${nodeId}:roll`), ms: pace };
        }
      }
      nodeId = branch.goto;
      continue;
    }

    if (node.next !== undefined) {
      nodeId = node.next;
      continue;
    }

    throw new Error(
      `node "${nodeId}" has no continuation (ending, decision, roll, next, or return)`,
    );
  }

  throw new Error(
    `story "${story.id}" walk exceeded ${nodeCount} visits on one line; the graph must be acyclic`,
  );
}

/**
 * Walks one playthrough. Yields {@link WalkEvent}s, expects the matching
 * {@link WalkFeedback} via `next()`, and returns the contract's ending
 * result text ("[ending:{id}] {prose}"). Throws only on engine misuse or a
 * story that bypassed validation (unknown node, no continuation, a cycle, a
 * main-line return).
 */
export function* walkStory(
  story: Story,
  input: WalkInput,
): Generator<WalkEvent, string, WalkFeedback> {
  const context: WalkContext = {
    story,
    name: input.name,
    seed: input.seed,
    resources: { ...story.resources },
    visual: {},
    standing: undefined,
    offers: 0,
    subWalks: 0,
  };
  if (story.actions !== undefined) {
    yield* offerActions(context, story.actions);
  }
  const outcome = yield* walkLine(context, story.start, { prefix: "", main: true });
  if (outcome.kind !== "ending") {
    throw new Error(`story "${story.id}" main line returned without an ending`);
  }
  return outcome.text;
}
