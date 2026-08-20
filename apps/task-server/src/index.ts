import { createMcpHandler, createTaskEntrypoint, McpServer, TaskRunner } from "durable-mcp-server";
import { z } from "zod";
import { getStory, listStories, storyIds } from "./story";
import { normalizeSeed } from "./story/format";
import { registerStoryResources } from "./story/resources";
import { walkStory, type WalkFeedback } from "./story/walk";
// Registers the shipped stories (src/stories) into the registry.
import "./stories";

function createServer() {
  const server = new McpServer({
    name: "durable-mcp-server-demo",
    version: "1.0.0",
  });

  // Story contract v3: every story's manifest, scenes, and sprites are MCP
  // resources (story://{id}/...). The client is story-agnostic — it builds
  // its picker from the manifests and reads the art the status meta names.
  registerStoryResources(server, listStories());

  // The adventure: one playthrough of a registered story graph per task.
  // Beats are handler-owned statusMessage prose with the visual state in the
  // structured status meta; forks are the only elicits (keyed by node id,
  // timed crises carry params.timeoutMs and a fate branch); ambient actions
  // are standing non-blocking offers consumed at beat boundaries; random
  // events are journaled seeded rolls — the same seed with the same inputs
  // replays the identical story. The walk itself is the pure generator in
  // src/story/walk.ts; this handler only adapts its events onto the durable
  // step API, so engine replays re-drive the generator with journal-fed
  // feedback.
  server.registerTask(
    "start",
    {
      description:
        "Starts a story. It runs as a long-running durable task and may pause at forks to ask " +
        "the player for input. The player can cancel at any time. Pick a story id from " +
        "resources/list (story://{id}/manifest).",
      inputSchema: z.object({
        story: z.string().describe("Story id, from resources/list (story://{id}/manifest)"),
        name: z
          .string()
          .max(80)
          .optional()
          .describe("The protagonist's name, woven into the story; defaults per story"),
        seed: z.number().int().optional().describe("Story seed; omit for a random draw"),
      }),
      pollIntervalMs: 1_000,
    },
    async (input, step) => {
      const story = getStory(input.story);
      if (story === undefined) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Unknown story "${input.story}". Known stories: ${storyIds().join(", ")}`,
            },
          ],
        };
      }
      const givenName = input.name?.trim();
      const name = givenName === undefined || givenName === "" ? story.defaultName : givenName;

      // Journaled setup: the seed draw. Replays read it back instead of
      // re-rolling, so an omitted input seed still tells one coherent story.
      const setup = await step.do("setup:seed", async () => ({
        seed: normalizeSeed(input.seed ?? Math.floor(Math.random() * 0x1_0000_0000)),
      }));

      const walk = walkStory(story, { name, seed: setup.seed });
      let feedback: WalkFeedback = undefined;
      for (;;) {
        const turn = walk.next(feedback);
        if (turn.done) {
          // An ending — triumphant or catastrophic — is a completion.
          return { content: [{ type: "text", text: turn.value }] };
        }
        feedback = undefined;
        const event = turn.value;
        switch (event.kind) {
          case "beat":
            await step.status(event.text, event.meta);
            break;
          case "sleep":
            await step.sleep(event.stepName, event.ms);
            break;
          case "roll":
            // The seeded branch pick, journaled: replays reuse the pick.
            feedback = { kind: "rolled", index: await step.do(event.stepName, event.pick) };
            break;
          case "ask": {
            if (event.timeoutMs === undefined) {
              feedback = {
                kind: "answered",
                response: await step.elicit(event.key, event.request),
              };
            } else {
              // A timed crisis: a real server-side deadline (the same window
              // the request's params.timeoutMs announces to the client).
              const outcome = await step.elicit(event.key, event.request, {
                timeoutMs: event.timeoutMs,
              });
              feedback =
                outcome.outcome === "answered"
                  ? { kind: "answered", response: outcome.response }
                  : { kind: "timed-out" };
            }
            break;
          }
          case "offer":
            // Standing, non-blocking: the task keeps working; the story
            // announces the set in its status meta.
            await step.offer(event.key, event.request);
            break;
          case "check":
            // Journaled, consume-once, never suspends.
            feedback = {
              kind: "checked",
              response: await step.checkInput(event.stepName, event.key),
            };
            break;
        }
      }
    },
  );

  return server;
}

// The standardized Durable Object (zero user code) and the stable execution
// address the engine dispatches task handlers to (via ctx.exports.TaskExecutor).
export { TaskRunner };
export const TaskExecutor = createTaskEntrypoint(createServer);

// The package's createMcpHandler: the tasks front door (tasks/get / update /
// cancel routed straight to the TaskRunner DO) composed in front of the
// official SDK handler. A fresh server is created for each request; the same
// factory serves Stateless clients and the Legacy compatibility lane.
const { fetch: handleMcp } = createMcpHandler<Env>(createServer);
if (handleMcp === undefined) {
  throw new Error("createMcpHandler returned no fetch handler");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") {
      return handleMcp(request, env, ctx);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
