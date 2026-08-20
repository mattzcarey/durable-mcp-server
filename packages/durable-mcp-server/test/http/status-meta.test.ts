/**
 * The HTTP layer for structured status meta: tasks/get carries the handler's
 * meta under `_meta["io.durable-mcp-server/status"]` exactly (next to the
 * serverInfo key the front door always stamps), and the key is absent while
 * no meta was ever written.
 */

import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { SERVER_INFO_META_KEY } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { STATUS_META_KEY } from "../../src";
import { getTaskResultSchema } from "../../src/wire";
import { drainTaskAlarms } from "../support/drain";
import { taskStub } from "../support/helpers";
import { callResult } from "../support/jsonrpc";

const NS = () => env.TASK_RUNNER_REAL;
const drain = (taskId: string) => drainTaskAlarms(taskId, { namespace: NS() });

const metaSchema = z.record(z.string(), z.unknown());

async function startTask(name: string, args: Record<string, unknown>): Promise<string> {
  const result = await callResult("tools/call", { name, arguments: args });
  expect(result["resultType"]).toBe("task");
  return z.string().parse(result["taskId"]);
}

async function getTask(taskId: string): Promise<z.output<typeof getTaskResultSchema>> {
  return getTaskResultSchema.parse(await callResult("tasks/get", { taskId }));
}

describe("structured status meta over HTTP", () => {
  it("tasks/get carries the meta under the namespaced _meta key exactly, next to serverInfo", async () => {
    const taskId = await startTask("status_meta_task", { text: "hi" });
    const stub = taskStub(taskId, NS());

    expect(await runDurableObjectAlarm(stub)).toBe(true); // sleeping after the message-only write
    const working = await getTask(taskId);
    expect(working.status).toBe("working");
    expect(working.statusMessage).toBe('sent "HI"');
    let meta = metaSchema.parse(working["_meta"]);
    expect(meta[STATUS_META_KEY]).toEqual({ phase: "warmup", lap: 0 }); // kept by the meta-less call
    expect(meta[SERVER_INFO_META_KEY]).toMatchObject({ name: "durable-mcp-fixture" });
    expect(new Set(Object.keys(meta))).toEqual(new Set([STATUS_META_KEY, SERVER_INFO_META_KEY]));

    await drain(taskId);
    const done = await getTask(taskId);
    expect(done.status).toBe("completed");
    expect(done.statusMessage).toBe("wrapping up");
    meta = metaSchema.parse(done["_meta"]);
    expect(meta[STATUS_META_KEY]).toEqual({ phase: "done", lap: 3 }); // replaced wholesale, kept at terminal
    expect(meta[SERVER_INFO_META_KEY]).toMatchObject({ name: "durable-mcp-fixture" });
  });

  it("the key is absent while no meta was written: message-only and silent tasks alike", async () => {
    for (const [name, args] of [
      ["status_task", { text: "hi" }],
      ["pipeline_task", { text: "quiet" }],
    ] as const) {
      const taskId = await startTask(name, args);
      const stub = taskStub(taskId, NS());
      expect(await runDurableObjectAlarm(stub)).toBe(true); // mid-flight
      let meta = metaSchema.parse((await getTask(taskId))["_meta"]);
      expect(STATUS_META_KEY in meta).toBe(false);
      expect(meta[SERVER_INFO_META_KEY]).toMatchObject({ name: "durable-mcp-fixture" });

      await drain(taskId);
      const done = await getTask(taskId);
      expect(done.status).toBe("completed");
      meta = metaSchema.parse(done["_meta"]);
      expect(STATUS_META_KEY in meta).toBe(false);
    }
  });
});
