/**
 * Flow: create + poll over the wire (HTTP + data + integration layers).
 *
 * The D3 wire test lives here: raw `tools/call` bytes (tasks extension
 * declared in the `_meta` envelope) must come back as the exact FLAT
 * `CreateTaskResult` shape — validated with OUR vendored zod schema, never
 * the SDK's deprecated 2025 task schemas. This is the SDK-upgrade tripwire
 * for the sanctioned encode-seam hole (docs/how-it-works.md §7 (the wire contract served), decision D3 path A).
 */

import { env } from "cloudflare:workers";
import { SERVER_INFO_META_KEY } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createTaskResultSchema, getTaskResultSchema } from "../../src/wire";
import { drainTaskAlarms } from "../support/drain";
import { readTaskRow, taskStub } from "../support/helpers";
import { callResult, postModern, readJsonRpcResponse, resultOf } from "../support/jsonrpc";

const NS = () => env.TASK_RUNNER_REAL;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function createTaskOverHttp(text: string): Promise<z.output<typeof createTaskResultSchema>> {
  const response = await postModern("tools/call", {
    name: "echo_task",
    arguments: { text },
  });
  expect(response.status).toBe(200);
  const result = resultOf(await readJsonRpcResponse(response));
  return createTaskResultSchema.parse(result);
}

describe("D3 wire test: tools/call -> flat CreateTaskResult", () => {
  it("returns the exact CreateTaskResult shape through the registerTool seam", async () => {
    const before = Date.now();
    const created = await createTaskOverHttp("wire");

    // The flat Result & Task shape (never a nested {task} envelope).
    expect(created.resultType).toBe("task");
    expect(created.taskId).toMatch(UUID_RE);
    expect(created.status).toBe("working");
    expect(created.ttlMs).toBe(86_400_000); // D11 default
    expect(created.pollIntervalMs).toBe(5_000); // D11 default
    expect(Date.parse(created.createdAt)).toBeGreaterThanOrEqual(before - 1);
    expect(Date.parse(created.createdAt)).toBeLessThanOrEqual(Date.now() + 1);
    expect(created.lastUpdatedAt).toBe(created.createdAt);

    // The raw result must not carry the legacy nested vocabulary.
    const raw = created as Record<string, unknown>;
    expect("task" in raw).toBe(false);
    expect("ttl" in raw).toBe(false);
    expect("pollInterval" in raw).toBe(false);

    // The modern encode seam stamps serverInfo _meta on every result.
    const meta = z.record(z.string(), z.unknown()).parse(raw["_meta"]);
    expect(meta[SERVER_INFO_META_KEY]).toMatchObject({ name: "durable-mcp-fixture" });
  });

  it("persists the task row before the tool call answers (data layer)", async () => {
    const created = await createTaskOverHttp("row-check");
    const row = await readTaskRow(taskStub(created.taskId, NS()));
    expect(row?.task_id).toBe(created.taskId);
    expect(row?.tool_name).toBe("echo_task");
    expect(JSON.parse(String(row?.input))).toEqual({
      kind: "value",
      value: { text: "row-check" },
    });
    expect(row?.status).toBe("working");
    expect(row?.auth_key).toBeNull(); // no authInfo on the Workers fetch surface
  });
});

describe("strong consistency + completion over the wire (integration)", () => {
  it("tasks/get resolves working immediately after tools/call, before any drain", async () => {
    const created = await createTaskOverHttp("consistency");

    const result = await callResult("tasks/get", { taskId: created.taskId });
    const snapshot = getTaskResultSchema.parse(result);
    expect(snapshot.resultType).toBe("complete");
    expect(snapshot.taskId).toBe(created.taskId);
    expect(snapshot.status).toBe("working");
    expect(snapshot.pollIntervalMs).toBe(5_000);
    expect("result" in snapshot).toBe(false);
  });

  it("drain -> tasks/get completed with the inlined CallToolResult, repeatably", async () => {
    const created = await createTaskOverHttp("finish");
    await drainTaskAlarms(created.taskId, { namespace: NS() });

    for (let poll = 0; poll < 2; poll++) {
      const snapshot = getTaskResultSchema.parse(
        await callResult("tasks/get", { taskId: created.taskId }),
      );
      expect(snapshot.status).toBe("completed");
      if (snapshot.status !== "completed") {
        throw new Error("unreachable");
      }
      // echo_task proves env resolves via cloudflare:workers in the executor.
      expect(snapshot.result).toEqual({
        content: [{ type: "text", text: "finish:object" }],
      });
      const meta = z
        .record(z.string(), z.unknown())
        .parse((snapshot as Record<string, unknown>)["_meta"]);
      expect(meta[SERVER_INFO_META_KEY]).toMatchObject({ name: "durable-mcp-fixture" });
    }
  });
});
