/**
 * Pure projection of a story playthrough: drives the same walkStory
 * generator the `start` handler runs, answering forks and ambient-action
 * checks from a script, so tests can compute the EXACT beat sequence (prose
 * + status meta), ask shapes, offers, sleeps, and ending text a
 * (seed, inputs) triple produces. The wire tests compare observed output
 * against this projection — any drift between interpreter and expectations
 * fails loudly.
 *
 * Ambient presses are scripted relative to forks ("while parked at ask X,
 * the player pressed action Y"), which is the one moment a press is
 * deterministic on the wire too: the first check after that fork consumes
 * it, exactly as the engine's journaled checkInput does after the resume.
 */

import type { JsonObject } from "durable-mcp-server";
import { pickBranchIndex, rollValue, type Story } from "../../src/story/format";
import { type AskEvent, type OfferEvent, walkStory, type WalkFeedback } from "../../src/story/walk";

/** A scripted fork answer: pick an option, or let the deadline pass. */
export type ScriptedAnswer = { choice: string } | "timeout";

export interface Script {
  /** Fork answers by ask key (node id). */
  answers: Record<string, ScriptedAnswer>;
  /** Ambient presses: while parked at ask `at`, the player pressed `choice`. */
  presses?: { at: string; choice: string }[];
}

export interface ProjectedBeat {
  text: string;
  meta: JsonObject;
}

export interface Projection {
  /** Every beat, in order: prose and the status meta written with it. */
  beats: ProjectedBeat[];
  /** Every fork ask, in order. */
  asks: AskEvent[];
  /** Every standing offer, in order (keys actions-1, actions-2, ...). */
  offers: OfferEvent[];
  /** Every durable sleep, in order. */
  sleeps: { stepName: string; ms: number }[];
  /** Every journal name claimed (sleeps, rolls, checks, offers, asks), in order. */
  names: string[];
  /** The contract's ending result text. */
  ending: string;
}

export function projectStory(story: Story, name: string, seed: number, script: Script): Projection {
  const walk = walkStory(story, { name, seed });
  const beats: ProjectedBeat[] = [];
  const asks: AskEvent[] = [];
  const offers: OfferEvent[] = [];
  const sleeps: { stepName: string; ms: number }[] = [];
  const names: string[] = [];
  const pendingPresses: string[] = [];
  let feedback: WalkFeedback = undefined;
  for (;;) {
    const turn = walk.next(feedback);
    if (turn.done) {
      return { beats, asks, offers, sleeps, names, ending: turn.value };
    }
    feedback = undefined;
    const event = turn.value;
    switch (event.kind) {
      case "beat":
        beats.push({ text: event.text, meta: event.meta });
        break;
      case "sleep":
        sleeps.push({ stepName: event.stepName, ms: event.ms });
        names.push(event.stepName);
        break;
      case "roll":
        names.push(event.stepName);
        feedback = { kind: "rolled", index: event.pick() };
        break;
      case "offer":
        offers.push(event);
        names.push(event.key);
        break;
      case "check": {
        names.push(event.stepName);
        const pressed = pendingPresses.shift();
        feedback = {
          kind: "checked",
          response:
            pressed === undefined ? null : { action: "accept", content: { choice: pressed } },
        };
        break;
      }
      case "ask": {
        asks.push(event);
        names.push(event.key);
        const scripted = script.answers[event.key];
        if (scripted === undefined) {
          throw new Error(`projection has no scripted answer for ask "${event.key}"`);
        }
        for (const press of script.presses ?? []) {
          if (press.at === event.key) {
            pendingPresses.push(press.choice);
          }
        }
        feedback =
          scripted === "timeout"
            ? { kind: "timed-out" }
            : {
                kind: "answered",
                response: { action: "accept", content: { choice: scripted.choice } },
              };
        break;
      }
    }
  }
}

/** An input policy for sweeps: answers forks by position and presses actions by check ordinal. */
export type Policy = {
  /** Picks an option index for an ask (by ask ordinal; `key` is the fork's node id). */
  answer: (
    optionIds: readonly string[],
    ordinal: number,
    timed: boolean,
    key: string,
  ) => number | "timeout";
  /** Presses an action (by action ordinal) at a check, or nothing. */
  press: (actionIds: readonly string[], ordinal: number) => number | undefined;
};

export interface Sweep {
  /** The contract's ending result text. */
  ending: string;
  /** The ending id inside it. */
  endingId: string;
  beats: number;
  asks: number;
  /** Every journal name claimed, in order. */
  names: string[];
  /** Every scene and sprite URI the metas named. */
  visuals: string[];
  /** Every standing offer key, in order. */
  actionKeys: string[];
}

/** Drives one pure playthrough under a policy (no script): the sweep tests' workhorse. */
export function sweepStory(story: Story, seed: number, policy: Policy): Sweep {
  const walk = walkStory(story, { name: "Sweep", seed });
  const names: string[] = [];
  const visuals = new Set<string>();
  const actionKeys: string[] = [];
  let beats = 0;
  let asks = 0;
  let checks = 0;
  let standingIds: string[] = [];
  let feedback: WalkFeedback = undefined;
  for (;;) {
    const turn = walk.next(feedback);
    if (turn.done) {
      const endingId = /^\[ending:([a-z0-9-]+)\]/.exec(turn.value)?.[1] ?? "";
      return {
        ending: turn.value,
        endingId,
        beats,
        asks,
        names,
        visuals: [...visuals],
        actionKeys,
      };
    }
    feedback = undefined;
    const event = turn.value;
    switch (event.kind) {
      case "beat": {
        beats += 1;
        const meta = event.meta;
        if (typeof meta["scene"] === "string") {
          visuals.add(meta["scene"]);
        }
        const sprite = meta["sprite"];
        if (typeof sprite === "object" && sprite !== null && !Array.isArray(sprite)) {
          visuals.add(String(sprite["uri"]));
        }
        break;
      }
      case "sleep":
        names.push(event.stepName);
        break;
      case "roll":
        names.push(event.stepName);
        feedback = { kind: "rolled", index: event.pick() };
        break;
      case "offer": {
        names.push(event.key);
        actionKeys.push(event.key);
        standingIds = event.request.params.requestedSchema.properties.choice.enum;
        break;
      }
      case "check": {
        names.push(event.stepName);
        const pick = policy.press(standingIds, checks);
        checks += 1;
        const chosen = pick === undefined ? undefined : standingIds.at(pick);
        feedback = {
          kind: "checked",
          response: chosen === undefined ? null : { action: "accept", content: { choice: chosen } },
        };
        break;
      }
      case "ask": {
        names.push(event.key);
        const pick = policy.answer(event.optionIds, asks, event.timeoutMs !== undefined, event.key);
        asks += 1;
        if (pick === "timeout") {
          feedback = { kind: "timed-out" };
        } else {
          const choice = event.optionIds.at(pick % event.optionIds.length);
          if (choice === undefined) {
            throw new Error(`ask "${event.key}" has no options`);
          }
          feedback = { kind: "answered", response: { action: "accept", content: { choice } } };
        }
        break;
      }
    }
  }
}

/**
 * A policy that, at every fork, takes the option whose declared effect on
 * `resource` is the largest (`"max"`) or the smallest (`"min"`), ties to the
 * first option; never presses. The balance sweeps' envelope: the priciest
 * road, the cheapest, the meanest, the kindest, the most GPUs.
 */
export function preferEffect(story: Story, resource: string, direction: "max" | "min"): Policy {
  const sign = direction === "max" ? 1 : -1;
  return {
    answer: (optionIds, _ordinal, _timed, key) => {
      const options = story.nodes[key]?.decision?.options ?? [];
      let best = 0;
      let bestValue = -Infinity;
      for (const [index, id] of optionIds.entries()) {
        const option = options.find((candidate) => candidate.id === id);
        const value = sign * (option?.effects?.[resource] ?? 0);
        if (value > bestValue) {
          bestValue = value;
          best = index;
        }
      }
      return best;
    },
    press: () => undefined,
  };
}

/**
 * A seed whose roll under `stepName` ("roll:{nodeId}" on the main line)
 * lands the wanted branch index, found by scanning — lets tests pin the
 * wildlife roll each way deterministically.
 */
export function seedForRollBranch(story: Story, nodeId: string, branchIndex: number): number {
  const node = story.nodes[nodeId];
  const roll = node?.roll;
  if (roll === undefined) {
    throw new Error(`node "${nodeId}" has no roll`);
  }
  const stepName = `roll:${nodeId}`;
  for (let seed = 1; seed <= 10_000; seed++) {
    if (pickBranchIndex(roll.branches, rollValue(seed, stepName)) === branchIndex) {
      return seed;
    }
  }
  throw new Error(`no seed under 10000 lands branch ${branchIndex} of "${nodeId}"`);
}
