/**
 * Three scripted routes through the REAL datacenter story, each a (seed,
 * answers) pair found by walking the pure interpreter under a policy and
 * keeping the first seed that landed the wanted ending:
 *
 *   - FRONTIER:     seed 1, the option with the most GPUs at every fork (and
 *                   a town-hall press while parked at the first fork), to
 *                   the triumphant frontier-lab ending
 *   - RECEIVERSHIP: seed 2, the priciest option at every fork, to the
 *                   catastrophic receivership ending (the budget gate)
 *   - BLACKLISTED:  seed 3, the least goodwill at every fork, to the
 *                   blacklisted-by-the-trades ending (the standoff gate)
 *
 * The answers are keyed by fork node id exactly as the wire asks for them;
 * the projection (test/support/story-sim.ts) replays the same script purely,
 * so the wire suite can assert the whole adventure log beat for beat.
 */

import type { Script } from "./story-sim";

export interface DatacenterRoute {
  seed: number;
  ending: string;
  script: Script;
}

export const FRONTIER: DatacenterRoute = {
  seed: 1,
  ending: "frontier-lab",
  script: {
    answers: {
      "land-brief": { choice: "floodplain" },
      "flood-plan": { choice: "raise-the-pad" },
      "zoning-hearing": { choice: "community-benefits" },
      "permit-conditions": { choice: "public-park" },
      "almond-intro": { choice: "buy-his-water" },
      "picket-news-van": { choice: "walk-out-and-talk" },
      "picket-camp": { choice: "negotiate-in-the-diner" },
      "power-source-choice": { choice: "join-the-queue" },
      "grid-line-route": { choice: "over-the-moor" },
      "water-plan": { choice: "take-the-full-allocation" },
      "cooling-choice": { choice: "air-cooling" },
      "heat-reuse-choice": { choice: "heat-the-pool" },
      "drought-year": { choice: "cut-the-draw" },
      "gpu-allocation-call": { choice: "wait-in-the-queue" },
      "gpu-queue-slip": { choice: "buy-a-spot-allocation" },
      "gpu-export-desk": { choice: "file-the-end-user-certificate" },
      "labor-headcount": { choice: "sign-with-the-union-hall" },
      "labor-union-terms": { choice: "sign-the-pla" },
      "labor-plumbers": { choice: "fly-in-a-crew" },
      "labor-poaching": { choice: "match-the-bonus" },
      "labor-electrician": { choice: "wait-for-the-moon" },
      "quake-forewarned": { choice: "shore-the-steel" },
      "quake-strike-shored": { choice: "kill-the-substation" },
      "hurricane-shelter-ask": { choice: "open-the-hall" },
      "hurricane-prep": { choice: "batten-everything" },
      "wildlife-newts": { choice: "wait-for-march" },
      "wildlife-mitigation": { choice: "bat-tunnel" },
      "bat-tunnel-press": { choice: "own-it" },
      "rack-cabling": { choice: "run-double-shifts" },
      "commission-ist": { choice: "pull-the-plug-now" },
      "ransomware-strike": { choice: "pull-the-plug" },
      "training-kickoff": { choice: "all-in-on-the-run" },
      "investor-day": { choice: "stay-independent" },
    },
    presses: [{ at: "land-brief", choice: "hold-a-town-hall" }],
  },
};

export const RECEIVERSHIP: DatacenterRoute = {
  seed: 2,
  ending: "receivership",
  script: {
    answers: {
      "land-brief": { choice: "floodplain" },
      "flood-plan": { choice: "raise-the-pad" },
      "zoning-hearing": { choice: "hire-the-fixer" },
      "permit-conditions": { choice: "public-park" },
      "almond-intro": { choice: "buy-his-water" },
      "dig-potsherd": { choice: "fund-the-dig" },
      "picket-news-van": { choice: "send-pr-and-coffee" },
      "picket-camp": { choice: "negotiate-in-the-diner" },
      "power-source-choice": { choice: "order-a-reactor" },
      "smr-order": { choice: "rent-a-diesel-farm" },
      "water-plan": { choice: "build-a-reservoir" },
      "cooling-choice": { choice: "immersion-in-oil" },
      "heat-reuse-choice": { choice: "heat-the-estate" },
      "drought-year": { choice: "truck-in-water" },
      "gpu-allocation-call": { choice: "fly-to-the-vendor" },
      "gpu-queue-slip": { choice: "buy-a-spot-allocation" },
      "gpu-export-desk": { choice: "reroute-through-a-friendly-port" },
      "labor-headcount": { choice: "sign-with-the-union-hall" },
      "labor-union-terms": { choice: "sign-the-pla" },
      "labor-plumbers": { choice: "fly-in-a-crew" },
      "labor-poaching": { choice: "match-the-bonus" },
      "labor-electrician": { choice: "hire-both" },
      "quake-strike": { choice: "clear-the-steel" },
      "hurricane-shelter-ask": { choice: "open-the-hall" },
      "hurricane-prep": { choice: "batten-everything" },
      "wildlife-newts": { choice: "wait-for-march" },
      "wildlife-mitigation": { choice: "all-of-it" },
      "rack-cabling": { choice: "run-double-shifts" },
      "commission-ist": { choice: "pull-the-plug-now" },
      "ransomware-strike": { choice: "pay-the-ransom" },
    },
  },
};

export const BLACKLISTED: DatacenterRoute = {
  seed: 3,
  ending: "blacklisted-by-the-trades",
  script: {
    answers: {
      "land-brief": { choice: "floodplain" },
      "flood-plan": { choice: "raise-the-pad" },
      "zoning-hearing": { choice: "send-the-lawyers" },
      "permit-conditions": { choice: "name-the-road" },
      "almond-intro": { choice: "contest-the-right" },
      "dig-remains": { choice: "relocate-the-pad" },
      "picket-news-van": { choice: "lock-the-gate" },
      "picket-camp": { choice: "wait-them-out" },
      "power-source-choice": { choice: "go-off-grid" },
      "offgrid-yard": { choice: "trucked-lng" },
      "water-source-choice": { choice: "borrow-from-the-locals" },
      "aquifer-noticed": { choice: "deny-everything" },
      "cooling-choice": { choice: "air-cooling" },
      "heat-reuse-choice": { choice: "vent-it" },
      "drought-year": { choice: "keep-pumping" },
      "gpu-allocation-call": { choice: "wait-in-the-queue" },
      "gpu-export-desk": { choice: "file-the-end-user-certificate" },
      "labor-headcount": { choice: "poach-from-across-the-valley" },
      "labor-plumbers": { choice: "fly-in-a-crew" },
      "labor-poaching": { choice: "match-the-bonus" },
      "labor-electrician": { choice: "wait-for-the-moon" },
      "labor-union-standoff": { choice: "bring-in-replacements" },
    },
  },
};

/** The shortest road out: sell the land options to the rival bidder at the second fork. */
export const SOLD_OUT: DatacenterRoute = {
  seed: 11,
  ending: "sold-to-the-rival",
  script: {
    answers: {
      "land-brief": { choice: "play-the-field" },
      "rival-intro": { choice: "sell-to-them" },
    },
  },
};

export const DATACENTER_ROUTES = [FRONTIER, RECEIVERSHIP, BLACKLISTED] as const;
