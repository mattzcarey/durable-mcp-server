/**
 * The POWER + WATER + COOLING arc of Nortada One: plain story data (nodes)
 * for the story module to spread into the datacenter story (./story); its
 * art lives in ./power-art. Nothing here registers itself.
 *
 * The setting is Sines: Portugal's mostly renewable grid and its long
 * connection queue, the refinery next door with a power block to spare, the
 * dead coal plant's switchyard, and the plant's seawater channels, which are
 * the cooling story (a closed freshwater loop indoors, seawater only at the
 * heat exchangers, the warm return carried south by the current) and the
 * subject of a fight over who owns them.
 *
 * Shape of the arc (entry `power-queue`, exit `power-water-handoff`):
 *
 *   power-queue -> power-source-choice
 *     grid:    queue purgatory (roll) -> stall fork -> line route fork
 *              (cork oaks / heath / railway, each rolled) -> grid-energize
 *     off-grid: fuel fork (pipeline / tankers / solar) -> agency roll
 *     reactor: siting fork (wait / diesel / dead coal plant) -> licence roll
 *              -> approved | delayed fork | denied
 *     refinery: terms fork (curtailment risk -> TIMED 3am call / heat trade /
 *              buy the refinery, rolled)
 *   water-plan (gate: water >= 60 = the seawater channels in hand -> channel
 *     fork) else water-source-choice: own intake (surfers fork) / the town's
 *     wells (rolled, caught fork) / closed loop / industrial water
 *   cooling-choice: air / liquid-to-chip / immersion in vegetable oil (rolled)
 *   heat-reuse-choice: pool / tomatoes / the workers' village / the sea
 *   drought-year (TIMED crisis: a court freezes the channels, fate branch)
 *     -> aftermath (water gate)
 *   power-water-handoff -> {exitTo} (the steel, at merge)
 *
 * Two endings live inside the arc: `lost-in-the-queue` (grid purgatory) and
 * `town-ran-dry` (pumping through the court order).
 *
 * Resource arithmetic it relies on (declared by the story: budget, water,
 * power, goodwill, gpus, progress):
 *   - power lands anywhere from ~15 (a betrayed refinery, a refused reactor)
 *     to ~105 (a licensed reactor with a diesel bridge)
 *   - water: the wet parcels (>= 60 on entry) get the channel fork, the dry
 *     parcels must find water; the court freeze takes 5..25 back; < 10
 *     afterwards pays for an emergency pipeline
 *   - budget swings from ~-40 (refinery heat trade, the wells, air cooling,
 *     the sea) to ~-150 (buy the refinery, an own intake, immersion, the
 *     village, a trucked-in freeze); bankruptcy is a real road
 *   - goodwill moves -6..+5 per node; progress penalties (queue purgatory,
 *     licensing, throttling) slip the downstream commissioning gate
 *
 * Node ids predate the move to Sines (smelter- is the refinery, drought- is
 * the court freeze, desal- is the own intake, aquifer- the town's wells) and
 * stay, so the wire keys, the scripted routes, and the seeded rolls stay put.
 *
 * Ambient actions: `power-queue` widens the standing set with two arc
 * asides (read the meter, check the basin) on top of the story's four
 * (./shared); `power-water-handoff` hands the plain set back.
 */

import { DATACENTER_SHARED_ACTIONS as SHARED_ACTIONS, type NodeTable } from "./shared";

/** Where the arc begins (the story links the groundbreaking beat here). */
export const POWER_WATER_ENTRY = "power-queue";
/** The arc's last node; its `next` is the `exitTo` passed to {@link powerWaterNodes}. */
export const POWER_WATER_EXIT = "power-water-handoff";

const ARC_ACTIONS = [
  { id: "read-the-meter", label: "Read the meter", goto: "meter-reading" },
  { id: "check-the-reservoir", label: "Check the basin", goto: "reservoir-check" },
] as const;

/** The ending ids this arc adds to the story. */
export const POWER_WATER_ENDINGS = ["lost-in-the-queue", "town-ran-dry"] as const;

/** Shared sprites the arc fires (declared by ./art). */
const SHARED_SPRITES = { stamp: "stamp", storm: "storm", truck: "truck" } as const;

/** Crisis windows: the refinery's 3am call and the court freeze on the channels. */
export const SMELTER_CALL_TIMEOUT_MS = 15_000;
export const DROUGHT_TIMEOUT_MS = 20_000;

// ---- Nodes -----------------------------------------------------------------

const powerNodes: NodeTable = {
  "power-queue": {
    phase: "power",
    scene: "pylons",
    actions: [...SHARED_ACTIONS, ...ARC_ACTIONS],
    beats: [
      "The power company's connection queue is four years long. {name} needs forty megawatts by summer.",
    ],
    next: "power-source-choice",
  },
  "power-source-choice": {
    buildPercent: 12,
    phase: "power",
    beats: ["The board wants electrons, and a plan before the quarter closes."],
    decision: {
      scene:
        "Join the grid queue, build your own turbines, order a small reactor, or knock on the refinery next door. How does {name} get its power?",
      options: [
        {
          id: "join-the-queue",
          label: "Join the queue",
          goto: "grid-queue-purgatory",
          effects: { budget: -30, power: 40 },
        },
        {
          id: "go-off-grid",
          label: "Go off-grid",
          goto: "offgrid-yard",
          effects: { budget: -45, power: 50, goodwill: -3 },
        },
        {
          id: "order-a-reactor",
          label: "Order a reactor",
          goto: "smr-order",
          effects: { budget: -50, goodwill: -1 },
        },
        {
          id: "knock-on-the-smelter",
          label: "Knock on the refinery",
          goto: "smelter-door",
          effects: { budget: -10 },
        },
      ],
    },
  },

  // ---- Grid: queue purgatory and the line route --------------------------
  "grid-queue-purgatory": {
    phase: "power",
    sprite: { id: "ticket", persist: true },
    beats: ["Queue number 1,847. The clerk says it moves faster than it looks, and it does not."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "grid-line-route",
          beat: "The study clears in one spring. The bill that follows is not read aloud.",
          effects: { progress: 3 },
        },
        {
          weight: 2,
          goto: "grid-queue-stalls",
          beat: "The study is re-studied. Somebody orders a fourth study to check the third.",
          effects: { progress: -5, budget: -5 },
        },
        {
          weight: 1,
          goto: "grid-line-route",
          beat: "The hydrogen plant ahead of you slips another year. {name} buys its queue slot.",
          effects: { budget: -15, progress: 5 },
        },
      ],
    },
  },
  "grid-queue-stalls": {
    phase: "power",
    beats: ["Purgatory has a waiting room, and the coffee is worse than the estimates."],
    decision: {
      scene:
        "Pay for the grid upgrades yourself, wait, or hire the old energy regulator to make calls. The queue has stopped moving. What does {name} do about it?",
      options: [
        {
          id: "fund-the-upgrades",
          label: "Fund the upgrades",
          goto: "grid-line-route",
          effects: { budget: -25, progress: 5 },
        },
        {
          id: "wait-it-out",
          label: "Wait it out",
          goto: "grid-queue-wait",
          effects: { progress: -10 },
        },
        {
          id: "hire-the-ex-commissioner",
          label: "Hire the ex-regulator",
          goto: "grid-commissioner-roll",
          effects: { budget: -8, goodwill: -2 },
        },
      ],
    },
  },
  "grid-queue-wait": {
    phase: "power",
    beats: ["Seasons pass. The site office grows a vegetable patch and a grievance."],
    roll: {
      branches: [
        {
          weight: 3,
          goto: "grid-line-route",
          beat: "The queue lurches forward one wet November. {name} is suddenly next.",
        },
        {
          weight: 1,
          goto: "ending-lost-in-queue",
          beat: "A new study puts {name} behind a datacenter nobody has announced yet.",
        },
      ],
    },
  },
  "ending-lost-in-queue": {
    phase: "power",
    scene: "pylons",
    beats: ["The land options lapse while the queue number stays exactly where it is."],
    ending: {
      id: "lost-in-the-queue",
      prose: "{name} never draws an amp. It waited its turn, and its turn never came.",
    },
  },
  "grid-commissioner-roll": {
    phase: "power",
    beats: ["The adviser knows which door at the power company is never locked."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "grid-line-route",
          beat: "Calls are made, lunches are had, and the study reaches the top.",
          effects: { progress: 5 },
        },
        {
          weight: 1,
          goto: "grid-line-route",
          beat: "A newspaper puts both his jobs in one paragraph. The power company turns frosty.",
          effects: { goodwill: -4, progress: -3 },
        },
      ],
    },
  },
  "grid-line-route": {
    phase: "power",
    beats: ["The nearest substation with room is forty kilometres inland, past the cork oaks."],
    decision: {
      scene:
        "Pylons over the cork oaks are cheap and ugly, and the oaks are protected. A tunnel under the heath is invisible and expensive, and the ponds have a lawyer. The railway wants a fee and a favour. Which way does {name}'s line run?",
      options: [
        {
          id: "over-the-moor",
          label: "Over the cork oaks",
          goto: "line-moor",
          effects: { budget: -10, goodwill: -2 },
        },
        {
          id: "under-the-bat-woods",
          label: "Under the heath",
          goto: "line-bat-woods",
          effects: { budget: -25, goodwill: 1 },
        },
        {
          id: "along-the-railway",
          label: "Along the railway",
          goto: "line-railway",
          effects: { budget: -15 },
        },
      ],
    },
  },
  "line-moor": {
    phase: "power",
    scene: "pylons",
    beats: ["Pylons march over the cork oaks, handsome on the map and ugly from the café."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "grid-energize",
          beat: "The cork growers write to every newspaper with a letters page. The line goes up anyway.",
          effects: { goodwill: -1 },
        },
        {
          weight: 1,
          goto: "grid-energize",
          beat: "A pylon footing finds an old well. The digger is recovered, the schedule is not.",
          effects: { budget: -8, progress: -4 },
        },
        {
          weight: 1,
          goto: "grid-energize",
          beat: "Eighteen hundred oaks stand in the way, and the estate's lawyer is already on the phone.",
          effects: { budget: -6, goodwill: 1 },
        },
      ],
    },
  },
  "line-bat-woods": {
    phase: "wildlife",
    sprite: { id: "bat" },
    beats: ["The ecologist's bat detector clicks like a Geiger counter."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "grid-energize",
          beat: "Common pipistrelles, says the report. The tunnel goes in and the bats do not watch.",
        },
        {
          weight: 1,
          goto: "grid-energize",
          beat: "Lesser horseshoe bats, a nursery roost. The tunnel goes deeper and waits for the pups.",
          sprite: { id: "bat", persist: true },
          effects: { budget: -12, progress: -6, goodwill: 2 },
        },
      ],
    },
  },
  "line-railway": {
    phase: "power",
    beats: ["The rail company's lawyer produces an agreement older than {name}'s parent company."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "grid-energize",
          beat: "The favour is a new footbridge at the halt, painted in {name}'s colours.",
          effects: { budget: -5, goodwill: 2 },
        },
        {
          weight: 1,
          goto: "grid-energize",
          beat: "The favour is moving a signal box. Nobody has done that since 1962.",
          effects: { budget: -10, progress: -4 },
        },
      ],
    },
  },
  "grid-energize": {
    phase: "power",
    sprite: { id: SHARED_SPRITES.stamp },
    beats: ["The line goes live at dawn. A breaker closes far away, and {name} hums."],
    next: "water-plan",
  },

  // ---- Off-grid: turbines, fuel, the environment agency -------------------
  "offgrid-yard": {
    phase: "power",
    beats: ["Turbines arrive from a cancelled plant in Spain, still wearing somebody else's logo."],
    decision: {
      scene:
        "Pipe gas from the port's terminal, truck LNG past the school, or run solar by day and turbines by night. The turbines need feeding, so what burns at {name}?",
      options: [
        {
          id: "pipeline-gas",
          label: "Pipeline gas",
          goto: "offgrid-pipeline",
          effects: { budget: -15, power: 10, goodwill: -1 },
        },
        {
          id: "trucked-lng",
          label: "Trucked LNG",
          goto: "offgrid-tankers",
          effects: { budget: -10, goodwill: -3 },
        },
        {
          id: "solar-first",
          label: "Solar first",
          goto: "offgrid-solar",
          effects: { budget: -20, power: -10, goodwill: 4 },
        },
      ],
    },
  },
  "offgrid-pipeline": {
    phase: "power",
    beats: ["The trench runs straight across three farms. Two farmers wave, and one does not."],
    next: "offgrid-air-board",
  },
  "offgrid-tankers": {
    phase: "power",
    sprite: { id: SHARED_SPRITES.truck },
    beats: ["Tankers queue through town from five a.m. The motorway is forty years late."],
    roll: {
      branches: [
        {
          weight: 3,
          goto: "offgrid-air-board",
          beat: "The convoy settles into a rhythm. The café starts opening at four.",
        },
        {
          weight: 1,
          goto: "offgrid-air-board",
          beat: "A tanker jackknifes in the first winter storm. Nobody is hurt, and everybody has photographs.",
          effects: { goodwill: -3, progress: -3 },
        },
      ],
    },
  },
  "offgrid-solar": {
    phase: "power",
    beats: ["Panels cover the south slope. The nortada salts every one by the afternoon."],
    effects: { budget: -4 },
    next: "offgrid-air-board",
  },
  "offgrid-air-board": {
    phase: "power",
    beats: ["The environment agency meets in a room with a broken projector and a lot of feeling."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "water-plan",
          beat: "The agency signs off. The blue file turns green, which almost never happens.",
        },
        {
          weight: 1,
          goto: "water-plan",
          beat: "The agency caps the turbines' hours. You sign a backup grid deal at hurry prices.",
          effects: { power: -15, budget: -12 },
        },
      ],
    },
  },

  // ---- The small modular reactor ------------------------------------------
  "smr-order": {
    phase: "power",
    scene: "reactor",
    beats: ["The reactor brochure has a cooling tower, a meadow, and no dates."],
    decision: {
      scene:
        "Wait on a cold pad, rent a diesel farm, or buy the dead coal plant, grid connection included. While the licence takes years, where does {name} get power?",
      options: [
        {
          id: "wait-for-the-licence",
          label: "Wait for the licence",
          goto: "smr-licence-wait",
          effects: { progress: -10 },
        },
        {
          id: "rent-a-diesel-farm",
          label: "Rent a diesel farm",
          goto: "smr-diesel",
          effects: { budget: -20, power: 25, goodwill: -2 },
        },
        {
          id: "buy-the-dead-coal-plant",
          label: "Buy the coal plant",
          goto: "smr-coal-site",
          effects: { budget: -20, goodwill: 1, progress: -5 },
        },
      ],
    },
  },
  "smr-diesel": {
    phase: "power",
    beats: [
      "Forty generators, each the size of a shipping container, because each is a shipping container.",
    ],
    next: "smr-licence-wait",
  },
  "smr-coal-site": {
    phase: "power",
    beats: ["The coal plant's switchyard is older than the vendor's CEO and more reliable."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "smr-licence-wait",
          beat: "The switchyard goes live on the second try. Its last electrician drives out to watch.",
          effects: { power: 25 },
        },
        {
          weight: 1,
          goto: "smr-licence-wait",
          beat: "The surveyors find asbestos, then more asbestos, then a room that was only ever asbestos.",
          effects: { budget: -15, progress: -5, power: 15 },
        },
      ],
    },
  },
  "smr-licence-wait": {
    phase: "power",
    beats: ["Lisbon has to write the reactor law first. The committee meets four times a year."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "water-plan",
          beat: "The licence issues with four hundred conditions. The reactor starts up boringly, on purpose.",
          sprite: { id: SHARED_SPRITES.stamp },
          effects: { power: 80 },
        },
        {
          weight: 2,
          goto: "smr-delayed",
          beat: "The committee wants an earthquake study. Somebody mentions 1755, and the room goes quiet.",
          effects: { budget: -10, progress: -8 },
        },
        {
          weight: 1,
          goto: "smr-abandoned",
          beat: "The licence is refused. The brochure, it turns out, was the whole product.",
          effects: { budget: -20 },
        },
      ],
    },
  },
  "smr-delayed": {
    phase: "power",
    beats: [
      "The study finds nothing, expensively. The committee schedules a meeting to discuss the nothing.",
    ],
    decision: {
      scene:
        "The reactor is a year late and counting. Does {name} stay the course or cut its losses?",
      options: [
        {
          id: "stay-the-course",
          label: "Stay the course",
          goto: "smr-approved-late",
          effects: { progress: -10 },
        },
        {
          id: "cut-the-losses",
          label: "Cut the losses",
          goto: "smr-abandoned",
          effects: { budget: -15, power: 10 },
        },
      ],
    },
  },
  "smr-approved-late": {
    phase: "power",
    sprite: { id: SHARED_SPRITES.stamp },
    beats: [
      "The licence issues at last, with five hundred conditions. The vendor pours concrete quietly.",
    ],
    effects: { power: 80 },
    next: "water-plan",
  },
  "smr-abandoned": {
    phase: "power",
    beats: ["The power company finds spare capacity, at a price that says it knows."],
    effects: { power: 20, budget: -10 },
    next: "water-plan",
  },

  // ---- The refinery next door ----------------------------------------------
  "smelter-door": {
    phase: "power",
    beats: ["The refinery's manager has a spare power block and a gas contract from 1978."],
    decision: {
      scene:
        "Promise to drop first when the grid calls, trade waste heat for her power, or buy the refinery. What does {name} offer for the spare block's power?",
      options: [
        {
          id: "take-the-curtailment-risk",
          label: "Promise to drop first",
          goto: "smelter-call",
          effects: { power: 45, budget: -5 },
        },
        {
          id: "trade-heat-for-power",
          label: "Trade heat for power",
          goto: "smelter-heat",
          effects: { power: 40, budget: -15, goodwill: 2 },
        },
        {
          id: "buy-the-smelter",
          label: "Buy the refinery",
          goto: "smelter-buyout",
          effects: { budget: -60, power: 70, goodwill: 3 },
        },
      ],
    },
  },
  "smelter-call": {
    phase: "crisis",
    sprite: { id: SHARED_SPRITES.storm },
    beats: [
      "February cold snap. The grid calls the refinery, and the refinery calls you at 3 a.m.",
    ],
    decision: {
      scene:
        "The grid wants thirty megawatts back in ten minutes. Does {name} drop first, as promised?",
      options: [
        {
          id: "drop-first",
          label: "Drop first",
          goto: "smelter-honoured",
          effects: { goodwill: 3, progress: -4 },
        },
        {
          id: "hold-the-load",
          label: "Hold the load",
          goto: "smelter-betrayed",
          effects: { goodwill: -5 },
        },
      ],
      timeoutMs: SMELTER_CALL_TIMEOUT_MS,
      fateGoto: "smelter-fate",
    },
  },
  "smelter-honoured": {
    phase: "power",
    beats: [
      "Half the halls go dark till dawn. At six the manager calls to say thank you, a first.",
    ],
    next: "water-plan",
  },
  "smelter-betrayed": {
    phase: "power",
    beats: [
      "The furnace trips and takes a week to relight. The manager tells you what a week costs.",
    ],
    effects: { budget: -20, power: -20 },
    roll: {
      branches: [
        {
          weight: 1,
          goto: "water-plan",
          beat: "She tears up the contract. {name} buys diesel all winter.",
          effects: { power: -10, budget: -8 },
        },
        {
          weight: 1,
          goto: "water-plan",
          beat: "She keeps the deal. She would rather have your money than your apology.",
          effects: { goodwill: -1 },
        },
      ],
    },
  },
  "smelter-fate": {
    phase: "crisis",
    beats: [
      "Nobody answers. The breaker trips for you, and the manager adds a clause about telephones.",
    ],
    effects: { goodwill: -2, progress: -5 },
    next: "water-plan",
  },
  "smelter-heat": {
    phase: "power",
    beats: [
      "Pipes the size of a train carry your heat to the refinery's boilers. The accountants are delighted.",
    ],
    next: "water-plan",
  },
  "smelter-buyout": {
    phase: "power",
    beats: ["{name} now owns a datacenter, a refinery, and a pension fund with strong views."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "water-plan",
          beat: "Oil crashes the week the ink dries. The datacenter quietly covers the loss.",
          effects: { budget: -15 },
        },
        {
          weight: 1,
          goto: "water-plan",
          beat: "Oil booms. The refinery, absurdly, is the profitable half of the company.",
          effects: { budget: 20, goodwill: 1 },
        },
        {
          weight: 1,
          goto: "water-plan",
          beat: "The union asks about hiring, then about pay. You answer both in writing.",
          effects: { budget: -5, goodwill: 1 },
        },
      ],
    },
  },
};

const waterNodes: NodeTable = {
  "water-plan": {
    buildPercent: 16,
    phase: "water",
    gate: { resource: "water", min: 60, elseGoto: "water-source-choice" },
    beats: ["The old plant's channels run past the fence, not caring what {name} needs."],
    decision: {
      scene:
        "Take the full flow and let the fish share. Or take less, and send it back barely warmer. Or rebuild the old cold basin and fill it from the channels. How much of the sea does {name} take?",
      options: [
        {
          id: "take-the-full-allocation",
          label: "Take the full flow",
          goto: "cooling-choice",
          effects: { water: 20, goodwill: -3 },
        },
        {
          id: "leave-the-fish-flow",
          label: "Mind the fish",
          goto: "cooling-choice",
          effects: { water: 8, goodwill: 2, budget: -5 },
        },
        {
          id: "build-a-reservoir",
          label: "Rebuild the basin",
          goto: "water-reservoir",
          effects: { budget: -20, water: 25, goodwill: 1 },
        },
      ],
    },
  },
  "water-reservoir": {
    phase: "water",
    beats: [
      "Workers reline the cold basin over the winter. By spring the gulls consider it theirs.",
    ],
    roll: {
      branches: [
        { weight: 3, goto: "cooling-choice" },
        {
          weight: 1,
          goto: "cooling-choice",
          beat: "The liner tears in the first big storm. The gulls stay, the water does not.",
          effects: { water: -15, budget: -8 },
        },
      ],
    },
  },
  "water-source-choice": {
    phase: "water",
    beats: ["The channels are not yours to open. The cooling loop will have to be clever."],
    decision: {
      scene:
        "Build your own seawater intake, or borrow from the town's wells. Or seal the loop and fill it once, or buy the industrial zone's treated water. Where does {name} get its water?",
      options: [
        {
          id: "desalinate-the-sea",
          label: "Pump the sea",
          goto: "desal-build",
          effects: { water: 40, budget: -35, goodwill: -2 },
        },
        {
          id: "borrow-from-the-locals",
          label: "Borrow the town's wells",
          goto: "aquifer-draw",
          effects: { water: 30, budget: -5, goodwill: -3 },
        },
        {
          id: "close-the-loop",
          label: "Close the loop",
          goto: "closed-loop-build",
          effects: { water: 5, budget: -25, goodwill: 2 },
        },
        {
          id: "buy-the-wastewater",
          label: "Buy industrial water",
          goto: "wastewater-deal",
          effects: { water: 25, budget: -12, goodwill: 3 },
        },
      ],
    },
  },

  // ---- The own intake and the surfers ----------------------------------------
  "desal-build": {
    phase: "water",
    scene: "coast",
    beats: [
      "The intake rises beside the coast's best surf break. The surfers notice the warm outfall.",
    ],
    decision: {
      scene:
        "Surfers Against The Plume hold a paddle-out for the television cameras. What does {name} do?",
      options: [
        {
          id: "extend-the-outfall",
          label: "Extend the outfall",
          goto: "cooling-choice",
          effects: { budget: -15, goodwill: 3 },
        },
        {
          id: "sponsor-the-surf-comp",
          label: "Sponsor the surf comp",
          goto: "desal-surf-comp",
          effects: { budget: -5 },
        },
        {
          id: "ignore-the-surfers",
          label: "Ignore the surfers",
          goto: "desal-ignored",
          effects: { goodwill: -4 },
        },
      ],
    },
  },
  "desal-surf-comp": {
    phase: "water",
    sprite: { id: "surfer" },
    beats: ["The contest runs under {name}'s banner. The swell is excellent."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "cooling-choice",
          beat: "The champion thanks the sponsors, the ocean, and her mum, in that order.",
          effects: { goodwill: 2 },
        },
        {
          weight: 1,
          goto: "cooling-choice",
          beat: "The champion uses her speech to explain the plume to four million people.",
          effects: { goodwill: -3 },
        },
      ],
    },
  },
  "desal-ignored": {
    phase: "water",
    sprite: { id: "surfer", persist: true },
    beats: [
      "The paddle-out becomes a weekly fixture. The surfers learn the names of your lawyers.",
    ],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "cooling-choice",
          beat: "Their court case fails. The surfers find the outfall is warm, and forgive it.",
        },
        {
          weight: 1,
          goto: "cooling-choice",
          beat: "Their court order holds for a season. The intake runs at half rate.",
          effects: { water: -15, progress: -6 },
        },
      ],
    },
  },

  // ---- The town's wells, the town, and the industrial pipe ----------------
  "aquifer-draw": {
    phase: "water",
    beats: ["Pumps go in at night. The town's water pressure drops, and nobody says why."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "aquifer-noticed",
          beat: "The town's wells run cloudy. The water report has {name}'s name on page one.",
        },
        {
          weight: 1,
          goto: "cooling-choice",
          beat: "Nobody notices. The aquifer is enormous, and the water scientist is on sabbatical.",
        },
      ],
    },
  },
  "aquifer-noticed": {
    phase: "water",
    beats: ["The town meeting is standing room only, mostly on purpose."],
    effects: { goodwill: -3 },
    decision: {
      scene:
        "The town wants its water back. Does {name} pay for a new reservoir, deny everything, or give the wells back and buy industrial water?",
      options: [
        {
          id: "pay-for-the-reservoir",
          label: "Pay for a reservoir",
          goto: "cooling-choice",
          effects: { budget: -20, goodwill: 5 },
        },
        {
          id: "deny-everything",
          label: "Deny everything",
          goto: "aquifer-denial",
          effects: { goodwill: -3 },
        },
        {
          id: "switch-to-wastewater",
          label: "Switch to industrial water",
          goto: "wastewater-deal",
          effects: { budget: -10, water: -15, goodwill: 3 },
        },
      ],
    },
  },
  "aquifer-denial": {
    phase: "water",
    beats: ["The lawyers argue about the word 'borrow' for a season."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "cooling-choice",
          beat: "The case is thrown out on a technicality the town remembers for a generation.",
          effects: { goodwill: -2 },
        },
        {
          weight: 1,
          goto: "cooling-choice",
          beat: "The court caps the draw at a figure that makes the chillers look cheap.",
          effects: { water: -20, budget: -10 },
        },
      ],
    },
  },
  "wastewater-deal": {
    phase: "water",
    beats: ["Treated industrial water arrives by pipe. The town sends a fruit basket."],
    next: "cooling-choice",
  },
  "closed-loop-build": {
    phase: "water",
    beats: ["The loop is filled once, from tankers. After that it only sweats."],
    roll: {
      branches: [
        {
          weight: 3,
          goto: "cooling-choice",
          beat: "The loop holds pressure. The top-up tank barely moves all summer.",
        },
        {
          weight: 1,
          goto: "cooling-choice",
          beat: "A weld lets go behind a wall nobody can reach. The plumbers get rich.",
          effects: { budget: -6, water: -5 },
        },
      ],
    },
  },
};

const coolingNodes: NodeTable = {
  "cooling-choice": {
    buildPercent: 22,
    phase: "cooling",
    beats: [
      "Eighty megawatts of silicon make eighty megawatts of heat. Physics does not negotiate.",
    ],
    decision: {
      scene:
        "Fans the size of jet engines, cold plates on every chip, or tanks of vegetable oil to dunk the servers in. How does {name} keep the halls from melting?",
      options: [
        {
          id: "air-cooling",
          label: "Air cooling",
          goto: "cooling-air",
          effects: { budget: -10, water: -10 },
        },
        {
          id: "liquid-to-chip",
          label: "Liquid to chip",
          goto: "cooling-liquid",
          effects: { budget: -25, water: -5 },
        },
        {
          id: "immersion-in-oil",
          label: "Immersion in oil",
          goto: "cooling-immersion",
          effects: { budget: -30, goodwill: 1 },
        },
      ],
    },
  },
  "cooling-air": {
    phase: "cooling",
    beats: ["Fan walls go up. On the rare still night the town can hear {name}."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "heat-reuse-choice",
          beat: "The noise report says the nearest house hears 'a distant sea'. The house, by the sea, disagrees.",
        },
        {
          weight: 1,
          goto: "heat-reuse-choice",
          beat: "The noise complaints arrive in a bundle. Silencers want money.",
          effects: { budget: -8, goodwill: -2 },
        },
      ],
    },
  },
  "cooling-liquid": {
    phase: "cooling",
    beats: ["Every rack is plumbing now. The plumbers have never been richer."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "heat-reuse-choice",
          beat: "The first cold plate leaks onto the first server. A week of testing follows.",
          effects: { progress: -3, budget: -3 },
        },
        {
          weight: 1,
          goto: "heat-reuse-choice",
          beat: "The halls are so quiet the engineers whisper out of habit.",
        },
      ],
    },
  },
  "cooling-immersion": {
    phase: "cooling",
    beats: [
      "Forty thousand servers go swimming in food-grade oil. The site smells of a sardine festival.",
    ],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "heat-reuse-choice",
          beat: "The oil supplier also supplies the sardine festival. The town thinks this is hilarious.",
          effects: { goodwill: 2 },
        },
        {
          weight: 1,
          goto: "heat-reuse-choice",
          beat: "A seal fails. The slab becomes a skating rink and the safety officer a legend.",
          effects: { budget: -6, progress: -2 },
        },
      ],
    },
  },
  "heat-reuse-choice": {
    phase: "cooling",
    beats: ["The waste heat could warm a town, and a town is right there."],
    decision: {
      scene:
        "Pipe it to the town pool, grow tomatoes in January, heat the workers' village, or send it back to the sea. Where does {name}'s waste heat go?",
      options: [
        {
          id: "heat-the-pool",
          label: "Heat the pool",
          goto: "heat-pool",
          effects: { budget: -8, goodwill: 4 },
        },
        {
          id: "grow-tomatoes",
          label: "Grow tomatoes",
          goto: "heat-tomatoes",
          effects: { budget: -12, goodwill: 2 },
        },
        {
          id: "heat-the-estate",
          label: "Heat the village",
          goto: "heat-district",
          effects: { budget: -20, goodwill: 5, progress: -3 },
        },
        {
          id: "vent-it",
          label: "Send it to sea",
          goto: "heat-vent",
          effects: { goodwill: -2 },
        },
      ],
    },
  },
  "heat-pool": {
    phase: "cooling",
    sprite: { id: "steam" },
    beats: [
      "The pool reopens in December at a temperature the lifeguards call 'suspicious'. Attendance triples.",
    ],
    next: "drought-year",
  },
  "heat-tomatoes": {
    phase: "cooling",
    sprite: { id: "tomato" },
    beats: ["Tomato vines climb in a greenhouse warmer than the server hall next door."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "drought-year",
          beat: "The January tomatoes sell out. The label says 'grown on the cloud'.",
          effects: { budget: 6, goodwill: 2 },
        },
        {
          weight: 1,
          goto: "drought-year",
          beat: "Blight takes the first crop. The manager blames the humidity, which blames the servers.",
          effects: { budget: -4 },
        },
      ],
    },
  },
  "heat-district": {
    phase: "cooling",
    beats: [
      "Pipes run under the road to the workers' village. By February nobody mentions the cranes.",
    ],
    next: "drought-year",
  },
  "heat-vent": {
    phase: "cooling",
    beats: ["The return runs a degree warmer, as the old plant's did. The surfers approve."],
    next: "drought-year",
  },
};

const droughtNodes: NodeTable = {
  "drought-year": {
    phase: "crisis",
    scene: "dry-reservoir",
    beats: [
      "A judge freezes the seawater channels. The state moved the deeds, and the old plant's owner sued.",
    ],
    decision: {
      scene:
        "Nobody may open a sluice until the deeds are settled, and the cold basin drains by tonight. What does {name} do?",
      options: [
        {
          id: "cut-the-draw",
          label: "Shut the sluices",
          goto: "drought-throttled",
          effects: { water: -10, progress: -8, goodwill: 4 },
        },
        {
          id: "truck-in-water",
          label: "Truck in water",
          goto: "drought-trucks",
          effects: { budget: -25, goodwill: -1 },
        },
        {
          id: "keep-pumping",
          label: "Keep pumping",
          goto: "drought-pumped",
          effects: { goodwill: -6, water: -5 },
        },
      ],
      timeoutMs: DROUGHT_TIMEOUT_MS,
      fateGoto: "drought-fate",
    },
  },
  "drought-throttled": {
    phase: "crisis",
    beats: ["Half the halls go dark at noon. {name} runs on industrial water until the ruling."],
    next: "drought-aftermath",
  },
  "drought-trucks": {
    phase: "crisis",
    sprite: { id: SHARED_SPRITES.truck },
    beats: ["Tankers fill the road from dawn. The café sells out of custard tarts by nine."],
    next: "drought-aftermath",
  },
  "drought-pumped": {
    phase: "crisis",
    beats: ["The pumps run all summer. The water company's lawyer is not on holiday."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "ending-town-ran-dry",
          beat: "The judge hears the pumps on a Sunday. By Monday the licence is revoked.",
        },
        {
          weight: 2,
          goto: "drought-aftermath",
          beat: "The ruling lands in October, and the fee that follows is long and unkind.",
          effects: { goodwill: -2 },
        },
      ],
    },
  },
  "drought-fate": {
    phase: "crisis",
    beats: [
      "Nobody answers. The court's bailiff padlocks the sluice himself, with a photographer.",
    ],
    effects: { water: -25, progress: -10, goodwill: -3 },
    next: "drought-aftermath",
  },
  "drought-aftermath": {
    phase: "water",
    gate: { resource: "water", min: 10, elseGoto: "water-rescue" },
    beats: [],
    next: POWER_WATER_EXIT,
  },
  "water-rescue": {
    phase: "water",
    beats: ["The tanks are dry. {name} pays for an emergency pipeline at emergency prices."],
    effects: { budget: -20, water: 20, progress: -5 },
    next: POWER_WATER_EXIT,
  },
  "ending-town-ran-dry": {
    phase: "crisis",
    scene: "dry-reservoir",
    beats: ["The cranes stand still. The channels get an owner before the licence comes back."],
    ending: {
      id: "town-ran-dry",
      prose:
        "{name} pumped through a court order. The licence is gone, the halls are empty, and only the lawsuit is still running.",
    },
  },
};

/** Ambient asides (sub-stories): no phase, they play inside whatever phase the main line is in. */
const asideNodes: NodeTable = {
  "meter-reading": {
    beats: ["You read the meter yourself. The decimal point is in an alarming place."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "arc-aside-done",
          beat: "{name} draws three megawatts more than it pays for. You mention it first.",
          effects: { budget: -3, goodwill: 1 },
        },
        {
          weight: 1,
          goto: "arc-aside-done",
          beat: "The meter agrees with the bill, which is the best a meter can do.",
        },
        {
          weight: 1,
          goto: "arc-aside-done",
          beat: "A transformer is running hot. The electricians find a loose bolt and a pigeon.",
          effects: { progress: 1 },
        },
      ],
    },
  },
  "reservoir-check": {
    beats: ["You walk out to the basin with the keeper, who has opinions about tides."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "arc-aside-done",
          beat: "A spring tide has filled the basin. The keeper takes full credit.",
          effects: { water: 4 },
        },
        {
          weight: 1,
          goto: "arc-aside-done",
          beat: "Sand has been busy. The keeper says the word 'dredge' and means it.",
          effects: { water: -3 },
        },
      ],
    },
  },
  "arc-aside-done": {
    beats: [],
    return: true,
  },
};

/**
 * Every node of the arc (spread into the story's `nodes` at merge). `exitTo`
 * is the node the hand-off beat leads to (the steel going up).
 */
export function powerWaterNodes(exitTo: string): NodeTable {
  return {
    ...powerNodes,
    ...waterNodes,
    ...coolingNodes,
    ...droughtNodes,
    [POWER_WATER_EXIT]: {
      phase: "power",
      actions: [...SHARED_ACTIONS],
      beats: ["The sluices reopen in October. Power, water, and cooling are signed and humming."],
      next: exitTo,
    },
    ...asideNodes,
  };
}
