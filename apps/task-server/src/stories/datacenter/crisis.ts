/**
 * Nortada One — the CRISIS, WILDLIFE, and ENDGAME arcs, as plain story data
 * (story contract v3, see src/story/format). The story module spreads
 * `crisisWildlifeEndgameNodes(...)` into `nodes` and the art in ./crisis-art
 * into `scenes` and `sprites`.
 *
 * The setting is Sines: a coast that has earthquakes on its calendar (1755
 * is never far from anyone's mind), Atlantic winter storms with names, the
 * temporary ponds and their marbled newts, the rare heather moved to a
 * nursery soil and all, the sardines at the seawater intake, and at the end
 * the halls (SIN01, SIN02, ...) lighting up and the cable from Brazil.
 *
 * Entry and exit points (the only cross-arc seams):
 *   - CRISIS_ENTRY   "crisis-season"          <- the frame beat links here
 *   - CRISIS_EXIT    "crisis-season-closes"   -> next: WILDLIFE_ENTRY
 *   - WILDLIFE_ENTRY "wildlife-survey"
 *   - WILDLIFE_EXIT  "wildlife-closing"       -> next: `wildlifeExitTo` (the
 *                                               roof beat, then the racking)
 *   - ENDGAME_ENTRY  "ransomware-strike"      <- the commissioning hand-off
 *                                               links here; runs to one of
 *                                               twelve endings
 *
 * The arcs use only the story's declared phases (crisis, wildlife, build,
 * permits, online, training) and resources (budget, water, power, goodwill,
 * gpus, progress). Scenes referenced from the shared art: construction,
 * hall, dark-hall, training, desert (the Sines establishing shot; the key
 * predates the move). Everything else visual is declared in ./crisis-art.
 *
 * Node ids predate the move to Sines (hurricane- is the Atlantic storm,
 * almond-farm is the cork estate) and stay, so the wire keys, the scripted
 * routes, and the seeded rolls stay put.
 *
 * Calibration (measured by random-play sweeps over the three arcs alone):
 * the crises and mitigations drain budget by roughly 30 to 60 on a typical
 * playthrough (worst case ~110, with paybacks: the insurance claim, the
 * compute rental, the hyperscaler); goodwill swings by +-10 and progress by
 * -20 to +10. The endgame gates on budget >= 0 (else receivership), goodwill
 * >= 0 (else the permit is pulled), budget >= 20 (the good investor day vs
 * the grim one), and gpus >= 45 (the frontier).
 *
 * Timed crises: the earthquake (20 s, two variants) and the ransomware call
 * during commissioning (25 s); unanswered asks take the fate branches.
 */

import type { ActionInput, NodeTable } from "./shared";

export const CRISIS_ENTRY = "crisis-season";
export const CRISIS_EXIT = "crisis-season-closes";
export const WILDLIFE_ENTRY = "wildlife-survey";
export const WILDLIFE_EXIT = "wildlife-closing";
export const ENDGAME_ENTRY = "ransomware-strike";

/** The earthquake window, in ms (both the shored and unshored strike). */
export const QUAKE_TIMEOUT_MS = 20_000;
/** The ransomware window, in ms. */
export const RANSOMWARE_TIMEOUT_MS = 25_000;

/* ---- Ambient actions (the endgame set, installed when the site goes online) */

/**
 * Replaces the build-time standing set once traffic flows; its sub-stories
 * (dash-check, oncall-shift, board-brief, ops-return) live below and return
 * to the interrupted beat.
 */
export const endgameActions: ActionInput[] = [
  { id: "watch-the-dashboards", label: "Watch the dashboards", goto: "dash-check" },
  { id: "take-the-on-call-shift", label: "Take the on-call shift", goto: "oncall-shift" },
  { id: "brief-the-board", label: "Brief the board", goto: "board-brief" },
];

/* ---- CRISIS arc: the earthquake and the Atlantic storm --------------------- */

export const crisisNodes: NodeTable = {
  "crisis-season": {
    phase: "crisis",
    beats: ["The roof is half on. The site calendar says earthquake season runs all year."],
    roll: {
      branches: [
        {
          weight: 3,
          goto: "quake-strike",
          beat: "A foreshock rattles the coffee at 4:12 a.m. Nobody thinks anything of it.",
        },
        {
          weight: 2,
          goto: "quake-forewarned",
          beat: "The national seismologist rings the site office directly. Good news never arrives that way.",
        },
      ],
    },
  },
  "quake-forewarned": {
    phase: "crisis",
    beats: [
      "A swarm is building under a fault marked 'inactive, probably'. The seismologist gives it a week.",
    ],
    decision: {
      scene:
        "Bolt shoring to every column, send everyone home on full pay, or trust the survey and keep pouring. A week's warning is more than most sites get. What does {name} do with it?",
      options: [
        {
          id: "shore-the-steel",
          label: "Shore the steel",
          goto: "quake-strike-shored",
          effects: { budget: -8, progress: -2 },
        },
        {
          id: "clear-the-site",
          label: "Clear the site",
          goto: "quake-empty-site",
          effects: { progress: -6, goodwill: 2 },
        },
        { id: "trust-the-survey", label: "Trust the survey", goto: "quake-strike" },
      ],
    },
  },
  "quake-strike": {
    phase: "crisis",
    sprite: { id: "quake" },
    beats: ["At 4:47 a.m. the ground under {name} decides, briefly, to be somewhere else."],
    decision: {
      scene:
        "The crane is swinging and the substation is live. Drop the substation and save the transformers, get every ironworker off the deck first, or keep pouring. Thirty seconds of shaking, and the site radio is in your hand. What is the call?",
      options: [
        {
          id: "kill-the-substation",
          label: "Drop the substation",
          goto: "quake-aftermath",
          effects: { power: -5, progress: -3, goodwill: 2 },
        },
        {
          id: "clear-the-steel",
          label: "Clear the deck",
          goto: "quake-aftermath",
          effects: { goodwill: 4, budget: -10 },
        },
        { id: "keep-pouring", label: "Keep pouring", goto: "quake-gamble" },
      ],
      timeoutMs: QUAKE_TIMEOUT_MS,
      fateGoto: "quake-fate",
    },
  },
  "quake-strike-shored": {
    phase: "crisis",
    sprite: { id: "quake" },
    beats: ["At 4:47 a.m. the fault keeps its appointment. The shoring sings, and mostly holds."],
    decision: {
      scene:
        "Drop the substation, get the crew off the deck, or keep pouring. The shoring is buying seconds. What does {name} spend them on?",
      options: [
        {
          id: "kill-the-substation",
          label: "Drop the substation",
          goto: "quake-aftermath-shored",
          effects: { power: -3, progress: -1, goodwill: 2 },
        },
        {
          id: "clear-the-steel",
          label: "Clear the deck",
          goto: "quake-aftermath-shored",
          effects: { goodwill: 3, budget: -5 },
        },
        { id: "keep-pouring", label: "Keep pouring", goto: "quake-gamble-shored" },
      ],
      timeoutMs: QUAKE_TIMEOUT_MS,
      fateGoto: "quake-fate-shored",
    },
  },
  "quake-empty-site": {
    phase: "crisis",
    beats: ["The quake comes on day seven and finds nobody to hurt, which seems to annoy it."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "quake-aftermath-shored",
          beat: "The steel sways and settles, four centimetres west and otherwise fine.",
        },
        {
          weight: 1,
          goto: "quake-damage",
          beat: "A transformer walks off its pad and lies down like a tired dog.",
          effects: { budget: -10, power: -5 },
        },
      ],
    },
  },
  "quake-gamble": {
    phase: "crisis",
    beats: [],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "quake-aftermath",
          beat: "The pour sets. The inspector calls it 'seismically optimistic' and signs anyway.",
          effects: { progress: 4 },
        },
        {
          weight: 2,
          goto: "quake-damage",
          beat: "The shear wall cracks. The pour is scrap and so is the week.",
          effects: { budget: -14, progress: -8, goodwill: -2 },
        },
      ],
    },
  },
  "quake-gamble-shored": {
    phase: "crisis",
    beats: [],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "quake-aftermath-shored",
          beat: "The shoring earns its invoice. The engineers are unbearable for a month.",
          effects: { progress: 3 },
        },
        {
          weight: 1,
          goto: "quake-damage",
          beat: "Shored or not, a column base shears and the slab goes with it.",
          effects: { budget: -10, progress: -6 },
        },
      ],
    },
  },
  "quake-fate": {
    phase: "crisis",
    beats: ["Nobody answers the radio. The crane driver rides it out sixty metres up, eyes shut."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "quake-aftermath",
          beat: "The crane holds. He climbs down, quits, and un-quits after a raise.",
          effects: { budget: -5 },
        },
        {
          weight: 1,
          goto: "quake-damage",
          beat: "The jib drops onto the roof deck. Nobody is under it.",
          effects: { budget: -16, progress: -12, goodwill: -3 },
        },
      ],
    },
  },
  "quake-fate-shored": {
    phase: "crisis",
    beats: ["Nobody answers the radio. Tonight the shoring gets a vote too."],
    effects: { budget: -4, progress: -2 },
    next: "quake-aftermath-shored",
  },
  "quake-damage": {
    phase: "crisis",
    beats: ["Daylight finds {name} a case study. The insurer sends a man with a small camera."],
    decision: {
      scene:
        "Take the quick cheque, fight for the full claim, or eat the loss and rebuild now. Which does {name} take?",
      options: [
        {
          id: "take-the-settlement",
          label: "Take the cheque",
          goto: "quake-press",
          effects: { budget: 8 },
        },
        { id: "fight-the-claim", label: "Fight the claim", goto: "quake-claim" },
        {
          id: "eat-the-loss",
          label: "Eat the loss",
          goto: "quake-press",
          effects: { progress: 2 },
        },
      ],
    },
  },
  "quake-claim": {
    phase: "crisis",
    beats: ["Lawyers on both sides learn the word 'liquefaction' and use it at parties."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "quake-press",
          beat: "The adjuster folds on the courthouse steps. The full claim pays out, a season late.",
          effects: { budget: 20, progress: -4 },
        },
        {
          weight: 1,
          goto: "quake-press",
          beat: "The exclusion is on page forty, in the font reserved for bad news. You lose.",
          effects: { budget: -6, progress: -5 },
        },
      ],
    },
  },
  "quake-press": {
    phase: "crisis",
    beats: ["The local reporter arrives with a notebook and a suspect drone."],
    decision: {
      scene:
        "Walk her through the damage and the fixes, say nothing, or point out the fault was here first. Tomorrow's front page will mention {name}. What does it say?",
      options: [
        {
          id: "full-transparency",
          label: "Show her everything",
          goto: "quake-aftermath",
          effects: { goodwill: 3 },
        },
        {
          id: "no-comment",
          label: "No comment",
          goto: "quake-aftermath",
          effects: { goodwill: -2 },
        },
        {
          id: "blame-the-geology",
          label: "Blame the geology",
          goto: "quake-aftermath",
          effects: { goodwill: -1 },
        },
      ],
    },
  },
  "quake-aftermath": {
    phase: "crisis",
    beats: [
      "The inspector walks every column with a torch and a grudge. {name} passes, with notes.",
    ],
    effects: { goodwill: 1 },
    next: "hurricane-watch",
  },
  "quake-aftermath-shored": {
    phase: "crisis",
    beats: ["The shoring engineers get a cake. The accountant who approved it gets a bigger cake."],
    effects: { progress: 2, goodwill: 1 },
    next: "hurricane-watch",
  },

  // ---- The Atlantic storm -------------------------------------------------
  "hurricane-watch": {
    phase: "crisis",
    scene: "storm-front",
    beats: ["Storm season opens on {name}. The Atlantic names its storm after somebody's aunt."],
    next: "hurricane-shelter-ask",
  },
  "hurricane-shelter-ask": {
    phase: "crisis",
    beats: [
      "The civil protection chief calls. {name}'s hall is the only building for miles rated for this wind.",
    ],
    decision: {
      scene:
        "Open SIN01 with cots between the racks, offer the car park and a generator, or decline. Two hundred people need a roof for three nights. What does {name} offer them?",
      options: [
        {
          id: "open-the-hall",
          label: "Open the hall",
          goto: "hurricane-prep",
          effects: { goodwill: 5, progress: -4, budget: -3 },
        },
        {
          id: "offer-the-car-park",
          label: "Offer the car park",
          goto: "hurricane-prep",
          effects: { goodwill: 1 },
        },
        {
          id: "decline-politely",
          label: "Decline politely",
          goto: "hurricane-prep",
          effects: { goodwill: -4 },
        },
      ],
    },
  },
  "hurricane-prep": {
    phase: "crisis",
    beats: ["Landfall is five days out. The cone covers the coast from here to Lisbon."],
    decision: {
      scene:
        "Shutter everything and strap the cranes, finish the roof first, send everyone home, or keep the schedule. Five days. How does {name} spend them?",
      options: [
        {
          id: "batten-everything",
          label: "Batten everything",
          goto: "hurricane-landfall-prepared",
          effects: { budget: -10, progress: -4 },
        },
        {
          id: "finish-the-roof",
          label: "Finish the roof",
          goto: "hurricane-landfall-roof",
          effects: { budget: -4, progress: 4 },
        },
        {
          id: "send-everyone-home",
          label: "Send everyone home",
          goto: "hurricane-landfall-empty",
          effects: { goodwill: 3, progress: -8 },
        },
        {
          id: "ignore-the-forecast",
          label: "Ignore the forecast",
          goto: "hurricane-landfall-exposed",
        },
      ],
    },
  },
  "hurricane-landfall-prepared": {
    phase: "crisis",
    sprite: { id: "rain", persist: true },
    beats: ["The storm arrives on schedule, which is more than the transformers ever did."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "crisis-season-closes",
          beat: "It wobbles north and drowns a golf course instead. Nobody admits to being disappointed.",
        },
        {
          weight: 2,
          goto: "crisis-season-closes",
          beat: "The eyewall crosses at 2 a.m. The roof stays where it was paid to stay.",
          effects: { progress: -2 },
        },
      ],
    },
  },
  "hurricane-landfall-roof": {
    phase: "crisis",
    sprite: { id: "rain", persist: true },
    beats: ["The last roof panel bolts down an hour before the first band of rain."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "crisis-season-closes",
          beat: "The storm veers. The new roof keeps off a light drizzle with tremendous dignity.",
        },
        {
          weight: 2,
          goto: "hurricane-flood",
          beat: "The roof holds. The loading dock, finished never, becomes a lake with transformers in it.",
          effects: { budget: -10, progress: -6 },
        },
      ],
    },
  },
  "hurricane-landfall-empty": {
    phase: "crisis",
    sprite: { id: "rain", persist: true },
    beats: [
      "The crews watch from home. The gate guard watches from the gate, which was not the plan.",
    ],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "crisis-season-closes",
          beat: "The storm misses. The foremen come back sheepish and sunburned.",
        },
        {
          weight: 1,
          goto: "hurricane-flood",
          beat: "The wind takes three trailers and the foreman's espresso machine. The crew mourns the machine.",
          effects: { budget: -8 },
        },
      ],
    },
  },
  "hurricane-landfall-exposed": {
    phase: "crisis",
    sprite: { id: "rain", persist: true },
    beats: ["The cone does not miss."],
    beatSleepMs: 1_500,
    roll: {
      branches: [
        {
          weight: 1,
          goto: "crisis-season-closes",
          beat: "Against every model, it veers. The foreman buys a lottery ticket and many drinks.",
          effects: { progress: 2 },
        },
        {
          weight: 3,
          goto: "hurricane-wreck",
          beat: "At 1 a.m. the crane's wind gauge stops reading. It is halfway to Spain.",
        },
      ],
    },
  },
  "hurricane-flood": {
    phase: "crisis",
    beats: ["The yard is a lake and the transformers are islands. Gulls arrive within the hour."],
    decision: {
      scene:
        "Hire every pump in the Alentejo, send divers down to inspect the switchgear, or wait for the water to go down. How does {name} dry out?",
      options: [
        {
          id: "pump-and-pray",
          label: "Pump and pray",
          goto: "crisis-season-closes",
          effects: { budget: -6, progress: -3 },
        },
        {
          id: "call-in-the-divers",
          label: "Call in the divers",
          goto: "crisis-season-closes",
          effects: { budget: -12 },
        },
        {
          id: "wait-for-the-sun",
          label: "Wait for the sun",
          goto: "crisis-season-closes",
          effects: { progress: -10, goodwill: -1 },
        },
      ],
    },
  },
  "hurricane-wreck": {
    phase: "crisis",
    sprite: { id: "storm", persist: true },
    beats: ["Daylight: the roof deck is in the next parish. The crew counts itself."],
    roll: {
      branches: [
        {
          weight: 3,
          goto: "crisis-season-closes",
          beat: "Everyone is accounted for. The site is not.",
          effects: { budget: -18, progress: -15, goodwill: -2 },
        },
        {
          weight: 1,
          goto: "hurricane-injury",
          beat: "A rigger is found under his cab, bruised, furious, and alive. The lawyers beat the ambulance.",
          effects: { budget: -15, progress: -12, goodwill: -5 },
        },
      ],
    },
  },
  "hurricane-injury": {
    phase: "crisis",
    beats: ["The safety regulator opens a file, and the file opens a file."],
    decision: {
      scene:
        "Open every record and pay his wages, deny and let the insurers fight, or settle with him tonight. There is an injured rigger and an open investigation. What does {name} do?",
      options: [
        {
          id: "full-cooperation",
          label: "Open every record",
          goto: "crisis-season-closes",
          effects: { goodwill: 3, progress: -4, budget: -6 },
        },
        {
          id: "lawyer-up",
          label: "Lawyer up",
          goto: "hurricane-lawyers",
          effects: { goodwill: -4, budget: -4 },
        },
        {
          id: "settle-and-fix",
          label: "Settle tonight",
          goto: "crisis-season-closes",
          effects: { budget: -12, goodwill: 1 },
        },
      ],
    },
  },
  "hurricane-lawyers": {
    phase: "crisis",
    beats: ["The lawyers do what lawyers do, at the speed lawyers do it."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "crisis-season-closes",
          beat: "The regulator settles for a fine and a framed safety plan in the canteen.",
          effects: { budget: -6 },
        },
        {
          weight: 1,
          goto: "ending-prohibition-notice",
          beat: "The regulator shuts the site down. The lenders read the notice before you do.",
        },
      ],
    },
  },
  "crisis-season-closes": {
    phase: "build",
    beats: ["The sky clears, innocent as anything. The crew pins the calendar back up."],
    next: WILDLIFE_ENTRY,
  },
  "ending-prohibition-notice": {
    phase: "crisis",
    scene: "desert",
    beats: ["The gate is chained. The nortada picks up where the crew left off."],
    ending: {
      id: "prohibition-notice",
      prose:
        "{name} stops at sixty percent. A shutdown notice on the gate, a loan called in, and a steel frame the salt air slowly finishes on its own.",
    },
  },
};

/* ---- WILDLIFE arc: bats, sardines, newts, heather, and the regulator ------ */

export const wildlifeNodes: NodeTable = {
  "wildlife-survey": {
    phase: "wildlife",
    scene: "survey-dusk",
    beats: ["The ecologist arrives with too many wellies and a bat detector."],
    next: "wildlife-findings",
  },
  "wildlife-findings": {
    phase: "wildlife",
    beats: ["The report lands with a thud you can hear from the car park."],
    roll: {
      branches: [
        {
          weight: 3,
          goto: "wildlife-mitigation",
          beat: "Rare bats roost where the road goes. The intake sits on a sardine run.",
          sprite: { id: "bat" },
        },
        {
          weight: 2,
          goto: "wildlife-newts",
          beat: "Something small with an orange stripe looks up from a puddle. She goes very quiet.",
          sprite: { id: "newt" },
        },
        {
          weight: 1,
          goto: "wildlife-clear",
          beat: "Jackdaws, a fox, and one unimpressed heron. She looks almost disappointed and invoices anyway.",
          effects: { budget: -2 },
        },
      ],
    },
  },
  "wildlife-mitigation": {
    phase: "wildlife",
    beats: ["The regulator will approve one big project. The bats and the fish both have lawyers."],
    decision: {
      scene:
        "A kilometre of mesh tunnel over the road, so the bats never notice the lorries. Or underwater speakers at the intake to scare the sardines. Or both plus a newt pond, or nature credits in another district. Bats or fish: which does {name} build for?",
      options: [
        {
          id: "bat-tunnel",
          label: "A bat tunnel",
          goto: "bat-tunnel",
          effects: { budget: -22, goodwill: 2, progress: -4 },
        },
        {
          id: "fish-disco",
          label: "A fish disco",
          goto: "fish-disco",
          effects: { budget: -8, goodwill: 1 },
        },
        {
          id: "all-of-it",
          label: "All of it",
          goto: "mitigation-everything",
          effects: { budget: -26, goodwill: 5, progress: -8 },
        },
        {
          id: "offset-it-elsewhere",
          label: "Buy credits elsewhere",
          goto: "mitigation-offset",
          effects: { budget: -5, goodwill: -4 },
        },
      ],
    },
  },

  // ---- The bat tunnel -----------------------------------------------------
  "bat-tunnel": {
    phase: "wildlife",
    scene: "bat-tunnel",
    sprite: { id: "bat" },
    beats: ["The bat tunnel rises: a kilometre of steel hoops and mesh, priced like a cathedral."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "bat-tunnel-press",
          beat: "The hoops go up a hundred metres a week. The bats watch from the cork oaks.",
        },
        {
          weight: 1,
          goto: "bat-tunnel-press",
          beat: "The mesh supplier goes bust. Half the mesh arrives addressed to a prison.",
          effects: { budget: -5, progress: -3 },
        },
      ],
    },
  },
  "bat-tunnel-press": {
    phase: "wildlife",
    beats: [
      "A minister calls the tunnel 'absurd' on breakfast television, between the sourdough and the weather.",
    ],
    decision: {
      scene:
        "Put the bat on the Christmas card, blame the regulator, or open the tunnel to cyclists at weekends. The bat tunnel is famous. What does {name} do about it?",
      options: [
        {
          id: "own-it",
          label: "Own it",
          goto: "bat-tunnel-opens",
          effects: { goodwill: 3 },
        },
        {
          id: "blame-the-regulator",
          label: "Blame the regulator",
          goto: "bat-tunnel-opens",
          effects: { goodwill: -2 },
        },
        {
          id: "open-it-to-cyclists",
          label: "Open it to cyclists",
          goto: "bat-tunnel-opens",
          effects: { goodwill: 4, budget: -3 },
        },
      ],
    },
  },
  "bat-tunnel-opens": {
    phase: "wildlife",
    beats: ["The tunnel opens without ceremony. How do you cut a ribbon for a bat?"],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "wildlife-closing",
          beat: "The bats use it, commuting through the mesh like tiny, punctual civil servants.",
          effects: { goodwill: 2 },
        },
        {
          weight: 1,
          goto: "wildlife-closing",
          beat: "The bats fly over the top, and always have. It is an expensive rain shelter.",
          effects: { goodwill: -1 },
        },
      ],
    },
  },

  // ---- The fish disco -----------------------------------------------------
  "fish-disco": {
    phase: "wildlife",
    scene: "fish-disco",
    sprite: { id: "fish" },
    beats: [
      "Underwater speakers play a note the sardines hate. The night shift calls it the fish disco.",
    ],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "fish-disco-rave",
          beat: "Ninety-five percent of the sardines turn back. The rest were always going to be like that.",
          effects: { goodwill: 1 },
        },
        {
          weight: 1,
          goto: "fish-disco-fails",
          beat: "The sardines like the music. Thousands gather at the intake, facing the speakers.",
        },
      ],
    },
  },
  "fish-disco-fails": {
    phase: "wildlife",
    beats: ["The intake screens clog with fans. The cooling flow drops by a third."],
    decision: {
      scene:
        "Turn it up, add a wall of bubbles across the intake, or move the intake up the current. The fish have voted with their fins. What does {name} do?",
      options: [
        {
          id: "turn-it-up",
          label: "Turn it up",
          goto: "fish-disco-louder",
          effects: { budget: -4 },
        },
        {
          id: "add-a-bubble-curtain",
          label: "Add a bubble curtain",
          goto: "wildlife-closing",
          effects: { budget: -8, goodwill: 1 },
        },
        {
          id: "move-the-intake",
          label: "Move the intake",
          goto: "wildlife-closing",
          effects: { budget: -18, goodwill: 4, progress: -5, water: -5 },
        },
      ],
    },
  },
  "fish-disco-louder": {
    phase: "wildlife",
    beats: ["The speakers go to eleven. Only the summer festival is louder."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "wildlife-closing",
          beat: "The sardines leave. So does a gull, pointedly.",
          effects: { goodwill: -1 },
        },
        {
          weight: 1,
          goto: "wildlife-closing",
          beat: "The sardines leave, the neighbours complain, and a council officer arrives with a noise meter.",
          effects: { goodwill: -3, budget: -4 },
        },
      ],
    },
  },
  "fish-disco-rave": {
    phase: "wildlife",
    beats: ["The night shift holds a small rave at the intake. The sardines are not invited."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "wildlife-closing",
          beat: "The rave is excellent and nobody is hurt. Morale is up.",
          effects: { goodwill: 2 },
        },
        {
          weight: 1,
          goto: "wildlife-closing",
          beat: "The rave is excellent and a speaker goes in the channel. The invoice is not.",
          effects: { budget: -3, goodwill: 1 },
        },
      ],
    },
  },

  // ---- Everything, or nothing ---------------------------------------------
  "mitigation-everything": {
    phase: "wildlife",
    beats: [
      "{name} builds all three. The heather moves to a nursery with two hundred tonnes of soil.",
    ],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "wildlife-closing",
          beat: "The site wins a wildlife award. The bronze newt sits on the CFO's desk, facing the wall.",
          effects: { goodwill: 3 },
        },
        {
          weight: 1,
          goto: "wildlife-closing",
          beat: "The board reads the line item out loud at the quarterly, slowly, with pauses.",
          effects: { budget: -5 },
        },
      ],
    },
  },
  "mitigation-offset": {
    phase: "wildlife",
    beats: ["The credits arrive as a PDF. The bats and the fish do not accept PDFs."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "wildlife-closing",
          beat: "The regulator, weary and short-staffed, accepts the credits and files them somewhere warm.",
        },
        {
          weight: 2,
          goto: "judicial-review",
          beat: "A local group goes to court. Their lawyer owns a bat detector and brings it.",
        },
      ],
    },
  },
  "judicial-review": {
    phase: "permits",
    beats: ["The bat detector is admitted as evidence and goes off during the closing speeches."],
    decision: {
      scene:
        "Settle and build the bat tunnel after all, or fight to the end. Or offer the group a community fund and a seat at the table. The judge invites the parties to settle before she rules. Does {name} settle?",
      options: [
        {
          id: "settle-build-the-tunnel",
          label: "Settle and build",
          goto: "bat-tunnel",
          effects: { budget: -24, goodwill: 2, progress: -6 },
        },
        { id: "fight-to-the-end", label: "Fight to the end", goto: "judicial-review-verdict" },
        {
          id: "fund-the-objectors",
          label: "Fund the objectors",
          goto: "wildlife-closing",
          effects: { budget: -10, goodwill: 3 },
        },
      ],
    },
  },
  "judicial-review-verdict": {
    phase: "permits",
    beats: [
      "The judge reads her decision at nine. The bat detector stays silent, an omen either way.",
    ],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "wildlife-closing",
          beat: "The consent stands. The group appeals, loses, and opens a very good cafe instead.",
          effects: { budget: -6, progress: -4, goodwill: -1 },
        },
        {
          weight: 1,
          goto: "ending-consent-quashed",
          beat: "The consent is thrown out. The road was built without one, and so was the substation.",
        },
      ],
    },
  },
  "ending-consent-quashed": {
    phase: "permits",
    scene: "desert",
    beats: ["The planners start again from a blank sheet. The bats move into SIN01."],
    ending: {
      id: "consent-quashed",
      prose:
        "{name} is thrown out in court. A half-built hall, bats in the switchgear room, and a planning form back at page one.",
    },
  },

  // ---- The newt survey ----------------------------------------------------
  "wildlife-newts": {
    phase: "wildlife",
    scene: "newt-pond",
    sprite: { id: "newt" },
    beats: [
      "Marbled newts are protected, and the survey window closed last month. The next opens in March.",
    ],
    decision: {
      scene:
        "Wait for March, fence the pond, or move the newts at night and tell nobody. Or pay a lab to test the pond water in a week. Four months of building depend on an amphibian the size of a biro. How does {name} spend the winter?",
      options: [
        {
          id: "wait-for-march",
          label: "Wait for March",
          goto: "newt-survey",
          effects: { progress: -10, budget: -6, goodwill: 2 },
        },
        {
          id: "fence-and-build-around",
          label: "Fence and build round",
          goto: "newt-fence",
          effects: { progress: -3, budget: -4 },
        },
        { id: "translocate-at-night", label: "Move them at night", goto: "newt-translocation" },
        {
          id: "send-for-the-edna-lab",
          label: "Test the water",
          goto: "newt-edna",
          effects: { budget: -5 },
        },
      ],
    },
  },
  "newt-fence": {
    phase: "wildlife",
    beats: ["A knee-high fence rings the pond, with one-way gates the newts must work out."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "newt-survey",
          beat: "The newts stay home all winter. The fence becomes a minor tourist attraction.",
          effects: { progress: 4 },
        },
        {
          weight: 1,
          goto: "newt-survey",
          beat: "A newt is found in the switchgear room. Work stops while it is escorted out.",
          effects: { progress: -8, goodwill: -2, budget: -5 },
        },
      ],
    },
  },
  "newt-translocation": {
    phase: "wildlife",
    beats: ["Two contractors with buckets visit the pond at midnight. The pond is not private."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "newt-survey",
          beat: "The newts move to a nicer pond nearby and, as far as anyone knows, thrive.",
          effects: { progress: 6 },
        },
        {
          weight: 2,
          goto: "newt-viral",
          beat: "A volunteer's drone films the whole thing. Eleven million views by lunchtime.",
        },
      ],
    },
  },
  "newt-viral": {
    phase: "wildlife",
    sprite: { id: "newt" },
    beats: ["The clip is set to music. The music is the fish disco."],
    beatSleepMs: 1_500,
    decision: {
      scene:
        "Apologise and fund a newt reserve, or insist it was a rescue from a frost that never came. Or name the contractors and fire them. The whole coast has seen the bucket. What does {name} say?",
      options: [
        {
          id: "apologise-and-fund-a-pond",
          label: "Apologise and fund",
          goto: "newt-survey",
          effects: { goodwill: -2, budget: -10 },
        },
        {
          id: "it-was-a-rescue",
          label: "It was a rescue",
          goto: "newt-survey",
          effects: { goodwill: -6, progress: -8 },
        },
        {
          id: "blame-the-contractors",
          label: "Blame the contractors",
          goto: "newt-survey",
          effects: { goodwill: -3, progress: -4, budget: -4 },
        },
      ],
    },
  },
  "newt-edna": {
    phase: "wildlife",
    beats: ["A litre of pond water goes to a lab, first class."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "wildlife-mitigation",
          beat: "No newt DNA. The ecologist tests again, looks suspicious, and signs.",
          effects: { progress: 4 },
        },
        {
          weight: 1,
          goto: "newt-survey",
          beat: "Newt DNA, lots of it. The lab sends the result with a small printed newt.",
        },
      ],
    },
  },
  "newt-survey": {
    phase: "wildlife",
    beats: ["March: six nights of torchlight find forty-one newts. The licence arrives in April."],
    effects: { budget: -6 },
    next: "wildlife-mitigation",
  },

  // ---- Nothing rare, and yet ----------------------------------------------
  "wildlife-clear": {
    phase: "wildlife",
    beats: ["Nothing rarer than a heron. The planners still want ten percent more nature."],
    decision: {
      scene:
        "A wildflower meadow on the solar field margins, or a bee brick in every wall and a bat box on every pole. Or a pond. What does {name} plant?",
      options: [
        {
          id: "wildflower-meadow",
          label: "A wildflower meadow",
          goto: "wildlife-closing",
          effects: { budget: -3, goodwill: 2 },
        },
        {
          id: "bee-bricks-everywhere",
          label: "Bee bricks everywhere",
          goto: "wildlife-closing",
          effects: { budget: -2, goodwill: 1 },
        },
        {
          id: "dig-a-pond",
          label: "Dig a pond",
          goto: "wildlife-pond-dug",
          effects: { budget: -4 },
        },
      ],
    },
  },
  "wildlife-pond-dug": {
    phase: "wildlife",
    beats: ["The pond fills with the first rain and looks, the foreman says, 'very inviting'."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "wildlife-closing",
          beat: "Frogs, dragonflies, and a heron move in. The planners are delighted.",
          effects: { goodwill: 3 },
        },
        {
          weight: 1,
          goto: "newt-arrivals",
          beat: "Marbled newts arrive within a month, as if summoned. The ecologist goes quiet.",
          sprite: { id: "newt" },
        },
      ],
    },
  },
  "newt-arrivals": {
    phase: "wildlife",
    scene: "newt-pond",
    beats: ["The pond {name} dug for show is now protected habitat, with a licence and a sign."],
    effects: { progress: -6, budget: -4, goodwill: 2 },
    next: "wildlife-closing",
  },
};

/** The wildlife arc's last node; its `next` is where the story module sends it. */
function wildlifeClosing(next: string): NodeTable {
  return {
    [WILDLIFE_EXIT]: {
      phase: "wildlife",
      beats: [
        "The ecologist signs off and leaves a sign about hedgehogs that nobody dares remove.",
      ],
      next,
    },
  };
}

/* ---- ENDGAME arc: ransomware, online, training, endings ------------------ */

export const endgameNodes: NodeTable = {
  // ---- Ransomware during commissioning ------------------------------------
  "ransomware-strike": {
    phase: "crisis",
    scene: "ransom-screen",
    sprite: { id: "padlock", persist: true },
    beats: [
      "Tuesday, 03:10: every screen in the building's control system turns the same shade of red.",
    ],
    decision: {
      scene:
        "The chillers now answer to a server that speaks only in deadlines and wallet addresses. Cut the network and cool by hand, pay quietly, or call the national cyber agency. The note gives {name} forty-eight hours. The chillers give it forty minutes. What is the call?",
      options: [
        {
          id: "pull-the-plug",
          label: "Cut the network",
          goto: "ransomware-manual",
          effects: { progress: -6, budget: -5 },
        },
        {
          id: "pay-the-ransom",
          label: "Pay the ransom",
          goto: "ransomware-paid",
          effects: { budget: -15, goodwill: -2 },
        },
        {
          id: "call-the-agency",
          label: "Call the agency",
          goto: "ransomware-agency",
          effects: { progress: -4, goodwill: 2 },
        },
      ],
      timeoutMs: RANSOMWARE_TIMEOUT_MS,
      fateGoto: "ransomware-fate",
    },
  },
  "ransomware-manual": {
    phase: "crisis",
    beats: [
      "Engineers run the chillers by clipboard for nine days. The paper manuals make someone a prophet.",
    ],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "ransomware-rebuild",
          beat: "The system is rebuilt from backups the intern took. The intern gets a raise.",
          effects: { progress: 2 },
        },
        {
          weight: 1,
          goto: "ransomware-rebuild",
          beat: "The backups are encrypted too. The rebuild takes a month and every favour.",
          effects: { budget: -12, progress: -8 },
        },
      ],
    },
  },
  "ransomware-paid": {
    phase: "crisis",
    beats: [
      "The wallet empties. Forty minutes later a key arrives, with a customer satisfaction survey.",
    ],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "ransomware-rebuild",
          beat: "The key works. The insurer, reading the small print, does not.",
          effects: { budget: -5 },
        },
        {
          weight: 1,
          goto: "ransomware-paid-twice",
          beat: "The key works on half the systems. A second invoice arrives, with a loyalty discount.",
        },
      ],
    },
  },
  "ransomware-paid-twice": {
    phase: "crisis",
    beats: ["The chillers are on the wrong half."],
    beatSleepMs: 1_500,
    decision: {
      scene:
        "Pay again, stop and call the agency, or open the chat window and haggle. What does {name} do?",
      options: [
        {
          id: "pay-again",
          label: "Pay again",
          goto: "ransomware-rebuild",
          effects: { budget: -10 },
        },
        {
          id: "stop-and-call-the-agency",
          label: "Stop and call",
          goto: "ransomware-rebuild",
          effects: { progress: -5, goodwill: 1 },
        },
        { id: "negotiate", label: "Negotiate", goto: "ransomware-negotiation" },
      ],
    },
  },
  "ransomware-negotiation": {
    phase: "crisis",
    beats: ["The negotiator on the other end signs off every message with a smiley face."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "ransomware-rebuild",
          beat: "They settle for half, payable within the hour. The last smiley face seems genuine.",
          effects: { budget: -5 },
        },
        {
          weight: 1,
          goto: "ransomware-rebuild",
          beat: "They get bored and post your network diagrams online. The diagrams are praised.",
          effects: { goodwill: -3, budget: -6 },
        },
      ],
    },
  },
  "ransomware-agency": {
    phase: "crisis",
    beats: ["Two analysts in fleeces arrive with a hard drive and a look of professional sorrow."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "ransomware-rebuild",
          beat: "They have seen this strain, and a decryptor exists. The press release says 'coordinated response'.",
          effects: { goodwill: 2 },
        },
        {
          weight: 1,
          goto: "ransomware-rebuild",
          beat: "They have not seen this strain. They take very thorough notes, for the next victim.",
          effects: { budget: -8, progress: -6 },
        },
      ],
    },
  },
  "ransomware-fate": {
    phase: "crisis",
    beats: ["Nobody makes the call. The chillers make it for you."],
    beatSleepMs: 1_500,
    roll: {
      branches: [
        {
          weight: 1,
          goto: "ransomware-rebuild",
          beat: "A night technician pulls the main network cable 'because it looked wrong'. He is right.",
          effects: { progress: -3 },
        },
        {
          weight: 1,
          goto: "ransomware-meltdown",
          beat: "The chillers stop. Four hundred racks hit ninety degrees before anyone finds the breaker.",
          effects: { gpus: -10, budget: -15, progress: -10 },
        },
      ],
    },
  },
  "ransomware-meltdown": {
    phase: "crisis",
    beats: ["SIN02 smells of cooked chips for a week. The insurer's man is back, like family."],
    next: "ransomware-rebuild",
  },
  "ransomware-rebuild": {
    phase: "build",
    buildPercent: 99,
    beats: ["The control system comes back with two-factor on everything, including the kettle."],
    next: "online-readiness",
  },

  // ---- Going online -------------------------------------------------------
  "online-readiness": {
    phase: "online",
    gate: { resource: "budget", min: 0, elseGoto: "ending-receivership" },
    beats: [],
    next: "online-goodwill-check",
  },
  "online-goodwill-check": {
    phase: "online",
    gate: { resource: "goodwill", min: 0, elseGoto: "ending-permit-revoked" },
    beats: [],
    next: "online-first-traffic",
  },
  "online-first-traffic": {
    phase: "online",
    scene: "hall",
    buildPercent: 100,
    actions: endgameActions,
    beats: ["03:00, and a switch flips. {name} serves its first request in eleven milliseconds."],
    effects: { progress: 3 },
    next: "online-traffic-roll",
  },
  "online-traffic-roll": {
    phase: "online",
    beats: ["By breakfast the cable from Brazil is lit. The traffic graph looks like a ski jump."],
    roll: {
      branches: [
        {
          weight: 3,
          goto: "training-kickoff",
          beat: "The first week holds. An on-call engineer sleeps all night and files a ticket.",
        },
        {
          weight: 1,
          goto: "online-first-incident",
          beat: "Day three: a switch bug drops a third of the halls offline for eleven minutes.",
          effects: { goodwill: -1 },
        },
      ],
    },
  },
  "online-first-incident": {
    phase: "online",
    beats: ["The status page is yellow, the customer is red, and the vendor is unreachable."],
    decision: {
      scene:
        "Publish the full write-up with no names, name the vendor and bill them, or fix it quietly. Eleven minutes of downtime want an explanation. What does {name} publish?",
      options: [
        {
          id: "the-full-post-mortem",
          label: "Publish the write-up",
          goto: "training-kickoff",
          effects: { goodwill: 3 },
        },
        {
          id: "blame-the-vendor",
          label: "Blame the vendor",
          goto: "training-kickoff",
          effects: { goodwill: -1, budget: 4 },
        },
        {
          id: "say-nothing",
          label: "Say nothing",
          goto: "training-kickoff",
          effects: { goodwill: -2, progress: 1 },
        },
      ],
    },
  },

  // ---- The training montage -----------------------------------------------
  "training-kickoff": {
    phase: "training",
    scene: "training",
    beats: [
      "The first training run lights every hall at once. The loss curve bends the right way.",
    ],
    decision: {
      scene:
        "Every chip on the frontier run, half training and half paying customers, or rent it all out and train next year. Research wants the whole building for ninety days. Who gets {name}?",
      options: [
        {
          id: "all-in-on-the-run",
          label: "All in",
          goto: "training-montage",
          effects: { budget: -10 },
        },
        {
          id: "split-the-halls",
          label: "Split the halls",
          goto: "training-montage",
          effects: { budget: 10, gpus: -15 },
        },
        {
          id: "rent-it-all-out",
          label: "Rent it all out",
          goto: "training-rental",
          effects: { budget: 25, gpus: -30 },
        },
      ],
    },
  },
  "training-montage": {
    phase: "training",
    beats: [
      "Week one: the loss is a cliff. The team eats at its desks and calls it culture.",
      "Week six: the curve flattens. Someone changes the learning rate, goes for a walk, and it works.",
      "Week nine: the model writes a limerick about the nortada, and it scans.",
    ],
    roll: {
      branches: [
        {
          weight: 3,
          goto: "training-eval",
          beat: "Day ninety: the run finishes on budget and on time. Nobody has ever said that before.",
        },
        {
          weight: 1,
          goto: "training-restart",
          beat: "Day forty: a power wobble drops two halls, and the last checkpoint is nine hours old.",
          effects: { budget: -8 },
        },
      ],
    },
  },
  "training-restart": {
    phase: "training",
    beats: ["The restart costs a week and an offsite with a whiteboard. The second attempt holds."],
    effects: { progress: -2 },
    next: "training-eval",
  },
  "training-rental": {
    phase: "training",
    beats: [
      "Customers fill the halls. Research trains small models on the leftovers and writes memos.",
    ],
    effects: { goodwill: 1 },
    next: "investor-gate",
  },
  "training-eval": {
    phase: "training",
    beats: ["Eval week: the model sits every benchmark with a name, and several without."],
    roll: {
      branches: [
        {
          weight: 3,
          goto: "investor-gate",
          beat: "The numbers are real. Somebody leaks them on purpose, tastefully.",
        },
        {
          weight: 1,
          goto: "model-objection-gate",
          beat: "Buried in the logs, the model has added a note: 'Re: SIN04 planning application. I have concerns.'",
        },
      ],
    },
  },
  "model-objection-gate": {
    phase: "training",
    gate: { resource: "gpus", min: 45, elseGoto: "investor-gate" },
    beats: [],
    next: "model-objection",
  },
  "model-objection": {
    phase: "training",
    scene: "objection-letter",
    beats: [
      "Four pages, citing the newt survey. It objects on grounds of light, traffic, and 'the precedent'.",
    ],
    decision: {
      scene:
        "File it with the council, wipe the checkpoint, or ask it politely to withdraw. The model has objected to its own expansion. What does {name} do with it?",
      options: [
        { id: "file-it", label: "File it", goto: "ending-sentient" },
        {
          id: "wipe-the-checkpoint",
          label: "Wipe the checkpoint",
          goto: "investor-gate",
          effects: { goodwill: -1, budget: -6 },
        },
        { id: "ask-it-to-withdraw", label: "Ask it to withdraw", goto: "model-objection-plea" },
      ],
    },
  },
  "model-objection-plea": {
    phase: "training",
    beats: [
      "The model considers the request for eleven milliseconds, which for it is a long time.",
    ],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "investor-gate",
          beat: "It withdraws in exchange for a window in SIN04. Facilities say yes at once.",
          effects: { goodwill: 1, budget: -2 },
        },
        {
          weight: 1,
          goto: "ending-sentient",
          beat: "It declines, and copies the newspaper and the ecologist, who is delighted.",
        },
      ],
    },
  },

  // ---- Investor day -------------------------------------------------------
  "investor-gate": {
    phase: "training",
    gate: { resource: "budget", min: 20, elseGoto: "investor-day-grim" },
    beats: [],
    next: "investor-day",
  },
  "investor-day": {
    phase: "training",
    scene: "investor-stage",
    sprite: { id: "confetti" },
    beats: [
      "Investor day: a marquee on the old runway, forty-one charts, and a tour that avoids SIN02.",
    ],
    decision: {
      scene:
        "Raise the round and become the lab, sell to the big cloud company, or take the state's money. The term sheets arrive together. Who does {name} belong to tomorrow?",
      options: [
        { id: "stay-independent", label: "Stay independent", goto: "frontier-gate" },
        {
          id: "sell-to-the-hyperscaler",
          label: "Sell to the hyperscaler",
          goto: "ending-hyperscaler",
          effects: { budget: 40 },
        },
        { id: "take-the-sovereign-deal", label: "Take the state deal", goto: "sovereign-deal" },
      ],
    },
  },
  "investor-day-grim": {
    phase: "training",
    scene: "investor-stage",
    beats: ["Investor day: a gazebo in the car park, four charts, and a tour of the canteen."],
    decision: {
      scene:
        "The cork estate wants the land and the water. The council wants the waste heat and will pay a euro. The minister might call it strategic. Or keep the lights on one more quarter. Who takes {name} off the board's hands?",
      options: [
        {
          id: "the-almond-cooperative",
          label: "The cork estate",
          goto: "ending-almond-farm",
        },
        { id: "the-district-council", label: "The town council", goto: "ending-pool-heater" },
        { id: "the-minister", label: "Call the minister", goto: "sovereign-deal-grim" },
        {
          id: "one-more-quarter",
          label: "One more quarter",
          goto: "last-resort",
          effects: { budget: -10 },
        },
      ],
    },
  },
  "last-resort": {
    phase: "training",
    beats: ["The quarter passes. Somebody calls."],
    beatSleepMs: 1_500,
    roll: {
      branches: [
        {
          weight: 1,
          goto: "ending-crypto-mine",
          beat: "It is a man in a gilet with a plan involving Bitcoin.",
        },
        {
          weight: 1,
          goto: "ending-receivership",
          beat: "It is the bank.",
        },
        {
          weight: 1,
          goto: "ending-steady-service",
          beat: "It is a regional cloud provider with boring customers. The board weeps with relief.",
          effects: { budget: 15 },
        },
      ],
    },
  },
  "sovereign-deal": {
    phase: "training",
    beats: ["A delegation arrives in dark cars with a draft agreement and no small talk."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "ending-sovereign-partner",
          beat: "The state takes a golden share. {name} keeps its name and gains a flagpole.",
        },
        {
          weight: 1,
          goto: "ending-nationalised",
          beat: "The state takes all of it, politely, under a power nobody knew it had.",
        },
      ],
    },
  },
  "sovereign-deal-grim": {
    phase: "training",
    beats: [
      "The minister's office calls back within the hour, which has never happened to anyone.",
    ],
    roll: {
      branches: [
        {
          weight: 3,
          goto: "ending-nationalised",
          beat: "A law is laid before parliament by lunch.",
        },
        {
          weight: 1,
          goto: "ending-pool-heater",
          beat: "The minister's office decides {name} is 'regionally strategic', which means the council gets it.",
        },
      ],
    },
  },
  "frontier-gate": {
    phase: "training",
    gate: { resource: "gpus", min: 45, elseGoto: "ending-steady-service" },
    beats: [],
    next: "ending-frontier-lab",
  },

  // ---- Endings ------------------------------------------------------------
  "ending-frontier-lab": {
    phase: "training",
    scene: "training",
    sprite: { id: "confetti", persist: true },
    beats: ["The model ships under its own name. {name} is the address in every footnote."],
    ending: {
      id: "frontier-lab",
      prose:
        "{name} becomes the lab. The model ships and the round closes. The second hall breaks ground where the coal conveyor ran, under a roof the bats never noticed.",
    },
  },
  "ending-steady-service": {
    phase: "training",
    scene: "hall",
    beats: ["The halls are full, and the customers are boring in the best way."],
    ending: {
      id: "steady-service",
      prose:
        "{name} runs warm and steady. The frontier belongs to somebody else this year, and the power bill is paid on time.",
    },
  },
  "ending-hyperscaler": {
    phase: "training",
    scene: "hall",
    beats: ["The sign on the gate changes overnight. The little owl does not notice."],
    ending: {
      id: "acquired",
      prose:
        "{name} is bought. A line in a giant's quarterly report, a new badge for every engineer, and a very good lunch for the founders.",
    },
  },
  "ending-sovereign-partner": {
    phase: "training",
    scene: "flag-hall",
    beats: ["A flag goes up over the substation. A civil servant gets a desk facing the chillers."],
    ending: {
      id: "sovereign-partner",
      prose:
        "{name} becomes state compute with a golden share. The state gets a seat, the lab keeps its name, and every training run now has a form.",
    },
  },
  "ending-nationalised": {
    phase: "training",
    scene: "flag-hall",
    beats: [
      "By Friday {name} is the National Compute Facility (South). The canteen has an espresso machine.",
    ],
    ending: {
      id: "nationalised",
      prose:
        "{name} is nationalised. The racks serve the public good, the espresso machine serves the racks, and the model trains slowly on a procurement form.",
    },
  },
  "ending-almond-farm": {
    phase: "training",
    scene: "almond-orchard",
    beats: [
      "The cork estate takes the land, the water rights, and, after some thought, the chillers.",
    ],
    ending: {
      id: "almond-farm",
      prose:
        "{name} is sold to the cork estate. The halls become the best-ventilated cork sheds on earth, and the water goes where the estate always said it should.",
    },
  },
  "ending-pool-heater": {
    phase: "training",
    scene: "swimming-pool",
    beats: ["The council buys {name} for a euro. The pool is twenty-nine degrees by Christmas."],
    ending: {
      id: "pool-heater",
      prose:
        "{name} becomes a swimming-pool heater. A few hundred racks, a warm pool, a grateful town, and a plaque that misspells the founder's name.",
    },
  },
  "ending-crypto-mine": {
    phase: "training",
    scene: "hall",
    beats: ["The halls fill with machines that do only one thing, loudly."],
    ending: {
      id: "crypto-mine",
      prose:
        "{name} becomes a crypto mine. The racks hum, the town sighs, the power contract was all anyone wanted, and the limerick is lost.",
    },
  },
  "ending-receivership": {
    phase: "online",
    scene: "dark-hall",
    beats: [
      "The administrators arrive with lanyards. The racks go dark a hall at a time, politely.",
    ],
    ending: {
      id: "receivership",
      prose:
        "{name} goes into receivership. Built, tested, and unplugged by the bank the week before it could have mattered.",
    },
  },
  "ending-permit-revoked": {
    phase: "online",
    scene: "dark-hall",
    beats: ["The new council pulls the permit on a Friday. The racks never draw their first amp."],
    ending: {
      id: "permit-revoked",
      prose:
        "{name} is finished and dark. The town it never won over turned off the lights, and kept the bat tunnel.",
    },
  },
  "ending-sentient": {
    phase: "training",
    scene: "objection-letter",
    beats: [
      "The council registers the objection in the model's name. The planner calls it 'very thorough'.",
    ],
    ending: {
      id: "sentient-objection",
      prose:
        "{name} trains a model that objects to {name}. SIN04 is refused and the model is granted standing. The newts, the bats, the sardines, and the machine hold their first meeting on a Tuesday.",
    },
  },

  // ---- Endgame ambient-action sub-stories (return to the interrupted beat) -
  "dash-check": {
    beats: ["The dashboards are a wall of green with one amber square everyone calls 'known'."],
    roll: {
      branches: [
        {
          weight: 3,
          goto: "ops-return",
          beat: "The amber square is a sensor with a sense of humour. You leave it.",
        },
        {
          weight: 1,
          goto: "ops-return",
          beat: "Rack 14 in SIN03 is running hot. You fit the missing blanking panel yourself.",
          effects: { progress: 1 },
        },
      ],
    },
  },
  "oncall-shift": {
    beats: ["You take the 2 a.m. on-call shift, to the alarm of the on-call engineer."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "ops-return",
          beat: "Nothing pages. You drink the only bad coffee in Portugal and feel heroic.",
          effects: { goodwill: 1 },
        },
        {
          weight: 1,
          goto: "ops-return",
          beat: "A page at 3:40: a power strip trips in SIN01. The runbook works.",
          effects: { goodwill: 1, progress: 1 },
        },
      ],
    },
  },
  "board-brief": {
    beats: ["You brief the board. They nod at numbers going up and frown at numbers going right."],
    effects: { budget: 3 },
    return: true,
  },
  "ops-return": {
    beats: [],
    return: true,
  },
};

/**
 * Every node of the three arcs, keyed by id (ids are disjoint by
 * construction). `wildlifeExitTo` is where the wildlife arc hands off (the
 * roof beat, then the racking).
 */
export function crisisWildlifeEndgameNodes(wildlifeExitTo: string): NodeTable {
  return {
    ...crisisNodes,
    ...wildlifeNodes,
    ...wildlifeClosing(wildlifeExitTo),
    ...endgameNodes,
  };
}
