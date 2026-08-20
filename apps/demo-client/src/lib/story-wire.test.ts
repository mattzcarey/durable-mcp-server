import { describe, expect, it } from "vitest";
import { type DetailedTask, DetailedTaskSchema, type InputRequest } from "../mcp-tasks/schema";
import {
  choiceResponse,
  endingTone,
  findFork,
  forkWindowMs,
  normalizeBuild,
  parseBeat,
  parseEnding,
  parseFork,
  readStatusMeta,
  resultText,
  STATUS_META_KEY,
  storyIdFromUri,
} from "./story-wire";

const task = (overrides: Record<string, unknown> = {}): DetailedTask =>
  DetailedTaskSchema.parse({
    taskId: "t-1",
    status: "working",
    createdAt: "2026-08-21T12:00:00Z",
    lastUpdatedAt: "2026-08-21T12:00:01Z",
    ttlMs: null,
    ...overrides,
  });

const withMeta = (status: unknown): DetailedTask => task({ _meta: { [STATUS_META_KEY]: status } });

describe("readStatusMeta", () => {
  it("reads every field of the structured status meta", () => {
    const meta = readStatusMeta(
      withMeta({
        scene: "story://odyssey/scenes/boat",
        sprite: { uri: "story://odyssey/sprites/cyclops", persist: true },
        phase: "polyphemus",
        build: 0.4,
        actions: {
          key: "actions-3",
          options: [
            { id: "consult-the-gods", label: "Consult the gods" },
            { id: "ration-supplies", label: "Ration supplies" },
          ],
        },
      }),
    );
    expect(meta).toEqual({
      scene: "story://odyssey/scenes/boat",
      sprite: { uri: "story://odyssey/sprites/cyclops", persist: true },
      phase: "polyphemus",
      build: 0.4,
      actions: {
        key: "actions-3",
        options: [
          { id: "consult-the-gods", label: "Consult the gods" },
          { id: "ration-supplies", label: "Ration supplies" },
        ],
      },
    });
  });

  it("defaults sprite persist to false and tolerates a percentage build", () => {
    const meta = readStatusMeta(
      withMeta({ sprite: { uri: "story://dc/sprites/bats" }, build: 55 }),
    );
    expect(meta.sprite).toEqual({ uri: "story://dc/sprites/bats", persist: false });
    expect(meta.build).toBe(0.55);
  });

  it("reads an empty meta from a missing, foreign, or malformed key", () => {
    expect(readStatusMeta(task())).toEqual({});
    expect(readStatusMeta(task({ _meta: { other: 1 } }))).toEqual({});
    expect(readStatusMeta(withMeta("not an object"))).toEqual({});
    expect(readStatusMeta(withMeta({ scene: 42, build: "big" }))).toEqual({});
  });

  it("drops a malformed actions block without losing the rest", () => {
    const meta = readStatusMeta(withMeta({ phase: "site", actions: { key: "a", options: "x" } }));
    expect(meta).toEqual({});
    const partial = readStatusMeta(withMeta({ phase: "site", build: -3 }));
    expect(partial).toEqual({ phase: "site" });
  });
});

describe("normalizeBuild", () => {
  it("keeps fractions, maps percentages, clamps, and rejects nonsense", () => {
    expect(normalizeBuild(0.25)).toBe(0.25);
    expect(normalizeBuild(1)).toBe(1);
    expect(normalizeBuild(40)).toBe(0.4);
    expect(normalizeBuild(250)).toBe(1);
    expect(normalizeBuild(-1)).toBeUndefined();
    expect(normalizeBuild(Number.NaN)).toBeUndefined();
  });
});

describe("parseBeat", () => {
  it("passes v3 prose through untouched", () => {
    expect(parseBeat("The crew eyes the bag of winds.")).toEqual({
      prose: "The crew eyes the bag of winds.",
    });
  });

  it("unwraps a v1 tagged line into prose plus fallbacks", () => {
    expect(parseBeat("[gpus] Racks arrive by the truckload for Aurora. (build 45%)")).toEqual({
      prose: "Racks arrive by the truckload for Aurora.",
      phase: "gpus",
      build: 0.45,
    });
    expect(parseBeat("[site] Scouts fan out.")).toEqual({
      prose: "Scouts fan out.",
      phase: "site",
    });
  });

  it("leaves bracketed words that are not a leading phase tag alone", () => {
    expect(parseBeat("The sign reads [closed] for the season.")).toEqual({
      prose: "The sign reads [closed] for the season.",
    });
    expect(parseBeat("[Site] Capitalized tags are prose.")).toEqual({
      prose: "[Site] Capitalized tags are prose.",
    });
  });
});

const elicit = (message: string, ids?: string[]): InputRequest => ({
  method: "elicitation/create",
  params: {
    message,
    requestedSchema:
      ids === undefined
        ? { type: "object", properties: {}, required: [] }
        : {
            type: "object",
            properties: { choice: { type: "string", enum: ids } },
            required: ["choice"],
          },
  },
});

describe("parseFork", () => {
  it("splits the scene from the option lines and labels the enum ids", () => {
    const fork = parseFork(
      "site-choice",
      elicit(
        "Two parcels make the shortlist. Where does Aurora break ground?\n- desert-mesa: The mesa: cheap land, brutal summers\n- river-bend: The river bend: pricey land beside cold water",
        ["desert-mesa", "river-bend"],
      ),
    );
    expect(fork).toEqual({
      key: "site-choice",
      scene: "Two parcels make the shortlist. Where does Aurora break ground?",
      options: [
        { id: "desert-mesa", label: "The mesa: cheap land, brutal summers" },
        { id: "river-bend", label: "The river bend: pricey land beside cold water" },
      ],
    });
  });

  it("keeps the enum order and falls back to the id when a line is missing", () => {
    const fork = parseFork("k", elicit("Choose?\n- b: Option B", ["a", "b"]));
    expect(fork.options).toEqual([
      { id: "a", label: "a" },
      { id: "b", label: "Option B" },
    ]);
  });

  it("uses the lines alone when the schema has no enum", () => {
    const fork = parseFork("k", elicit("Which way?\n- left: Go left\n- right: Go right"));
    expect(fork.scene).toBe("Which way?");
    expect(fork.options).toEqual([
      { id: "left", label: "Go left" },
      { id: "right", label: "Go right" },
    ]);
  });

  it("survives a bare request with no message at all", () => {
    expect(parseFork("k", { method: "elicitation/create" })).toEqual({
      key: "k",
      scene: "",
      options: [],
    });
  });

  it("carries the crisis window when the ask announces one", () => {
    const timed = parseFork(
      "bag-of-winds",
      elicit("The crew reaches for the bag. You have 8 seconds. Stop them?\n- stop: Stop them", [
        "stop",
      ]),
    );
    expect(timed.windowMs).toBe(8000);
    const untimed = parseFork("k", elicit("Stop them?\n- stop: Stop them", ["stop"]));
    expect(untimed.windowMs).toBeUndefined();
  });
});

describe("forkWindowMs", () => {
  it("prefers a numeric timeoutMs param, then a seconds mention", () => {
    expect(
      forkWindowMs({ method: "elicitation/create", params: { timeoutMs: 5000, message: "10s" } }),
    ).toBe(5000);
    expect(forkWindowMs(elicit("Decide within 12 seconds?"))).toBe(12_000);
    expect(forkWindowMs(elicit("Window 2.5s — go?"))).toBe(2500);
  });

  it("ignores numbers that are not a duration", () => {
    expect(forkWindowMs(elicit("Forty megawatts by summer across 5 sites?"))).toBeUndefined();
    expect(forkWindowMs({ method: "elicitation/create" })).toBeUndefined();
  });
});

describe("findFork", () => {
  it("returns the first outstanding ask parsed, or undefined", () => {
    expect(findFork(undefined)).toBeUndefined();
    expect(findFork({})).toBeUndefined();
    expect(findFork({ "site-choice": elicit("Where?\n- a: A", ["a"]) })?.key).toBe("site-choice");
  });
});

describe("choiceResponse", () => {
  it("answers the exact key with an accept carrying the option id", () => {
    expect(choiceResponse("actions-2", "ration-supplies")).toEqual({
      "actions-2": { action: "accept", content: { choice: "ration-supplies" } },
    });
  });
});

describe("parseEnding", () => {
  it("splits the ending id from the prose", () => {
    expect(parseEnding("[ending:lights-on] Aurora hums. Traffic flows.")).toEqual({
      id: "lights-on",
      prose: "Aurora hums. Traffic flows.",
    });
  });

  it("rejects anything else", () => {
    expect(parseEnding("Car 7 finished: 8 laps in 30s")).toBeUndefined();
    expect(parseEnding("[ending:Bad Id] prose")).toBeUndefined();
    expect(parseEnding("")).toBeUndefined();
  });
});

describe("resultText", () => {
  it("joins text contents and ignores the rest", () => {
    expect(
      resultText({
        content: [
          { type: "text", text: "[ending:home] Ithaca at last." },
          { type: "image", data: "…" },
          { type: "text", text: "The suitors are gone." },
        ],
      }),
    ).toBe("[ending:home] Ithaca at last.\nThe suitors are gone.");
    expect(resultText({ content: [] })).toBeUndefined();
    expect(resultText(undefined)).toBeUndefined();
  });
});

describe("endingTone", () => {
  it("lets the status and isError flag decide first", () => {
    expect(endingTone("lights-on", { status: "cancelled" })).toBe("abandoned");
    expect(endingTone("lights-on", { status: "failed" })).toBe("disaster");
    expect(endingTone("lights-on", { isError: true })).toBe("disaster");
  });

  it("reads the ending id's words otherwise", () => {
    expect(endingTone("lights-online")).toBe("triumph");
    expect(endingTone("home-at-last")).toBe("triumph");
    expect(endingTone("bankrupt-before-power")).toBe("disaster");
    expect(endingTone("shipwrecked-off-scylla")).toBe("disaster");
    expect(endingTone("quiet-retirement")).toBe("neutral");
  });
});

describe("storyIdFromUri", () => {
  it("names the story of a story:// URI", () => {
    expect(storyIdFromUri("story://odyssey/scenes/boat")).toBe("odyssey");
    expect(storyIdFromUri("story://datacenter/manifest")).toBe("datacenter");
    expect(storyIdFromUri("https://example.com/x")).toBeUndefined();
    expect(storyIdFromUri(undefined)).toBeUndefined();
  });
});
