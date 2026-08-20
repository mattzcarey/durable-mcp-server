/**
 * Wire conformance at the example's fetch surface: the spec-mandated -32021
 * refusal (+HTTP 400) for clients that do not declare the tasks extension,
 * -32602 for unknown taskIds, and plain tools staying unaffected by the tasks
 * machinery.
 */

import { TASKS_EXTENSION_ID } from "durable-mcp-server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorOf, postModern, readJsonRpcResponse, resultOf } from "./support/jsonrpc";

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

  it("rejects a modern tools/call of send_report without the declaration", async () => {
    const response = await postModern(
      "tools/call",
      { name: "send_report", arguments: { to: "nobody@example.com" } },
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

describe("plain tools are unaffected by the tasks machinery", () => {
  it("a modern client that does not declare the extension can call echo", async () => {
    const response = await postModern(
      "tools/call",
      { name: "echo", arguments: { m: "still here" } },
      { declareTasks: false },
    );
    expect(response.status).toBe(200);
    const result = resultOf(await readJsonRpcResponse(response));
    const content = z
      .object({ content: z.array(z.object({ type: z.string(), text: z.string() })) })
      .parse(result).content;
    expect(content.at(0)?.text).toBe("still here");
  });
});
