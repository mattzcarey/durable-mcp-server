/**
 * Nortada One: a choose-your-own-adventure about building a datacenter on
 * the Atlantic coast at Sines, from the coal town's shortlist to the first
 * training run, composed from four arc modules in this folder (./land,
 * ./power, ./supply, ./crisis, with their art in the matching ./*-art
 * modules) plus the intro and the connective construction beats authored
 * here. Plain data — the interpreter (src/story/walk.ts) plays it. "{name}"
 * is the datacenter's name (default "Nortada One").
 *
 * The place: Sines, on the Alentejo coast. Portugal's largest coal plant
 * burned imported coal here for thirty-five years and closed in 2021; its
 * two dead chimneys, its seawater intake and return channels, the port, and
 * the grid are the bones the datacenter is built on. The nortada is the
 * north wind that never stops; under it a cold current runs south and
 * carries the warm return water away. The cable from Brazil lands here.
 *
 * The campaign, in main-line order (every seam is a named constant below):
 *
 *   nortada-intro                                the INTRO (the place and the name)
 *   -> land-scouts ... permits-complete          the SITE + PERMITS + COMMUNITY arc
 *   -> build-groundbreaking (8%)                 connective
 *   -> power-queue ... power-water-handoff       the POWER + WATER + COOLING arc
 *   -> build-steel (30%)                         connective
 *   -> gpu-allocation-call ... labor-complete    the GPUS + LABOR arc
 *   -> build-frame (45%)                         connective
 *   -> crisis-season ... crisis-season-closes    the CRISIS arc (quake, Atlantic storm)
 *   -> wildlife-survey ... wildlife-closing      the WILDLIFE arc (ponds, newts, sardines)
 *   -> build-roof (55%)                          connective (a rolled cameo)
 *   -> rack-first-row ... rack-last-row          the racking (62..88%)
 *   -> build-schedule-check                      connective (the progress gate)
 *   -> commission-week ... commission-handoff    the commissioning (92..98%)
 *   -> ransomware-strike ... online ... training the ENDGAME arc, to one of its endings
 *
 * Resource arithmetic (start: budget 380, water 50, power 0, goodwill 5,
 * gpus 0, progress 0):
 *   - budget: the arcs drain roughly 150..400 over a playthrough (land
 *     30..80, power/water 40..150, supply/labor 45..90, crises 30..60); the
 *     endgame gates on budget >= 0 (else receivership) and budget >= 20 (the
 *     good investor day vs the grim one). At 380, random play goes into
 *     receivership about one time in eight, a first-option run almost never,
 *     and the priciest option at every fork always — measured by the sweeps
 *     in test/datacenter.test.ts.
 *   - water >= 60 at water-plan is the seawater channels in hand (the heath
 *     and the aerodrome parcels, the cork estate's water); the dry parcels
 *     find their water; the court freeze on the channels takes it back;
 *     water < 10 afterwards pays for an emergency pipeline
 *   - goodwill >= 4 at the union standoff gate skips the pickets; goodwill
 *     < 0 when the site goes online loses the operating permit
 *   - gpus >= 25 passes the dock count; gpus >= 45 at the frontier gate ships
 *     the frontier model
 *   - progress >= 0 at build-schedule-check keeps the commissioning on
 *     schedule; below it the slip costs a quarter of overtime
 *
 * Shared art (./art): scenes desert (the Sines establishing shot: sea,
 * chimneys, basin; the key predates the move and is kept for the resource
 * URI), river, construction, hall, dark-hall, training; sprites storm, owl,
 * tortoise, truck, protest, stamp. Each arc brings its own scenes and
 * sprites (spread below; the crisis arc's "bat" sprite stands in for the
 * power arc's, both being bats).
 */

import { registerStory } from "../../story";
import type { StoryInput } from "../../story/format";
import { scenes, sprites } from "./art";
import { CRISIS_ENTRY, crisisWildlifeEndgameNodes, ENDGAME_ENTRY } from "./crisis";
import { crisisWildlifeEndgameScenes, crisisWildlifeEndgameSprites } from "./crisis-art";
import { LAND_PERMITS_ENTRY, landPermitsNodes } from "./land";
import { landPermitsSprites } from "./land-art";
import { POWER_WATER_ENTRY, powerWaterNodes } from "./power";
import { powerWaterScenes, powerWaterSprites } from "./power-art";
import { DATACENTER_SHARED_ACTIONS, datacenterSharedNodes, type NodeTable } from "./shared";
import {
  SUPPLY_LABOR_COMMISSIONING_ENTRY,
  SUPPLY_LABOR_ENTRY,
  SUPPLY_LABOR_RACKING_ENTRY,
  supplyLaborNodes,
} from "./supply";
import { supplyLaborScenes, supplyLaborSprites } from "./supply-art";

/** The intro: the first thing the player reads, before the land arc. */
const NORTADA_INTRO = "nortada-intro";

/** The connective construction beats authored here. */
const BUILD_GROUNDBREAKING = "build-groundbreaking";
const BUILD_STEEL = "build-steel";
const BUILD_FRAME = "build-frame";
const BUILD_ROOF = "build-roof";
const BUILD_SCHEDULE_CHECK = "build-schedule-check";
const BUILD_SCHEDULE_SLIP = "build-schedule-slip";

/** The progress a build must hold at the schedule check to commission on time. */
const ON_SCHEDULE_PROGRESS = 0;

const introNodes: NodeTable = {
  [NORTADA_INTRO]: {
    phase: "site",
    scene: "desert",
    beats: [
      "There was once a project to build a datacenter on the Atlantic Ocean. Its name was {name}.",
      "Sines, on the coast of Portugal, is a coal town with two dead chimneys. The old plant left a cold seawater basin behind.",
      "The north wind never stops, and they call it the nortada. Cold sea in, warm sea out, and a current to carry the heat south.",
    ],
    next: LAND_PERMITS_ENTRY,
  },
};

const buildNodes: NodeTable = {
  [BUILD_GROUNDBREAKING]: {
    phase: "build",
    scene: "construction",
    buildPercent: 8,
    effects: { progress: 5 },
    beats: [
      "A gold shovel and a photographer who wants everyone to dig at once: {name} breaks ground.",
    ],
    next: POWER_WATER_ENTRY,
  },
  [BUILD_STEEL]: {
    phase: "build",
    scene: "construction",
    buildPercent: 30,
    effects: { progress: 5 },
    beats: [
      "Steel rises from the pad. The press release restates the megawatts, upwards, for the third time.",
    ],
    next: SUPPLY_LABOR_ENTRY,
  },
  [BUILD_FRAME]: {
    phase: "build",
    scene: "construction",
    buildPercent: 45,
    effects: { progress: 5 },
    beats: ["The frame closes in. The halls finally cast a shadow."],
    next: CRISIS_ENTRY,
  },
  [BUILD_ROOF]: {
    phase: "build",
    scene: "construction",
    buildPercent: 55,
    effects: { progress: 5 },
    beats: ["Chillers land on the roof by crane, one every forty minutes, all day."],
    roll: {
      branches: [
        {
          weight: 3,
          goto: SUPPLY_LABOR_RACKING_ENTRY,
          beat: "The last chiller bolts down before dark. The crane driver eats his sandwich sixty metres up.",
        },
        {
          weight: 1,
          goto: SUPPLY_LABOR_RACKING_ENTRY,
          beat: "A tortoise crosses the access road, in no hurry. Nobody knows whose it is, and nobody honks.",
          sprite: { id: "tortoise" },
          effects: { goodwill: 1, progress: -1 },
        },
        {
          weight: 1,
          goto: SUPPLY_LABOR_RACKING_ENTRY,
          beat: "A little owl has moved into the transformer yard. The ecologist sighs and fences it off.",
          sprite: { id: "owl" },
          effects: { budget: -3, goodwill: 1 },
        },
      ],
    },
  },
  [BUILD_SCHEDULE_CHECK]: {
    phase: "build",
    gate: { resource: "progress", min: ON_SCHEDULE_PROGRESS, elseGoto: BUILD_SCHEDULE_SLIP },
    beats: ["The schedule holds. The commissioning agent is booked for the week the plan said."],
    next: SUPPLY_LABOR_COMMISSIONING_ENTRY,
  },
  [BUILD_SCHEDULE_SLIP]: {
    phase: "build",
    effects: { budget: -10 },
    beats: [
      "The schedule slipped two years somewhere. {name} commissions hall by hall on overtime.",
    ],
    next: SUPPLY_LABOR_COMMISSIONING_ENTRY,
  },
};

const story: StoryInput = {
  id: "datacenter",
  title: "Nortada One",
  blurb:
    "Sines burned coal for thirty-five years, then stopped. Build the datacenter that cools on the " +
    "Atlantic, before the money or the goodwill runs out.",
  accent: "#f6821f",
  defaultName: "Nortada One",
  phases: [
    { id: "site", label: "Site" },
    { id: "permits", label: "Permits" },
    { id: "power", label: "Power" },
    { id: "water", label: "Water" },
    { id: "cooling", label: "Cooling" },
    { id: "gpus", label: "GPUs" },
    { id: "labor", label: "Labor" },
    { id: "crisis", label: "Crisis" },
    { id: "wildlife", label: "Wildlife" },
    { id: "build", label: "Build" },
    { id: "online", label: "Online" },
    { id: "training", label: "Training" },
  ],
  resources: { budget: 380, water: 50, power: 0, goodwill: 5, gpus: 0, progress: 0 },
  start: NORTADA_INTRO,
  defaultScene: "desert",
  actions: [...DATACENTER_SHARED_ACTIONS],
  scenes: {
    ...scenes,
    ...powerWaterScenes,
    ...supplyLaborScenes,
    ...crisisWildlifeEndgameScenes,
  },
  sprites: {
    ...sprites,
    ...landPermitsSprites,
    ...powerWaterSprites,
    ...supplyLaborSprites,
    ...crisisWildlifeEndgameSprites,
  },
  nodes: {
    // The intro, then the arcs in campaign order, each handed the next beat of the campaign.
    ...introNodes,
    ...landPermitsNodes(BUILD_GROUNDBREAKING),
    ...powerWaterNodes(BUILD_STEEL),
    ...supplyLaborNodes({
      laborExitTo: BUILD_FRAME,
      rackingExitTo: BUILD_SCHEDULE_CHECK,
      exitTo: ENDGAME_ENTRY,
    }),
    ...crisisWildlifeEndgameNodes(BUILD_ROOF),
    // The connective construction beats.
    ...buildNodes,
    // The standing ambient-action sub-stories.
    ...datacenterSharedNodes,
  },
};

export const datacenterStory = registerStory(story);
