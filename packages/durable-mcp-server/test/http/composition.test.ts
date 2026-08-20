/**
 * The advanced entry style (API revision 4): createTasksRouter composed by
 * hand in front of the OFFICIAL createMcpHandler from
 * @modelcontextprotocol/server —
 *
 *   (await tasks.fetch(request, env, ctx)) ?? officialHandler.fetch(request)
 *
 * — must be wire-identical to this package's one-line createMcpHandler
 * (which the fixture's default export mounts, served here via SELF). The
 * composition runs on the DEFAULT `TASK_RUNNER` binding, also covering the
 * McpServer wire handler's `cloudflare:workers` env fallback for the
 * namespace (no `configureTaskRunner` injection happens in this style).
 */

import { createExecutionContext, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createMcpHandler as sdkCreateMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createTasksRouter } from "../../src";
import { createTaskResultSchema, getTaskResultSchema } from "../../src/wire";
import { createServer } from "../fixtures/worker";
import { uniqueTaskId } from "../support/helpers";
import { errorOf, modernRequest, readJsonRpcResponse, resultOf } from "../support/jsonrpc";

const tasks = createTasksRouter(createServer);
const official = sdkCreateMcpHandler(() => createServer());

async function composedFetch(request: Request): Promise<Response> {
  const routed = await tasks.fetch(request, env, createExecutionContext());
  return routed ?? official.fetch(request);
}

interface Observed {
  status: number;
  errorCode?: number;
  resultType?: unknown;
}

async function observe(response: Response): Promise<Observed> {
  const message = await readJsonRpcResponse(response);
  const parsed = z
    .object({
      error: z.object({ code: z.number() }).optional(),
      result: z.record(z.string(), z.unknown()).optional(),
    })
    .parse(message);
  return {
    status: response.status,
    ...(parsed.error !== undefined && { errorCode: parsed.error.code }),
    ...(parsed.result !== undefined && { resultType: parsed.result["resultType"] }),
  };
}

describe("createTasksRouter ?? official SDK handler === our createMcpHandler", () => {
  it("answers the conformance matrix identically to the one-liner", async () => {
    const cases: Array<() => Request> = [
      () => modernRequest("tasks/get", { taskId: uniqueTaskId() }),
      () => modernRequest("tasks/get", { taskId: uniqueTaskId() }, { declareTasks: false }),
      () => modernRequest("tasks/cancel", { taskId: uniqueTaskId() }),
      () => modernRequest("tasks/get", { taskId: uniqueTaskId() }, { mcpName: "mismatched-name" }),
      () => modernRequest("tasks/result", { taskId: uniqueTaskId() }),
      () => modernRequest("tasks/list", {}),
      () =>
        modernRequest(
          "tools/call",
          { name: "echo_task", arguments: { text: "x" } },
          { declareTasks: false },
        ),
      () =>
        modernRequest(
          "tools/call",
          { name: "echo_tool", arguments: { text: "same" } },
          { declareTasks: false },
        ),
    ];

    for (const build of cases) {
      const viaComposition = await observe(await composedFetch(build()));
      const viaOneLiner = await observe(await SELF.fetch(build()));
      expect(viaComposition).toEqual(viaOneLiner);
    }
  });

  it("creates and polls a task through the composition (default TASK_RUNNER binding)", async () => {
    const createResponse = await composedFetch(
      modernRequest("tools/call", { name: "echo_task", arguments: { text: "composed" } }),
    );
    expect(createResponse.status).toBe(200);
    const created = createTaskResultSchema.parse(
      resultOf(await readJsonRpcResponse(createResponse)),
    );
    expect(created.status).toBe("working");

    // Strong consistency through the same composition: the row lives in the
    // DEFAULT namespace (env fallback), so tasks/get resolves immediately.
    const polled = getTaskResultSchema.parse(
      resultOf(
        await readJsonRpcResponse(
          await composedFetch(modernRequest("tasks/get", { taskId: created.taskId })),
        ),
      ),
    );
    expect(polled.taskId).toBe(created.taskId);
    expect(polled.status).toBe("working");

    // And the default-binding row is invisible to the one-liner's
    // TASK_RUNNER_REAL-bound router — proof the binding option routes.
    const crossNamespace = await SELF.fetch(modernRequest("tasks/get", { taskId: created.taskId }));
    expect(errorOf(await readJsonRpcResponse(crossNamespace)).code).toBe(-32602);
  });
});
