/**
 * Unit tests for the story schema (zod shape) and the graph validator: a
 * minimal valid story passes, and a deliberately-broken story fails each
 * rule with its stable tag. Also asserts the full registry — every story
 * registered (the shipped datacenter and odyssey, plus the fixture)
 * validates clean.
 */

import { describe, expect, it } from "vitest";
import { listStories, registerStory } from "../src/story";
import { storySchema, type Story, type StoryInput } from "../src/story/format";
import { svgDocument } from "../src/story/svg";
import { validateStory } from "../src/story/validate";
import "../src/stories";
import { fixtureStory } from "./support/fixture-story";

const SVG = svgDocument(`<rect width="640" height="360" fill="#000"/>`);

/** A minimal valid story: start "a" -> ending "b", one scene, one sprite, one action sub-story. */
function validStory(): StoryInput {
  return {
    id: "probe",
    title: "Probe",
    blurb: "A probe.",
    defaultName: "Probe",
    phases: [
      { id: "site", label: "Site" },
      { id: "online", label: "Online" },
    ],
    resources: { budget: 0, water: 0 },
    start: "a",
    defaultScene: "main",
    scenes: { main: SVG },
    sprites: { flash: SVG },
    actions: [{ id: "look", label: "Look around", goto: "look" }],
    nodes: {
      a: { phase: "site", scene: "main", beats: ["Ground is broken."], next: "b" },
      b: { phase: "online", beats: [], ending: { id: "done", prose: "It stands." } },
      look: { beats: ["You look around."], return: true },
    },
  };
}

function problemsOf(input: StoryInput): string[] {
  return validateStory(storySchema.parse(input));
}

function expectProblem(input: StoryInput, tag: string): void {
  const problems = problemsOf(input);
  expect(
    problems.some((problem) => problem.startsWith(`${tag}:`)),
    `expected a "${tag}:" problem, got:\n${problems.join("\n")}`,
  ).toBe(true);
}

describe("the story schema (zod shape)", () => {
  it("parses the minimal valid story", () => {
    expect(storySchema.safeParse(validStory()).success).toBe(true);
  });

  it("rejects a non-kebab-case node id", () => {
    const story = validStory();
    story.nodes["Bad_Id"] = { phase: "site", beats: [], next: "b" };
    expect(storySchema.safeParse(story).success).toBe(false);
  });

  it("rejects an unknown property (strict objects for author typos)", () => {
    const story = validStory();
    (story.nodes["a"] as Record<string, unknown>)["beatz"] = ["typo"];
    expect(storySchema.safeParse(story).success).toBe(false);
  });

  it("rejects a scene or sprite that is not an <svg> document", () => {
    const story = validStory();
    story.scenes["main"] = "<div>not svg</div>";
    expect(storySchema.safeParse(story).success).toBe(false);
  });

  it("rejects an out-of-range buildPercent and an empty beat line", () => {
    const badProgress = validStory();
    badProgress.nodes["a"] = { phase: "site", beats: ["x"], buildPercent: 101, next: "b" };
    expect(storySchema.safeParse(badProgress).success).toBe(false);

    const emptyBeat = validStory();
    emptyBeat.nodes["a"] = { phase: "site", beats: [""], next: "b" };
    expect(storySchema.safeParse(emptyBeat).success).toBe(false);
  });

  it("requires phases, a blurb, a default name, and a default scene", () => {
    const story = validStory();
    (story as Record<string, unknown>)["phases"] = [];
    expect(storySchema.safeParse(story).success).toBe(false);
    const noBlurb = validStory();
    delete (noBlurb as Record<string, unknown>)["blurb"];
    expect(storySchema.safeParse(noBlurb).success).toBe(false);
  });
});

describe("the graph validator", () => {
  it("passes the minimal valid story", () => {
    expect(problemsOf(validStory())).toEqual([]);
  });

  it("missing-start: the start id must be a node", () => {
    const story = validStory();
    story.start = "nowhere";
    expectProblem(story, "missing-start");
  });

  it("reserved-id: node ids must not collide with the actions-{n} offer keys", () => {
    const story = validStory();
    story.nodes["actions-1"] = { phase: "site", beats: [], next: "b" };
    story.nodes["a"] = { phase: "site", beats: [], next: "actions-1" };
    expectProblem(story, "reserved-id");
  });

  it("unresolved-target: every next, option goto, fateGoto, elseGoto, roll goto, and action goto must resolve", () => {
    const badNext = validStory();
    badNext.nodes["a"] = { phase: "site", beats: [], next: "nowhere" };
    expectProblem(badNext, "unresolved-target");

    const badOption = validStory();
    badOption.nodes["a"] = {
      phase: "site",
      beats: [],
      decision: { scene: "Where?", options: [{ id: "x", label: "X", goto: "nowhere" }] },
    };
    expectProblem(badOption, "unresolved-target");

    const badFate = validStory();
    badFate.nodes["a"] = {
      phase: "site",
      beats: [],
      decision: {
        scene: "Now what?",
        options: [{ id: "x", label: "X", goto: "b" }],
        timeoutMs: 1_000,
        fateGoto: "nowhere",
      },
    };
    expectProblem(badFate, "unresolved-target");

    const badGate = validStory();
    badGate.nodes["a"] = {
      phase: "site",
      beats: [],
      gate: { resource: "budget", min: 0, elseGoto: "nowhere" },
      next: "b",
    };
    expectProblem(badGate, "unresolved-target");

    const badRoll = validStory();
    badRoll.nodes["a"] = {
      phase: "site",
      beats: [],
      roll: { branches: [{ weight: 1, goto: "nowhere" }] },
    };
    expectProblem(badRoll, "unresolved-target");

    const badAction = validStory();
    badAction.actions = [{ id: "look", label: "Look", goto: "nowhere" }];
    expectProblem(badAction, "unresolved-target");

    const badNodeAction = validStory();
    badNodeAction.nodes["a"] = {
      phase: "site",
      beats: ["x"],
      actions: [{ id: "peek", label: "Peek", goto: "nowhere" }],
      next: "b",
    };
    expectProblem(badNodeAction, "unresolved-target");
  });

  it("continuation: a node needs exactly one of ending, decision, roll, next, return", () => {
    const none = validStory();
    none.nodes["a"] = { phase: "site", beats: ["Stuck."] };
    expectProblem(none, "continuation");

    const two = validStory();
    two.nodes["b"] = {
      phase: "online",
      beats: [],
      next: "a",
      ending: { id: "done", prose: "It stands." },
    };
    expectProblem(two, "continuation");
  });

  it("decision-question: the scene must end with its question", () => {
    const story = validStory();
    story.nodes["a"] = {
      phase: "site",
      beats: [],
      decision: { scene: "No question here.", options: [{ id: "x", label: "X", goto: "b" }] },
    };
    expectProblem(story, "decision-question");
  });

  it("duplicate-option: option ids must be unique within a decision", () => {
    const story = validStory();
    story.nodes["a"] = {
      phase: "site",
      beats: [],
      decision: {
        scene: "Which twin?",
        options: [
          { id: "x", label: "One", goto: "b" },
          { id: "x", label: "Other", goto: "b" },
        ],
      },
    };
    expectProblem(story, "duplicate-option");
  });

  it("crisis-timeout: timeoutMs and fateGoto come together or not at all", () => {
    const timeoutOnly = validStory();
    timeoutOnly.nodes["a"] = {
      phase: "site",
      beats: [],
      decision: {
        scene: "Now what?",
        options: [{ id: "x", label: "X", goto: "b" }],
        timeoutMs: 1_000,
      },
    };
    expectProblem(timeoutOnly, "crisis-timeout");

    const fateOnly = validStory();
    fateOnly.nodes["a"] = {
      phase: "site",
      beats: [],
      decision: {
        scene: "Now what?",
        options: [{ id: "x", label: "X", goto: "b" }],
        fateGoto: "b",
      },
    };
    expectProblem(fateOnly, "crisis-timeout");
  });

  it("no-ending: a story without any ending node is rejected", () => {
    const story = validStory();
    story.nodes["b"] = { phase: "online", beats: [], next: "a" };
    expectProblem(story, "no-ending");
  });

  it("duplicate-ending: ending ids must be unique across the story", () => {
    const story = validStory();
    story.nodes["a"] = {
      phase: "site",
      beats: [],
      roll: {
        branches: [
          { weight: 1, goto: "b" },
          { weight: 1, goto: "c" },
        ],
      },
    };
    story.nodes["c"] = { phase: "site", beats: [], ending: { id: "done", prose: "Twice." } };
    expectProblem(story, "duplicate-ending");
  });

  it("duplicate-phase and unknown-phase: phases are declared once and referenced by id", () => {
    const dup = validStory();
    dup.phases = [
      { id: "site", label: "Site" },
      { id: "site", label: "Again" },
      { id: "online", label: "Online" },
    ];
    expectProblem(dup, "duplicate-phase");

    const unknown = validStory();
    unknown.nodes["a"] = { phase: "landscaping", beats: [], next: "b" };
    expectProblem(unknown, "unknown-phase");
  });

  it("unknown-resource: effects, option effects, roll-branch effects, and gates name declared resources", () => {
    const effects = validStory();
    effects.nodes["a"] = { phase: "site", beats: [], effects: { vibes: 1 }, next: "b" };
    expectProblem(effects, "unknown-resource");

    const gate = validStory();
    gate.nodes["a"] = {
      phase: "site",
      beats: [],
      gate: { resource: "vibes", min: 0, elseGoto: "b" },
      next: "b",
    };
    expectProblem(gate, "unknown-resource");

    const option = validStory();
    option.nodes["a"] = {
      phase: "site",
      beats: [],
      decision: {
        scene: "Which?",
        options: [{ id: "x", label: "X", goto: "b", effects: { vibes: 1 } }],
      },
    };
    expectProblem(option, "unknown-resource");

    const branch = validStory();
    branch.nodes["a"] = {
      phase: "site",
      beats: [],
      roll: { branches: [{ weight: 1, goto: "b", effects: { vibes: 1 } }] },
    };
    expectProblem(branch, "unknown-resource");
  });

  it("unknown-scene and unknown-sprite: visuals must be declared", () => {
    const scene = validStory();
    scene.nodes["a"] = { phase: "site", scene: "void", beats: ["x"], next: "b" };
    expectProblem(scene, "unknown-scene");

    const defaultScene = validStory();
    defaultScene.defaultScene = "void";
    expectProblem(defaultScene, "unknown-scene");

    const sprite = validStory();
    sprite.nodes["a"] = { phase: "site", sprite: { id: "ghost" }, beats: ["x"], next: "b" };
    expectProblem(sprite, "unknown-sprite");

    const branchSprite = validStory();
    branchSprite.nodes["a"] = {
      phase: "site",
      beats: [],
      roll: { branches: [{ weight: 1, goto: "b", beat: "x", sprite: { id: "ghost" } }] },
    };
    expectProblem(branchSprite, "unknown-sprite");
  });

  it("visual-needs-beat: a scene or sprite needs a beat to ride on", () => {
    const scene = validStory();
    scene.nodes["a"] = { phase: "site", scene: "main", beats: [], next: "b" };
    expectProblem(scene, "visual-needs-beat");

    const branch = validStory();
    branch.nodes["a"] = {
      phase: "site",
      beats: [],
      roll: { branches: [{ weight: 1, goto: "b", sprite: { id: "flash" } }] },
    };
    expectProblem(branch, "visual-needs-beat");
  });

  it("duplicate-action: action ids are unique within a set", () => {
    const story = validStory();
    story.actions = [
      { id: "look", label: "Look", goto: "look" },
      { id: "look", label: "Look again", goto: "look" },
    ];
    expectProblem(story, "duplicate-action");
  });

  it("action-scope: sub-stories stay off the main line and carry no decisions or action sets", () => {
    const overlap = validStory();
    overlap.actions = [{ id: "look", label: "Look", goto: "a" }];
    delete overlap.nodes["look"];
    expectProblem(overlap, "action-scope");

    const decision = validStory();
    decision.nodes["look"] = {
      beats: [],
      decision: { scene: "Which?", options: [{ id: "x", label: "X", goto: "look-done" }] },
    };
    decision.nodes["look-done"] = { beats: [], return: true };
    expectProblem(decision, "action-scope");

    const nested = validStory();
    nested.nodes["look"] = {
      beats: ["x"],
      actions: [{ id: "peek", label: "Peek", goto: "look" }],
      return: true,
    };
    expectProblem(nested, "action-scope");
  });

  it("return-scope: a main-line node cannot return", () => {
    const story = validStory();
    story.nodes["a"] = { phase: "site", beats: [], return: true };
    expectProblem(story, "return-scope");
  });

  it("unreachable: every node must be reachable from start (action gotos count)", () => {
    const story = validStory();
    story.nodes["orphan"] = { phase: "site", beats: [], next: "b" };
    expectProblem(story, "unreachable");

    // A sub-story node IS reachable, through its action.
    expect(problemsOf(validStory())).toEqual([]);
  });

  it("dead-end: main-line nodes must reach an ending; sub-story nodes a return or an ending", () => {
    const main = validStory();
    main.nodes["c"] = { phase: "site", beats: [], next: "d" };
    main.nodes["d"] = { phase: "site", beats: [], next: "c" };
    expectProblem(main, "dead-end");

    const sub = validStory();
    sub.nodes["look"] = { beats: [], next: "look-more" };
    sub.nodes["look-more"] = { beats: [], next: "look" };
    expectProblem(sub, "dead-end");
  });

  it("cycle: the graph must be acyclic, even when endings stay reachable", () => {
    const story = validStory();
    story.nodes["a"] = {
      phase: "site",
      beats: [],
      decision: {
        scene: "Again?",
        options: [
          { id: "on", label: "Onward", goto: "b" },
          { id: "again", label: "Once more", goto: "a" },
        ],
      },
    };
    const problems = problemsOf(story);
    expect(problems.some((problem) => problem.startsWith("cycle:"))).toBe(true);
    expect(problems.some((problem) => problem.startsWith("dead-end:"))).toBe(false);
  });

  it("node-id: the validator itself flags non-kebab ids (belt over the schema)", () => {
    const parsed = storySchema.parse(validStory());
    const ending = parsed.nodes["b"];
    const bad = { ...parsed, nodes: { ...parsed.nodes, Bad_Id: ending } } as Story;
    expect(validateStory(bad).some((problem) => problem.startsWith("node-id:"))).toBe(true);
  });
});

describe("the registry", () => {
  it("holds the shipped stories and the fixture, and every registered story validates clean", () => {
    const stories = listStories();
    const ids = stories.map((story) => story.id);
    expect(ids).toContain("datacenter");
    expect(ids).toContain("odyssey");
    expect(ids).toContain(fixtureStory.id);
    for (const story of stories) {
      expect(validateStory(story), story.id).toEqual([]);
    }
  });

  it("rejects an invalid story at registration", () => {
    const story = validStory();
    story.id = "probe-broken";
    story.nodes["a"] = { phase: "site", beats: [], next: "nowhere" };
    expect(() => registerStory(story)).toThrowError(/unresolved-target/);
  });

  it("rejects a duplicate story id", () => {
    const again = validStory();
    again.id = fixtureStory.id;
    expect(() => registerStory(again)).toThrowError(/already registered/);
  });
});
