/**
 * The merged datacenter story, purely: the census of the graph the four arc
 * modules and the connective beats compose, the seams between them, and the
 * balance sweeps — every playthrough reaches an ending under every policy
 * and seed, the build meter never runs backwards, and the endings the
 * arithmetic promises (the frontier, receivership, the blacklisting, the
 * early sale) are the endings the roads reach.
 */

import { describe, expect, it } from "vitest";
import { datacenterStory } from "../src/stories/datacenter/story";
import { storyResourceUris } from "../src/story/resources";
import { validateStory } from "../src/story/validate";
import { DATACENTER_ROUTES, SOLD_OUT } from "./support/datacenter-routes";
import { type Policy, preferEffect, projectStory, sweepStory } from "./support/story-sim";

const story = datacenterStory;
const nodes = Object.entries(story.nodes);

/** The ids of an action set (empty when none is declared). */
function actionIdsOf(actions: { id: string }[] | undefined): string[] {
  return (actions ?? []).map((action) => action.id);
}

describe("the merged graph", () => {
  it("validates clean and is massive: 300+ nodes, 70+ forks, 8 timed crises, 100+ rolls, 20 endings", () => {
    expect(validateStory(story)).toEqual([]);
    const decisions = nodes.filter(([, node]) => node.decision !== undefined);
    const timed = decisions.filter(([, node]) => node.decision?.timeoutMs !== undefined);
    const endings = nodes.filter(([, node]) => node.ending !== undefined);
    const rolls = nodes.filter(([, node]) => node.roll !== undefined);
    const gates = nodes.filter(([, node]) => node.gate !== undefined);
    const returns = nodes.filter(([, node]) => node.return !== undefined);
    const options = decisions.reduce(
      (sum, [, node]) => sum + (node.decision?.options.length ?? 0),
      0,
    );
    expect(nodes.length).toBeGreaterThanOrEqual(300);
    expect(decisions.length).toBeGreaterThanOrEqual(70);
    expect(options).toBeGreaterThanOrEqual(220);
    expect(timed.length).toBe(8);
    expect(rolls.length).toBeGreaterThanOrEqual(110);
    expect(gates.length).toBeGreaterThanOrEqual(11);
    expect(returns.length).toBeGreaterThanOrEqual(12);
    expect(endings.length).toBe(20);
    expect(Object.keys(story.scenes).length).toBeGreaterThanOrEqual(24);
    expect(Object.keys(story.sprites).length).toBeGreaterThanOrEqual(27);
    expect(story.phases.map((phase) => phase.id)).toEqual([
      "site",
      "permits",
      "power",
      "water",
      "cooling",
      "gpus",
      "labor",
      "crisis",
      "wildlife",
      "build",
      "online",
      "training",
    ]);
    // Every arc's endings survive the merge under their own ids.
    const endingIds = new Set(endings.map(([, node]) => node.ending?.id));
    for (const id of [
      "sold-to-the-rival",
      "zoned-out",
      "sealed-by-the-state",
      "lost-in-the-queue",
      "town-ran-dry",
      "seized-by-warrant",
      "blacklisted-by-the-trades",
      "prohibition-notice",
      "consent-quashed",
      "frontier-lab",
      "steady-service",
      "acquired",
      "sovereign-partner",
      "nationalised",
      "almond-farm",
      "pool-heater",
      "crypto-mine",
      "receivership",
      "permit-revoked",
      "sentient-objection",
    ]) {
      expect(endingIds.has(id), id).toBe(true);
    }
  });

  it("stitches the arcs in campaign order through the connective construction beats", () => {
    const next = (id: string): string | undefined => story.nodes[id]?.next;
    expect(story.start).toBe("nortada-intro");
    expect(next("nortada-intro")).toBe("land-scouts");
    expect(next("permits-complete")).toBe("build-groundbreaking");
    expect(next("build-groundbreaking")).toBe("power-queue");
    expect(next("power-water-handoff")).toBe("build-steel");
    expect(next("build-steel")).toBe("gpu-allocation-call");
    expect(next("labor-complete")).toBe("build-frame");
    expect(next("build-frame")).toBe("crisis-season");
    expect(next("crisis-season-closes")).toBe("wildlife-survey");
    expect(next("wildlife-closing")).toBe("build-roof");
    for (const branch of story.nodes["build-roof"]?.roll?.branches ?? []) {
      expect(branch.goto).toBe("rack-first-row");
    }
    expect(next("rack-last-row")).toBe("build-schedule-check");
    expect(story.nodes["build-schedule-check"]?.gate?.elseGoto).toBe("build-schedule-slip");
    expect(next("build-schedule-check")).toBe("commission-week");
    expect(next("build-schedule-slip")).toBe("commission-week");
    expect(next("commission-handoff")).toBe("ransomware-strike");
    // The endgame's duplicate commissioning beat is dropped; its rebuild keeps the meter rising.
    expect(story.nodes["endgame-commissioning"]).toBeUndefined();
    expect(story.nodes["ransomware-rebuild"]?.buildPercent).toBe(99);
    expect(story.nodes["online-first-traffic"]?.buildPercent).toBe(100);
    // The standing set is shared by the header and the arcs that widen or restore it.
    const shared = ["walk-the-site", "check-the-books", "call-the-lobbyist", "hold-a-town-hall"];
    expect(actionIdsOf(story.actions)).toEqual(shared);
    expect(actionIdsOf(story.nodes["power-queue"]?.actions).slice(0, 4)).toEqual(shared);
    expect(actionIdsOf(story.nodes["power-water-handoff"]?.actions)).toEqual(shared);
    expect(actionIdsOf(story.nodes["gpu-allocation-call"]?.actions).slice(0, 4)).toEqual(shared);
    expect(actionIdsOf(story.nodes["commission-handoff"]?.actions)).toEqual(shared);
    expect(actionIdsOf(story.nodes["online-first-traffic"]?.actions)).toEqual([
      "watch-the-dashboards",
      "take-the-on-call-shift",
      "brief-the-board",
    ]);
  });

  it("the build meter never runs backwards along the scripted routes, which play traffic and training before the triumphant ending", () => {
    for (const route of [...DATACENTER_ROUTES, SOLD_OUT]) {
      const projection = projectStory(story, "Nortada One", route.seed, route.script);
      expect(projection.ending.startsWith(`[ending:${route.ending}] `), route.ending).toBe(true);
      const builds = projection.beats
        .map((beat) => beat.meta["build"])
        .filter((build): build is number => typeof build === "number");
      for (let index = 1; index < builds.length; index++) {
        expect(builds[index], `${route.ending} beat ${index}`).toBeGreaterThanOrEqual(
          builds[index - 1] ?? 0,
        );
      }
      const text = projection.beats.map((beat) => beat.text).join("\n");
      if (route.ending === "frontier-lab") {
        expect(builds.at(-1)).toBe(1);
        expect(text).toContain("serves its first request");
        expect(text).toContain("The first training run");
      }
    }
  });
});

/* ---- Balance sweeps ----------------------------------------------------- */

const SEEDS = 60;

const FIRST_OPTION: Policy = { answer: () => 0, press: () => undefined };
const LAST_OPTION: Policy = { answer: (ids) => ids.length - 1, press: () => undefined };
const PRICIEST = preferEffect(story, "budget", "min");
const MOST_GPUS = preferEffect(story, "gpus", "max");

const POLICIES: Record<string, Policy> = {
  "first option": FIRST_OPTION,
  "last option": LAST_OPTION,
  "rotate options, press every third check": {
    answer: (_ids, ordinal) => ordinal,
    press: (ids, ordinal) => (ordinal % 3 === 0 ? ordinal % ids.length : undefined),
  },
  "fate on every timed ask, press every check": {
    answer: (_ids, ordinal, timed) => (timed ? "timeout" : ordinal + 1),
    press: (ids, ordinal) => ordinal % ids.length,
  },
  "the cheapest option": preferEffect(story, "budget", "max"),
  "the priciest option": PRICIEST,
  "the least goodwill": preferEffect(story, "goodwill", "min"),
  "the most goodwill": preferEffect(story, "goodwill", "max"),
  "the most GPUs": MOST_GPUS,
};

function endingsUnder(policy: Policy): Map<string, number> {
  const endings = new Map<string, number>();
  for (let seed = 1; seed <= SEEDS; seed++) {
    const run = sweepStory(story, seed, policy);
    endings.set(run.endingId, (endings.get(run.endingId) ?? 0) + 1);
  }
  return endings;
}

describe("balance sweeps", () => {
  for (const [label, policy] of Object.entries(POLICIES)) {
    it(`every seed reaches an ending under "${label}", with unique journal names and published visuals`, () => {
      const published = new Set(storyResourceUris(story));
      for (let seed = 1; seed <= SEEDS; seed++) {
        const run = sweepStory(story, seed, policy);
        expect(run.ending).toMatch(/^\[ending:[a-z0-9-]+\] .+/);
        expect(run.beats).toBeGreaterThan(3);
        expect(new Set(run.names).size, `seed ${seed}`).toBe(run.names.length);
        for (const uri of run.visuals) {
          expect(published.has(uri), uri).toBe(true);
        }
        expect(run.actionKeys.at(0)).toBe("actions-1");
      }
    });
  }

  it("reaches a dozen distinct endings across the policies, including every road the arithmetic promises", () => {
    const endings = new Set<string>();
    for (const policy of Object.values(POLICIES)) {
      for (const id of endingsUnder(policy).keys()) {
        endings.add(id);
      }
    }
    expect(endings.size).toBeGreaterThanOrEqual(12);
    for (const id of [
      "frontier-lab",
      "steady-service",
      "receivership",
      "blacklisted-by-the-trades",
      "sold-to-the-rival",
      "almond-farm",
      "acquired",
    ]) {
      expect(endings.has(id), id).toBe(true);
    }
  });

  it("the money is the main gate: the priciest road always ends in receivership, a first-option run almost never, and the most GPUs can ship the frontier model", () => {
    expect(endingsUnder(PRICIEST).get("receivership")).toBe(SEEDS);
    expect(endingsUnder(FIRST_OPTION).get("receivership") ?? 0).toBeLessThanOrEqual(SEEDS / 10);
    expect(endingsUnder(MOST_GPUS).get("frontier-lab") ?? 0).toBeGreaterThan(0);
    expect(endingsUnder(LAST_OPTION).get("sold-to-the-rival")).toBe(SEEDS);
  });
});
