/**
 * Nortada One — the GPUS + LABOR arcs, as plain story data for the
 * interpreter (src/story/walk). This module registers nothing itself: the
 * story module spreads `supplyLaborNodes(...)` into the datacenter story's
 * `nodes`, the art in ./supply-art into its scenes and sprites, and passes
 * the cross-arc links in. "{name}" is the datacenter's name.
 *
 * The setting is Sines: a town of fourteen thousand with a few hundred
 * retraining coal workers, a refinery next door with crews worth poaching,
 * and a port whose road was promised a motorway forty years ago.
 *
 * Shape of the arc (all ids are kebab-case and prefixed so they cannot
 * collide with the other arcs: gpu-*, labor-*, rack-*, commission-*, act-*):
 *
 *   ENTRY  gpu-allocation-call   <- the story module links the steel beat here
 *   GPUs   allocation queue | grey-market pallet | miner liquidation auction |
 *          fly to the vendor  ->  export-control desk  ->  the dock count
 *          (gate gpus >= 25, else the shortfall fork)
 *   LABOR  headcount fork -> plumber shortage -> the poaching crisis (timed) ->
 *          the full-moon electrician -> energisation -> union standoff
 *          (gate goodwill >= 4) -> labor-complete (SUPPLY_LABOR_LABOR_EXIT:
 *          `laborExitTo` runs the crisis + wildlife arcs, whose exit comes
 *          back to rack-first-row)
 *   BUILD  rack-first-row .. rack-last-row, build 62..88% (the cold-aisle
 *          scene fills with --build-progress) -> `rackingExitTo` (the
 *          schedule gate) -> commission-week .. commission-handoff, build
 *          92..98%
 *   EXIT   commission-handoff     -> `exitTo` (the endgame's ransomware strike)
 *
 * Endings inside the arc (catastrophic, both rare and earned):
 *   seized-by-warrant          the grey-market pallet, bought hot, on a bad roll
 *   blacklisted-by-the-trades  replacement crews at the standoff when goodwill
 *                              has already gone below -3
 *
 * Resources used (declared by the datacenter story): budget, gpus, progress,
 * goodwill, power. Rough net over the arc: gpus +20..+55 (the dock gate wants
 * 25; the queue with luck, the vendor's champion, or the split order reach
 * the frontier's 45), budget -45..-90, progress +15..+35 (the racking and
 * commissioning nodes carry it), goodwill from -8 to +10 depending on the road.
 *
 * Timed crises: gpu-auction-hammer (the hammer, 20 s) and labor-poaching
 * (the recruiting tent, 20 s); both carry fate branches. Rolls are seeded and
 * journaled by the interpreter.
 *
 * Ambient actions: the entry node offers the story-level set (./shared)
 * together with the arc's own three (`supplyLaborActions`, sub-stories under
 * act-*); the exit node hands the plain story-level set back.
 *
 * Shared art referenced, declared by ./art: the dark-hall scene and the
 * stamp, truck, and protest sprites.
 */

import type { StoryInput } from "../../story/format";
import { DATACENTER_SHARED_ACTIONS as SHARED_ACTIONS, type NodeTable } from "./shared";

type ActionsInput = NonNullable<StoryInput["actions"]>;

/** The arc's first node: wire the preceding beat's `next` here. */
export const SUPPLY_LABOR_ENTRY = "gpu-allocation-call";
/** The labor arc's last node (one seam for every road out of the standoff). */
export const SUPPLY_LABOR_LABOR_EXIT = "labor-complete";
/** The racking's first node (build 62%); the last is SUPPLY_LABOR_RACKING_EXIT. */
export const SUPPLY_LABOR_RACKING_ENTRY = "rack-first-row";
/** The racking's last node (build 88%). */
export const SUPPLY_LABOR_RACKING_EXIT = "rack-last-row";
/** The commissioning's first node (build 92%). */
export const SUPPLY_LABOR_COMMISSIONING_ENTRY = "commission-week";
/** The arc's last node (build 98%). */
export const SUPPLY_LABOR_EXIT = "commission-handoff";

/** The ending ids this arc adds to the story. */
export const SUPPLY_LABOR_ENDINGS = ["seized-by-warrant", "blacklisted-by-the-trades"] as const;

/** The crisis windows: the auction hammer and the recruiting tent. */
export const AUCTION_HAMMER_TIMEOUT_MS = 20_000;
export const POACHING_TIMEOUT_MS = 20_000;

/** The cross-arc links the story module passes in. */
export interface SupplyLaborLinks {
  /** Where labor-complete hands off (the frame beat, then the crisis arcs). */
  laborExitTo: string;
  /** Where rack-last-row hands off (the schedule gate). */
  rackingExitTo: string;
  /** Where commission-handoff hands off (the endgame). */
  exitTo: string;
}

// ---------------------------------------------------------------------------
// Ambient actions: the story-level set (./shared) plus the arc's own three,
// offered together from the entry node; the exit node hands the plain set back.
// ---------------------------------------------------------------------------

export const supplyLaborActions: ActionsInput = [
  { id: "buy-the-crew-lunch", label: "Buy the crew lunch", goto: "act-lunch" },
  { id: "call-the-broker", label: "Call the broker", goto: "act-broker" },
  { id: "walk-the-yard", label: "Walk the yard", goto: "act-yard" },
];

// ---------------------------------------------------------------------------
// Nodes.
// ---------------------------------------------------------------------------

export function supplyLaborNodes(links: SupplyLaborLinks): NodeTable {
  return {
    // ===== GPUs: the allocation call =========================================
    "gpu-allocation-call": {
      phase: "gpus",
      actions: [...SHARED_ACTIONS, ...supplyLaborActions],
      beats: ["The chip vendor's allocation manager calls. {name} is forty-first in the queue."],
      decision: {
        scene:
          "Wait your turn, or meet a broker with a pallet that 'fell off a container'. Or bid at a bankrupt crypto miner's auction, or fly to the vendor. How does {name} find forty thousand chips?",
        options: [
          { id: "wait-in-the-queue", label: "Wait in the queue", goto: "gpu-queue-wait" },
          { id: "grey-market-pallet", label: "Meet the broker", goto: "gpu-grey-market" },
          {
            id: "miner-liquidation",
            label: "Bid at the auction",
            goto: "gpu-auction-preview",
            effects: { budget: -2 },
          },
          {
            id: "fly-to-the-vendor",
            label: "Fly to the vendor",
            goto: "gpu-vendor-visit",
            effects: { budget: -3 },
          },
        ],
      },
    },

    // ----- The queue -----------------------------------------------------------
    "gpu-queue-wait": {
      phase: "gpus",
      beats: ["The order is signed. The vendor's progress bar does not move for weeks."],
      effects: { budget: -25, gpus: 35 },
      roll: {
        branches: [
          {
            weight: 3,
            goto: "gpu-export-desk",
            beat: "The chips land on schedule. The account manager calls it a miracle and bills accordingly.",
          },
          {
            weight: 2,
            goto: "gpu-queue-slip",
            beat: "An 'Allocation update' email lands at 5:58 on a Friday. It is not good news.",
          },
          {
            weight: 1,
            goto: "gpu-export-desk",
            beat: "A rival's order collapses and {name} inherits its slot. Tell nobody, says the vendor.",
            effects: { gpus: 10 },
          },
        ],
      },
    },
    "gpu-queue-slip": {
      phase: "gpus",
      beats: ["The chips slip a quarter. The board hears about it on a podcast."],
      decision: {
        scene:
          "Eat the delay, buy from a reseller at a tout's price, or split the order with the other vendor. How does {name} cover the slip?",
        options: [
          {
            id: "eat-the-delay",
            label: "Eat the delay",
            goto: "gpu-export-desk",
            effects: { progress: -6 },
          },
          {
            id: "buy-a-spot-allocation",
            label: "Buy from a reseller",
            goto: "gpu-export-desk",
            effects: { budget: -18, gpus: 10 },
          },
          {
            id: "split-with-the-other-vendor",
            label: "Split the order",
            goto: "gpu-second-vendor",
            effects: { budget: -10, gpus: 10 },
          },
        ],
      },
    },
    "gpu-second-vendor": {
      phase: "gpus",
      beats: [
        "Different plug, different compiler. The engineers start a wiki page called 'Two Of Everything'.",
      ],
      effects: { progress: -3 },
      next: "gpu-export-desk",
    },

    // ----- The vendor visit --------------------------------------------------
    "gpu-vendor-visit": {
      phase: "gpus",
      beats: ["You fly out with a deck and a bottle the CEO is rumoured to like."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "gpu-export-desk",
            beat: "The chief of staff likes the story. A 'strategic allocation' appears overnight.",
            effects: { gpus: 45, budget: -30, goodwill: 1 },
          },
          {
            weight: 2,
            goto: "gpu-queue-wait",
            beat: "You get forty minutes, a lapel pin, and a slightly worse queue number.",
          },
          {
            weight: 1,
            goto: "gpu-auction-preview",
            beat: "Wrong building. The guard's brother-in-law liquidates mining farms, and hands you a laminated card.",
          },
        ],
      },
    },

    // ----- The grey market ---------------------------------------------------
    "gpu-grey-market": {
      phase: "gpus",
      beats: ["Dmitri, no surname, has photos of twenty crates and a suspiciously round price."],
      decision: {
        scene:
          "Dmitri wants a wire by Friday and no questions about the pallet. What does {name} do?",
        options: [
          {
            id: "inspect-the-pallet",
            label: "Inspect the pallet",
            goto: "gpu-grey-inspect",
            effects: { budget: -2 },
          },
          {
            id: "wire-the-money",
            label: "Wire the money",
            goto: "gpu-grey-wire",
            effects: { budget: -15 },
          },
          { id: "walk-away", label: "Walk away", goto: "gpu-queue-wait" },
        ],
      },
    },
    "gpu-grey-inspect": {
      phase: "gpus",
      beats: [
        "Your engineer reads serial numbers off twenty crates while Dmitri's cousin watches.",
      ],
      roll: {
        branches: [
          {
            weight: 3,
            goto: "gpu-grey-loaded",
            beat: "The serials are clean: a startup that ran out of money before ambition.",
            effects: { budget: -15, gpus: 20 },
          },
          {
            weight: 2,
            goto: "gpu-grey-stolen",
            beat: "The serials trace to a cloud giant's scrap bin. These were meant to be shredded.",
          },
        ],
      },
    },
    "gpu-grey-stolen": {
      phase: "gpus",
      beats: ["Dmitri shrugs in a way that suggests he has been shrugged at before."],
      decision: {
        scene:
          "The pallet is hot, the price is cold, and the hall is empty. Does {name} walk, or buy and hope?",
        options: [
          {
            id: "report-the-pallet",
            label: "Report it and walk",
            goto: "gpu-queue-wait",
            effects: { goodwill: 2 },
          },
          {
            id: "buy-it-anyway",
            label: "Buy it anyway",
            goto: "gpu-grey-heat",
            effects: { budget: -12, gpus: 20, goodwill: -2 },
          },
        ],
      },
    },
    "gpu-grey-heat": {
      phase: "gpus",
      beats: ["The boards run beautifully for a month. Then their serial numbers phone home."],
      roll: {
        branches: [
          {
            weight: 3,
            goto: "gpu-grey-loaded",
            beat: "They settle quietly: a 'recovery fee', a donation, and a promise of silence.",
            effects: { budget: -10 },
          },
          {
            weight: 2,
            goto: "gpu-queue-wait",
            beat: "Their lawyers arrive with a forklift. The pallet leaves and the lawyers stay for lunch.",
            effects: { gpus: -20, goodwill: -2 },
          },
          {
            weight: 1,
            goto: "ending-grey-market-raid",
            beat: "It is not lawyers who arrive. It is the judicial police with a warrant.",
          },
        ],
      },
    },
    "ending-grey-market-raid": {
      phase: "gpus",
      scene: "dark-hall",
      beats: [
        "The officers catalogue every crate by torchlight. The board stops answering the phone.",
      ],
      ending: {
        id: "seized-by-warrant",
        prose:
          "{name} ends in an evidence locker. The hall stands dark, the receivers sell the racks, and Dmitri was never called Dmitri.",
      },
    },
    "gpu-grey-wire": {
      phase: "gpus",
      beats: ["The wire clears at 4:59. Dmitri sends a photo of a truck, somewhere."],
      roll: {
        branches: [
          {
            weight: 3,
            goto: "gpu-grey-loaded",
            beat: "The truck is real: twenty crates, clean serials, and a driver who needs the bathroom.",
            effects: { gpus: 20 },
          },
          {
            weight: 2,
            goto: "gpu-grey-bricks",
            beat: "Twelve crates are real. Eight hold painted heat sinks glued to bricks.",
            effects: { gpus: 8 },
          },
          {
            weight: 1,
            goto: "gpu-queue-wait",
            beat: "Dmitri's number now rings a car wash abroad. The risk register gains the word 'Dmitri'.",
            effects: { progress: -3 },
          },
        ],
      },
    },
    "gpu-grey-bricks": {
      phase: "gpus",
      beats: [
        "Your engineers weigh the bricks out of professional interest. They are good bricks.",
      ],
      decision: {
        scene: "Eight crates of bricks and twelve of silicon. How does {name} fill the gap?",
        options: [
          {
            id: "chase-dmitri",
            label: "Chase Dmitri",
            goto: "gpu-grey-chase",
            effects: { budget: -4 },
          },
          { id: "queue-for-the-rest", label: "Queue for the rest", goto: "gpu-queue-wait" },
          {
            id: "try-the-auction",
            label: "Try the auction",
            goto: "gpu-auction-preview",
            effects: { budget: -2 },
          },
        ],
      },
    },
    "gpu-grey-chase": {
      phase: "gpus",
      beats: [
        "An investigator follows the money through three shell companies and a yacht broker.",
      ],
      roll: {
        branches: [
          {
            weight: 1,
            goto: "gpu-queue-wait",
            beat: "The yacht broker settles rather than explain. Half the money comes back in euros.",
            effects: { budget: 8 },
          },
          {
            weight: 1,
            goto: "gpu-queue-wait",
            beat: "The trail ends at a mailbox in a country whose national sport is mailboxes.",
            effects: { budget: -3 },
          },
        ],
      },
    },
    "gpu-grey-loaded": {
      phase: "gpus",
      sprite: { id: "crate" },
      beats: ["The crates go into a cage. The guard asks no questions, then asks one."],
      next: "gpu-export-desk",
    },

    // ----- Export control ----------------------------------------------------
    "gpu-export-desk": {
      phase: "gpus",
      beats: [
        "Compliance reads the shipping route. The boards pass through a port banned last Tuesday.",
      ],
      decision: {
        scene:
          "File the paperwork, reroute through a friendly port at a 'special' rate, or sail on and apologise. How does {name} clear export control?",
        options: [
          {
            id: "file-the-end-user-certificate",
            label: "File the paperwork",
            goto: "gpu-export-cleared",
            effects: { progress: -4 },
          },
          {
            id: "reroute-through-a-friendly-port",
            label: "Reroute the ship",
            goto: "gpu-export-reroute",
            effects: { budget: -8 },
          },
          { id: "ship-and-apologise-later", label: "Let it sail", goto: "gpu-export-gamble" },
        ],
      },
    },
    "gpu-export-cleared": {
      phase: "gpus",
      sprite: { id: "stamp" },
      beats: [
        "Six weeks later the certificate comes back stamped in three colours. Compliance frames it.",
      ],
      effects: { goodwill: 1 },
      next: "gpu-landed",
    },
    "gpu-export-reroute": {
      phase: "gpus",
      beats: ["The ship turns south. The forwarder sends a sunset photo, as if that settles it."],
      roll: {
        branches: [
          {
            weight: 3,
            goto: "gpu-landed",
            beat: "The friendly port is friendly. The containers clear in a day.",
          },
          {
            weight: 2,
            goto: "gpu-landed",
            beat: "The port is full. The ship waits three weeks for a crane repair.",
            effects: { progress: -5 },
          },
        ],
      },
    },
    "gpu-export-gamble": {
      phase: "gpus",
      beats: ["The containers sail. The lawyers draft an apology and keep it in a drawer."],
      roll: {
        branches: [
          {
            weight: 3,
            goto: "gpu-landed",
            beat: "Nobody looks. Nobody ever looks, until they do.",
          },
          {
            weight: 2,
            goto: "gpu-export-seized",
            beat: "Somebody looks. A customs officer with a long afternoon opens container four.",
          },
        ],
      },
    },
    "gpu-export-seized": {
      phase: "gpus",
      beats: ["Container four is held for 'review', which means a shed with a padlock."],
      effects: { gpus: -10, goodwill: -2 },
      decision: {
        scene: "Ten thousand boards sit in a shed with a padlock. What does {name} do about it?",
        options: [
          {
            id: "fight-the-seizure",
            label: "Fight the seizure",
            goto: "gpu-seizure-hearing",
            effects: { budget: -10 },
          },
          {
            id: "write-it-off",
            label: "Write it off",
            goto: "gpu-landed",
            effects: { budget: -6 },
          },
        ],
      },
    },
    "gpu-seizure-hearing": {
      phase: "gpus",
      beats: ["The hearing lasts four hours. Three of them are about the word 'transit'."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "gpu-landed",
            beat: "Container four is released with a warning letter your lawyer calls 'practically a compliment'.",
            effects: { gpus: 10 },
          },
          {
            weight: 1,
            goto: "gpu-landed",
            beat: "Container four stays in the shed. The shed, you are told, is climate controlled.",
            effects: { progress: -3 },
          },
        ],
      },
    },

    // ----- The liquidation auction -----------------------------------------
    "gpu-auction-preview": {
      phase: "gpus",
      scene: "auction",
      beats: [
        "Four thousand mining rigs stand under sodium light. The auctioneer wears a hat indoors.",
      ],
      decision: {
        scene:
          "Lot 7 is the chips. Lot 12 is everything, including the switchgear and the pigeons. The big cloud company's buyer is here too. What does {name} bid on?",
        options: [
          { id: "bid-on-the-accelerators", label: "Bid on Lot 7", goto: "gpu-auction-hammer" },
          {
            id: "bid-on-the-whole-farm",
            label: "Bid on Lot 12",
            goto: "gpu-auction-whole-farm",
            effects: { budget: -35, gpus: 30, power: 10 },
          },
          { id: "leave-the-auction", label: "Keep the paddle down", goto: "gpu-queue-wait" },
        ],
      },
    },
    "gpu-auction-hammer": {
      phase: "gpus",
      sprite: { id: "auction-gavel" },
      beats: ["Lot 7. The cloud buyer raises without looking up, and the hat turns to you."],
      decision: {
        scene: "The hammer is up and the room is watching. Does {name} raise or hold?",
        options: [
          {
            id: "raise",
            label: "Raise",
            goto: "gpu-auction-won",
            effects: { budget: -20, gpus: 30 },
          },
          { id: "hold", label: "Hold", goto: "gpu-auction-lost" },
        ],
        timeoutMs: AUCTION_HAMMER_TIMEOUT_MS,
        fateGoto: "gpu-auction-fate",
      },
    },
    "gpu-auction-fate": {
      phase: "gpus",
      beats: ["Your cough is taken as a bid on Lot 8: pallet racking and pigeons."],
      effects: { budget: -8, progress: 2 },
      next: "gpu-queue-wait",
    },
    "gpu-auction-won": {
      phase: "gpus",
      sprite: { id: "crate" },
      beats: ["Lot 7 is yours. The cloud buyer shakes your hand like someone filing a note."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "gpu-auction-haul",
            beat: "The cards need a firmware flash and a clean. Old chips beat an empty hall.",
          },
          {
            weight: 1,
            goto: "gpu-auction-haul",
            beat: "A third of the cards spent two summers at ninety degrees. They are recycled.",
            effects: { gpus: -10 },
          },
        ],
      },
    },
    "gpu-auction-lost": {
      phase: "gpus",
      beats: ["The cloud buyer leaves with the cards, surprised at having to pay."],
      next: "gpu-queue-wait",
    },
    "gpu-auction-whole-farm": {
      phase: "gpus",
      beats: ["You buy the farm: racks, switchgear, four thousand fans, and the pigeons."],
      next: "gpu-auction-haul",
    },
    "gpu-auction-haul": {
      phase: "gpus",
      sprite: { id: "truck" },
      beats: [
        "The haul arrives smelling of hot attic. The foreman counts it twice and writes 'approximately'.",
      ],
      next: "gpu-dock-count",
    },

    // ----- Landing and the dock count --------------------------------------
    "gpu-landed": {
      phase: "gpus",
      sprite: { id: "truck" },
      beats: ["The trucks roll in under escort. Each crate is insured for more than the land."],
      next: "gpu-dock-count",
    },
    "gpu-dock-count": {
      phase: "gpus",
      gate: { resource: "gpus", min: 25, elseGoto: "gpu-shortfall" },
      beats: [
        "Enough silicon to fill the hall. The foreman signs for more than the town's budget.",
      ],
      next: "labor-headcount",
    },
    "gpu-shortfall": {
      phase: "gpus",
      beats: ["The count comes in short. The cold aisles will be cold for the wrong reason."],
      decision: {
        scene:
          "Lease a rival's cloud for a year and call it yours. Go back to the board, or open half a hall. How does {name} close the gap?",
        options: [
          {
            id: "lease-cloud-capacity",
            label: "Lease cloud capacity",
            goto: "gpu-shortfall-lease",
            effects: { budget: -15, gpus: 10 },
          },
          {
            id: "pitch-the-board",
            label: "Pitch the board",
            goto: "gpu-board-pitch",
            effects: { budget: -1 },
          },
          {
            id: "open-half-a-hall",
            label: "Open half a hall",
            goto: "gpu-half-hall",
            effects: { progress: 4 },
          },
        ],
      },
    },
    "gpu-shortfall-lease": {
      phase: "gpus",
      beats: ["The rival's sales team sends a fruit basket. The note says 'Welcome'."],
      next: "labor-headcount",
    },
    "gpu-board-pitch": {
      phase: "gpus",
      beats: ["Slide one: 'The Gap'. Slide two: 'Closing The Gap', mostly a photo of the sea."],
      roll: {
        branches: [
          {
            weight: 1,
            goto: "labor-headcount",
            beat: "The board says yes. The chair says this is the last time, again.",
            effects: { budget: 30, gpus: 20 },
          },
          {
            weight: 1,
            goto: "gpu-half-hall",
            beat: "The board says no, kindly, with a hand on your shoulder that lingers too long.",
            effects: { goodwill: -1 },
          },
        ],
      },
    },
    "gpu-half-hall": {
      phase: "gpus",
      beats: ["The empty rows get a tarp and a sign that says 'Phase Two', confidently."],
      next: "labor-headcount",
    },

    // ===== Labor: the headcount ==============================================
    "labor-headcount": {
      phase: "labor",
      beats: [
        "Eight hundred skilled workers are needed by spring. Sines has a few hundred coal workers retraining.",
      ],
      decision: {
        scene:
          "Call the union hall, take the lowest bid, or poach from the refinery's shutdown crews. Who builds {name}?",
        options: [
          {
            id: "sign-with-the-union-hall",
            label: "Call the union hall",
            goto: "labor-union-terms",
            effects: { budget: -12, goodwill: 3 },
          },
          {
            id: "open-shop-lowest-bid",
            label: "Take the lowest bid",
            goto: "labor-open-shop",
            effects: { budget: -4, goodwill: -1 },
          },
          {
            id: "poach-from-across-the-valley",
            label: "Poach from the refinery",
            goto: "labor-poach-first",
            effects: { budget: -10, goodwill: -2 },
          },
        ],
      },
    },
    "labor-union-terms": {
      phase: "labor",
      beats: ["The union agent reads the whole agreement aloud, including the part about parking."],
      decision: {
        scene: "The union deal is on the table and so is a pen. Does {name} sign, or haggle?",
        options: [
          {
            id: "sign-the-pla",
            label: "Sign it",
            goto: "labor-plumbers",
            effects: { budget: -8, goodwill: 2 },
          },
          { id: "haggle-the-overtime", label: "Haggle the overtime", goto: "labor-pla-haggle" },
        ],
      },
    },
    "labor-pla-haggle": {
      phase: "labor",
      beats: ["The haggle takes nine days and two lunches. You pay for the second."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "labor-plumbers",
            beat: "He gives on overtime and takes it back on parking. You both call it a win.",
            effects: { budget: 4 },
          },
          {
            weight: 1,
            goto: "labor-plumbers",
            beat: "He walks out over a comma. Talks resume a week later, with a worse comma.",
            effects: { goodwill: -2, progress: -3 },
          },
        ],
      },
    },
    "labor-open-shop": {
      phase: "labor",
      beats: ["The lowest bid is forty percent under the next. Genius, or arithmetic."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "labor-plumbers",
            beat: "The low bidder has built three halls and a cathedral. The cathedral is straight.",
          },
          {
            weight: 1,
            goto: "labor-plumbers",
            beat: "The low bidder's last job is a car park that leans.",
            effects: { progress: -4 },
          },
        ],
      },
    },
    "labor-poach-first": {
      phase: "labor",
      beats: ["Your recruiter parks at the refinery gate. By Friday: ninety people and an enemy."],
      effects: { progress: 2 },
      next: "labor-plumbers",
    },

    // ----- The plumber shortage --------------------------------------------
    "labor-plumbers": {
      phase: "labor",
      sprite: { id: "wrench" },
      beats: [
        "The problem is plumbers: eleven within two hundred kilometres, and two of them are the same man.",
      ],
      decision: {
        scene:
          "Fly in plumbers from the north, train the old coal crews, or prefab the pipework and crane it in. How does {name} find forty plumbers?",
        options: [
          {
            id: "fly-in-a-crew",
            label: "Fly in a crew",
            goto: "labor-plumbers-flown",
            effects: { budget: -12 },
          },
          {
            id: "start-an-apprenticeship",
            label: "Train your own",
            goto: "labor-plumbers-apprentice",
            effects: { budget: -6, goodwill: 2, progress: -4 },
          },
          {
            id: "prefab-the-pipework",
            label: "Prefab the pipework",
            goto: "labor-plumbers-prefab",
            effects: { budget: -10, progress: 2 },
          },
        ],
      },
    },
    "labor-plumbers-flown": {
      phase: "labor",
      beats: ["Forty plumbers fly in with their own wrenches and opinions about the wind."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "labor-pipe-test",
            beat: "They work like a stage crew and burn like tourists. The loop goes in early.",
            effects: { progress: 3 },
          },
          {
            weight: 1,
            goto: "labor-plumber-bidding-war",
            beat: "The rival's recruiter finds the camp. By day four half the crew want bifanas.",
          },
        ],
      },
    },
    "labor-plumber-bidding-war": {
      phase: "labor",
      beats: ["The foreman brings a number on a napkin. It is not a small napkin."],
      decision: {
        scene:
          "The plumbers want the rival's daily rate or they walk to the refinery. Does {name} match it?",
        options: [
          {
            id: "match-the-per-diem",
            label: "Match it",
            goto: "labor-pipe-test",
            effects: { budget: -8 },
          },
          {
            id: "let-them-walk",
            label: "Let them walk",
            goto: "labor-pipe-test",
            effects: { progress: -6 },
          },
        ],
      },
    },
    "labor-plumbers-apprentice": {
      phase: "labor",
      beats: ["The old coal crews take a night class. Its graduates are slow, careful, and local."],
      effects: { goodwill: 1 },
      next: "labor-pipe-test",
    },
    "labor-plumbers-prefab": {
      phase: "labor",
      beats: ["Each skid is a small cathedral of valves. The crane swings them in."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "labor-pipe-test",
            beat: "The skids land on their bolts first time. The contractor photographs it for his mother.",
          },
          {
            weight: 1,
            goto: "labor-pipe-test",
            beat: "The drawings were metric and the building was not. Grinders sing for a week.",
            effects: { budget: -4, progress: -2 },
          },
        ],
      },
    },
    "labor-pipe-test": {
      phase: "labor",
      beats: [
        "Pressure test day. The pumps wind up and the contractor stops breathing on principle.",
      ],
      roll: {
        branches: [
          {
            weight: 3,
            goto: "labor-poaching",
            beat: "The loop holds overnight. Somebody writes 'DRY' on the whiteboard and underlines it twice.",
          },
          {
            weight: 1,
            goto: "labor-poaching",
            beat: "One joint weeps onto a switchboard installed early. Nobody is ahead of schedule now.",
            effects: { budget: -5, progress: -2 },
          },
        ],
      },
    },

    // ----- The poaching crisis (timed) --------------------------------------
    "labor-poaching": {
      phase: "crisis",
      sprite: { id: "recruiter", persist: true },
      beats: [
        "A rival's recruiting tent is at your gate. Bifanas, and a signing bonus with a comma in it.",
      ],
      decision: {
        scene:
          "Match the bonus, walk the line and make your case, or let them go. By lunch the tent will have names on a clipboard. How does {name} answer the recruiters?",
        options: [
          {
            id: "match-the-bonus",
            label: "Match the bonus",
            goto: "labor-poach-held",
            effects: { budget: -15 },
          },
          { id: "counter-with-culture", label: "Walk the line", goto: "labor-poach-culture" },
          {
            id: "let-them-go",
            label: "Let them go",
            goto: "labor-poach-loss",
            effects: { progress: -8 },
          },
        ],
        timeoutMs: POACHING_TIMEOUT_MS,
        fateGoto: "labor-poach-fate",
      },
    },
    "labor-poach-held": {
      phase: "labor",
      beats: ["The memo is up by ten, the tent gone by two. The bifana van stays."],
      effects: { goodwill: 1 },
      next: "labor-electrician",
    },
    "labor-poach-culture": {
      phase: "labor",
      beats: ["You walk the line without a microphone and say what {name} is for."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "labor-electrician",
            beat: "It lands. The recruiter leaves with nine names and a bifana.",
            effects: { goodwill: 2 },
          },
          {
            weight: 1,
            goto: "labor-rehire",
            beat: "It lands with some. The rest would rather be paid in money than meaning.",
            effects: { progress: -5 },
          },
        ],
      },
    },
    "labor-poach-loss": {
      phase: "labor",
      beats: ["A hundred and forty walk to the refinery. The ones who stay are the ones you want."],
      next: "labor-rehire",
    },
    "labor-poach-fate": {
      phase: "crisis",
      beats: [
        "The clipboard decides. By lunch the tent has two hundred names and your electrical foreman.",
      ],
      effects: { progress: -10, goodwill: -1 },
      next: "labor-rehire",
    },
    "labor-rehire": {
      phase: "labor",
      beats: ["The staffing slide is a question mark again, and this time it is underlined."],
      decision: {
        scene:
          "Recruit from Brazil and pay for flights, or run long days. Or park your own tent outside the rival's gate. The site is short-handed. How does {name} refill the crews?",
        options: [
          {
            id: "hire-from-three-states-over",
            label: "Fly in recruits",
            goto: "labor-electrician",
            effects: { budget: -10 },
          },
          {
            id: "stretch-the-schedule",
            label: "Stretch the schedule",
            goto: "labor-electrician",
            effects: { progress: -4, goodwill: -1 },
          },
          {
            id: "raise-your-own-tent",
            label: "Raise your own tent",
            goto: "labor-tent-war",
            effects: { budget: -6 },
          },
        ],
      },
    },
    "labor-tent-war": {
      phase: "labor",
      beats: ["Two tents, two vans, one road. The police park between them and eat at both."],
      roll: {
        branches: [
          {
            weight: 1,
            goto: "labor-electrician",
            beat: "Your van is better. Sixty come back, and forty of theirs come too.",
            effects: { progress: 4, goodwill: -1 },
          },
          {
            weight: 1,
            goto: "labor-electrician",
            beat: "Their van is better. It is, annoyingly, a very good van.",
            effects: { progress: -2 },
          },
        ],
      },
    },

    // ----- The full-moon electrician ---------------------------------------
    "labor-electrician": {
      phase: "labor",
      scene: "full-moon",
      beats: [
        "Ten thousand cable ends need fitting. Every foreman says the same name: Luz Delgado.",
        "Forty years, never failed an inspection, and she only works by full moon. She does not explain.",
      ],
      decision: {
        scene:
          "The next full moon is eleven days out. The regular crews can start tomorrow. Who fits {name}'s switchgear?",
        options: [
          {
            id: "wait-for-the-moon",
            label: "Wait for the moon",
            goto: "labor-moon-wait",
            effects: { budget: -8, progress: -3 },
          },
          {
            id: "hire-the-day-crew",
            label: "Hire the day crew",
            goto: "labor-day-crew",
            effects: { budget: -10 },
          },
          {
            id: "hire-both",
            label: "Hire both",
            goto: "labor-moon-and-crew",
            effects: { budget: -16 },
          },
        ],
      },
    },
    "labor-moon-wait": {
      phase: "labor",
      sprite: { id: "moon", persist: true },
      beats: ["The crews learn the lunar calendar. The moon fattens on schedule."],
      roll: {
        branches: [
          {
            weight: 3,
            goto: "labor-switchgear",
            beat: "Clear sky, and Delgado works three nights straight. The inspector calls it art.",
            effects: { progress: 6, goodwill: 1 },
          },
          {
            weight: 1,
            goto: "labor-switchgear",
            beat: "Cloud. Delgado says the moon counts even unseen, and the arguing costs a night.",
            effects: { progress: -2 },
          },
        ],
      },
    },
    "labor-day-crew": {
      phase: "labor",
      sprite: { id: "sparks" },
      beats: ["The day crew starts at sunrise and works by volume. It is fine, mostly."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "labor-switchgear",
            beat: "Inspection passes with a list of notes the foreman calls 'opinions'.",
          },
          {
            weight: 1,
            goto: "labor-switchgear",
            beat: "Inspection fails on torque, and four hundred cable ends are redone. Now they understand Delgado.",
            effects: { budget: -5, progress: -3 },
          },
        ],
      },
    },
    "labor-moon-and-crew": {
      phase: "labor",
      sprite: { id: "moon" },
      beats: ["The day crew works by sun and Delgado by moon. Two shifts, one legend."],
      effects: { progress: 4, goodwill: 1 },
      next: "labor-switchgear",
    },
    "labor-switchgear": {
      phase: "labor",
      sprite: { id: "sparks" },
      beats: [
        "The main breaker closes and every panel wakes in order, like a choir that has practised.",
      ],
      effects: { progress: 3 },
      next: "labor-standoff-gate",
    },

    // ----- The union standoff ----------------------------------------------
    "labor-standoff-gate": {
      phase: "labor",
      gate: { resource: "goodwill", min: 4, elseGoto: "labor-union-standoff" },
      beats: ["The stewards sign off the racking plan without a fight. Somebody brings pastries."],
      next: SUPPLY_LABOR_LABOR_EXIT,
    },
    "labor-union-standoff": {
      phase: "labor",
      sprite: { id: "protest", persist: true },
      beats: ["Dawn: pickets at the gate. The fight is over who racks the servers."],
      decision: {
        scene:
          "Let the electricians rack and the IT crew cable, or call a referee and keep the gate shut. Or bring in a replacement crew under escort. Every hour costs what a plumber makes in a month. How does {name} end the standoff?",
        options: [
          {
            id: "concede-jurisdiction",
            label: "Let the electricians rack",
            goto: "labor-standoff-settled",
            effects: { budget: -8, goodwill: 3 },
          },
          {
            id: "call-for-arbitration",
            label: "Call in a referee",
            goto: "labor-arbitration",
            effects: { progress: -4 },
          },
          {
            id: "bring-in-replacements",
            label: "Bring in replacements",
            goto: "labor-replacements",
            effects: { goodwill: -4, progress: -6 },
          },
        ],
      },
    },
    "labor-standoff-settled": {
      phase: "labor",
      beats: ["The deal is signed on the bonnet of a van. The pastries arrive late."],
      next: SUPPLY_LABOR_LABOR_EXIT,
    },
    "labor-arbitration": {
      phase: "labor",
      beats: ["The referee retired from the bench in 2004, and so did his opinions about servers."],
      roll: {
        branches: [
          {
            weight: 1,
            goto: SUPPLY_LABOR_LABOR_EXIT,
            beat: "The ruling goes your way. The agent stops talking to you.",
            effects: { goodwill: -1 },
          },
          {
            weight: 1,
            goto: SUPPLY_LABOR_LABOR_EXIT,
            beat: "The ruling goes their way, with back pay for the week the gate was shut.",
            effects: { budget: -10, goodwill: 1 },
          },
        ],
      },
    },
    "labor-replacements": {
      phase: "labor",
      gate: { resource: "goodwill", min: -3, elseGoto: "ending-trades-walk" },
      beats: [
        "The replacements arrive in vans with taped windows. The racking starts, slowly, under a loud silence.",
      ],
      next: SUPPLY_LABOR_LABOR_EXIT,
    },
    "ending-trades-walk": {
      phase: "labor",
      scene: "dark-hall",
      beats: [
        "A brass band turns the vans back. Every trade from Lisbon to the Algarve blacklists you.",
      ],
      ending: {
        id: "blacklisted-by-the-trades",
        prose:
          "{name} is finished in everything but the finishing. It has power, water, and nobody left who will rack a single server.",
      },
    },

    "labor-complete": {
      phase: "labor",
      beats: [],
      next: links.laborExitTo,
    },

    // ===== Build: racking, piece by piece ====================================
    "rack-first-row": {
      phase: "build",
      scene: "cold-aisle",
      buildPercent: 62,
      beats: [
        "The first rack rolls down the cold aisle, a technician walking backwards in front. Somebody applauds.",
      ],
      effects: { progress: 5 },
      next: "rack-second-row",
    },
    "rack-second-row": {
      phase: "build",
      buildPercent: 68,
      beats: ["Row two. The rhythm arrives: jack, roll, bolt, cable, next."],
      effects: { progress: 4 },
      roll: {
        branches: [
          {
            weight: 3,
            goto: "rack-cabling",
            beat: "Forty racks by Friday and nobody has dropped one.",
          },
          {
            weight: 1,
            goto: "rack-cabling",
            beat: "Rack thirty-one meets a loose floor tile. The insurance form is twelve pages.",
            effects: { budget: -4, gpus: -1 },
          },
        ],
      },
    },
    "rack-cabling": {
      phase: "build",
      buildPercent: 74,
      beats: [
        "Forty thousand fibre jumpers, each hand-labelled by somebody who now hates the alphabet.",
      ],
      decision: {
        scene:
          "Double shifts with the lights on, one careful shift, or the cable-pulling robot the rep keeps emailing about. How does {name} run the cable?",
        options: [
          {
            id: "run-double-shifts",
            label: "Run double shifts",
            goto: "rack-double-shift",
            effects: { budget: -10, progress: 8 },
          },
          {
            id: "steady-single-shift",
            label: "One careful shift",
            goto: "rack-steady",
            effects: { progress: 3 },
          },
          {
            id: "rent-the-cable-robot",
            label: "Rent the robot",
            goto: "rack-robot",
            effects: { budget: -7 },
          },
        ],
      },
    },
    "rack-double-shift": {
      phase: "build",
      buildPercent: 82,
      beats: ["The hall never goes dark. The night shift's handwriting is, frankly, better."],
      roll: {
        branches: [
          {
            weight: 3,
            goto: "rack-last-row",
            beat: "The cable is in four days early. The night shift asks, reasonably, about a bonus.",
            effects: { budget: -3 },
          },
          {
            weight: 1,
            goto: "rack-last-row",
            beat: "A night tech swaps the A and B feeds on a whole row. Nobody notices until commissioning.",
            effects: { progress: -4 },
          },
        ],
      },
    },
    "rack-steady": {
      phase: "build",
      buildPercent: 80,
      beats: [
        "One shift, tidy trays, every jumper dressed like it will be photographed. Several are.",
      ],
      effects: { goodwill: 1 },
      next: "rack-last-row",
    },
    "rack-robot": {
      phase: "build",
      buildPercent: 80,
      beats: ["The robot pulls cable beautifully in a straight line and has views about corners."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "rack-last-row",
            beat: "The robot does the trays, the humans the corners, and the rep a case study.",
            effects: { progress: 5 },
          },
          {
            weight: 1,
            goto: "rack-last-row",
            beat: "The robot wraps a fibre bundle round an upright. It takes a hacksaw.",
            effects: { progress: -2, budget: -2 },
          },
        ],
      },
    },
    "rack-last-row": {
      phase: "build",
      buildPercent: 88,
      sprite: { id: "crate" },
      beats: ["The last rack. The foreman bolts it down himself and the crew signs it."],
      effects: { progress: 5 },
      next: links.rackingExitTo,
    },

    // ===== Commissioning week ================================================
    "commission-week": {
      phase: "build",
      buildPercent: 92,
      beats: [
        "Commissioning week. Everyone who ever said 'that is a commissioning problem' is in one room.",
      ],
      roll: {
        branches: [
          {
            weight: 3,
            goto: "commission-ist",
            beat: "The first hall passes its smoke test, which means no smoke. Everyone is pleased.",
          },
          {
            weight: 2,
            goto: "commission-ist",
            beat: "A load bank trips the hall. Somebody copied a breaker setting from another building.",
            effects: { budget: -5 },
          },
          {
            weight: 1,
            goto: "commission-ist",
            beat: "The control system thinks it is 1970 and opens every damper. The fix comes from a beach.",
            effects: { progress: -3, budget: -3 },
          },
        ],
      },
    },
    "commission-ist": {
      phase: "build",
      beats: ["The big test: pull the grid and see whether the generators catch the hall."],
      decision: {
        scene:
          "The snag list still has two hundred lines. Does {name} run the big test now, or clear the list first?",
        options: [
          {
            id: "pull-the-plug-now",
            label: "Pull the plug now",
            goto: "commission-ist-roll",
            effects: { progress: 4 },
          },
          {
            id: "clear-the-punch-list-first",
            label: "Clear the list first",
            goto: "commission-punch-list",
            effects: { progress: -3, goodwill: 1 },
          },
        ],
      },
    },
    "commission-punch-list": {
      phase: "build",
      beats: ["Two hundred lines become forty, then nine, then one argument about a door closer."],
      next: "commission-ist-roll",
    },
    "commission-ist-roll": {
      phase: "build",
      sprite: { id: "sparks" },
      beats: [
        "The breaker opens. For one and a half seconds the hall runs on batteries and faith.",
      ],
      roll: {
        branches: [
          {
            weight: 3,
            goto: "commission-signoff",
            beat: "The generators catch the load like a drummer catching a dropped stick.",
            effects: { progress: 5 },
          },
          {
            weight: 1,
            goto: "commission-signoff",
            beat: "A row of racks reboots in the dark. The test runs again at midnight.",
            effects: { progress: -3, budget: -6 },
          },
        ],
      },
    },
    "commission-signoff": {
      phase: "build",
      buildPercent: 96,
      sprite: { id: "stamp" },
      beats: ["The agent signs the last page and asks whether anyone here has done this before."],
      effects: { progress: 4 },
      next: "commission-handoff",
    },
    "commission-handoff": {
      phase: "build",
      buildPercent: 98,
      actions: [...SHARED_ACTIONS],
      beats: ["Operations takes the keys. {name} is built, and now it has to work."],
      next: links.exitTo,
    },

    // ===== Ambient action sub-stories (return to the interrupted beat) =======
    // No phase: they play inside whatever phase the main line is in.
    "act-lunch": {
      beats: ["You put the café on {name}'s tab. The crews eat like people being looked after."],
      effects: { budget: -2, goodwill: 1 },
      return: true,
    },
    "act-broker": {
      beats: ["You call a broker who knows a broker."],
      roll: {
        branches: [
          {
            weight: 1,
            goto: "act-broker-done",
            beat: "A cancelled order surfaces: a few hundred clean boards, yours if you wire today.",
            effects: { gpus: 2, budget: -3 },
          },
          {
            weight: 2,
            goto: "act-broker-done",
            beat: "Nothing this week. He will call, and he does not call.",
          },
        ],
      },
    },
    "act-broker-done": {
      beats: [],
      return: true,
    },
    "act-yard": {
      beats: ["You walk the yard with a torch, past the crates and the cable drums."],
      roll: {
        branches: [
          {
            weight: 1,
            goto: "act-yard-done",
            beat: "A fibre drum is out in the rain. You move it in time.",
            effects: { progress: 1 },
          },
          {
            weight: 1,
            goto: "act-yard-done",
            beat: "Everything is in place. Either the crew is perfect or the torch needs batteries.",
          },
        ],
      },
    },
    "act-yard-done": {
      beats: [],
      return: true,
    },
  };
}
