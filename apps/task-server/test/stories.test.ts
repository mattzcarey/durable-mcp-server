/**
 * The shipped stories (datacenter, odyssey): their resources over the real
 * /mcp wire (resources/list + resources/read for EVERY URI a story
 * publishes, manifests that parse, SVG art that is self-contained), and
 * pure sweeps of the interpreter across seeds and input policies — every
 * playthrough terminates in an ending, every journal name is unique (D8),
 * every scene or sprite the meta names is a published resource — plus a
 * real wire playthrough of each story with the default pacing
 * fast-forwarded by the alarm drain.
 */

import { describe, expect, it } from "vitest";
import { createTaskResultSchema, STATUS_META_KEY } from "durable-mcp-server";
import { z } from "zod";
import { getStory } from "../src/story";
import { storyManifest, storyResourceUris } from "../src/story/resources";
import { datacenterStory, odysseyStory } from "../src/stories";
import { callResult } from "./support/jsonrpc";
import { type Policy, sweepStory } from "./support/story-sim";
import { drainTaskUntil, type TaskSnapshot } from "./support/tasks";

const STORIES = [datacenterStory, odysseyStory];

/* ---- Resources over the wire ------------------------------------------- */

const listSchema = z.object({
  resources: z.array(
    z.object({ uri: z.string(), name: z.string(), mimeType: z.string().optional() }),
  ),
});
const readSchema = z.object({
  contents: z.array(
    z.object({ uri: z.string(), mimeType: z.string().optional(), text: z.string() }),
  ),
});

describe("story resources over the wire", () => {
  it("resources/list names every manifest, scene, and sprite of both stories, and resources/read serves each one", async () => {
    const listed = listSchema.parse(await callResult("resources/list", {})).resources;
    const listedUris = new Set(listed.map((resource) => resource.uri));
    for (const story of STORIES) {
      for (const uri of storyResourceUris(story)) {
        expect(listedUris.has(uri), `listed: ${uri}`).toBe(true);
        const read = readSchema.parse(await callResult("resources/read", { uri }));
        const content = read.contents.at(0);
        expect(content?.uri).toBe(uri);
        expect(content?.text.length ?? 0).toBeGreaterThan(0);
        if (uri.endsWith("/manifest")) {
          expect(content?.mimeType).toBe("application/json");
          expect(JSON.parse(content?.text ?? "")).toEqual(storyManifest(story));
        } else {
          expect(content?.mimeType).toBe("image/svg+xml");
          expect(content?.text).toMatch(/^<svg[\s>]/);
          // Self-contained: no scripts, no external references (the SVG
          // namespace declaration is the one URL allowed).
          expect(content?.text).not.toMatch(
            /<script|\bhref\s*=\s*["']?https?:|\bsrc\s*=|url\(\s*["']?https?:|@import/i,
          );
        }
      }
    }
  });

  it("each manifest carries the picker and checklist fields, and its defaultScene is a published scene", () => {
    for (const story of STORIES) {
      const manifest = storyManifest(story);
      expect(manifest.id).toBe(story.id);
      expect(manifest.title.length).toBeGreaterThan(0);
      expect(manifest.blurb.length).toBeGreaterThan(0);
      expect(manifest.phases.length).toBeGreaterThan(5);
      expect(manifest.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(storyResourceUris(story)).toContain(manifest.defaultScene);
    }
  });
});

/* ---- Pure sweeps --------------------------------------------------------- */

const POLICIES: Record<string, Policy> = {
  "first option, no presses": { answer: () => 0, press: () => undefined },
  "last option, no presses": { answer: (ids) => ids.length - 1, press: () => undefined },
  "rotate options, press every third check": {
    answer: (_ids, ordinal) => ordinal,
    press: (ids, ordinal) => (ordinal % 3 === 0 ? ordinal % ids.length : undefined),
  },
  "fate on every timed ask, press every check": {
    answer: (_ids, ordinal, timed) => (timed ? "timeout" : ordinal + 1),
    press: (ids, ordinal) => ordinal % ids.length,
  },
};

describe("pure sweeps of the shipped stories", () => {
  for (const story of STORIES) {
    describe(story.id, () => {
      it("is massive: 40+ nodes, several endings, forks, a timed crisis, rolls, gates, and ambient actions", () => {
        const nodes = Object.values(story.nodes);
        expect(nodes.length).toBeGreaterThanOrEqual(40);
        expect(nodes.filter((node) => node.ending !== undefined).length).toBeGreaterThanOrEqual(4);
        expect(nodes.filter((node) => node.decision !== undefined).length).toBeGreaterThanOrEqual(
          8,
        );
        expect(nodes.some((node) => node.decision?.timeoutMs !== undefined)).toBe(true);
        expect(nodes.some((node) => node.roll !== undefined)).toBe(true);
        expect(nodes.some((node) => node.gate !== undefined)).toBe(true);
        expect(story.actions?.length ?? 0).toBeGreaterThanOrEqual(3);
        expect(nodes.filter((node) => node.return !== undefined).length).toBeGreaterThanOrEqual(3);
      });

      for (const [label, policy] of Object.entries(POLICIES)) {
        it(`terminates in an ending for every seed under "${label}", with unique journal names and published visuals`, () => {
          const published = new Set(storyResourceUris(story));
          const endings = new Set<string>();
          for (let seed = 1; seed <= 40; seed++) {
            const run = sweepStory(story, seed, policy);
            expect(run.ending).toMatch(/^\[ending:[a-z0-9-]+\] .+/);
            endings.add(run.ending);
            expect(run.beats).toBeGreaterThan(3);
            expect(new Set(run.names).size, `seed ${seed}`).toBe(run.names.length);
            for (const uri of run.visuals) {
              expect(published.has(uri), uri).toBe(true);
            }
            expect(run.actionKeys.at(0)).toBe("actions-1");
          }
          expect(endings.size).toBeGreaterThan(0);
        });
      }

      it("reaches several distinct endings across policies and seeds", () => {
        const endings = new Set<string>();
        for (const policy of Object.values(POLICIES)) {
          for (let seed = 1; seed <= 40; seed++) {
            endings.add(sweepStory(story, seed, policy).endingId);
          }
        }
        expect(endings.size).toBeGreaterThanOrEqual(3);
      });
    });
  }
});

/* ---- A real wire playthrough of each story ------------------------------ */

const TERMINAL = ["completed", "failed", "cancelled"] as const;
const WAITING = ["input_required", ...TERMINAL] as const;

async function playFirstOptions(
  storyId: string,
  seed: number,
): Promise<{ done: TaskSnapshot; beats: number; scenes: Set<string> }> {
  const created = createTaskResultSchema.parse(
    await callResult("tools/call", {
      name: "start",
      arguments: { story: storyId, name: "Wire", seed },
    }),
  );
  let beats = 0;
  let last: string | undefined;
  const scenes = new Set<string>();
  const observe = (snapshot: TaskSnapshot): void => {
    if (snapshot.statusMessage !== undefined && snapshot.statusMessage !== last) {
      last = snapshot.statusMessage;
      beats += 1;
    }
    const meta = snapshot["_meta"]?.[STATUS_META_KEY];
    if (
      typeof meta === "object" &&
      meta !== null &&
      "scene" in meta &&
      typeof meta.scene === "string"
    ) {
      scenes.add(meta.scene);
    }
  };
  for (;;) {
    const snapshot = await drainTaskUntil(created.taskId, WAITING, { observe, timeoutMs: 60_000 });
    if (snapshot.status !== "input_required") {
      return { done: snapshot, beats, scenes };
    }
    const [key, request] = Object.entries(snapshot.inputRequests).at(0) ?? [];
    if (key === undefined || request === undefined) {
      throw new Error("input_required with no outstanding request");
    }
    const choice = z
      .object({ properties: z.object({ choice: z.object({ enum: z.array(z.string()) }) }) })
      .parse(request.params?.["requestedSchema"])
      .properties.choice.enum.at(0);
    await callResult("tasks/update", {
      taskId: created.taskId,
      inputResponses: { [key]: { action: "accept", content: { choice } } },
    });
  }
}

describe("a wire playthrough of each shipped story (first option at every fork, default pacing fast-forwarded)", () => {
  for (const story of STORIES) {
    it(
      `${story.id} plays to an ending whose scenes are all readable resources`,
      { timeout: 120_000 },
      async () => {
        const { done, beats, scenes } = await playFirstOptions(story.id, 7);
        expect(done.status).toBe("completed");
        if (done.status !== "completed") {
          return;
        }
        const text = z
          .array(z.object({ type: z.literal("text"), text: z.string() }))
          .parse(done.result["content"])
          .at(0)?.text;
        expect(text).toMatch(/^\[ending:[a-z0-9-]+\] .+/);
        expect(beats).toBeGreaterThan(10);
        expect(scenes.size).toBeGreaterThan(1);
        for (const uri of scenes) {
          const read = readSchema.parse(await callResult("resources/read", { uri }));
          expect(read.contents.at(0)?.text).toMatch(/^<svg[\s>]/);
        }
        expect(getStory(story.id)?.id).toBe(story.id);
      },
    );
  }
});
