/**
 * The `start` task over the real /mcp wire, playing the REAL datacenter
 * story (HTTP + integrations layers of the four-layer matrix; the data and
 * control-plane layers live in the durable-mcp-server package suite, and the
 * pure interpreter semantics in story-walk.test.ts against the fixture).
 * Expectations come from the same walkStory generator the handler drives
 * (via test/support/story-sim.ts), so beat sequences, status metas, ask
 * shapes, and ending texts are asserted EXACTLY, beat for beat, over three
 * seeded routes to three different endings (test/support/datacenter-routes).
 *
 * Timing: drain ticks fast-forward step sleeps, but elicit deadlines are
 * wall-clock honest — the fate-branch test really waits the picket line's
 * twenty-second window out.
 */

import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { datacenterStory } from "../src/stories/datacenter/story";
import { sceneUri } from "../src/story/uris";
import {
  BLACKLISTED,
  DATACENTER_ROUTES,
  FRONTIER,
  RECEIVERSHIP,
  SOLD_OUT,
} from "./support/datacenter-routes";
import { callResult } from "./support/jsonrpc";
import {
  collectBeats,
  endingIdOf,
  expectInputRequired,
  metaOf,
  playThrough,
  resultText,
  startStory,
  TERMINAL,
  waitOutCrisis,
} from "./support/play";
import { projectStory, type ProjectedBeat, type Script } from "./support/story-sim";
import { drainTaskUntil, getTask } from "./support/tasks";

const STORY = datacenterStory.id;
const NAME = "Nortada One";

const actionsSchema = z.object({
  key: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string() })),
});

describe("the frontier route (seed 1, the most GPUs at every fork, a town hall pressed at the first one)", () => {
  it(
    "plays the projected story exactly — every beat, meta, sub-story, and the triumphant ending",
    { timeout: 180_000 },
    async () => {
      const projection = projectStory(datacenterStory, NAME, FRONTIER.seed, FRONTIER.script);
      expect(endingIdOf(projection.ending)).toBe(FRONTIER.ending);

      const seen: ProjectedBeat[] = [];
      const taskId = await startStory(STORY, NAME, FRONTIER.seed);
      const done = await playThrough(taskId, FRONTIER.script, seen);

      expect(done.status).toBe("completed");
      // The complete adventure log, in order, prose AND meta, exactly as projected.
      expect(seen.length).toBeGreaterThan(100);
      expect(seen).toEqual(projection.beats);
      // Beats are pure prose: no bracket tags of any kind.
      for (const beat of seen) {
        expect(beat.text).not.toMatch(/^\[/);
        expect(beat.text).not.toMatch(/\(build \d+%\)/);
      }
      const lines = seen.map((beat) => beat.text);

      // The first beat: the default scene, the first phase, the standing set under actions-1.
      expect(seen.at(0)?.meta).toMatchObject({
        scene: sceneUri(STORY, "desert"),
        phase: "site",
        actions: { key: "actions-1" },
      });
      expect(
        actionsSchema.parse(seen.at(0)?.meta["actions"]).options.map((option) => option.id),
      ).toEqual(["walk-the-site", "check-the-books", "call-the-lobbyist", "hold-a-town-hall"]);

      // The town-hall press: its sub-story lands right after the first main
      // beat past the land fork (under the consumed key), and the next main
      // beat announces the fresh key.
      const surveyIndex = lines.findIndex((line) =>
        line.startsWith("The surveyor drives her stakes"),
      );
      expect(surveyIndex).toBeGreaterThan(0);
      expect(lines.at(surveyIndex + 1)).toBe(
        `${NAME} books the school gym for a town hall. The coffee runs out first.`,
      );
      expect(seen.at(surveyIndex + 1)?.meta["actions"]).toMatchObject({ key: "actions-1" });
      expect(seen.at(surveyIndex + 3)?.meta["actions"]).toMatchObject({ key: "actions-2" });

      // Construction: the connective beats switch the scene and raise the meter.
      const groundbreaking = seen.find((beat) => beat.text.includes("breaks ground."));
      expect(groundbreaking?.meta).toMatchObject({
        scene: sceneUri(STORY, "construction"),
        phase: "build",
        build: 0.08,
      });
      // The power arc widens the standing set (a fresh key) and hands the plain set back.
      const queue = seen.find((beat) =>
        beat.text.startsWith("The power company's connection queue"),
      );
      const queueActions = actionsSchema.parse(queue?.meta["actions"]);
      expect(queueActions.options.map((option) => option.id)).toContain("read-the-meter");
      expect(queueActions.options.map((option) => option.id)).toContain("hold-a-town-hall");
      expect(queue?.meta).toMatchObject({ scene: sceneUri(STORY, "pylons"), phase: "power" });
      // The build meter never runs backwards across the arcs' seams.
      const builds = seen
        .map((beat) => beat.meta["build"])
        .filter((build): build is number => typeof build === "number");
      for (let index = 1; index < builds.length; index++) {
        expect(builds[index]).toBeGreaterThanOrEqual(builds[index - 1] ?? 0);
      }
      // Online: the hall at build 1.0, the endgame's own standing set.
      const online = seen.find((beat) => beat.text.startsWith("03:00, and a switch flips"));
      expect(online?.meta).toMatchObject({
        scene: sceneUri(STORY, "hall"),
        phase: "online",
        build: 1,
      });
      expect(
        actionsSchema.parse(online?.meta["actions"]).options.map((option) => option.id),
      ).toEqual(["watch-the-dashboards", "take-the-on-call-shift", "brief-the-board"]);
      // The datacenter serves traffic and trains before it ends.
      expect(lines.some((line) => line.includes("serves its first request"))).toBe(true);
      expect(lines.some((line) => line.startsWith("The first training run"))).toBe(true);
      // The completed snapshot keeps the last beat's meta (the ending card's scene).
      expect(metaOf(done)).toMatchObject({ scene: sceneUri(STORY, "training"), phase: "training" });
      expect(resultText(done)).toBe(projection.ending);
      expect(resultText(done)).toBe(
        `[ending:frontier-lab] ${NAME} becomes the lab. The model ships and the round closes. The second hall breaks ground where the coal conveyor ran, under a roof the bats never noticed.`,
      );
    },
  );
});

describe("the fork ask", () => {
  it(
    "is the contract's exact wire shape both ways: key = node id, enum of option ids, listed options, and the timed window on the request; cancel is legal mid-crisis",
    { timeout: 120_000 },
    async () => {
      const projection = projectStory(datacenterStory, NAME, FRONTIER.seed, FRONTIER.script);
      const seen: ProjectedBeat[] = [];
      const taskId = await startStory(STORY, NAME, FRONTIER.seed);

      // The land fork, exactly as the contract fixes it.
      const atLand = expectInputRequired(
        await playThrough(taskId, FRONTIER.script, seen, { stopAtKey: "land-brief" }),
      );
      expect(Object.keys(atLand.inputRequests)).toEqual(["land-brief"]);
      const projectedLand = projection.asks.at(0);
      expect(atLand.inputRequests["land-brief"]).toEqual(projectedLand?.request);
      const landMessage = projectedLand?.request.params.message ?? "";
      expect(landMessage).toContain(
        `with water rights and a smell. Where does ${NAME} put its chips?`,
      );
      expect(landMessage).toContain("- floodplain: The heath");
      expect(atLand.inputRequests["land-brief"]?.params?.["timeoutMs"]).toBeUndefined();

      // The first timed crisis (the news van at the picket line) carries the
      // same shape under its own node id, plus the window on the request
      // (params.timeoutMs) and in words.
      const atCrisis = expectInputRequired(
        await playThrough(taskId, FRONTIER.script, seen, { stopAtKey: "picket-news-van" }),
      );
      expect(Object.keys(atCrisis.inputRequests)).toEqual(["picket-news-van"]);
      const projectedCrisis = projection.asks.find((ask) => ask.key === "picket-news-van");
      expect(atCrisis.inputRequests["picket-news-van"]).toEqual(projectedCrisis?.request);
      expect(atCrisis.inputRequests["picket-news-van"]?.params?.["timeoutMs"]).toBe(20_000);
      expect(atCrisis.inputRequests["picket-news-van"]?.params?.["message"]).toContain(
        "You have 20 seconds.",
      );
      // Everything so far matched the projection beat for beat.
      expect(seen).toEqual(projection.beats.slice(0, seen.length));

      // Cancel is always legal while running (or parked): no ending plays.
      const ack = await callResult("tasks/cancel", { taskId });
      expect(ack["resultType"]).toBe("complete");
      const done = await drainTaskUntil(taskId, TERMINAL, { timeoutMs: 20_000 });
      expect(done.status).toBe("cancelled");
    },
  );
});

describe("the timed crisis", () => {
  it(
    "an unanswered crisis really waits its window, then fate decides — and the priciest road ends in receivership",
    { timeout: 240_000 },
    async () => {
      const script: Script = {
        answers: { ...RECEIVERSHIP.script.answers, "picket-news-van": "timeout" },
      };
      const projection = projectStory(datacenterStory, NAME, RECEIVERSHIP.seed, script);
      expect(endingIdOf(projection.ending)).toBe("receivership");

      const seen: ProjectedBeat[] = [];
      const observe = collectBeats(seen);
      const taskId = await startStory(STORY, NAME, RECEIVERSHIP.seed);

      expectInputRequired(
        await playThrough(taskId, script, seen, { stopAtKey: "picket-news-van" }),
      );

      // Wall-clock honest: an early alarm tick does NOT time the ask out.
      await runDurableObjectAlarm(env.TASK_RUNNER.getByName(taskId));
      expect((await getTask(taskId)).status).toBe("input_required");

      // Really wait past the window (observing the resumed beats); the
      // deadline alarm resumes the task on its own, and the rest plays out.
      await waitOutCrisis(taskId, 20_000, observe);
      const done = await playThrough(taskId, script, seen);

      expect(done.status).toBe("completed");
      expect(seen).toEqual(projection.beats);
      const lines = seen.map((beat) => beat.text);
      expect(lines).toContain(
        "Nobody moves in time. The reporter interviews the choir instead, and the clip goes viral.",
      );
      // A catastrophic ending is still a completion, with the exact text and
      // the dark hall for its card; no traffic, no training run.
      expect(resultText(done)).toBe(projection.ending);
      expect(resultText(done)).toBe(
        `[ending:receivership] ${NAME} goes into receivership. Built, tested, and unplugged by the bank the week before it could have mattered.`,
      );
      expect(metaOf(done)).toMatchObject({ scene: sceneUri(STORY, "dark-hall") });
      expect(lines.some((line) => line.includes("serves its first request"))).toBe(false);
    },
  );
});

describe("ambient actions", () => {
  it(
    "presses on the offered keys (never wire inputRequests) play their sub-stories at the next beat boundary and re-offer under fresh keys — on the road to the blacklisting",
    { timeout: 180_000 },
    async () => {
      const script: Script = {
        ...BLACKLISTED.script,
        presses: [
          { at: "land-brief", choice: "walk-the-site" },
          { at: "power-source-choice", choice: "check-the-books" },
        ],
      };
      const projection = projectStory(datacenterStory, NAME, BLACKLISTED.seed, script);
      expect(endingIdOf(projection.ending)).toBe(BLACKLISTED.ending);

      const seen: ProjectedBeat[] = [];
      const taskId = await startStory(STORY, NAME, BLACKLISTED.seed);
      const done = await playThrough(taskId, script, seen);

      expect(done.status).toBe("completed");
      expect(seen).toEqual(projection.beats);
      const lines = seen.map((beat) => beat.text);
      // The walk-the-site sub-story landed right after the first main beat past the land fork...
      const surveyIndex = lines.findIndex((line) =>
        line.startsWith("The surveyor drives her stakes"),
      );
      expect(lines.at(surveyIndex + 1)).toBe(`You walk ${NAME}'s fence line with the foreman.`);
      // ...under the consumed key; the next main beat announced the fresh one.
      expect(seen.at(surveyIndex + 1)?.meta["actions"]).toMatchObject({ key: "actions-1" });
      expect(seen.at(surveyIndex + 3)?.meta["actions"]).toMatchObject({ key: "actions-2" });
      // The books sub-story (pressed at the power fork, to the power arc's
      // widened set) played after the first off-grid beat.
      const turbinesIndex = lines.findIndex((line) =>
        line.startsWith("Turbines arrive from a cancelled plant"),
      );
      expect(turbinesIndex).toBeGreaterThan(surveyIndex);
      expect(lines.at(turbinesIndex + 1)).toBe(
        `The controller opens the ledger. ${NAME} is burning cash at the planned rate.`,
      );
      expect(lines.at(turbinesIndex + 2)).toMatch(
        /double-billed transformer invoice|Steel prices moved/,
      );
      // Offer keys are lifetime-unique and strictly increasing along the log.
      const keys = [...new Set(seen.map((beat) => actionsSchema.parse(beat.meta["actions"]).key))];
      expect(keys).toEqual(keys.map((_key, index) => `actions-${index + 1}`));
      expect(keys.length).toBeGreaterThanOrEqual(4);
      expect(resultText(done)).toBe(projection.ending);
      expect(metaOf(done)).toMatchObject({ scene: sceneUri(STORY, "dark-hall") });
    },
  );
});

describe("three seeds, three roads, three endings", () => {
  it("the scripted routes project to three different endings of the same story", () => {
    const endings = DATACENTER_ROUTES.map((route) =>
      endingIdOf(projectStory(datacenterStory, NAME, route.seed, route.script).ending),
    );
    expect(endings).toEqual(DATACENTER_ROUTES.map((route) => route.ending));
    expect(new Set(endings).size).toBe(3);
    expect(new Set(DATACENTER_ROUTES.map((route) => route.seed)).size).toBe(3);
  });
});

describe("seeded determinism", () => {
  it(
    "the same seed and the same inputs tell the identical story twice",
    { timeout: 60_000 },
    async () => {
      const firstSeen: ProjectedBeat[] = [];
      const first = await playThrough(
        await startStory(STORY, "Twin", SOLD_OUT.seed),
        SOLD_OUT.script,
        firstSeen,
      );
      const secondSeen: ProjectedBeat[] = [];
      const second = await playThrough(
        await startStory(STORY, "Twin", SOLD_OUT.seed),
        SOLD_OUT.script,
        secondSeen,
      );

      expect(first.status).toBe("completed");
      expect(second.status).toBe("completed");
      expect(firstSeen.length).toBeGreaterThan(0);
      expect(firstSeen).toEqual(secondSeen);
      expect(resultText(first)).toBe(resultText(second));
      expect(endingIdOf(resultText(first))).toBe(SOLD_OUT.ending);
      // And both match the pure projection of the same seed + inputs.
      expect(firstSeen).toEqual(
        projectStory(datacenterStory, "Twin", SOLD_OUT.seed, SOLD_OUT.script).beats,
      );
    },
  );
});

describe("cancellation and defaults", () => {
  it(
    "an omitted name falls back to the story's default; tasks/cancel while parked on a fork settles the task cancelled",
    { timeout: 60_000 },
    async () => {
      const seen: ProjectedBeat[] = [];
      const taskId = await startStory(STORY, undefined, SOLD_OUT.seed);
      const parked = expectInputRequired(
        await playThrough(taskId, SOLD_OUT.script, seen, { stopAtKey: "land-brief" }),
      );
      expect(seen.at(0)?.text).toBe(
        "There was once a project to build a datacenter on the Atlantic Ocean. Its name was Nortada One.",
      );
      // The default protagonist plays: the fork asks about Nortada One.
      expect(parked.inputRequests["land-brief"]?.params?.["message"]).toContain(
        `Where does ${datacenterStory.defaultName} put its chips?`,
      );

      const ack = await callResult("tasks/cancel", { taskId });
      expect(ack["resultType"]).toBe("complete");

      const done = await drainTaskUntil(taskId, TERMINAL, { timeoutMs: 20_000 });
      expect(done.status).toBe("cancelled");
    },
  );
});
