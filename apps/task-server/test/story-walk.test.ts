/**
 * Unit tests for the pure interpreter core (src/story/walk.ts) against the
 * fixture story — no worker, no storage. The wire suite replays these same
 * projections over /mcp; here the semantics are pinned directly: node
 * order, gates, seeded rolls, timed-crisis fates, fallbacks, the status
 * meta (scene / sprite / phase / build / actions), ambient-action
 * sub-stories with fresh offer keys, journal-name uniqueness, and exact
 * contract strings.
 */

import { describe, expect, it } from "vitest";
import { decisionRequest } from "../src/story/format";
import { sceneUri, spriteUri } from "../src/story/uris";
import { walkStory, type WalkFeedback } from "../src/story/walk";
import { FIXTURE_STORY_ID, FIXTURE_TIMEOUT_MS, fixtureStory } from "./support/fixture-story";
import { projectStory, seedForRollBranch } from "./support/story-sim";

const JACKRABBIT = seedForRollBranch(fixtureStory, "wildlife-visit", 0);
const OWL = seedForRollBranch(fixtureStory, "wildlife-visit", 1);

const ACTIONS_1 = {
  key: "actions-1",
  options: [
    { id: "walk-the-site", label: "Walk the site" },
    { id: "check-the-books", label: "Check the books" },
  ],
};

const texts = (projection: { beats: { text: string }[] }): string[] =>
  projection.beats.map((beat) => beat.text);

describe("determinism", () => {
  it("the same seed and inputs project the identical story", () => {
    const script = {
      answers: { "site-choice": { choice: "desert-mesa" }, "crisis-grid": { choice: "shed-load" } },
      presses: [{ at: "site-choice", choice: "check-the-books" }],
    };
    const first = projectStory(fixtureStory, "Twin", JACKRABBIT, script);
    const second = projectStory(fixtureStory, "Twin", JACKRABBIT, script);
    expect(first).toEqual(second);
  });

  it("the wildlife roll is seeded: an owl seed detours (and pins the owl sprite), a jackrabbit seed does not", () => {
    const script = {
      answers: {
        "site-choice": { choice: "desert-mesa" },
        "crisis-grid": { choice: "ride-it-out" },
      },
    };
    const owlRun = projectStory(fixtureStory, "Aviary", OWL, script);
    const jackrabbitRun = projectStory(fixtureStory, "Warren", JACKRABBIT, script);

    const owlBeat = owlRun.beats.find(
      (beat) => beat.text === "A burrowing owl stares back from the transformer yard.",
    );
    expect(owlBeat?.meta["sprite"]).toEqual({
      uri: spriteUri(FIXTURE_STORY_ID, "owl"),
      persist: true,
    });
    expect(texts(owlRun)).toContain("Work pauses while the owl is rehomed with full honors.");
    expect(texts(jackrabbitRun)).toContain(
      "Nothing rarer than a jackrabbit turns up; work continues.",
    );
    expect(texts(jackrabbitRun).join("\n")).not.toContain("owl");
  });
});

describe("forks (the only elicits)", () => {
  it("emits the contract ask shape: key = node id, listed options, enum schema, timed crisis window on the request", () => {
    const projection = projectStory(fixtureStory, "Askbox", JACKRABBIT, {
      answers: { "site-choice": { choice: "desert-mesa" }, "crisis-grid": { choice: "shed-load" } },
    });
    expect(projection.asks.map((ask) => ask.key)).toEqual(["site-choice", "crisis-grid"]);

    const site = projection.asks.at(0);
    const siteMessage = [
      "Two parcels make the shortlist. Where does Askbox break ground?",
      "- desert-mesa: The mesa: cheap land, no river, brutal summers",
      "- river-bend: The river bend: pricey land beside cold water",
    ].join("\n");
    expect(site?.request).toEqual(decisionRequest(siteMessage, ["desert-mesa", "river-bend"]));
    expect(site?.timeoutMs).toBeUndefined();

    const crisis = projection.asks.at(1);
    expect(crisis?.timeoutMs).toBe(FIXTURE_TIMEOUT_MS);
    expect(crisis?.optionIds).toEqual(["shed-load", "ride-it-out"]);
    // The window rides the request itself AND the scene text, in words.
    expect(crisis?.request.params.timeoutMs).toBe(FIXTURE_TIMEOUT_MS);
    expect(crisis?.request.params.message).toBe(
      [
        "The grid is buckling. Does Askbox shed load or ride the heat wave out? You have 2 seconds.",
        "- shed-load: Drop to half power and protect the grid",
        "- ride-it-out: Keep building at full draw",
      ].join("\n"),
    );
  });

  it("routes each site option to its own permits beat", () => {
    const desert = projectStory(fixtureStory, "Juniper One", JACKRABBIT, {
      answers: { "site-choice": { choice: "desert-mesa" }, "crisis-grid": { choice: "shed-load" } },
    });
    const river = projectStory(fixtureStory, "Riverside", JACKRABBIT, {
      answers: { "site-choice": { choice: "river-bend" }, "crisis-grid": { choice: "shed-load" } },
    });
    expect(texts(desert)).toContain(
      "The county board waves the mesa plans through in a single hearing.",
    );
    expect(texts(river)).toContain(
      "Riverside permits crawl; the fish-ladder study alone eats a season.",
    );
  });
});

describe("gates", () => {
  it("the water gate reroutes the dry mesa to dry cooling and lets the river run wet", () => {
    const desert = projectStory(fixtureStory, "Juniper One", JACKRABBIT, {
      answers: { "site-choice": { choice: "desert-mesa" }, "crisis-grid": { choice: "shed-load" } },
    });
    const river = projectStory(fixtureStory, "Riverside", JACKRABBIT, {
      answers: { "site-choice": { choice: "river-bend" }, "crisis-grid": { choice: "shed-load" } },
    });
    expect(texts(desert)).toContain(
      "With no river in reach, engineers spec dry coolers and pray for mild summers.",
    );
    expect(texts(desert).join("\n")).not.toContain("Intake pipes reach the river");
    expect(texts(river)).toContain(
      "Intake pipes reach the river; the cooling loop will run wet and cheap.",
    );
    expect(texts(river).join("\n")).not.toContain("dry coolers");
  });

  it("the solvency gate turns a bankrupted river build into the catastrophic ending", () => {
    const broke = projectStory(fixtureStory, "Nimbus", JACKRABBIT, {
      answers: { "site-choice": { choice: "river-bend" }, "crisis-grid": "timeout" },
    });
    expect(texts(broke)).toContain(
      "No answer reaches the site office; fate decides. Breakers trip across the valley and the county remembers.",
    );
    expect(texts(broke)).toContain("The checks bounce and the contractors walk.");
    expect(broke.ending).toBe(
      "[ending:out-of-money] Nimbus stands half-lit and silent: the money ran out before the machines woke.",
    );
    // No serving-traffic or training beats on the catastrophic route.
    expect(texts(broke).join("\n")).not.toContain("serves its first traffic");
    expect(texts(broke).join("\n")).not.toContain("training run");
    // The ending beat carries the desert scene for the ending card.
    expect(broke.beats.at(-1)?.meta["scene"]).toBe(sceneUri(FIXTURE_STORY_ID, "desert"));
  });
});

describe("the status meta", () => {
  it("carries the visual state with every beat: scene, phase, build, the standing actions, and sprite firings", () => {
    const run = projectStory(fixtureStory, "Juniper One", JACKRABBIT, {
      answers: { "site-choice": { choice: "desert-mesa" }, "crisis-grid": { choice: "shed-load" } },
    });
    // Beats are pure prose: no bracket tags of any kind.
    for (const beat of run.beats) {
      expect(beat.text).not.toMatch(/^\[/);
      expect(beat.text).not.toMatch(/\(build \d+%\)/);
    }
    // The first beat: the default scene, the first phase, the standing set.
    expect(run.beats.at(0)).toEqual({
      text: "Scouts fan out across the high desert, hunting flat land and dark fiber for Juniper One.",
      meta: { scene: sceneUri(FIXTURE_STORY_ID, "desert"), phase: "site", actions: ACTIONS_1 },
    });
    // The construction beat switches the scene and reports build 0.25.
    const build = run.beats.find(
      (beat) => beat.text === "Steel rises from the pad and the first hall takes shape.",
    );
    expect(build?.meta).toEqual({
      scene: sceneUri(FIXTURE_STORY_ID, "construction"),
      phase: "build",
      build: 0.25,
      actions: ACTIONS_1,
    });
    // The crisis beat fires the storm sprite (not persisted) exactly once.
    const crisis = run.beats.find((beat) => beat.text.startsWith("A heat wave slams"));
    expect(crisis?.meta["sprite"]).toEqual({
      uri: spriteUri(FIXTURE_STORY_ID, "storm"),
      persist: false,
    });
    expect(run.beats.filter((beat) => beat.meta["sprite"] !== undefined)).toHaveLength(1);
    // Online: the hall scene at build 1.0; the phase then moves to training.
    const online = run.beats.find(
      (beat) => beat.text === "Juniper One comes online and serves its first traffic.",
    );
    expect(online?.meta).toEqual({
      scene: sceneUri(FIXTURE_STORY_ID, "hall"),
      phase: "online",
      build: 1,
      actions: ACTIONS_1,
    });
    expect(run.beats.at(-1)?.meta["phase"]).toBe("training");
    expect(run.ending).toBe(
      "[ending:model-shipped] Juniper One ships its first frontier model; the desert hums for a decade.",
    );
  });

  it("paces every beat with the story's beatSleepMs and sleeps the build nodes, under unique journal names", () => {
    const run = projectStory(fixtureStory, "Juniper One", JACKRABBIT, {
      answers: { "site-choice": { choice: "desert-mesa" }, "crisis-grid": { choice: "shed-load" } },
    });
    const paces = run.sleeps.filter((sleep) => sleep.stepName.startsWith("pace:"));
    const waits = run.sleeps.filter((sleep) => sleep.stepName.startsWith("wait:"));
    expect(paces.length).toBe(run.beats.length);
    expect(waits.map((sleep) => sleep.stepName)).toEqual(["wait:build-start", "wait:build-finish"]);
    // Every journal name (sleeps, rolls, checks, offers, asks) is unique.
    expect(new Set(run.names).size).toBe(run.names.length);
    // One check per main-line node beat while the set stands (the rolled
    // wildlife beat rides its roll and has no check of its own).
    expect(run.names.filter((name) => name.startsWith("check:")).length).toBe(run.beats.length - 1);
  });
});

describe("ambient actions", () => {
  it("a press consumed at the next beat boundary plays the sub-story, then re-offers under a fresh key", () => {
    const run = projectStory(fixtureStory, "Juniper One", JACKRABBIT, {
      answers: { "site-choice": { choice: "desert-mesa" }, "crisis-grid": { choice: "shed-load" } },
      presses: [
        { at: "site-choice", choice: "walk-the-site" },
        { at: "crisis-grid", choice: "check-the-books" },
      ],
    });
    // Offers: the opening set, then a fresh key after each consumed press.
    expect(run.offers.map((offer) => offer.key)).toEqual(["actions-1", "actions-2", "actions-3"]);
    const walkIndex = run.beats.findIndex((beat) => beat.text.startsWith("You walk the site line"));
    const permitsIndex = run.beats.findIndex((beat) => beat.text.startsWith("The county board"));
    // The sub-story beat lands right after the first main beat past the fork.
    expect(walkIndex).toBe(permitsIndex + 1);
    // The sub-story beat keeps the current phase (no phase of its own) and
    // still announces the consumed key; the NEXT main beat carries the fresh one.
    expect(run.beats.at(walkIndex)?.meta["phase"]).toBe("permits");
    expect(run.beats.at(walkIndex)?.meta["actions"]).toEqual(ACTIONS_1);
    expect(run.beats.at(walkIndex + 1)?.meta["actions"]).toEqual({
      ...ACTIONS_1,
      key: "actions-2",
    });
    // The rolled books sub-story: its lead beat, then its rolled beat, then back to the main line.
    const booksIndex = run.beats.findIndex(
      (beat) => beat.text === "The controller opens the ledger for Juniper One.",
    );
    expect(booksIndex).toBeGreaterThan(walkIndex);
    expect(run.beats.at(booksIndex + 1)?.text).toMatch(/double-billed invoice|Steel prices moved/);
    expect(run.beats.at(booksIndex + 2)?.text).toBe(
      "Nothing rarer than a jackrabbit turns up; work continues.",
    );
    // Sub-story journal names are prefixed per entry and stay unique.
    expect(run.names.filter((name) => name.startsWith("a1:"))).toEqual(["a1:pace:walk-site:0"]);
    expect(run.names.filter((name) => name.startsWith("a2:"))).toEqual([
      "a2:pace:books:0",
      "a2:roll:books",
      "a2:pace:books:roll",
    ]);
    expect(new Set(run.names).size).toBe(run.names.length);
    expect(run.ending).toBe(
      "[ending:model-shipped] Juniper One ships its first frontier model; the desert hums for a decade.",
    );
  });

  it("a press naming no action is consumed and re-offered without a sub-story", () => {
    const run = projectStory(fixtureStory, "Juniper One", JACKRABBIT, {
      answers: { "site-choice": { choice: "desert-mesa" }, "crisis-grid": { choice: "shed-load" } },
      presses: [{ at: "site-choice", choice: "not-an-action" }],
    });
    expect(run.offers.map((offer) => offer.key)).toEqual(["actions-1", "actions-2"]);
    expect(texts(run).join("\n")).not.toContain("You walk the site line");
  });

  it("the offer request lists the options the way a fork does, filled with the name", () => {
    const run = projectStory(fixtureStory, "Juniper One", JACKRABBIT, {
      answers: { "site-choice": { choice: "desert-mesa" }, "crisis-grid": { choice: "shed-load" } },
    });
    const offer = run.offers.at(0);
    expect(offer?.request.method).toBe("elicitation/create");
    expect(offer?.request.params.message).toBe(
      [
        "Standing orders — answer at any time.",
        "- walk-the-site: Walk the site",
        "- check-the-books: Check the books",
      ].join("\n"),
    );
    expect(offer?.request.params.requestedSchema).toEqual({
      type: "object",
      properties: { choice: { type: "string", enum: ["walk-the-site", "check-the-books"] } },
      required: ["choice"],
    });
  });
});

describe("fallbacks (answers that name no option)", () => {
  function driveWithAnswers(answerFor: (key: string) => WalkFeedback): string[] {
    const walk = walkStory(fixtureStory, { name: "Decliner", seed: JACKRABBIT });
    const beats: string[] = [];
    let feedback: WalkFeedback = undefined;
    for (;;) {
      const turn = walk.next(feedback);
      if (turn.done) {
        return beats;
      }
      feedback = undefined;
      const event = turn.value;
      if (event.kind === "beat") {
        beats.push(event.text);
      } else if (event.kind === "roll") {
        feedback = { kind: "rolled", index: event.pick() };
      } else if (event.kind === "check") {
        feedback = { kind: "checked", response: null };
      } else if (event.kind === "ask") {
        feedback = answerFor(event.key);
      }
    }
  }

  it("a declined untimed fork takes the first option", () => {
    const beats = driveWithAnswers((key) =>
      key === "site-choice"
        ? { kind: "answered", response: { action: "decline" } }
        : { kind: "answered", response: { action: "accept", content: { choice: "shed-load" } } },
    );
    // First option = desert-mesa: the mesa permits beat plays.
    expect(beats).toContain("The county board waves the mesa plans through in a single hearing.");
  });

  it("a malformed answer to a timed crisis lets fate decide", () => {
    const beats = driveWithAnswers((key) =>
      key === "crisis-grid"
        ? { kind: "answered", response: { action: "accept", content: { choice: "not-real" } } }
        : { kind: "answered", response: { action: "accept", content: { choice: "desert-mesa" } } },
    );
    expect(beats.join("\n")).toContain("fate decides");
  });
});

describe("walk guard rails", () => {
  it("throws on a story that bypassed validation and walks off the graph", () => {
    const broken = { ...fixtureStory, start: "nowhere" };
    const walk = walkStory(broken, { name: "Ghost", seed: 1 });
    // The opening offer comes first; the next turn walks to the unknown node.
    expect(walk.next().value).toMatchObject({ kind: "offer", key: "actions-1" });
    expect(() => walk.next()).toThrowError(/unknown node "nowhere"/);
  });
});
