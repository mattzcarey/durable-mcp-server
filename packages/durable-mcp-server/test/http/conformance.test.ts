/**
 * Wire conformance per docs/testing.md (HTTP layer): capability gating
 * (-32021 + 400), unknown/purged taskId (-32602), Mcp-Name / Mcp-Method
 * header-body cross-checks (-32020 + 400), removed legacy vocabulary and
 * legacy-era tasks/* (-32601 — HTTP 404 on the modern ladder, in-band 200 on
 * the legacy lane, both verified against the SDK's own pairings), ordinary
 * tools unaffected on both eras, conditional capability advertising (D10),
 * and auth_key mismatch rejection (D12).
 */

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TASKS_EXTENSION_ID } from "../../src/wire";
import { createTask, listTableNames, uniqueTaskId } from "../support/helpers";
import {
  callResult,
  errorOf,
  postLegacy,
  postModern,
  readJsonRpcResponse,
  resultOf,
} from "../support/jsonrpc";

const NS = () => env.TASK_RUNNER_REAL;

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

const requiredCapabilitiesSchema = z.object({
  requiredCapabilities: z.object({
    extensions: z.record(z.string(), z.unknown()),
  }),
});

describe("-32021 MissingRequiredClientCapability (+HTTP 400) for non-declaring clients", () => {
  it("rejects a modern tools/call of a task tool without the declaration", async () => {
    const response = await postModern(
      "tools/call",
      { name: "echo_task", arguments: { text: "x" } },
      { declareTasks: false },
    );
    const error = await expectError(response, 400, -32021);
    const data = requiredCapabilitiesSchema.parse(error.data);
    expect(TASKS_EXTENSION_ID in data.requiredCapabilities.extensions).toBe(true);
  });

  it("rejects each tasks/* method without the declaration", async () => {
    const taskId = uniqueTaskId();
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

  it("still creates the task when the extension is declared alongside others", async () => {
    const result = resultOf(
      await readJsonRpcResponse(
        await postModern("tools/call", { name: "echo_task", arguments: { text: "declared" } }),
      ),
    );
    expect(result["resultType"]).toBe("task");
  });
});

describe("-32602 unknown / purged taskId (in-band, HTTP 200)", () => {
  it("tasks/get for an unknown task", async () => {
    const taskId = uniqueTaskId();
    const response = await postModern("tasks/get", { taskId });
    const error = await expectError(response, 200, -32602);
    expect(error.message).toMatch(/not found/i);
    // The not-found poll performed ZERO storage writes on the cold-started DO
    // (docs/how-it-works.md §4(h) (tasks/get through the router) MUST — an unauthenticated random-id poll must not
    // persist anything).
    expect(await listTableNames(NS().getByName(taskId))).toEqual([]);
  });

  it("tasks/update and tasks/cancel for an unknown task", async () => {
    const taskId = uniqueTaskId();
    await expectError(
      await postModern("tasks/update", { taskId, inputResponses: {} }),
      200,
      -32602,
    );
    await expectError(await postModern("tasks/cancel", { taskId }), 200, -32602);
  });

  it("tasks/get with missing taskId params is invalid params", async () => {
    await expectError(await postModern("tasks/get", {}), 200, -32602);
  });
});

describe("-32020 header/body cross-checks (+HTTP 400)", () => {
  it("rejects an Mcp-Name header that disagrees with the body taskId", async () => {
    const taskId = uniqueTaskId();
    const response = await postModern("tasks/get", { taskId }, { mcpName: "someone-elses-task" });
    const error = await expectError(response, 400, -32020);
    expect(error.message).toMatch(/headers and body disagree/);
  });

  it("rejects an Mcp-Method header that disagrees with the body method", async () => {
    const response = await postModern(
      "tasks/get",
      { taskId: uniqueTaskId() },
      { mcpMethod: "tasks/cancel" },
    );
    await expectError(response, 400, -32020);
  });

  it("accepts a headerless modern tasks/get (body-parse fallback, docs/how-it-works.md §4(h) (tasks/get through the router))", async () => {
    const created = resultOf(
      await readJsonRpcResponse(
        await postModern("tools/call", { name: "echo_task", arguments: { text: "fallback" } }),
      ),
    );
    const taskId = z.string().parse(created["taskId"]);
    const response = await postModern("tasks/get", { taskId }, { mcpMethod: null, mcpName: null });
    expect(response.status).toBe(200);
    const result = resultOf(await readJsonRpcResponse(response));
    expect(result["status"]).toBe("working");
  });
});

describe("-32601 removed vocabulary and legacy-era tasks/*", () => {
  it("modern tasks/result and tasks/list fall through to the SDK era gate (-32601, HTTP 404)", async () => {
    for (const [method, params] of [
      ["tasks/result", { taskId: uniqueTaskId() }],
      ["tasks/list", {}],
    ] as const) {
      const response = await postModern(method, params);
      await expectError(response, 404, -32601);
    }
  });

  it("legacy-era tasks/* falls through to the SDK (-32601, in-band on the legacy lane)", async () => {
    const taskId = uniqueTaskId();
    for (const [method, params] of [
      ["tasks/get", { taskId }],
      ["tasks/update", { taskId, inputResponses: {} }],
      ["tasks/cancel", { taskId }],
      ["tasks/result", { taskId }],
      ["tasks/list", {}],
    ] as const) {
      const response = await postLegacy(method, params);
      // The 2025 stateless transport answers handler-level errors in-band:
      // -32601 rides HTTP 200 there (404 is the modern ladder's pairing).
      await expectError(response, 200, -32601);
    }
  });

  it("a legacy tools/call of a task tool is refused with the 2025 idiom (isError result)", async () => {
    const response = await postLegacy("tools/call", {
      name: "echo_task",
      arguments: { text: "x" },
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

describe("ordinary registerTool tools are unaffected on both eras", () => {
  it("modern era (no tasks declaration needed)", async () => {
    const response = await postModern(
      "tools/call",
      { name: "echo_tool", arguments: { text: "hi" } },
      { declareTasks: false },
    );
    expect(response.status).toBe(200);
    const result = resultOf(await readJsonRpcResponse(response));
    expect(result["content"]).toEqual([{ type: "text", text: "echo:hi" }]);
    expect(result["isError"]).toBeUndefined();
  });

  it("legacy era", async () => {
    const response = await postLegacy("tools/call", {
      name: "echo_tool",
      arguments: { text: "hi" },
    });
    expect(response.status).toBe(200);
    const result = resultOf(await readJsonRpcResponse(response));
    expect(result["content"]).toEqual([{ type: "text", text: "echo:hi" }]);
  });

  it("tools/list advertises task tools next to ordinary tools", async () => {
    const result = await callResult("tools/list", {}, { declareTasks: false });
    const tools = z.array(z.object({ name: z.string() })).parse(result["tools"]);
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["echo_tool", "echo_task", "pipeline_task"]));
  });
});

describe("capability advertising (D10)", () => {
  it("server/discover advertises the tasks extension when tasks are registered", async () => {
    const result = await callResult("server/discover", {}, { declareTasks: false });
    const capabilities = z
      .object({ extensions: z.record(z.string(), z.unknown()) })
      .parse(result["capabilities"]);
    expect(capabilities.extensions[TASKS_EXTENSION_ID]).toEqual({});
  });
});

describe("auth_key mismatch rejection (D12)", () => {
  it("a task bound to an auth_key at creation is -32602 to an unauthenticated poller", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { authKey: "client-1" }, NS());

    await expectError(await postModern("tasks/get", { taskId }), 200, -32602);
    await expectError(await postModern("tasks/cancel", { taskId }), 200, -32602);
    await expectError(
      await postModern("tasks/update", { taskId, inputResponses: {} }),
      200,
      -32602,
    );
  });

  it("an unkeyed task stays a pure bearer handle", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, {}, NS());
    const response = await postModern("tasks/get", { taskId });
    expect(response.status).toBe(200);
    expect(resultOf(await readJsonRpcResponse(response))["status"]).toBe("working");
  });
});
