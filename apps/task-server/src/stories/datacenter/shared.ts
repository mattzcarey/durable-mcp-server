/**
 * Nortada One's STANDING ambient-action set and its sub-stories, shared by
 * every arc module (the story header offers it from the start; the
 * power/water and supply/labor arcs widen it with their own asides and hand
 * it back at their exits; the endgame replaces it once traffic flows). One
 * definition, so the arcs and the story module cannot drift on ids or gotos.
 *
 * Sub-stories carry no phase (they play inside whatever phase the main line
 * is in), no decisions, and end in `return` — back to the interrupted beat.
 */

import type { StoryInput } from "../../story/format";

export type NodeInput = StoryInput["nodes"][string];
export type NodeTable = Record<string, NodeInput>;
export type ActionInput = NonNullable<StoryInput["actions"]>[number];

/** The standing set: walk the site, check the books, call the lobbyist, hold a town hall. */
export const DATACENTER_SHARED_ACTIONS: readonly ActionInput[] = [
  { id: "walk-the-site", label: "Walk the site", goto: "walk-site" },
  { id: "check-the-books", label: "Check the books", goto: "books" },
  { id: "call-the-lobbyist", label: "Call the lobbyist", goto: "lobbyist" },
  { id: "hold-a-town-hall", label: "Hold a town hall", goto: "town-hall" },
];

/** The sub-stories behind the standing set (spread into the story's nodes). */
export const datacenterSharedNodes: NodeTable = {
  "walk-site": {
    beats: ["You walk {name}'s fence line with the foreman."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "walk-site-morale",
          beat: "Someone has chalked the datacenter's name on the first steel column. Morale is up.",
        },
        {
          weight: 1,
          goto: "walk-site-snag",
          beat: "A pallet of conduit is in the wrong yard. You flag it in time.",
        },
      ],
    },
  },
  "walk-site-morale": {
    beats: [],
    effects: { goodwill: 1 },
    return: true,
  },
  "walk-site-snag": {
    beats: [],
    effects: { progress: 2, budget: -2 },
    return: true,
  },
  books: {
    beats: ["The controller opens the ledger. {name} is burning cash at the planned rate."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "books-saving",
          beat: "A double-billed transformer invoice turns up. The vendor credits it back.",
        },
        {
          weight: 1,
          goto: "books-overrun",
          beat: "Steel prices moved while nobody was looking. The estimate drifts.",
        },
      ],
    },
  },
  "books-saving": {
    beats: [],
    effects: { budget: 5 },
    return: true,
  },
  "books-overrun": {
    beats: [],
    effects: { budget: -3 },
    return: true,
  },
  lobbyist: {
    beats: ["Your lobbyist buys a councillor lunch on {name}'s tab. Doors stay open."],
    effects: { goodwill: 2, budget: -4 },
    return: true,
  },
  "town-hall": {
    beats: ["{name} books the school gym for a town hall. The coffee runs out first."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "town-hall-done",
          beat: "The room comes for the coffee and leaves mostly reassured.",
          effects: { goodwill: 1, budget: -1 },
        },
        {
          weight: 1,
          goto: "town-hall-done",
          beat: "Senhor Abrantes asks one question from the front row. It lasts eleven minutes.",
          effects: { goodwill: -1 },
        },
      ],
    },
  },
  "town-hall-done": {
    beats: [],
    return: true,
  },
};
