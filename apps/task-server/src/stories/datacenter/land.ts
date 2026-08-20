/**
 * Nortada One — the SITE, PERMITS and COMMUNITY arc, as plain story data in
 * the story contract v3 format (src/story/format). It is not a story on its
 * own: the story module splices these nodes into the datacenter story's
 * node table, points the arc's exit at the next construction beat, and
 * spreads the arc's sprites (./land-art) into the story's sprite table.
 *
 * The setting is Sines, on the Alentejo coast: the dead coal plant and its
 * seawater channels, the disused aerodrome inside the industrial zone, the
 * heath with its winter ponds, the bluff with its beach villas, and the cork
 * estate inland that holds the old freshwater dam.
 *
 * Shape of the arc (entry {@link LAND_PERMITS_ENTRY}, exit
 * {@link LAND_PERMITS_EXIT}, phases "site" | "permits" | "crisis"):
 *
 *   land-scouts -> land-brief ─┬─ floodplain  (the heath: cheap, wet every
 *                              │               winter, the ponds are protected)
 *                              ├─ plateau     (the bluff: pricey, bedrock, a
 *                              │               residents' association)
 *                              ├─ brownfield  (the aerodrome: the channels and
 *                              │               a smell; may bounce to
 *                              │               land-second-look)
 *                              └─ rival       (a cube-logo bidder; outbid,
 *                                              poach, concede, or sell out)
 *   -> zoning-hearing (benefits / fixer / lawyers / rename)
 *   -> permit-conditions (park / visitor centre / road / truck)
 *   -> almond-intro (the cork estate's dam, Senhor Abrantes, litigious)
 *   -> ground-test (test pits: dirt, a potsherd, or remains)
 *   -> picket-line -> picket-news-van (TIMED crisis, fate branch)
 *   -> picket-camp (café accord / folk band / viewing platform / winter)
 *   -> permits-complete -> {exitTo}
 *
 * Resource arithmetic (the datacenter story declares budget, water, power,
 * goodwill, gpus, progress; this arc touches budget, water, goodwill,
 * progress):
 *   - land: the heath -8 budget / +15 water (wet enough to reach the water
 *     gate); the bluff -40 budget / +5 progress (bedrock); the aerodrome -15
 *     budget / +10 water / -2 goodwill, with a grant branch that pays back 15
 *   - the rival costs a premium (-12 or -25) or a poaching fee (-10), or ends
 *     the story early (sold-to-the-rival)
 *   - zoning: -6..-25 budget, goodwill -4..+3; the lawyers can lose twice
 *     and end the story (zoned-out)
 *   - conditions of approval: -1..-12 budget, goodwill +1..+4
 *   - the cork estate is the water lever: buy (+20 water, -20 budget), court
 *     (+10 / +5 / -10 water), lunch (+10 water on a handshake), or go dry
 *   - the dig costs 0..-25 budget and up to -13 progress; a quiet backfill
 *     can lose the whole site (sealed-by-the-state)
 *   - the picket line is goodwill: -5..+7 depending on the camera and the
 *     camp; the news van is a 20 second timed crisis with a fate branch
 *   Typical main-line totals: budget -30..-80, goodwill -8..+15, water
 *   -25..+35, progress -20..+7.
 *
 * Every node id is kebab-case and prefixed by its beat (land-, flood-,
 * plateau-, brownfield-, rival-, zoning-, permit-, almond-, dig-, picket-,
 * ending-) so it cannot collide with the power / water / build arcs. The
 * prefixes predate the move to Sines (flood- is the heath, plateau- the
 * bluff, brownfield- the aerodrome, almond- the cork estate) and stay, so
 * the wire keys, the scripted routes, and the seeded rolls stay put.
 */

import type { NodeTable } from "./shared";

/** The arc's first node; the story's intro hands off here. */
export const LAND_PERMITS_ENTRY = "land-scouts";

/** The arc's last node; its `next` is the `exitTo` passed to {@link landPermitsNodes}. */
export const LAND_PERMITS_EXIT = "permits-complete";

/** Ending ids this arc can complete the task with. */
export const LAND_PERMITS_ENDING_IDS = [
  "sold-to-the-rival",
  "zoned-out",
  "sealed-by-the-state",
] as const;

/**
 * The arc's main-line nodes. `exitTo` is the node the arc hands off to
 * (the groundbreaking beat).
 */
export function landPermitsNodes(exitTo: string): NodeTable {
  return {
    // ---- Site: the shortlist ---------------------------------------------
    "land-scouts": {
      phase: "site",
      scene: "desert",
      beats: ["Scouts fan out along the coast with a drone and a soil auger."],
      next: "land-brief",
    },
    "land-brief": {
      phase: "site",
      beats: ["The broker spreads three maps on the café table. A cube-logo rival is circling."],
      decision: {
        scene:
          "The heath is cheap, flat, and wet every winter. The bluff is bedrock with a view and a residents' association. The aerodrome is a dead runway in the industrial zone, with water rights and a smell. Where does {name} put its chips?",
        options: [
          { id: "floodplain", label: "The heath", goto: "flood-survey" },
          { id: "plateau", label: "The bluff", goto: "plateau-survey" },
          { id: "brownfield", label: "The aerodrome", goto: "brownfield-survey" },
          { id: "play-the-field", label: "Bid on nothing yet", goto: "rival-intro" },
        ],
      },
    },

    // ---- Site: the heath and its winter ponds ------------------------------
    "flood-survey": {
      phase: "site",
      scene: "river",
      effects: { budget: -8, water: 15 },
      beats: ["The surveyor drives her stakes into heath so soft the drone could have done it."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "flood-plan",
            beat: "The winter rains come, look at the stakes, and go politely around them.",
          },
          {
            weight: 1,
            goto: "flood-plan",
            beat: "The rains fill a hundred protected ponds in week three. One eats the surveyor's truck.",
            sprite: { id: "storm" },
            effects: { budget: -5, progress: -3 },
          },
        ],
      },
    },
    "flood-plan": {
      phase: "site",
      beats: ["The engineer has three plans and the same face for each."],
      decision: {
        scene:
          "Raise the whole pad on imported fill, buy flood insurance, or trust the ditches the old farmers dug. The ponds will be back every winter. How does {name} plan for it?",
        options: [
          {
            id: "raise-the-pad",
            label: "Raise the pad",
            goto: "zoning-hearing",
            effects: { budget: -14, progress: 2 },
          },
          {
            id: "buy-insurance",
            label: "Buy flood insurance",
            goto: "zoning-hearing",
            effects: { budget: -6 },
          },
          { id: "trust-the-levee", label: "Trust the ditches", goto: "flood-gamble" },
        ],
      },
    },
    "flood-gamble": {
      phase: "site",
      beats: ["The drainage engineer walks the ditch and says 'probably' eleven times."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "zoning-hearing",
            beat: "The ditches hold through a wet spring. 'Probably' becomes 'likely'.",
          },
          {
            weight: 1,
            goto: "zoning-hearing",
            beat: "Rabbits have hollowed the ditch bank like a baguette. The bill lands on you.",
            effects: { budget: -20, goodwill: 1 },
          },
        ],
      },
    },

    // ---- Site: the bluff -----------------------------------------------------
    "plateau-survey": {
      phase: "site",
      scene: "desert",
      effects: { budget: -40, goodwill: 1, progress: 5 },
      beats: [
        "The bluff is bedrock. From the stakes you can see the chimneys and the beach villas.",
      ],
      next: "plateau-hoa",
    },
    "plateau-hoa": {
      phase: "site",
      beats: [
        "The beach villas' residents' association requests a meeting. 'Requests' is doing a lot of work.",
      ],
      decision: {
        scene:
          "The residents object to the skyline, the night lights, and in principle. What does {name} offer the neighbours?",
        options: [
          {
            id: "berm-and-junipers",
            label: "Plant a pine belt",
            goto: "zoning-hearing",
            effects: { budget: -10, goodwill: 3 },
          },
          {
            id: "paint-it-beige",
            label: "Paint it white",
            goto: "zoning-hearing",
            effects: { goodwill: 1 },
          },
          {
            id: "no-jurisdiction",
            label: "Tell them no",
            goto: "plateau-hoa-lawsuit",
            effects: { goodwill: -3 },
          },
        ],
      },
    },
    "plateau-hoa-lawsuit": {
      phase: "site",
      beats: ["The residents sue. Their lawyer is somebody's nephew, new to the bar and thrilled."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "zoning-hearing",
            beat: "The judge throws it out in eleven minutes and praises the nephew's binder.",
          },
          {
            weight: 1,
            goto: "zoning-hearing",
            beat: "The nephew finds a paperwork gap and wins a stop order. Four weeks of nothing.",
            effects: { budget: -8, progress: -3 },
          },
        ],
      },
    },

    // ---- Site: the aerodrome -------------------------------------------------
    "brownfield-survey": {
      phase: "site",
      scene: "desert",
      effects: { budget: -15, water: 10, goodwill: -2 },
      beats: [
        "The aerodrome closed years ago. The coal plant's seawater channels still run along its fence.",
      ],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "brownfield-clean",
            beat: "The soil cores shrug. Nothing a liner and a lawyer can't handle.",
          },
          {
            weight: 1,
            goto: "brownfield-plume",
            beat: "The cores come back with a map, and an arrow pointing at the town well.",
            effects: { goodwill: -2 },
          },
        ],
      },
    },
    "brownfield-clean": {
      phase: "site",
      beats: [
        "The state offers a just-transition grant with strings. The zone offers a discount, as-is.",
      ],
      decision: {
        scene: "Money is on the table from two directions. Which hand does {name} shake?",
        options: [
          {
            id: "take-the-grant",
            label: "Take the grant",
            goto: "zoning-hearing",
            effects: { budget: 15, goodwill: 2, progress: -4 },
          },
          {
            id: "as-is",
            label: "Take it as-is",
            goto: "zoning-hearing",
            effects: { budget: 5, goodwill: -1 },
          },
        ],
      },
    },
    "brownfield-plume": {
      phase: "site",
      beats: [
        "Old aviation fuel is creeping towards the town's only well, with a twenty-year head start.",
      ],
      decision: {
        scene:
          "Pump and treat for a decade, cap it and hope, or walk away and lose the option money. The plume is {name}'s problem now, so what does {name} do?",
        options: [
          {
            id: "pump-and-treat",
            label: "Pump and treat",
            goto: "zoning-hearing",
            effects: { budget: -25, goodwill: 4, water: 5 },
          },
          {
            id: "cap-it",
            label: "Cap it",
            goto: "brownfield-cap",
            effects: { budget: -5, goodwill: -3 },
          },
          {
            id: "walk-away",
            label: "Walk away",
            goto: "land-second-look",
            effects: { budget: -5 },
          },
        ],
      },
    },
    "brownfield-cap": {
      phase: "site",
      beats: ["The cap goes on. Nobody reads the quarterly numbers too hard."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "zoning-hearing",
            beat: "The plume stays put, for now. That is the most the lawyers will promise.",
          },
          {
            weight: 1,
            goto: "zoning-hearing",
            beat: "The town well starts tasting of the seventies. {name} pays for bottled water.",
            effects: { goodwill: -4, budget: -15, water: -5 },
          },
        ],
      },
    },
    "land-second-look": {
      phase: "site",
      scene: "desert",
      beats: [
        "Back to the café table, minus one parcel. The broker re-lists the aerodrome as 'historic'.",
      ],
      decision: {
        scene: "Two parcels left. Where does {name} break ground instead?",
        options: [
          { id: "floodplain-after-all", label: "The heath", goto: "flood-survey" },
          { id: "plateau-after-all", label: "The bluff", goto: "plateau-survey" },
        ],
      },
    },

    // ---- Site: the rival bidder -------------------------------------------
    "rival-intro": {
      phase: "site",
      beats: [
        "The cube people are Hexamesh Hyperscale, motto 'Density Is Destiny'. They bid on everything.",
      ],
      decision: {
        scene:
          "A rival wants your shortlist. Does {name} outbid them, let them win, hire their site lead, or sell your options and walk?",
        options: [
          { id: "outbid-them", label: "Outbid them", goto: "rival-bidding-war" },
          { id: "let-them-win", label: "Let them win", goto: "rival-neighbours" },
          {
            id: "poach-their-site-lead",
            label: "Hire their site lead",
            goto: "rival-poach",
            effects: { budget: -10 },
          },
          { id: "sell-to-them", label: "Sell to them", goto: "ending-sold-to-rival" },
        ],
      },
    },
    "rival-bidding-war": {
      phase: "site",
      beats: ["The auction runs by phone all afternoon. The broker has never been happier."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "plateau-survey",
            beat: "Hexamesh folds at round three. You overpaid a little and gained a grudge.",
            effects: { budget: -12 },
          },
          {
            weight: 1,
            goto: "plateau-survey",
            beat: "Hexamesh does not fold. The price grows a second zero before they do.",
            effects: { budget: -25 },
          },
        ],
      },
    },
    "rival-neighbours": {
      phase: "site",
      effects: { progress: -2 },
      beats: ["Hexamesh breaks ground first, and gets ahead of you in the substation queue."],
      next: "flood-survey",
    },
    "rival-poach": {
      phase: "site",
      beats: ["She signs on a Tuesday and redraws your shortlist in three colours of pen."],
      decision: {
        scene:
          "Her verdict: the aerodrome is cleaner than it smells, and the bluff's residents' chair is her uncle. The heath is fine if you like frogs. Where does {name} break ground?",
        options: [
          {
            id: "her-brownfield",
            label: "The aerodrome",
            goto: "brownfield-survey",
            effects: { goodwill: 1 },
          },
          {
            id: "her-plateau",
            label: "The bluff",
            goto: "plateau-survey",
            effects: { goodwill: 2 },
          },
          { id: "her-floodplain", label: "The heath", goto: "flood-survey" },
        ],
      },
    },
    "ending-sold-to-rival": {
      phase: "site",
      scene: "desert",
      beats: ["The cube people pay well and name the place something with an X in it."],
      ending: {
        id: "sold-to-the-rival",
        prose:
          "{name} is never built. Hexamesh builds it instead, badly. The board keeps the profit and the regret.",
      },
    },

    // ---- Permits: the zoning fight ----------------------------------------
    "zoning-hearing": {
      phase: "permits",
      beats: [
        "The parcel is zoned for something else. Item six on the agenda is {name}'s rezoning.",
      ],
      decision: {
        scene:
          "Offer the town benefits, hire the old town planner to work the room, or send the lawyers. Or re-file as 'Cork Oak Cloud Gardens'. How does {name} walk into the hearing?",
        options: [
          {
            id: "community-benefits",
            label: "Offer community benefits",
            goto: "permit-conditions",
            effects: { budget: -6, goodwill: 3 },
          },
          {
            id: "hire-the-fixer",
            label: "Hire the fixer",
            goto: "zoning-fixer",
            effects: { budget: -10 },
          },
          {
            id: "send-the-lawyers",
            label: "Send the lawyers",
            goto: "zoning-court",
            effects: { goodwill: -3 },
          },
          {
            id: "rename-the-project",
            label: "Rename the project",
            goto: "zoning-rename",
            effects: { goodwill: 1, progress: -2 },
          },
        ],
      },
    },
    "zoning-fixer": {
      phase: "permits",
      beats: ["Your consultant knows every councillor's dog by name. The dogs seem to know him."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "permit-conditions",
            beat: "The rezoning passes four to one. The one is new and still reads the packets.",
          },
          {
            weight: 1,
            goto: "permit-conditions",
            beat: "Prosecutors tape his lunches and question the mayor. A judge frees everyone, and the rezoning passes late.",
            effects: { goodwill: -4, progress: -3 },
          },
        ],
      },
    },
    "zoning-court": {
      phase: "permits",
      sprite: { id: "gavel" },
      beats: [
        "Your lawyers file before breakfast. The council files back and cites a fish cannery.",
      ],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "permit-conditions",
            beat: "The judge reads 'processing' your way. The council rezones, and is not gracious about it.",
            effects: { goodwill: -1 },
          },
          {
            weight: 1,
            goto: "zoning-appeal",
            beat: "The judge reads 'processing' the council's way. The fish cannery wins.",
          },
        ],
      },
    },
    "zoning-appeal": {
      phase: "permits",
      effects: { budget: -15, progress: -4 },
      beats: ["The appeal costs a season and a second lawyer who mostly does divorces."],
      roll: {
        branches: [
          {
            weight: 3,
            goto: "permit-conditions",
            beat: "The appeals court splits the difference. Rezoning granted, conditions to follow, everyone unhappy.",
          },
          {
            weight: 1,
            goto: "ending-zoned-out",
            beat: "The appeal fails. The councillors stop returning calls, and then stop having a phone.",
          },
        ],
      },
    },
    "ending-zoned-out": {
      phase: "permits",
      scene: "desert",
      beats: ["The options lapse one by one. The broker re-lists the parcel as 'a blank canvas'."],
      ending: {
        id: "zoned-out",
        prose: "{name} dies in committee. It was only ever a drawing, a lawsuit, and an item six.",
      },
    },
    "zoning-rename": {
      phase: "permits",
      beats: ["'Cork Oak Cloud Gardens' has no cork oaks and no garden. The rendering has a deer."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "permit-conditions",
            beat: "Nobody notices it is the same drawings. The deer gets a round of applause.",
          },
          {
            weight: 1,
            goto: "permit-conditions",
            beat: "The chair notices. She has a sense of humour, and that is why it passes.",
            effects: { goodwill: -1 },
          },
        ],
      },
    },

    // ---- Permits: the condition of approval -------------------------------
    "permit-conditions": {
      phase: "permits",
      beats: [
        "Rezoning is stamp one of eighteen. The councillors add one condition and let you pick.",
      ],
      decision: {
        scene:
          "A park with a splash pad, a visitor centre, a road named after the chair, or a second fire truck. What does {name} build for the town?",
        options: [
          {
            id: "public-park",
            label: "A public park",
            goto: "permit-park",
            effects: { budget: -12, goodwill: 4, water: -5 },
          },
          {
            id: "visitor-centre",
            label: "A visitor centre",
            goto: "permit-visitor-centre",
            effects: { budget: -8, goodwill: 2 },
          },
          {
            id: "name-the-road",
            label: "Name the road",
            goto: "permit-road-name",
            effects: { budget: -1 },
          },
          {
            id: "fire-truck",
            label: "A fire truck",
            goto: "permit-fire-truck",
            effects: { budget: -10, goodwill: 3 },
          },
        ],
      },
    },
    "permit-park": {
      phase: "permits",
      beats: ["The park is mostly pines, which in the nortada is mostly genius."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "almond-intro",
            beat: "The splash pad opens first. {name} is the town's favourite thing for a summer.",
          },
          {
            weight: 1,
            goto: "almond-intro",
            beat: "The water board notices the splash pad uses water. The pad goes on a timer.",
            effects: { water: -5, goodwill: 1 },
          },
        ],
      },
    },
    "permit-visitor-centre": {
      phase: "permits",
      beats: [
        "The architect wants a smaller visitor centre inside the visitor centre. He is stopped.",
      ],
      next: "almond-intro",
    },
    "permit-road-name": {
      phase: "permits",
      beats: ["Surveyors stake out 'Rua Vereadora Delgado'. She approves the font personally."],
      roll: {
        branches: [
          {
            weight: 1,
            goto: "almond-intro",
            beat: "The chair is delighted and says so at every meeting for a year.",
            effects: { goodwill: 2 },
          },
          {
            weight: 1,
            goto: "almond-intro",
            beat: "Her rival on the council objects on principle. The road becomes 'Rua do Compromisso'.",
          },
        ],
      },
    },
    "permit-fire-truck": {
      phase: "permits",
      beats: [
        "The ladder reaches your roof. The chief names the truck after your mortified project manager.",
      ],
      next: "almond-intro",
    },

    // ---- Permits: the cork estate and its dam ------------------------------
    "almond-intro": {
      phase: "permits",
      sprite: { id: "almond" },
      beats: [
        "Inland, two thousand hectares of cork oak. The estate has sued the wind farm, the council, and the state.",
        "The estate's dam holds more water than {name} needs. Senhor Abrantes owns every drop.",
      ],
      decision: {
        scene:
          "Buy some of his water, fight him in water court, or take him to lunch. Or design dry, cool on the sea, and never speak to him. What does {name} do about the cork man?",
        options: [
          {
            id: "buy-his-water",
            label: "Buy his water",
            goto: "almond-deal",
            effects: { budget: -20, water: 20, goodwill: 1 },
          },
          { id: "contest-the-right", label: "Contest the right", goto: "almond-court" },
          {
            id: "lunch-with-hask",
            label: "Lunch with Abrantes",
            goto: "almond-lunch",
            effects: { budget: -2 },
          },
          {
            id: "design-dry",
            label: "Design dry",
            goto: "almond-dry",
            effects: { water: -10, budget: -8, goodwill: 2 },
          },
        ],
      },
    },
    "almond-deal": {
      phase: "permits",
      beats: [
        "Abrantes signs, then sues the council for allowing it. His lawyer calls it a reflex.",
      ],
      next: "ground-test",
    },
    "almond-court": {
      phase: "permits",
      sprite: { id: "gavel" },
      effects: { budget: -10, goodwill: -2 },
      beats: ["Abrantes brings three lawyers and a deed older than two of them."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "ground-test",
            beat: "The judge trims the estate's right for a decade of over-drawing. {name} gets the trimmings.",
            effects: { water: 10 },
          },
          {
            weight: 2,
            goto: "ground-test",
            beat: "You settle in the hallway. Abrantes gets a noise wall and the last word.",
            effects: { budget: -8, water: 5 },
          },
          {
            weight: 1,
            goto: "ground-test",
            beat: "The deed wins. The cooling design goes back to the drawing board with less water.",
            effects: { goodwill: -3, water: -10, progress: -5 },
          },
        ],
      },
    },
    "almond-lunch": {
      phase: "permits",
      beats: [
        "Abrantes orders the black pork before the menu arrives and listens for forty minutes.",
      ],
      roll: {
        branches: [
          {
            weight: 1,
            goto: "ground-test",
            beat: "He shakes your hand in the car park. A water lease arrives by courier, unsigned.",
            effects: { water: 10, goodwill: 2 },
          },
          {
            weight: 1,
            goto: "almond-court",
            beat: "He eats the pork, thanks you for the pork, and sues you on Monday.",
          },
        ],
      },
    },
    "almond-dry": {
      phase: "permits",
      beats: ["The cooling engineers take it like professionals. They ask for a bigger budget."],
      next: "ground-test",
    },

    // ---- Permits: the test pits under the substation ----------------------
    "ground-test": {
      phase: "permits",
      beats: ["Test pits first. A backhoe older than its driver digs under the substation pad."],
      roll: {
        branches: [
          {
            weight: 3,
            goto: "picket-line",
            beat: "Glorious, boring dirt all the way down. The report is two pages, one a signature.",
          },
          {
            weight: 2,
            goto: "dig-potsherd",
            beat: "The backhoe stops. The driver climbs down holding something that is definitely not dirt.",
            sprite: { id: "potsherd" },
          },
          {
            weight: 1,
            goto: "dig-remains",
            beat: "The backhoe turns up a jawbone. The driver's cousin works for the heritage office.",
          },
        ],
      },
    },
    "dig-potsherd": {
      phase: "permits",
      beats: [
        "The heritage office sends an archaeologist with a trowel and a form. Six weeks, minimum.",
      ],
      decision: {
        scene:
          "Fund a proper dig, move the substation east, or quietly bury the Roman site. What does {name} do about the past under the substation pad?",
        options: [
          {
            id: "fund-the-dig",
            label: "Fund the dig",
            goto: "dig-funded",
            effects: { budget: -12, goodwill: 3, progress: -5 },
          },
          {
            id: "move-the-substation",
            label: "Move the substation",
            goto: "dig-moved",
            effects: { budget: -10, progress: -3 },
          },
          { id: "backfill-quietly", label: "Backfill quietly", goto: "dig-backfill" },
        ],
      },
    },
    "dig-funded": {
      phase: "permits",
      beats: [
        "Students in wide hats sieve the pad by hand. The electrician bills from a lawn chair.",
      ],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "picket-line",
            beat: "They find a Roman fish-salting tank. Everyone agrees this is ironic.",
            effects: { goodwill: 1 },
          },
          {
            weight: 1,
            goto: "picket-line",
            beat: "The site is bigger than anyone guessed. Six weeks becomes twelve.",
            effects: { budget: -8, progress: -5 },
          },
        ],
      },
    },
    "dig-moved": {
      phase: "permits",
      beats: ["The substation moves east, drawing by drawing. Each move costs a fee."],
      next: "picket-line",
    },
    "dig-backfill": {
      phase: "permits",
      beats: ["The pit is filled by dusk. The driver is asked whether his phone has a camera."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "picket-line",
            beat: "Nobody asks, nobody tells. The pad pours on schedule over whatever it was.",
            effects: { progress: 2 },
          },
          {
            weight: 1,
            goto: "dig-stop-work",
            beat: "The driver's nephew posts the photo. By Friday the heritage office has a court order.",
            effects: { goodwill: -5 },
          },
        ],
      },
    },
    "dig-stop-work": {
      phase: "permits",
      beats: ["A stop-work order is taped to the gate with tape that outlasts lawyers."],
      decision: {
        scene:
          "The state wants a full dig at {name}'s expense and a public apology. How does {name} answer?",
        options: [
          {
            id: "settle-and-fund",
            label: "Settle and fund",
            goto: "picket-line",
            effects: { budget: -25, goodwill: -1, progress: -8 },
          },
          {
            id: "fight-the-order",
            label: "Fight the order",
            goto: "dig-fight",
            effects: { budget: -10 },
          },
        ],
      },
    },
    "dig-fight": {
      phase: "permits",
      sprite: { id: "gavel" },
      beats: ["The hearing is short. The judge has already read the nephew's post."],
      roll: {
        branches: [
          {
            weight: 1,
            goto: "picket-line",
            beat: "The order lifts with a fine the board calls 'a rounding error'.",
            effects: { goodwill: -3, budget: -8 },
          },
          {
            weight: 1,
            goto: "ending-sealed",
            beat: "The order stands. The state takes the parcel for a heritage park.",
          },
        ],
      },
    },
    "ending-sealed": {
      phase: "permits",
      scene: "desert",
      beats: ["The heritage park opens in two years. Its sign does not mention {name}."],
      ending: {
        id: "sealed-by-the-state",
        prose:
          "{name} ends as a footnote under a heritage site. The substation was never switched on, and the pot turned out to matter more.",
      },
    },
    "dig-remains": {
      phase: "permits",
      beats: ["Work stops. The heritage office, the priest, and the mayor meet at the pit's edge."],
      decision: {
        scene: "Human remains lie under the substation pad. What does {name} do?",
        options: [
          {
            id: "repatriate-with-ceremony",
            label: "Fund the ceremony",
            goto: "dig-ceremony",
            effects: { budget: -8, goodwill: 5, progress: -8 },
          },
          {
            id: "relocate-the-pad",
            label: "Relocate the pad",
            goto: "dig-relocated",
            effects: { budget: -18, progress: -6 },
          },
        ],
      },
    },
    "dig-ceremony": {
      phase: "permits",
      effects: { goodwill: 1 },
      beats: ["The ceremony is at dawn. The crew stands at the back with their hats off."],
      next: "picket-line",
    },
    "dig-relocated": {
      phase: "permits",
      beats: ["The substation moves a hundred metres south. The old ground is fenced off."],
      next: "picket-line",
    },

    // ---- Community: the picket line at the gate ---------------------------
    "picket-line": {
      phase: "permits",
      sprite: { id: "protest", persist: true },
      beats: [
        "Monday, six a.m.: forty people, eleven dogs, one Alentejo choir, and a banner reading NO SERVER FARMS.",
      ],
      next: "picket-news-van",
    },
    "picket-news-van": {
      phase: "crisis",
      beats: ["A news van pulls up, and the reporter is already clipping on her microphone."],
      decision: {
        scene: "She is live in moments and heading straight for you. What does {name} do?",
        options: [
          { id: "walk-out-and-talk", label: "Walk out and talk", goto: "picket-on-camera" },
          {
            id: "lock-the-gate",
            label: "Lock the gate",
            goto: "picket-lockdown",
            effects: { goodwill: -3 },
          },
          {
            id: "send-pr-and-coffee",
            label: "Send PR and coffee",
            goto: "picket-camp",
            effects: { budget: -2, goodwill: 1 },
          },
        ],
        timeoutMs: 20_000,
        fateGoto: "picket-fate",
      },
    },
    "picket-fate": {
      phase: "crisis",
      effects: { goodwill: -2 },
      beats: [
        "Nobody moves in time. The reporter interviews the choir instead, and the clip goes viral.",
      ],
      next: "picket-camp",
    },
    "picket-on-camera": {
      phase: "crisis",
      beats: ["You are on the evening news in a crooked hard hat."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "picket-camp",
            beat: "You answer every question plainly, the water one twice. The choir sings you off.",
            effects: { goodwill: 3 },
          },
          {
            weight: 1,
            goto: "picket-camp",
            beat: "You say 'synergy' on live television. It becomes a sticker.",
            effects: { goodwill: -2 },
          },
        ],
      },
    },
    "picket-lockdown": {
      phase: "crisis",
      beats: [
        "The gate locks and the crowd doubles. A drone appears that belongs to neither side.",
      ],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "picket-camp",
            beat: "By evening the crowd is bored and cold. The police suggest a meeting with chairs.",
          },
          {
            weight: 1,
            goto: "picket-camp",
            beat: "Somebody chains themselves to the gate. Deliveries reroute through the refinery gate for a week.",
            effects: { budget: -5, progress: -4, goodwill: -1 },
          },
        ],
      },
    },
    "picket-camp": {
      phase: "permits",
      beats: ["The pickets pitch tents. A hand-lettered sign says OPEN TO DIALOGUE."],
      decision: {
        scene:
          "The camp wants a meeting, a water cap, a rent cap, and a noise wall. The choir wants a dressing room. How does {name} answer?",
        options: [
          {
            id: "negotiate-in-the-diner",
            label: "Negotiate in the café",
            goto: "picket-accord",
            effects: { budget: -8, goodwill: 4, water: -5 },
          },
          {
            id: "hire-a-folk-band",
            label: "Hire a folk band",
            goto: "picket-folk-band",
            effects: { budget: -3 },
          },
          {
            id: "viewing-platform",
            label: "Build a viewing platform",
            goto: "picket-platform",
            effects: { budget: -6, goodwill: 2 },
          },
          {
            id: "wait-them-out",
            label: "Wait them out",
            goto: "picket-winter",
            effects: { goodwill: -2, progress: -3 },
          },
        ],
      },
    },
    "picket-folk-band": {
      phase: "permits",
      sprite: { id: "banjo" },
      beats: ["The band opens with a song about the sea. The crowd knows it."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "picket-accord",
            beat: "The protest becomes a festival. Two of the organisers ask about jobs.",
            effects: { goodwill: 3 },
          },
          {
            weight: 1,
            goto: "picket-accord",
            beat: "The band writes a protest song about {name} on the spot. It charts.",
            effects: { goodwill: -1 },
          },
        ],
      },
    },
    "picket-platform": {
      phase: "permits",
      beats: ["The platform goes up in a week and soon has a coffee cart."],
      next: "permits-complete",
    },
    "picket-winter": {
      phase: "permits",
      beats: ["October is mild. November comes in sideways, and the camp stove runs out of gas."],
      roll: {
        branches: [
          {
            weight: 2,
            goto: "picket-accord",
            beat: "The camp packs up in the first real storm. Two of them apply for jobs.",
            effects: { goodwill: 1 },
          },
          {
            weight: 1,
            goto: "picket-accord",
            beat: "They do not leave. They build a yurt, and the yurt has Wi-Fi.",
            effects: { goodwill: -2, progress: -3 },
          },
        ],
      },
    },
    "picket-accord": {
      phase: "permits",
      beats: ["The deal is drafted on a café napkin. The choir gets its dressing room."],
      next: "permits-complete",
    },

    // ---- Exit: permitted, conditioned, neighboured ------------------------
    "permits-complete": {
      phase: "permits",
      sprite: { id: "stamp" },
      beats: ["The last stamp comes down. {name} is permitted, conditioned, and neighboured."],
      next: exitTo,
    },
  };
}
