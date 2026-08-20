/**
 * The Odyssey over the real /mcp wire: a scripted route from Troy to
 * Penelope's bed (through the bag-of-winds crisis, answered in time, and the
 * strait fork) played beat for beat against the pure projection, plus the
 * routes the sweeps promise, purely. The datacenter suite proves the engine
 * mechanics (fate branches, presses, cancel); this suite proves the second
 * story is a full story on the same wire: its own resources, phases, scenes,
 * standing sets, timed window, and endings.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { odysseyStory } from "../src/stories/odyssey/story";
import { sceneUri } from "../src/story/uris";
import {
  endingIdOf,
  expectInputRequired,
  metaOf,
  playThrough,
  resultText,
  startStory,
} from "./support/play";
import { projectStory, type ProjectedBeat, type Script } from "./support/story-sim";

const STORY = odysseyStory.id;
const NAME = "Odysseus";

const actionsSchema = z.object({
  key: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string() })),
});

/** Seed 2, the long way round: home-to-penelope via the bag of winds opened on purpose and a fight in the strait. */
const HOME: { seed: number; ending: string; script: Script } = {
  seed: 2,
  ending: "home-to-penelope",
  script: {
    answers: {
      "cicones-landfall": { choice: "raid-and-run" },
      "lotus-landfall": { choice: "drag-them-aboard" },
      "cyclops-landfall": { choice: "take-and-run" },
      "aeolus-crisis": { choice: "let-them-look" },
      "laestrygonians-harbor": { choice: "all-inside" },
      "circe-landfall": { choice: "go-yourself" },
      "circe-hall": { choice: "bargain-for-the-men" },
      "circe-year": { choice: "sail-for-home-now" },
      "sirens-approach": { choice: "wax-for-all" },
      "strait-choice": { choice: "arm-and-fight" },
      "sun-approach": { choice: "sail-past" },
      "ithaca-swineherd": { choice: "storm-the-hall" },
    },
    presses: [{ at: "cyclops-landfall", choice: "consult-the-gods" }],
  },
};

/** Seed 3, the short way down: the Sirens' meadow after seizing the bag. */
const SIRENS: { seed: number; ending: string; script: Script } = {
  seed: 3,
  ending: "the-sirens-meadow",
  script: {
    answers: {
      "cicones-landfall": { choice: "sack-ismarus" },
      "lotus-landfall": { choice: "taste-the-lotus" },
      "cyclops-landfall": { choice: "ambush-the-host" },
      "aeolus-crisis": { choice: "seize-the-bag" },
      "laestrygonians-harbor": { choice: "flagship-outside" },
      "circe-landfall": { choice: "sail-on-hungry" },
    },
  },
};

describe("the Odyssey over the wire (seed 2, the long way home, the gods consulted once)", () => {
  it(
    "plays the projected voyage exactly — its own scenes, phases, standing sets, the timed bag-of-winds window, and Penelope's bed",
    { timeout: 180_000 },
    async () => {
      const projection = projectStory(odysseyStory, NAME, HOME.seed, HOME.script);
      expect(endingIdOf(projection.ending)).toBe(HOME.ending);

      const seen: ProjectedBeat[] = [];
      const taskId = await startStory(STORY, NAME, HOME.seed);

      // The bag of winds: a timed crisis under its node id, the window on the
      // request and in words, the Odyssey's own option ids.
      const atCrisis = expectInputRequired(
        await playThrough(taskId, HOME.script, seen, { stopAtKey: "aeolus-crisis" }),
      );
      expect(Object.keys(atCrisis.inputRequests)).toEqual(["aeolus-crisis"]);
      const crisis = atCrisis.inputRequests["aeolus-crisis"];
      expect(crisis).toEqual(projection.asks.find((ask) => ask.key === "aeolus-crisis")?.request);
      expect(crisis?.params?.["timeoutMs"]).toBe(20_000);
      expect(crisis?.params?.["message"]).toContain("You have 20 seconds.");
      expect(crisis?.params?.["message"]).toContain("- seize-the-bag: ");
      expect(seen).toEqual(projection.beats.slice(0, seen.length));

      const done = await playThrough(taskId, HOME.script, seen);
      expect(done.status).toBe("completed");
      expect(seen.length).toBeGreaterThan(30);
      expect(seen).toEqual(projection.beats);

      // The first beat: the prologue names the hero and Ithaca before the first
      // oar; the boat, the ship's standing orders under actions-1.
      expect(seen.at(0)?.text).toBe(
        `There was once a king of a small rocky island called Ithaca. His name was ${NAME}.`,
      );
      expect(seen.at(0)?.meta).toMatchObject({
        scene: sceneUri(STORY, "boat"),
        phase: "depart",
        actions: { key: "actions-1" },
      });
      expect(
        actionsSchema.parse(seen.at(0)?.meta["actions"]).options.map((option) => option.id),
      ).toEqual(["consult-the-gods", "ration-supplies", "rally-the-crew"]);
      const lines = seen.map((beat) => beat.text);
      // The press played its sub-story and the set came back under a fresh key.
      const keys = [...new Set(seen.map((beat) => actionsSchema.parse(beat.meta["actions"]).key))];
      expect(keys).toEqual(keys.map((_key, index) => `actions-${index + 1}`));
      expect(keys.length).toBeGreaterThanOrEqual(3);
      // The phases light in manifest order (this road skips the dead and
      // Calypso: Circe's directions straight to the strait, the crew sailed
      // home past Poseidon), from leaving Troy to home.
      const manifestOrder = odysseyStory.phases.map((phase) => phase.id);
      const phases = [...new Set(seen.map((beat) => String(beat.meta["phase"])))];
      expect(phases.at(0)).toBe("depart");
      expect(phases.at(-1)).toBe("home");
      expect(phases.length).toBeGreaterThanOrEqual(6);
      const lit = phases.map((phase) => manifestOrder.indexOf(phase));
      for (let index = 1; index < lit.length; index++) {
        expect(lit[index]).toBeGreaterThan(lit[index - 1] ?? -1);
      }
      // The voyage meter is a VOYAGE meter: in sight of Ithaca's watch-fires
      // (34%) the bag of winds blows the fleet back to Aeolia (26%) — the
      // one authored retreat on this road — and it ends on Ithaca's shore.
      const builds = seen
        .filter((beat) => typeof beat.meta["build"] === "number")
        .map((beat) => ({ text: beat.text, build: Number(beat.meta["build"]) }));
      const retreats = builds.filter(
        (beat, index) => index > 0 && beat.build < (builds[index - 1]?.build ?? 0),
      );
      expect(retreats.map((beat) => beat.text.slice(0, 36))).toEqual([
        "The winds come out of the bag all at",
      ]);
      expect(builds.at(-1)?.build ?? 0).toBeGreaterThanOrEqual(0.95);
      // The scenes named along the road are the Odyssey's own.
      const scenes = new Set(seen.map((beat) => beat.meta["scene"]));
      expect(scenes.has(sceneUri(STORY, "boat"))).toBe(true);
      expect(scenes.has(sceneUri(STORY, "aeolia"))).toBe(true);
      for (const scene of scenes) {
        expect(String(scene).startsWith(`story://${STORY}/scenes/`)).toBe(true);
      }
      expect(lines.some((line) => line.includes("The point leaves the bag"))).toBe(true);
      expect(resultText(done)).toBe(projection.ending);
      expect(resultText(done)).toBe(
        `[ending:home-to-penelope] ${NAME} is home, twelve ships out of Troy and the long way round. Penelope, who waited, knows you by the bed you built round the olive tree.`,
      );
      expect(metaOf(done)).toMatchObject({ phase: "home" });
    },
  );
});

describe("the roads the sweeps promise, purely", () => {
  it("seed 3 sails into the Sirens' meadow after seizing the bag; the two scripted routes end differently", () => {
    const sirens = projectStory(odysseyStory, NAME, SIRENS.seed, SIRENS.script);
    expect(endingIdOf(sirens.ending)).toBe(SIRENS.ending);
    const home = projectStory(odysseyStory, NAME, HOME.seed, HOME.script);
    expect(endingIdOf(home.ending)).toBe(HOME.ending);
    // Every ask the Odyssey raises is the contract's shape under its node id.
    for (const ask of [...sirens.asks, ...home.asks]) {
      expect(odysseyStory.nodes[ask.key]?.decision).toBeDefined();
      expect(ask.request.params.requestedSchema).toEqual({
        type: "object",
        properties: { choice: { type: "string", enum: ask.optionIds } },
        required: ["choice"],
      });
      if (ask.timeoutMs !== undefined) {
        expect(ask.request.params.timeoutMs).toBe(ask.timeoutMs);
        expect(ask.request.params.message).toMatch(/You have \d+ seconds?\./);
      } else {
        expect(ask.request.params.timeoutMs).toBeUndefined();
      }
    }
    // Journal names are unique along both roads (D8).
    for (const projection of [sirens, home]) {
      expect(new Set(projection.names).size).toBe(projection.names.length);
    }
  });
});
