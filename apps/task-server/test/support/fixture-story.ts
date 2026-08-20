/**
 * The built-in fixture story the suites play: small, but it exercises every
 * interpreter feature — a two-way site fork, a timed grid crisis with a fate
 * branch, a seeded wildlife roll (with a sprite on one branch), two resource
 * gates (water routes the cooling build; budget decides the ending),
 * scenes, a persisted and a fading sprite, build percentages, "{name}"
 * substitution, a standing ambient-action set with two sub-stories (one
 * linear, one rolled), and one triumphant + one catastrophic ending.
 *
 * Importing this module registers the story: tests and the SELF worker share
 * one isolate (and so one registry) per test file, which makes this fixture
 * playable over the wire as `start` { story: "fixture-high-desert" }.
 *
 * Budget lines that matter to tests: the river parcel is expensive (5 left
 * at the crisis), so a timed-out crisis (-10) bankrupts it into the
 * catastrophic ending via the solvency gate; the mesa parcel always stays
 * solvent. The mesa also never reaches 60 water, so the water gate reroutes
 * it to dry cooling.
 */

import { registerStory } from "../../src/story";
import type { Story, StoryInput } from "../../src/story/format";
import { svgDocument } from "../../src/story/svg";

/** The crisis window: short enough for a real in-test wait. */
export const FIXTURE_TIMEOUT_MS = 2_000;

/** Beat pacing: one durable sleep after every beat, so pollers see each line. */
export const FIXTURE_BEAT_SLEEP_MS = 400;

export const FIXTURE_STORY_ID = "fixture-high-desert";
export const FIXTURE_DEFAULT_NAME = "Desert One";

const fixture: StoryInput = {
  id: FIXTURE_STORY_ID,
  title: "High Desert Buildout",
  blurb: "A small test story: one site fork, one timed crisis, one wildlife roll.",
  accent: "#f6821f",
  defaultName: FIXTURE_DEFAULT_NAME,
  phases: [
    { id: "site", label: "Site" },
    { id: "permits", label: "Permits" },
    { id: "power", label: "Power" },
    { id: "water", label: "Water" },
    { id: "cooling", label: "Cooling" },
    { id: "gpus", label: "GPUs" },
    { id: "build", label: "Build" },
    { id: "crisis", label: "Crisis" },
    { id: "wildlife", label: "Wildlife" },
    { id: "labor", label: "Labor" },
    { id: "online", label: "Online" },
    { id: "training", label: "Training" },
  ],
  resources: { budget: 100, water: 50, power: 0, goodwill: 5, gpus: 0, progress: 0 },
  start: "site-survey",
  defaultScene: "desert",
  beatSleepMs: FIXTURE_BEAT_SLEEP_MS,
  actions: [
    { id: "walk-the-site", label: "Walk the site", goto: "walk-site" },
    { id: "check-the-books", label: "Check the books", goto: "books" },
  ],
  scenes: {
    desert: svgDocument(`<rect width="640" height="360" fill="#f7dcb4"/>`),
    construction: svgDocument(
      `<rect width="640" height="360" fill="#e4bf8d"/><rect x="180" y="120" width="280" height="130" fill="#6b7d8f" style="transform:scaleY(var(--build-progress,0));transform-origin:320px 250px"/>`,
    ),
    hall: svgDocument(`<rect width="640" height="360" fill="#0b1118"/>`),
  },
  sprites: {
    owl: svgDocument(`<circle cx="500" cy="260" r="40" fill="#6d563d"/>`),
    storm: svgDocument(`<rect width="640" height="120" fill="#3b3f5c" opacity="0.8"/>`),
  },
  nodes: {
    "site-survey": {
      phase: "site",
      scene: "desert",
      beats: [
        "Scouts fan out across the high desert, hunting flat land and dark fiber for {name}.",
      ],
      next: "site-choice",
    },
    "site-choice": {
      phase: "site",
      beats: [],
      decision: {
        scene: "Two parcels make the shortlist. Where does {name} break ground?",
        options: [
          {
            id: "desert-mesa",
            label: "The mesa: cheap land, no river, brutal summers",
            goto: "permits-desert",
            effects: { budget: -10 },
          },
          {
            id: "river-bend",
            label: "The river bend: pricey land beside cold water",
            goto: "permits-river",
            effects: { budget: -40, water: 20 },
          },
        ],
      },
    },
    "permits-desert": {
      phase: "permits",
      beats: ["The county board waves the mesa plans through in a single hearing."],
      effects: { goodwill: 1 },
      next: "power-quote",
    },
    "permits-river": {
      phase: "permits",
      beats: ["Riverside permits crawl; the fish-ladder study alone eats a season."],
      effects: { goodwill: -1 },
      next: "power-quote",
    },
    "power-quote": {
      phase: "power",
      beats: ["The utility quotes a substation upgrade: forty megawatts by summer."],
      effects: { power: 40, budget: -30 },
      next: "water-intake",
    },
    "water-intake": {
      phase: "water",
      gate: { resource: "water", min: 60, elseGoto: "cooling-dry" },
      beats: ["Intake pipes reach the river; the cooling loop will run wet and cheap."],
      effects: { water: -10 },
      next: "gpu-order",
    },
    "cooling-dry": {
      phase: "cooling",
      beats: ["With no river in reach, engineers spec dry coolers and pray for mild summers."],
      effects: { budget: -15 },
      next: "gpu-order",
    },
    "gpu-order": {
      phase: "gpus",
      beats: ["Forty thousand accelerators go on order; the vendor books a yacht."],
      effects: { gpus: 40, budget: -25 },
      next: "build-start",
    },
    "build-start": {
      phase: "build",
      scene: "construction",
      buildPercent: 25,
      beats: ["Steel rises from the pad and the first hall takes shape."],
      effects: { progress: 25 },
      sleepMs: 250,
      next: "crisis-grid",
    },
    "crisis-grid": {
      phase: "crisis",
      sprite: { id: "storm" },
      beats: ["A heat wave slams the region and the grid operator calls the site office."],
      decision: {
        scene: "The grid is buckling. Does {name} shed load or ride the heat wave out?",
        options: [
          {
            id: "shed-load",
            label: "Drop to half power and protect the grid",
            goto: "wildlife-visit",
            effects: { goodwill: 2, progress: -5 },
          },
          {
            id: "ride-it-out",
            label: "Keep building at full draw",
            goto: "wildlife-visit",
            effects: { goodwill: -2 },
          },
        ],
        timeoutMs: FIXTURE_TIMEOUT_MS,
        fateGoto: "grid-fate",
      },
    },
    "grid-fate": {
      phase: "crisis",
      beats: [
        "No answer reaches the site office; fate decides. Breakers trip across the valley and the county remembers.",
      ],
      effects: { goodwill: -3, budget: -10 },
      next: "wildlife-visit",
    },
    "wildlife-visit": {
      phase: "wildlife",
      beats: ["A biologist walks the fence line with a clipboard."],
      roll: {
        branches: [
          {
            weight: 3,
            goto: "build-finish",
            beat: "Nothing rarer than a jackrabbit turns up; work continues.",
          },
          {
            weight: 1,
            goto: "owl-delay",
            beat: "A burrowing owl stares back from the transformer yard.",
            sprite: { id: "owl", persist: true },
          },
        ],
      },
    },
    "owl-delay": {
      phase: "wildlife",
      beats: ["Work pauses while the owl is rehomed with full honors."],
      effects: { budget: -5, goodwill: 1 },
      next: "build-finish",
    },
    "build-finish": {
      phase: "build",
      buildPercent: 90,
      beats: ["Racks slide home and the halls begin to hum."],
      effects: { progress: 65 },
      sleepMs: 250,
      next: "solvency-check",
    },
    "solvency-check": {
      phase: "labor",
      gate: { resource: "budget", min: 0, elseGoto: "ending-broke" },
      beats: [],
      next: "online-day",
    },
    "online-day": {
      phase: "online",
      scene: "hall",
      buildPercent: 100,
      beats: ["{name} comes online and serves its first traffic."],
      effects: { progress: 10 },
      next: "training-day",
    },
    "training-day": {
      phase: "training",
      beats: ["The first training run lights every hall; loss curves bend the right way."],
      next: "ending-triumph",
    },
    "ending-triumph": {
      phase: "training",
      beats: ["The board flies in for the ribbon cutting."],
      ending: {
        id: "model-shipped",
        prose: "{name} ships its first frontier model; the desert hums for a decade.",
      },
    },
    "ending-broke": {
      phase: "labor",
      scene: "desert",
      beats: ["The checks bounce and the contractors walk."],
      ending: {
        id: "out-of-money",
        prose: "{name} stands half-lit and silent: the money ran out before the machines woke.",
      },
    },
    // Ambient action sub-stories (no phase: they play inside the current one).
    "walk-site": {
      beats: ["You walk the site line with the foreman; the crew looks up from their coffee."],
      effects: { goodwill: 1 },
      return: true,
    },
    books: {
      beats: ["The controller opens the ledger for {name}."],
      roll: {
        branches: [
          {
            weight: 1,
            goto: "books-done",
            beat: "A double-billed invoice turns up; the vendor credits it back.",
            effects: { budget: 5 },
          },
          {
            weight: 1,
            goto: "books-done",
            beat: "Steel prices moved while nobody was looking; the estimate drifts.",
            effects: { budget: -3 },
          },
        ],
      },
    },
    "books-done": {
      beats: [],
      return: true,
    },
  },
};

/** The parsed, validated, registered fixture. */
export const fixtureStory: Story = registerStory(fixture);
