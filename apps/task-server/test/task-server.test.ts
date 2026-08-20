import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createTaskResultSchema } from "durable-mcp-server";
import { z } from "zod";
import { callResult, errorOf, postLegacy, readJsonRpcResponse } from "./support/jsonrpc";
import { drainTaskUntil } from "./support/tasks";

describe("task-server worker", () => {
  it("answers the initialize handshake at /mcp", async () => {
    const response = await postLegacy("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });

    expect(response.status).toBe(200);
    const message = await readJsonRpcResponse(response);
    expect(message).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: { name: "durable-mcp-server-demo", version: "1.0.0" },
      },
    });
  });

  it("lists exactly the start task, with the story picker input and a long-running description", async () => {
    const response = await postLegacy("tools/list", {});

    expect(response.status).toBe(200);
    const toolSchema = z.object({
      name: z.string(),
      description: z.string(),
      inputSchema: z.looseObject({
        type: z.literal("object"),
        properties: z.record(z.string(), z.looseObject({ type: z.string() })),
        required: z.array(z.string()).optional(),
      }),
    });
    const tools = z
      .object({ result: z.object({ tools: z.array(toolSchema) }) })
      .parse(await readJsonRpcResponse(response)).result.tools;

    // Story contract v3: the adventure is the only tool.
    expect(tools.map((tool) => tool.name)).toEqual(["start"]);

    // Input: { story: string, name?: string, seed?: number }.
    const start = tools.at(0);
    expect(Object.keys(start?.inputSchema.properties ?? {})).toEqual(["story", "name", "seed"]);
    expect(start?.inputSchema.properties["story"]).toMatchObject({ type: "string" });
    expect(start?.inputSchema.properties["name"]).toMatchObject({ type: "string" });
    expect(start?.inputSchema.properties["seed"]).toMatchObject({ type: "integer" });
    expect(start?.inputSchema.required).toEqual(["story"]);

    // The description says plainly what the tool is.
    expect(start?.description).toMatch(/long-running/i);
    expect(start?.description).toMatch(/durable task/i);
    expect(start?.description).toMatch(/ask the player for input/i);
  });

  it("start with an unknown story id completes with an isError result naming the known ids", async () => {
    const created = createTaskResultSchema.parse(
      await callResult("tools/call", {
        name: "start",
        arguments: { story: "no-such-story", name: "Ghost Town", seed: 1 },
      }),
    );
    expect(created.status).toBe("working");

    const done = await drainTaskUntil(created.taskId, ["completed", "failed", "cancelled"]);
    if (done.status !== "completed") {
      throw new Error(`expected completed, got ${done.status}`);
    }
    expect(done.result["isError"]).toBe(true);
    const content = z
      .array(z.object({ type: z.literal("text"), text: z.string() }))
      .parse(done.result["content"]);
    const text = content.at(0)?.text ?? "";
    expect(text).toContain('Unknown story "no-such-story"');
    expect(text).toContain("datacenter");
    expect(text).toContain("odyssey");
  });

  it("advertises resources (the stories) but no prompts (-32601 on prompts/list)", async () => {
    const promptsError = errorOf(await readJsonRpcResponse(await postLegacy("prompts/list", {})));
    expect(promptsError.code).toBe(-32601);

    const resources = z
      .object({ resources: z.array(z.object({ uri: z.string() })) })
      .parse(await callResult("resources/list", {}));
    const uris = resources.resources.map((resource) => resource.uri);
    expect(uris).toContain("story://datacenter/manifest");
    expect(uris).toContain("story://odyssey/manifest");
  });

  it("returns 404 for requests outside /mcp", async () => {
    const wrongPath = await SELF.fetch("http://example.com/nope", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(wrongPath.status).toBe(404);

    const root = await SELF.fetch("http://example.com/");
    expect(root.status).toBe(404);
  });
});
