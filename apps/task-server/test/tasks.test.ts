/**
 * Tasks wire conformance for the adventure server (HTTP layer of the
 * four-layer matrix; gameplay flows live in adventure.test.ts, the data and
 * control-plane layers in the durable-mcp-server package suite). Responses
 * are validated with the PACKAGE's exported zod wire schemas, never the
 * SDK's deprecated 2025-11-25 task types.
 */

import { describe, expect, it } from "vitest";
import { TASKS_EXTENSION_ID } from "durable-mcp-server";
import { z } from "zod";
import { errorOf, postLegacy, postModern, readJsonRpcResponse, resultOf } from "./support/jsonrpc";

async function expectError(
  response: Response,
  status: number,
  code: number,
): Promise<{ code: number; message: string; data?: unknown }> {
  expect(response.status).toBe(status);
  const error = errorOf(await readJsonRpcResponse(response));
  expect(error.code).toBe(code);
  return error;
}

describe("-32021 MissingRequiredClientCapability (+HTTP 400) for non-declaring clients", () => {
  const requiredCapabilitiesSchema = z.object({
    requiredCapabilities: z.object({
      extensions: z.record(z.string(), z.unknown()),
    }),
  });

  it("rejects a modern tools/call of the start task without the declaration", async () => {
    const response = await postModern(
      "tools/call",
      { name: "start", arguments: { story: "datacenter", name: "Nope" } },
      { declareTasks: false },
    );
    const error = await expectError(response, 400, -32021);
    const data = requiredCapabilitiesSchema.parse(error.data);
    expect(TASKS_EXTENSION_ID in data.requiredCapabilities.extensions).toBe(true);
  });

  it("rejects each tasks/* method without the declaration", async () => {
    const taskId = crypto.randomUUID();
    for (const [method, params] of [
      ["tasks/get", { taskId }],
      ["tasks/update", { taskId, inputResponses: {} }],
      ["tasks/cancel", { taskId }],
    ] as const) {
      const response = await postModern(method, params, { declareTasks: false });
      const error = await expectError(response, 400, -32021);
      const data = requiredCapabilitiesSchema.parse(error.data);
      expect(TASKS_EXTENSION_ID in data.requiredCapabilities.extensions).toBe(true);
    }
  });
});

describe("-32602 unknown taskId (in-band, HTTP 200)", () => {
  it("tasks/get, tasks/update, and tasks/cancel for an unknown task", async () => {
    const taskId = crypto.randomUUID();
    const error = await expectError(await postModern("tasks/get", { taskId }), 200, -32602);
    expect(error.message).toMatch(/not found/i);
    await expectError(
      await postModern("tasks/update", { taskId, inputResponses: {} }),
      200,
      -32602,
    );
    await expectError(await postModern("tasks/cancel", { taskId }), 200, -32602);
  });
});

describe("legacy-era clients get the 2025 idiom (inspector interop)", () => {
  it("a legacy tools/call of the start task answers an isError result naming the extension", async () => {
    const response = await postLegacy("tools/call", {
      name: "start",
      arguments: { story: "datacenter", name: "Legacy" },
    });
    expect(response.status).toBe(200);
    const result = resultOf(await readJsonRpcResponse(response));
    expect(result["isError"]).toBe(true);
    const content = z
      .array(z.object({ type: z.string(), text: z.string() }))
      .parse(result["content"]);
    expect(content.at(0)?.text).toContain(TASKS_EXTENSION_ID);
  });
});
