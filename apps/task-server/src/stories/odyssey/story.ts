/**
 * The Odyssey: a storyteller's prologue, then from the smoke of Troy to the
 * bed built round the olive tree, as one story graph the interpreter
 * (src/story/walk.ts) plays. Plain data; the art lives in ./art. "{name}" is
 * the hero (default Odysseus).
 *
 * Voice: the game master narrates in the second person, one short beat at
 * a time, for a reader of ten.
 *
 * Resources (start: ships 12, crew 600, supplies 60, favor 3, morale 7,
 * kleos 3) and the gates they drive:
 *   - favor (of the gods): falls with the sack of Ismarus, the boast to
 *     Polyphemus (-4: the whole curse), skipping the dead; rises with piety,
 *     Hermes, the oath, Tiresias, good omens. favor >= 2 at the Poseidon gate
 *     (after the cattle are left alone) sails the crew home; below it the
 *     ship is broken and the hero drifts to Calypso alone. favor < -3 wrecks
 *     the raft harder.
 *   - ships: the Laestrygonians leave one unless the fleet anchors outside;
 *     ships >= 2 after a Charybdis wreck means a rescue, else the last hull.
 *   - crew: crew >= 40 at Ithaca storms the hall with the men who came home.
 *   - supplies: supplies >= 15 sails past the cattle of the Sun without
 *     starving; the bypass of Circe and the month in the cove drain them.
 *   - morale: morale < 3 after Aeolus is the mutiny; morale < 1 makes the
 *     rationing order a mutiny on the spot; morale >= 5 storms the hall
 *     alone; rallying buys it back at the cost of wine.
 *   - kleos (glory): the boast, the stake, the mast, the bow. kleos >= 10 at
 *     Scheria means the bard is already singing about you.
 *
 * Timed crises (fate branches): the boast across the water (15 s, fate
 * shouts), the bag of winds (20 s, fate opens it), the cattle of the Sun
 * (20 s, fate lets them eat). Ambient actions: consult-the-gods /
 * ration-supplies / rally-the-crew aboard; pray-to-athena / look-east /
 * take-stock alone; consult-the-gods / count-the-suitors /
 * test-the-household at Ithaca.
 *
 * Endings (13): home-to-penelope, home-on-the-west-wind, the-lotus-eaters,
 * sealed-in-the-cave, the-harbor-of-giants, the-crew-mutinies,
 * mutiny-over-the-rations, the-sty-of-circe, the-sirens-meadow,
 * swallowed-by-charybdis, starved-in-sight-of-beef, stays-with-calypso,
 * slain-in-your-own-hall.
 */

import { registerStory } from "../../story";
import type { StoryInput } from "../../story/format";
import { scenes, sprites } from "./art";

type NodeInput = StoryInput["nodes"][string];

/* ========================================================================== */
/*  Ambient action sets                                                        */
/* ========================================================================== */

/** Aboard, with a crew: the standing set from Troy onward. */
const SHIP_ACTIONS = [
  { id: "consult-the-gods", label: "Consult the gods", goto: "consult" },
  { id: "ration-supplies", label: "Ration the supplies", goto: "ration" },
  { id: "rally-the-crew", label: "Rally the crew", goto: "rally" },
];

/** Alone on a keel, a raft, or a stranger's shore. */
const ALONE_ACTIONS = [
  { id: "pray-to-athena", label: "Pray to Athena", goto: "pray" },
  { id: "look-east", label: "Look east", goto: "look-east" },
  { id: "take-stock", label: "Take stock", goto: "take-stock" },
];

/** Home, in rags, counting. */
const ITHACA_ACTIONS = [
  { id: "consult-the-gods", label: "Consult the gods", goto: "consult" },
  { id: "count-the-suitors", label: "Count the suitors", goto: "count-suitors" },
  { id: "test-the-household", label: "Test the household", goto: "test-household" },
];

/* ========================================================================== */
/*  Nodes                                                                      */
/* ========================================================================== */

const nodes: Record<string, NodeInput> = {
  /* ---- Prologue: the storyteller, before the first oar ------------------- */

  prologue: {
    phase: "depart",
    scene: "boat",
    buildPercent: 0,
    beats: [
      "There was once a king of a small rocky island called Ithaca. His name was {name}.",
      "He fought ten years at Troy. His wooden horse won the war, and he still tells the story.",
      "All he wants now is to go home to Penelope and his son. The gods have other plans.",
    ],
    next: "troy-departure",
  },

  /* ---- Leaving Troy: Cicones, the storm, the Lotus-eaters ---------------- */

  "troy-departure": {
    phase: "depart",
    scene: "boat",
    buildPercent: 2,
    beats: ["Troy burns behind you. Twelve ships and six hundred men turn west for home, {name}."],
    next: "cicones-landfall",
  },
  "cicones-landfall": {
    phase: "depart",
    scene: "shore",
    buildPercent: 5,
    beats: ["Ismarus lies a day north. Its gates are open and its guards are drunk."],
    decision: {
      scene: "The men smell loot and say the war is not over. Do you sack the city?",
      options: [
        {
          id: "sack-ismarus",
          label: "Sack it",
          goto: "cicones-feast",
          effects: { supplies: 20, kleos: 1, favor: -1 },
        },
        {
          id: "spare-the-city",
          label: "Spare it",
          goto: "cicones-maron",
          effects: { favor: 1, morale: -1 },
        },
        {
          id: "raid-and-run",
          label: "Raid at dawn",
          goto: "cicones-dawn-raid",
        },
      ],
    },
  },
  "cicones-feast": {
    phase: "depart",
    beats: ["You order the men aboard three times. Three times they pour you a drink."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "lotus-storm",
          beat: "At dawn the Cicones ride down. Six benches on every ship are empty by noon.",
          effects: { crew: -72, morale: -2 },
        },
        {
          weight: 1,
          goto: "lotus-storm",
          beat: "The Cicones come at dawn. The men fight hungover, and the line holds.",
          effects: { crew: -36, morale: -1 },
        },
      ],
    },
  },
  "cicones-maron": {
    phase: "depart",
    beats: [
      "Maron, priest of Apollo, gives you twelve jars of wine strong enough to drop a giant.",
    ],
    effects: { supplies: 10 },
    next: "lotus-storm",
  },
  "cicones-dawn-raid": {
    phase: "depart",
    beats: ["No guards, and the oars wrapped in fleece. So far, so Greek."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "lotus-storm",
          beat: "The fleet is past the harbour wall with the barley before anyone wakes.",
          effects: { supplies: 12, kleos: 1 },
        },
        {
          weight: 1,
          goto: "lotus-storm",
          beat: "A dog barks, then a man, then the hills. The rearguard pays for the barley.",
          effects: { crew: -24, supplies: 6 },
        },
      ],
    },
  },
  "lotus-storm": {
    phase: "depart",
    scene: "boat",
    sprite: { id: "storm" },
    buildPercent: 8,
    beats: ["Nine days of gale end on a green coast where everyone smiles. That is worse."],
    effects: { supplies: -10 },
    next: "lotus-landfall",
  },
  "lotus-landfall": {
    phase: "depart",
    scene: "shore",
    buildPercent: 10,
    beats: ["Your three scouts eat the sweet lotus fruit, sit down, and forget ships exist."],
    decision: {
      scene: "Three men are weeping at the thought of a boat. What do you do with the scouts?",
      options: [
        {
          id: "drag-them-aboard",
          label: "Drag them aboard",
          goto: "cyclops-landfall",
          effects: { morale: -1 },
        },
        {
          id: "taste-the-lotus",
          label: "Taste it yourself",
          goto: "lotus-dream",
        },
        {
          id: "leave-them",
          label: "Leave them",
          goto: "cyclops-landfall",
          effects: { crew: -3, morale: -2, favor: -1 },
        },
      ],
    },
  },
  "lotus-dream": {
    phase: "depart",
    beats: ["It tastes of every afternoon you ever spent going nowhere. It is very good."],
    roll: {
      branches: [
        {
          weight: 3,
          goto: "cyclops-landfall",
          beat: "You wake in a cold fury and drive the crew to the oars.",
          effects: { morale: 1 },
        },
        {
          weight: 1,
          goto: "ending-lotus",
          beat: "Nobody wakes. The ships settle into the sand.",
        },
      ],
    },
  },
  "ending-lotus": {
    phase: "depart",
    beats: ["Years later a trader finds a gentle shore where some people, oddly, speak Greek."],
    ending: {
      id: "the-lotus-eaters",
      prose:
        "{name} never leaves the land of the lotus. Ithaca becomes a word that means nothing much, and the men agree it was a lovely word.",
    },
  },

  /* ---- Polyphemus ------------------------------------------------------- */

  "cyclops-landfall": {
    phase: "cyclops",
    scene: "shore",
    buildPercent: 15,
    beats: ["Something huge whistles to its sheep across the strait. You take twelve men."],
    decision: {
      scene: "The cave is full of cheese and lambs, and nobody is home. What is the order, {name}?",
      options: [
        {
          id: "wait-for-host",
          label: "Wait for the host",
          goto: "cyclops-supper",
          effects: { kleos: 1 },
        },
        {
          id: "take-and-run",
          label: "Take and run",
          goto: "cyclops-clean-escape",
          effects: { supplies: 15, morale: 1, kleos: -1 },
        },
        {
          id: "ambush-the-host",
          label: "Set an ambush",
          goto: "cyclops-ambush",
        },
      ],
    },
  },
  "cyclops-clean-escape": {
    phase: "cyclops",
    scene: "boat",
    beats: [
      "The host comes home as you row away, a bellowing one-eyed hill. The cheese is excellent.",
    ],
    next: "aeolus-landfall",
  },
  "cyclops-ambush": {
    phase: "cyclops",
    beats: ["Twelve spears wait at the cave mouth. Then the sheep come in first."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "cyclops-flee",
          beat: "Polyphemus fills the doorway like weather. The spears bounce off, and you flee two men short.",
          effects: { crew: -2, morale: -1 },
        },
        {
          weight: 1,
          goto: "cyclops-supper",
          beat: "He is faster than a hill should be. The boulder seals you all inside.",
        },
      ],
    },
  },
  "cyclops-flee": {
    phase: "cyclops",
    scene: "boat",
    beats: ["Half a hillside lands astern, and the wave shoves you back to the fleet."],
    next: "aeolus-landfall",
  },
  "cyclops-supper": {
    phase: "cyclops",
    scene: "cave",
    sprite: { id: "cyclops", persist: true },
    buildPercent: 18,
    beats: ["Polyphemus, son of Poseidon, eats four men and rolls a boulder across the door."],
    effects: { crew: -4, morale: -1 },
    decision: {
      scene:
        "You have Maron's wine, a fire, and an olive trunk the size of a mast. What is the plan?",
      options: [
        {
          id: "wine-and-a-stake",
          label: "Wine and a stake",
          goto: "cyclops-blinding",
          effects: { kleos: 2 },
        },
        {
          id: "kill-him-in-his-sleep",
          label: "Kill him asleep",
          goto: "cyclops-tomb",
        },
        {
          id: "talk-your-way-out",
          label: "Talk your way out",
          goto: "cyclops-bargain",
        },
      ],
    },
  },
  "cyclops-tomb": {
    phase: "cyclops",
    beats: ["The giant dies in his sleep. The men cheer, then everyone looks at the boulder."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "ending-cyclops-tomb",
          beat: "The boulder does not move for a dead man either.",
        },
        {
          weight: 1,
          goto: "cyclops-dig-out",
          beat: "On the third day the sheep find a gap a man cannot.",
        },
      ],
    },
  },
  "ending-cyclops-tomb": {
    phase: "cyclops",
    beats: ["The cheese lasts a month. The candles, being sheep fat, last a little longer."],
    ending: {
      id: "sealed-in-the-cave",
      prose:
        "{name} and nine men die in the cave of Polyphemus, with a dead giant and a great deal of cheese. The boulder is still there.",
    },
  },
  "cyclops-dig-out": {
    phase: "cyclops",
    scene: "boat",
    beats: ["Three days of scraping widen the gap. Those who fit through row away."],
    effects: { crew: -3, morale: -1, kleos: -1 },
    next: "aeolus-landfall",
  },
  "cyclops-bargain": {
    phase: "cyclops",
    beats: ["You offer the wine with a speech. He drains it and asks your name."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "cyclops-blinding",
          beat: "He promises to eat Nobody last, as a courtesy, and falls asleep. The stake, then.",
        },
        {
          weight: 1,
          goto: "cyclops-blinding",
          beat: "He laughs, eats one more man, and sleeps. Plan B, with feeling.",
          effects: { crew: -1, morale: -1 },
        },
      ],
    },
  },
  "cyclops-blinding": {
    phase: "cyclops",
    buildPercent: 20,
    beats: [
      "The stake goes in, and he roars that Nobody hurt him. At dawn you creep out under his sheep.",
    ],
    next: "cyclops-boast",
  },
  "cyclops-boast": {
    phase: "cyclops",
    scene: "boat",
    buildPercent: 22,
    beats: ["From the cliff a blind giant asks the sea who did this to him."],
    decision: {
      scene:
        "The men beg you, in whispers, to keep quiet. Do you shout your true name across the water?",
      options: [
        {
          id: "shout-your-name",
          label: "Shout your name",
          goto: "cyclops-curse",
          effects: { kleos: 3, favor: -4 },
        },
        {
          id: "stay-nobody",
          label: "Stay Nobody",
          goto: "cyclops-silent",
          effects: { morale: 1, favor: -1 },
        },
      ],
      timeoutMs: 15_000,
      fateGoto: "cyclops-curse-fate",
    },
  },
  "cyclops-curse-fate": {
    phase: "cyclops",
    beats: ["You do not decide, so your pride does. Your name is across the water."],
    effects: { kleos: 2, favor: -4 },
    next: "cyclops-curse",
  },
  "cyclops-curse": {
    phase: "cyclops",
    beats: ["Polyphemus asks his father Poseidon to bring you home late, alone, and to trouble."],
    next: "aeolus-landfall",
  },
  "cyclops-silent": {
    phase: "cyclops",
    beats: ["The men love you for it. Poseidon curses Nobody, thoroughly, which is some comfort."],
    next: "aeolus-landfall",
  },

  /* ---- The open sea: Aeolus, the mutiny, the Laestrygonians -------------- */

  "aeolus-landfall": {
    phase: "sea",
    scene: "aeolia",
    buildPercent: 25,
    beats: ["Aeolus, keeper of the winds, gives you a bag of every bad wind, tied shut."],
    effects: { supplies: 15, morale: 1 },
    next: "aeolus-voyage",
  },
  "aeolus-voyage": {
    phase: "sea",
    scene: "boat",
    sprite: { id: "winds" },
    buildPercent: 34,
    beats: ["Nine days you will not sleep. On the tenth, the fires of Ithaca show ahead."],
    effects: { supplies: -5 },
    next: "aeolus-crisis",
  },
  "aeolus-crisis": {
    phase: "sea",
    beats: ["Sleep takes you at last, and Eurylochus has a theory about gold."],
    decision: {
      scene:
        "You wake to a knife at the wire and home in sight. Do you throw yourself on the bag, or trust the men?",
      options: [
        {
          id: "seize-the-bag",
          label: "Seize the bag",
          goto: "aeolus-guarded",
          effects: { morale: -1 },
        },
        {
          id: "trust-the-men",
          label: "Trust the men",
          goto: "aeolus-blown-back",
        },
        {
          id: "let-them-look",
          label: "Let them look",
          goto: "aeolus-opened-on-purpose",
          effects: { morale: 1 },
        },
      ],
      timeoutMs: 20_000,
      fateGoto: "aeolus-blown-back",
    },
  },
  "aeolus-guarded": {
    phase: "sea",
    beats: ["You land on the bag like a man smothering a fire."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "ending-home-by-the-winds",
          beat: "You sit on the bag, sword on your knees, all the way home.",
        },
        {
          weight: 2,
          goto: "aeolus-blown-back",
          beat: "You nod off once, and a hand is already at the knot.",
          sprite: { id: "storm" },
        },
      ],
    },
  },
  "ending-home-by-the-winds": {
    phase: "home",
    scene: "palace",
    buildPercent: 100,
    beats: ["Two years out of Troy, the whole fleet sails home. Penelope puts down her loom."],
    ending: {
      id: "home-on-the-west-wind",
      prose:
        "{name} comes home on the west wind with twelve ships and most of the men. The poets have less to sing about, and nobody minds, least of all Penelope.",
    },
  },
  "aeolus-opened-on-purpose": {
    phase: "sea",
    beats: ["You are making a point. The point leaves the bag at two hundred knots."],
    next: "aeolus-blown-back",
  },
  "aeolus-blown-back": {
    phase: "sea",
    sprite: { id: "storm" },
    buildPercent: 26,
    beats: [
      "The winds come out of the bag all at once and blow you back to Aeolia. Aeolus shuts his gate.",
    ],
    effects: { morale: -2, supplies: -10 },
    next: "mutiny-gate",
  },
  "mutiny-gate": {
    phase: "sea",
    gate: { resource: "morale", min: 3, elseGoto: "mutiny-rises" },
    beats: [],
    next: "laestrygonians-harbor",
  },
  "mutiny-rises": {
    phase: "sea",
    beats: ["Eurylochus stands up in the stern. Your pride has cost them Ithaca twice, he says."],
    decision: {
      scene:
        "Eurylochus names the men who will sail east without you, and it is most of them. What do you do, {name}?",
      options: [
        {
          id: "put-him-in-irons",
          label: "Put him in irons",
          goto: "mutiny-irons",
          effects: { morale: -1, kleos: 1 },
        },
        {
          id: "give-them-a-ship",
          label: "Give them a ship",
          goto: "mutiny-parted",
          effects: { ships: -1, crew: -50, supplies: -5, morale: 2 },
        },
        {
          id: "talk-them-round",
          label: "Talk them round",
          goto: "mutiny-talk",
        },
      ],
    },
  },
  "mutiny-irons": {
    phase: "sea",
    beats: ["Eurylochus spends a week tied to the mast. Nobody says mutiny again, or sings."],
    next: "laestrygonians-harbor",
  },
  "mutiny-parted": {
    phase: "sea",
    beats: ["One ship turns east with fifty men. You choose to believe it got home."],
    next: "laestrygonians-harbor",
  },
  "mutiny-talk": {
    phase: "sea",
    beats: ["You stand in the bow and talk until the stars move."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "laestrygonians-harbor",
          beat: "They sit down one bench at a time, Eurylochus last.",
          effects: { morale: 2, supplies: -3 },
        },
        {
          weight: 1,
          goto: "ending-mutiny",
          beat: "They have heard the horse story. They leave you a boat with no oars.",
        },
      ],
    },
  },
  "ending-mutiny": {
    phase: "sea",
    beats: ["Eleven sails go east on a fair wind, for once."],
    ending: {
      id: "the-crew-mutinies",
      prose:
        "{name} watches the fleet sail for Ithaca without him. The boat has no oars, and the poets, out of tact, sing about something else.",
    },
  },
  "laestrygonians-harbor": {
    phase: "sea",
    scene: "harbor",
    buildPercent: 38,
    beats: ["Telepylos is a harbour like a cup, with not one boat in it."],
    decision: {
      scene: "Eleven captains want the calm water inside. Where does your own ship moor, {name}?",
      options: [
        {
          id: "all-inside",
          label: "All twelve inside",
          goto: "laestrygonians-slaughter",
        },
        {
          id: "flagship-outside",
          label: "Yours outside",
          goto: "laestrygonians-escape",
        },
        {
          id: "all-outside",
          label: "Nobody inside",
          goto: "laestrygonians-scouts",
          effects: { morale: -1 },
        },
      ],
    },
  },
  "laestrygonians-slaughter": {
    phase: "sea",
    beats: [
      "The Laestrygonians are giants, and the harbour is their pantry. Boulders fall like rain.",
    ],
    effects: { ships: -11, crew: -520, morale: -3 },
    roll: {
      branches: [
        {
          weight: 2,
          goto: "laestrygonians-one-ship",
          beat: "Your sword cuts the cable, and the last ship claws out over the wreckage.",
        },
        {
          weight: 1,
          goto: "ending-laestrygonians",
          beat: "The last boulder finds the last ship.",
        },
      ],
    },
  },
  "ending-laestrygonians": {
    phase: "sea",
    beats: ["The giants keep the timbers for firewood. The harbour is flat again by evening."],
    ending: {
      id: "the-harbor-of-giants",
      prose:
        "{name} and the whole fleet from Troy are eaten at Telepylos. The Laestrygonians remember it as a good year.",
    },
  },
  "laestrygonians-escape": {
    phase: "sea",
    beats: ["From outside the mouth you watch the giants wade in. Eleven ships never come out."],
    effects: { ships: -11, crew: -500, morale: -3 },
    next: "laestrygonians-one-ship",
  },
  "laestrygonians-scouts": {
    phase: "sea",
    beats: ["The scouts meet a friendly girl the size of a mast. Her mother is not friendly."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "circe-landfall",
          beat: "The boat comes back two men short, and the fleet is away in time.",
          effects: { crew: -2, kleos: 1, morale: 1 },
        },
        {
          weight: 1,
          goto: "circe-landfall",
          beat: "The giants are faster than anchors. Four ships pay for it.",
          effects: { ships: -4, crew: -170, morale: -2 },
        },
      ],
    },
  },
  "laestrygonians-one-ship": {
    phase: "sea",
    scene: "boat",
    buildPercent: 40,
    beats: ["One ship. Forty-odd men, and you count them twice, and nobody sings."],
    effects: { supplies: -10 },
    next: "circe-landfall",
  },

  /* ---- Aeaea: Circe --------------------------------------------------- */

  "circe-landfall": {
    phase: "island",
    scene: "shore",
    buildPercent: 45,
    beats: ["Smoke rises from the woods of Aeaea. The men have seen smoke before, and weep."],
    decision: {
      scene: "Somebody has to go up to the house of smoke. Who goes?",
      options: [
        {
          id: "send-eurylochus",
          label: "Send Eurylochus",
          goto: "circe-pigs",
        },
        {
          id: "go-yourself",
          label: "Go yourself",
          goto: "circe-hermes",
          effects: { kleos: 1 },
        },
        {
          id: "sail-on-hungry",
          label: "Sail on hungry",
          goto: "circe-bypass",
          effects: { supplies: -15, morale: -2 },
        },
      ],
    },
  },
  "circe-bypass": {
    phase: "island",
    scene: "boat",
    beats: ["You sail on with half-empty jars and nobody to tell you the way."],
    next: "sirens-approach-blind",
  },
  "circe-pigs": {
    phase: "island",
    beats: ["Eurylochus comes back alone. A woman gave the men a drink, and now they are pigs."],
    next: "circe-hermes",
  },
  "circe-hermes": {
    phase: "island",
    sprite: { id: "moly" },
    beats: [
      "On the path a bored Hermes hands you a flower called moly, with precise instructions.",
    ],
    effects: { favor: 1 },
    next: "circe-hall",
  },
  "circe-hall": {
    phase: "island",
    scene: "hall",
    buildPercent: 48,
    beats: ["Circe offers the cup, good wine with something in it. You drink it down."],
    decision: {
      scene:
        "She strikes you with her wand and tells you to join the pigs. The moly holds, and her eyes go wide. What now?",
      options: [
        {
          id: "draw-your-sword",
          label: "Draw your sword",
          goto: "circe-oath",
          effects: { favor: 1, kleos: 1 },
        },
        {
          id: "go-to-bed-first",
          label: "Skip the oath",
          goto: "circe-bed-unsworn",
        },
        {
          id: "bargain-for-the-men",
          label: "Bargain for the men",
          goto: "circe-oath",
          effects: { morale: 2 },
        },
      ],
    },
  },
  "circe-bed-unsworn": {
    phase: "island",
    beats: ["Hermes was quite clear about the oath. You decide Hermes is not here."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "circe-year",
          beat: "She laughs and swears the oath later anyway. The men are men by supper.",
          effects: { morale: -1 },
        },
        {
          weight: 1,
          goto: "ending-circe-sty",
          beat: "She smiles, and the wand comes up again. No flower in the world helps.",
        },
      ],
    },
  },
  "ending-circe-sty": {
    phase: "island",
    beats: ["The sty is warm and the acorns are plentiful. After a while, that is enough."],
    ending: {
      id: "the-sty-of-circe",
      prose:
        "{name} roots for acorns in the sty of Circe with the rest of the crew. He cannot remember why the word Ithaca makes him sad.",
    },
  },
  "circe-oath": {
    phase: "island",
    beats: ["She swears by Styx, which even gods fear, and the pigs are men again."],
    next: "circe-year",
  },
  "circe-year": {
    phase: "island",
    buildPercent: 50,
    beats: ["A year at Circe's table passes before the men, of all people, mention Ithaca."],
    effects: { supplies: 25, morale: 1 },
    decision: {
      scene:
        "Circe says to ask the dead prophet Tiresias the way first. The men sit down on the floor. Do you sail down to the dead, or straight for home?",
      options: [
        {
          id: "go-down-to-hades",
          label: "Go down to Hades",
          goto: "underworld-voyage",
          effects: { favor: 1 },
        },
        {
          id: "sail-for-home-now",
          label: "Sail for home now",
          goto: "circe-directions",
          effects: { morale: 1, favor: -1 },
        },
      ],
    },
  },
  "circe-directions": {
    phase: "island",
    beats: ["Circe gives you the course. Elpenor wakes on her roof, and falls off it."],
    effects: { crew: -1 },
    next: "sirens-approach",
  },

  /* ---- The Underworld --------------------------------------------------- */

  "underworld-voyage": {
    phase: "underworld",
    scene: "underworld",
    buildPercent: 55,
    beats: ["Elpenor falls off the roof as you leave. At the edge of Ocean, you call the dead."],
    effects: { crew: -1 },
    next: "underworld-pit",
  },
  "underworld-pit": {
    phase: "underworld",
    beats: ["The first shade up is Elpenor, asking to be buried. You promise."],
    decision: {
      scene: "The shades press in, and your mother is among them. Who drinks first and speaks?",
      options: [
        {
          id: "tiresias-only",
          label: "Tiresias first",
          goto: "underworld-tiresias",
          effects: { favor: 1 },
        },
        {
          id: "your-mother-first",
          label: "Your mother first",
          goto: "underworld-mother",
          effects: { favor: -1 },
        },
        {
          id: "the-heroes-first",
          label: "The heroes first",
          goto: "underworld-heroes-first",
          effects: { kleos: 1, morale: -1 },
        },
      ],
    },
  },
  "underworld-mother": {
    phase: "underworld",
    beats: ["She died of missing you, she says. You reach for her three times and hold smoke."],
    next: "underworld-tiresias",
  },
  "underworld-heroes-first": {
    phase: "underworld",
    beats: ["Agamemnon says come home in secret. Achilles would rather be alive and poor."],
    next: "underworld-tiresias",
  },
  "underworld-tiresias": {
    phase: "underworld",
    buildPercent: 58,
    beats: ["Tiresias speaks plain. Leave the Sun's cattle alone, and you may get home."],
    effects: { favor: 1 },
    next: "underworld-shades",
  },
  "underworld-shades": {
    phase: "underworld",
    beats: ["Ajax will not speak to you, which is fair. Then the dead crowd in."],
    effects: { morale: -1, kleos: 1 },
    next: "sirens-approach",
  },

  /* ---- The Sirens, Scylla and Charybdis --------------------------------- */

  "sirens-approach": {
    phase: "strait",
    scene: "boat",
    sprite: { id: "sirens" },
    buildPercent: 64,
    beats: ["The sea goes flat as oil, and ahead there is singing that knows your name."],
    effects: { supplies: -5 },
    decision: {
      scene: "Circe warned you of this, in detail. How do you pass the Sirens?",
      options: [
        {
          id: "wax-and-ropes",
          label: "Wax and ropes",
          goto: "sirens-bound",
          effects: { kleos: 2, morale: 1 },
        },
        {
          id: "wax-for-all",
          label: "Wax for everyone",
          goto: "strait-choice",
          effects: { kleos: -1 },
        },
        {
          id: "row-on-will",
          label: "No wax, just row",
          goto: "sirens-song",
        },
      ],
    },
  },
  "sirens-approach-blind": {
    phase: "strait",
    scene: "boat",
    sprite: { id: "sirens" },
    buildPercent: 64,
    beats: [
      "Nobody warned you. The singing starts, it knows your name, and the helmsman is smiling.",
    ],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "strait-choice",
          beat: "You stuff wax in the men's ears just in time. Too late for two.",
          effects: { crew: -2, morale: -1 },
        },
        {
          weight: 1,
          goto: "ending-sirens",
          beat: "By the time you understand, the bow points at the meadow. Nobody minds.",
        },
      ],
    },
  },
  "sirens-bound": {
    phase: "strait",
    beats: ["You beg to be untied, and Eurylochus, bless him, ties you tighter."],
    next: "strait-choice",
  },
  "sirens-song": {
    phase: "strait",
    beats: ["The song is whatever each man most wants to hear."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "strait-choice",
          beat: "The oars never break rhythm. The men are grey-faced, and proud.",
          effects: { morale: 2, kleos: 1 },
        },
        {
          weight: 2,
          goto: "strait-choice",
          beat: "Three men go over the side before anyone can grab them.",
          effects: { crew: -3, morale: -2 },
        },
        {
          weight: 1,
          goto: "ending-sirens",
          beat: "The helmsman turns for the meadow, smiling, and nobody stops him.",
        },
      ],
    },
  },
  "ending-sirens": {
    phase: "strait",
    beats: ["The singing never stops. Soon there is no one left to hear it."],
    ending: {
      id: "the-sirens-meadow",
      prose:
        "{name} and the crew go ashore to the singing. The bones in the meadow are somewhat more numerous the following year.",
    },
  },
  "strait-choice": {
    phase: "strait",
    scene: "strait",
    buildPercent: 70,
    beats: [
      "Two rocks, a ship's width apart. Charybdis under one, six-headed Scylla in the other.",
    ],
    decision: {
      scene:
        "Circe said hug Scylla's rock, lose six men, and keep the ship. Which rock do you steer for?",
      options: [
        {
          id: "hug-scylla",
          label: "Scylla's rock",
          goto: "strait-scylla",
          effects: { crew: -6, morale: -2, kleos: 1 },
        },
        {
          id: "risk-charybdis",
          label: "Charybdis",
          goto: "strait-charybdis",
        },
        {
          id: "arm-and-fight",
          label: "Arm and fight",
          goto: "strait-fight",
        },
      ],
    },
  },
  "strait-scylla": {
    phase: "strait",
    sprite: { id: "scylla" },
    beats: ["Six heads come out of the fog, and six men go up, calling your name."],
    next: "sun-approach",
  },
  "strait-charybdis": {
    phase: "strait",
    beats: ["The sea drops away under the keel until the black sand shows."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "sun-approach",
          beat: "The ship skates over the rim. The men laugh like madmen for a mile.",
          effects: { morale: 2, kleos: 2 },
        },
        {
          weight: 1,
          goto: "charybdis-wreck",
          beat: "The inward breath catches the stern. Men cling to planks in white water.",
        },
      ],
    },
  },
  "charybdis-wreck": {
    phase: "strait",
    gate: { resource: "ships", min: 2, elseGoto: "charybdis-last-ship" },
    beats: ["Another ship pulls the swimmers out. The fleet is one hull smaller."],
    effects: { ships: -1, crew: -20, morale: -1 },
    next: "sun-approach",
  },
  "charybdis-last-ship": {
    phase: "strait",
    beats: ["There is no other ship. You hang from the fig tree like a bat."],
    effects: { ships: -1, crew: -600, morale: -3 },
    roll: {
      branches: [
        {
          weight: 1,
          goto: "ending-charybdis",
          beat: "Scylla, who has watched all this with interest, reaches down.",
          sprite: { id: "scylla" },
        },
        {
          weight: 1,
          goto: "adrift-alone",
          beat: "Charybdis spits the keel back up. The men are gone, every one.",
        },
      ],
    },
  },
  "ending-charybdis": {
    phase: "strait",
    beats: ["Charybdis gulps, and the sea closes over the last ship from Troy."],
    ending: {
      id: "swallowed-by-charybdis",
      prose:
        "{name} and the last of the men go down in the strait. Scylla yelps like a puppy, and the fig tree says nothing.",
    },
  },
  "strait-fight": {
    phase: "strait",
    sprite: { id: "scylla" },
    beats: ["You stand on the bow with two spears, watching the wrong bit of fog."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "sun-approach",
          beat: "Two heads take spears, four come down anyway. Eight men die, but they saw you fight.",
          effects: { crew: -8, morale: 1, kleos: 2 },
        },
        {
          weight: 2,
          goto: "strait-scylla",
          beat: "Scylla does not fight. She reaches past you and takes six from the benches.",
          effects: { kleos: -1 },
        },
      ],
    },
  },

  /* ---- Thrinacia: the cattle of the Sun --------------------------------- */

  "sun-approach": {
    phase: "sun",
    scene: "meadow",
    buildPercent: 76,
    beats: ["Thrinacia, island of the Sun. You hear the cattle before you see the shore."],
    effects: { supplies: -10 },
    decision: {
      scene:
        "Every prophet said sail past. The men are half dead at the oars, and the cove is right there. Do you put in?",
      options: [
        {
          id: "sail-past",
          label: "Sail past",
          goto: "sun-bypass-gate",
          effects: { morale: -3 },
        },
        {
          id: "land-on-oath",
          label: "Land on oath",
          goto: "sun-stranded",
        },
        {
          id: "land-and-butcher",
          label: "Land and eat beef",
          goto: "sun-wrath",
          effects: { morale: 2, favor: -5 },
        },
      ],
    },
  },
  "sun-bypass-gate": {
    phase: "sun",
    gate: { resource: "supplies", min: 15, elseGoto: "sun-starving" },
    beats: ["The men row past, cursing in rhythm. Nobody dies, and nobody thanks you."],
    next: "poseidon-gate",
  },
  "sun-starving": {
    phase: "sun",
    scene: "boat",
    beats: ["The jars are empty. The men row past the fattest cattle in the world, watching you."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "poseidon-gate",
          beat: "On the third day fish run under the keel. The men weep and spear them.",
          effects: { supplies: 10, morale: 1 },
        },
        {
          weight: 1,
          goto: "ending-starved",
          beat: "No fish come. On the fourth day the oars stop, one by one.",
        },
      ],
    },
  },
  "ending-starved": {
    phase: "sun",
    beats: ["The ship drifts on, past a ship from Ithaca that does not stop."],
    ending: {
      id: "starved-in-sight-of-beef",
      prose:
        "{name} and the crew starve on the wine-dark sea, close enough to smell the cattle of the Sun. Helios sees everything, notices, and is satisfied.",
    },
  },
  "sun-stranded": {
    phase: "sun",
    beats: ["A south gale pins you in the cove for a month. The food runs out."],
    effects: { supplies: -30, morale: -2 },
    next: "sun-temptation",
  },
  "sun-temptation": {
    phase: "sun",
    beats: ["You go inland to pray and fall asleep. Eurylochus makes a speech about beef."],
    decision: {
      scene:
        "You wake to the smell of roasting beef on the wind. Do you kick over the spits, or let the men eat?",
      options: [
        {
          id: "forbid-the-feast",
          label: "Kick over the spits",
          goto: "sun-forbidden",
          effects: { morale: -3 },
        },
        {
          id: "let-them-eat",
          label: "Let them eat",
          goto: "sun-wrath",
          effects: { morale: 1, favor: -3 },
        },
      ],
      timeoutMs: 20_000,
      fateGoto: "sun-wrath",
    },
  },
  "sun-forbidden": {
    phase: "sun",
    beats: ["You kick over the spits, and the men eat leather and hate you."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "poseidon-gate",
          beat: "On the thirty-first morning the wind swings west, and you are gone.",
          effects: { morale: 1 },
        },
        {
          weight: 1,
          goto: "poseidon-gate",
          beat: "Hunger takes four men before the wind turns.",
          effects: { crew: -4, morale: -2 },
        },
      ],
    },
  },
  "sun-wrath": {
    phase: "sun",
    sprite: { id: "lightning" },
    buildPercent: 78,
    beats: [
      "The meat lows on the spits, and the men eat anyway. Zeus puts a bolt through the mast.",
    ],
    effects: { ships: -1, crew: -600, favor: -2 },
    next: "adrift-alone",
  },
  "poseidon-gate": {
    phase: "sun",
    gate: { resource: "favor", min: 2, elseGoto: "poseidon-wreck" },
    beats: ["The sea stays kind, for once. The gods owe you a passage."],
    next: "sea-road-home",
  },
  "poseidon-wreck": {
    phase: "calypso",
    sprite: { id: "storm" },
    beats: ["Poseidon remembers his son. A wave like a wall breaks the ship in half."],
    effects: { ships: -1, crew: -600 },
    next: "adrift-alone",
  },
  "sea-road-home": {
    phase: "home",
    scene: "boat",
    buildPercent: 88,
    beats: ["Athena has had a word with the wind. The men begin, cautiously, to sing."],
    effects: { morale: 2 },
    next: "ithaca-landing",
  },

  /* ---- Ogygia: Calypso, and the raft ----------------------------------- */

  "adrift-alone": {
    phase: "calypso",
    scene: "boat",
    buildPercent: 80,
    actions: ALONE_ACTIONS,
    beats: ["Nine days alone on a keel. On the tenth night, an island and a light."],
    next: "calypso-grotto",
  },
  "calypso-grotto": {
    phase: "calypso",
    scene: "grotto",
    buildPercent: 84,
    beats: ["Calypso feeds you, loves you, and is in no hurry. For seven years you look east."],
    decision: {
      scene:
        "Calypso offers to make you ageless and deathless, here, with her, forever. What do you choose, {name}?",
      options: [
        {
          id: "ask-for-an-axe",
          label: "Ask for an axe",
          goto: "calypso-raft",
          effects: { morale: 1, kleos: 1 },
        },
        {
          id: "wait-on-the-gods",
          label: "Wait on the gods",
          goto: "calypso-hermes",
          effects: { favor: 1 },
        },
        {
          id: "accept-immortality",
          label: "Accept forever",
          goto: "ending-calypso",
        },
      ],
    },
  },
  "calypso-hermes": {
    phase: "calypso",
    beats: [
      "Hermes brings an order from Zeus, complaining about the distance. Calypso rages, then points at the timber.",
    ],
    next: "calypso-raft",
  },
  "ending-calypso": {
    phase: "calypso",
    beats: ["The years stop counting. Somewhere east a woman weaves by day and unpicks by night."],
    ending: {
      id: "stays-with-calypso",
      prose:
        "{name} lives forever on Ogygia with Calypso, ageless and beloved. Immortals are never quite content, and neither is he.",
    },
  },
  "calypso-raft": {
    phase: "calypso",
    scene: "boat",
    buildPercent: 87,
    beats: ["Twenty trees become a raft. You do not look back, except once."],
    next: "raft-storm",
  },
  "raft-storm": {
    phase: "calypso",
    gate: { resource: "favor", min: -3, elseGoto: "raft-wreck-hard" },
    sprite: { id: "storm" },
    beats: [
      "Seventeen days, then Poseidon sees the raft and raises every wind. You swim for two days.",
    ],
    next: "phaeacia-landfall",
  },
  "raft-wreck-hard": {
    phase: "calypso",
    sprite: { id: "storm" },
    beats: ["Poseidon holds you under twice, to be sure. You crawl ashore half dead."],
    effects: { morale: -2 },
    next: "phaeacia-landfall",
  },

  /* ---- Home: Scheria, Ithaca, the suitors ------------------------------- */

  "phaeacia-landfall": {
    phase: "home",
    scene: "shore",
    buildPercent: 90,
    beats: ["A ball lands beside your head. The princess Nausicaa, to her credit, does not run."],
    next: "phaeacia-famous",
  },
  "phaeacia-famous": {
    phase: "home",
    gate: { resource: "kleos", min: 10, elseGoto: "phaeacia-court" },
    scene: "court",
    beats: ["The bard Demodocus is already singing about you, mostly wrong. You correct him."],
    effects: { kleos: 2, favor: 1, supplies: 20 },
    next: "phaeacia-ship",
  },
  "phaeacia-court": {
    phase: "home",
    scene: "court",
    beats: ["The bard Demodocus sings of Troy. You weep, and only the king notices."],
    decision: {
      scene:
        "Alcinous asks, gently, who you are and why the song hurts. What do you tell the court?",
      options: [
        {
          id: "tell-everything",
          label: "Tell everything",
          goto: "phaeacia-ship",
          effects: { kleos: 3, favor: 1, supplies: 20 },
        },
        {
          id: "a-shipwrecked-nobody",
          label: "A shipwrecked nobody",
          goto: "phaeacia-ship-quiet",
          effects: { kleos: -1 },
        },
      ],
    },
  },
  "phaeacia-ship": {
    phase: "home",
    scene: "boat",
    buildPercent: 93,
    beats: ["The Phaeacians load a ship with gold and row you home overnight."],
    next: "ithaca-landing",
  },
  "phaeacia-ship-quiet": {
    phase: "home",
    scene: "boat",
    buildPercent: 93,
    beats: ["They give a nobody a ship and a blanket, which is the Phaeacian way."],
    next: "ithaca-landing",
  },
  "ithaca-landing": {
    phase: "home",
    scene: "shore",
    buildPercent: 95,
    actions: ITHACA_ACTIONS,
    beats: [
      "Ithaca, and a shepherd boy who is plainly Athena. She makes you look seventy, for safety.",
    ],
    next: "ithaca-swineherd",
  },
  "ithaca-swineherd": {
    phase: "home",
    beats: [
      "Eumaeus the swineherd feeds a beggar, no questions. Your old dog Argos knows you, and dies.",
    ],
    decision: {
      scene:
        "A hundred and eight suitors fill your hall. Rags and the bow, or a sword at the door, {name}?",
      options: [
        {
          id: "beggar-and-bow",
          label: "Beggar and bow",
          goto: "ithaca-bow",
        },
        {
          id: "storm-the-hall",
          label: "Storm the hall",
          goto: "ithaca-storm-gate",
        },
        {
          id: "go-to-penelope-first",
          label: "Penelope first",
          goto: "ithaca-penelope-plot",
        },
      ],
    },
  },
  "ithaca-penelope-plot": {
    phase: "home",
    scene: "palace",
    beats: ["You climb the back stair in the dark. She is awake, because she is always awake."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "ithaca-bow",
          beat: "She does not believe you, and then she does. The bow is her idea.",
          effects: { morale: 2 },
        },
        {
          weight: 1,
          goto: "ithaca-storm-gate",
          beat: "A maid sees you on the stair. By morning the suitors are waiting with swords.",
          effects: { morale: -2 },
        },
      ],
    },
  },
  "ithaca-storm-gate": {
    phase: "home",
    gate: { resource: "crew", min: 40, elseGoto: "ithaca-storm-alone" },
    scene: "palace",
    beats: ["Your men come up from the ship at dusk, armed, and the suitors are drunk."],
    effects: { kleos: 2 },
    next: "ithaca-victory",
  },
  "ithaca-storm-alone": {
    phase: "home",
    gate: { resource: "morale", min: 5, elseGoto: "ending-slain" },
    scene: "palace",
    beats: [
      "Telemachus, Eumaeus, the cowherd and you, against a hundred and eight. It is a harvest.",
    ],
    effects: { kleos: 3 },
    next: "ithaca-victory",
  },
  "ithaca-bow": {
    phase: "home",
    scene: "palace",
    beats: ["The suitors cannot even bend the great bow. The beggar asks, politely, for a turn."],
    decision: {
      scene: "The bow is in your hands and the hall is laughing. What do you do?",
      options: [
        {
          id: "string-and-shoot",
          label: "String it and shoot",
          goto: "ithaca-victory",
          effects: { kleos: 2 },
        },
        {
          id: "name-yourself-first",
          label: "Name yourself first",
          goto: "ithaca-storm-gate",
          effects: { morale: -1, kleos: 1 },
        },
      ],
    },
  },
  "ithaca-victory": {
    phase: "home",
    buildPercent: 100,
    beats: [
      "The first arrow goes through twelve axes, the next through Antinous. By evening the hall is yours.",
    ],
    next: "ithaca-penelope",
  },
  "ithaca-penelope": {
    phase: "home",
    beats: ["Penelope does not run to you. Move the bed, she says, and you say nobody can."],
    ending: {
      id: "home-to-penelope",
      prose:
        "{name} is home, twelve ships out of Troy and the long way round. Penelope, who waited, knows you by the bed you built round the olive tree.",
    },
  },
  "ending-slain": {
    phase: "home",
    beats: ["A hundred and eight against four, and one of the four had no heart left."],
    ending: {
      id: "slain-in-your-own-hall",
      prose:
        "{name} dies in the hall at Ithaca within sight of Penelope's door. The suitors carve the meat and argue about the widow.",
    },
  },

  /* ---- Ambient sub-stories (no phase: they play inside the current one) -- */

  consult: {
    beats: ["You pour wine on the deck and ask grey-eyed Athena for a sign."],
    roll: {
      branches: [
        {
          weight: 3,
          goto: "consult-done",
          beat: "A sea-eagle crosses the bow with a dove in its claws. Probably a yes.",
          sprite: { id: "eagle" },
          effects: { favor: 1, morale: 1 },
        },
        {
          weight: 2,
          goto: "consult-done",
          beat: "The sky stays empty. The men notice, and say nothing, which is worse.",
          effects: { morale: -1 },
        },
        {
          weight: 1,
          goto: "consult-owl",
          beat: "An owl lands on the yard at noon and looks at you. Not subtle.",
          sprite: { id: "owl" },
          effects: { favor: 2, morale: 1 },
        },
      ],
    },
  },
  "consult-owl": {
    beats: [
      "You know it is her because she says nothing. Then a voice says, hands off the cattle.",
    ],
    return: true,
  },
  "consult-done": {
    beats: [],
    return: true,
  },
  ration: {
    gate: { resource: "morale", min: 1, elseGoto: "ration-mutiny" },
    beats: ["You halve the wine in front of everyone. The men grumble, and the jars last."],
    effects: { supplies: 8, morale: -1 },
    return: true,
  },
  "ration-mutiny": {
    beats: ["You halve the wine, and it is the last straw. Eurylochus draws a knife."],
    roll: {
      branches: [
        {
          weight: 1,
          goto: "ending-ration-mutiny",
          beat: "Nobody moves to stop him. That is the whole of the verdict.",
        },
        {
          weight: 1,
          goto: "ration-done",
          beat: "Perimedes knocks the knife away. Everyone pretends it was a joke, and the jars last.",
          effects: { supplies: 8, morale: 1 },
        },
      ],
    },
  },
  "ending-ration-mutiny": {
    beats: ["They put you over the side with a skin of the wine you saved."],
    ending: {
      id: "mutiny-over-the-rations",
      prose:
        "{name} is put over the side by the crew for halving the wine once too often. The ship goes on without a captain and does no better for it.",
    },
  },
  "ration-done": {
    beats: [],
    return: true,
  },
  rally: {
    beats: ["You break out the good wine and tell the horse story again. The benches roar."],
    roll: {
      branches: [
        {
          weight: 3,
          goto: "rally-done",
          beat: "Even Eurylochus laughs, once, and hates himself for it.",
          effects: { morale: 2, supplies: -3 },
        },
        {
          weight: 1,
          goto: "rally-done",
          beat: "They have heard the horse story. They drink the wine anyway.",
          effects: { morale: 1, supplies: -3, kleos: -1 },
        },
      ],
    },
  },
  "rally-done": {
    beats: [],
    return: true,
  },
  pray: {
    beats: ["Alone, you pray to grey-eyed Athena, and mean it more than usual."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "pray-done",
          beat: "She hears. The wind shifts a point, and somehow you know.",
          effects: { favor: 1, morale: 1 },
        },
        {
          weight: 1,
          goto: "pray-done",
          beat: "Athena is busy with Telemachus in Sparta. You feel, distinctly, put on hold.",
        },
      ],
    },
  },
  "pray-done": {
    beats: [],
    return: true,
  },
  "look-east": {
    beats: ["You look east, as you do every day, and feel better for it."],
    effects: { morale: 1 },
    return: true,
  },
  "take-stock": {
    beats: ["You count what you have, your wits and a name Poseidon knows. It is not nothing."],
    effects: { morale: 1, kleos: 1 },
    return: true,
  },
  "count-suitors": {
    beats: ["A hundred and eight, and twelve of them would be trouble sober."],
    effects: { morale: 1 },
    return: true,
  },
  "test-household": {
    beats: ["You go among the servants as a beggar, the surest test of a house."],
    roll: {
      branches: [
        {
          weight: 2,
          goto: "test-done",
          beat: "Old Eurycleia, washing your feet, finds the boar's scar. She swears to keep quiet.",
          effects: { morale: 2 },
        },
        {
          weight: 1,
          goto: "test-done",
          beat: "Melanthius the goatherd kicks the beggar in passing, for practice. You remember his face.",
          effects: { morale: -1, kleos: 1 },
        },
      ],
    },
  },
  "test-done": {
    beats: [],
    return: true,
  },
};

/* ========================================================================== */
/*  The story                                                                  */
/* ========================================================================== */

const story: StoryInput = {
  id: "odyssey",
  title: "The Odyssey",
  blurb:
    "The war at Troy is won. The king of Ithaca wants to go home, and the gods have other plans.",
  accent: "#1f6fa8",
  defaultName: "Odysseus",
  phases: [
    { id: "depart", label: "Leaving Troy" },
    { id: "cyclops", label: "The Cyclops" },
    { id: "sea", label: "The Open Sea" },
    { id: "island", label: "Circe's Island" },
    { id: "underworld", label: "The Underworld" },
    { id: "strait", label: "Sirens and the Strait" },
    { id: "sun", label: "The Cattle of the Sun" },
    { id: "calypso", label: "Calypso" },
    { id: "home", label: "Home to Ithaca" },
  ],
  resources: { ships: 12, crew: 600, supplies: 60, favor: 3, morale: 7, kleos: 3 },
  start: "prologue",
  defaultScene: "boat",
  actions: SHIP_ACTIONS,
  scenes,
  sprites,
  nodes,
};

export const odysseyStory = registerStory(story);
