import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { type InputResponses, TASKS_EXTENSION_ID } from "./schema";
import {
  buildTaskLaneHeaders,
  callToolAsTask,
  cancelTask,
  CLIENT_CAPABILITIES_META_KEY,
  DEFAULT_POLL_INTERVAL_MS,
  encodeMcpHeaderValue,
  extractJsonRpcFromSse,
  getTask,
  MAX_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  nextPollDelayMs,
  pollTaskUntilTerminal,
  PROTOCOL_VERSION_META_KEY,
  taskChangeKey,
  TaskLaneError,
  type TaskLaneSession,
  updateTask,
} from "./task-lane";

const ENDPOINT = "https://tasks.example/mcp";
const SESSION_ID = "sess-123";
const ACCESS_TOKEN = "tok-abc";
const PROTOCOL_VERSION = "2026-07-28";

const session: TaskLaneSession = {
  url: ENDPOINT,
  protocolVersion: PROTOCOL_VERSION,
  sessionId: SESSION_ID,
  accessToken: ACCESS_TOKEN,
};

const TASK_ID = "3f2c8a54-6b1d-4f7e-9c3a-222222222222";

/** Wire-shape helpers for the fake server's scripted states. */
const baseWire = {
  taskId: TASK_ID,
  createdAt: "2026-08-20T10:00:00Z",
  lastUpdatedAt: "2026-08-20T10:00:01Z",
  ttlMs: 120_000,
};
const working = (overrides: Record<string, unknown> = {}) => ({
  ...baseWire,
  status: "working",
  ...overrides,
});
const completed = (result: Record<string, unknown>) => ({
  ...baseWire,
  status: "completed",
  lastUpdatedAt: "2026-08-20T10:00:05Z",
  result,
});
const failed = (error: Record<string, unknown>) => ({
  ...baseWire,
  status: "failed",
  lastUpdatedAt: "2026-08-20T10:00:05Z",
  error,
});
const inputRequired = (overrides: Record<string, unknown> = {}) => ({
  ...baseWire,
  status: "input_required",
  lastUpdatedAt: "2026-08-20T10:00:03Z",
  inputRequests: {
    "elicit-1": { method: "elicitation/create", params: { message: "proceed?" } },
  },
  ...overrides,
});

const RpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.record(z.string(), z.unknown()),
});

type RecordedRequest = {
  method: string;
  params: Record<string, unknown>;
  headers: Record<string, string | null>;
};

/**
 * A stateful fake of a draft-compliant tasks server. It enforces the same
 * wire rules a real 2026-era server would: bearer auth, session id, the
 * `_meta` envelope keys on every request, `Mcp-Method` matching the body,
 * and the `Mcp-Name` <-> `params.taskId` cross-check (-32020 on mismatch).
 */
class FakeTasksServer {
  /** Scripted tasks/get states per task id, served head-first; the last repeats. */
  private readonly states = new Map<string, Record<string, unknown>[]>();
  /** What tools/call answers with (a CreateTaskResult or a plain tool result). */
  toolCallResult: Record<string, unknown> = {};
  readonly requests: RecordedRequest[] = [];

  script(taskId: string, states: Record<string, unknown>[]) {
    this.states.set(taskId, [...states]);
  }

  handler() {
    return http.post(ENDPOINT, async ({ request }) => {
      const rpc = RpcRequestSchema.parse(await request.json());
      this.requests.push({
        method: rpc.method,
        params: rpc.params,
        headers: {
          authorization: request.headers.get("authorization"),
          "mcp-method": request.headers.get("mcp-method"),
          "mcp-name": request.headers.get("mcp-name"),
          "mcp-protocol-version": request.headers.get("mcp-protocol-version"),
          "mcp-session-id": request.headers.get("mcp-session-id"),
        },
      });

      const rpcError = (code: number, message: string, status = 200) =>
        HttpResponse.json({ jsonrpc: "2.0", id: rpc.id, error: { code, message } }, { status });
      const rpcResult = (result: Record<string, unknown>) =>
        HttpResponse.json({ jsonrpc: "2.0", id: rpc.id, result });

      if (request.headers.get("authorization") !== `Bearer ${ACCESS_TOKEN}`) {
        return new HttpResponse("unauthorized", { status: 401 });
      }
      if (request.headers.get("mcp-session-id") !== SESSION_ID) {
        return rpcError(-32600, "unknown session", 404);
      }
      if (request.headers.get("mcp-method") !== rpc.method) {
        return rpcError(-32020, "Mcp-Method does not match body method", 400);
      }
      if (!hasEnvelope(rpc.params)) {
        return rpcError(-32600, "missing required _meta envelope", 400);
      }

      if (rpc.method === "tools/call") {
        if (request.headers.get("mcp-name") !== rpc.params.name) {
          return rpcError(-32020, "Mcp-Name does not match tool name", 400);
        }
        return rpcResult(this.toolCallResult);
      }

      const { taskId } = rpc.params;
      if (typeof taskId !== "string") {
        return rpcError(-32602, "taskId is required");
      }
      if (request.headers.get("mcp-name") !== taskId) {
        return rpcError(-32020, "Mcp-Name does not match params.taskId", 400);
      }
      const states = this.states.get(taskId);
      if (!states || states.length === 0) {
        return rpcError(-32602, `Unknown task: ${taskId}`);
      }

      if (rpc.method === "tasks/get") {
        const state = states.length > 1 ? states.shift() : states.at(0);
        return rpcResult({ ...state, resultType: "complete" });
      }
      if (rpc.method === "tasks/cancel") {
        const last = states.at(-1) ?? {};
        this.states.set(taskId, [
          { ...last, status: "cancelled", lastUpdatedAt: "2026-08-20T10:00:09Z" },
        ]);
        return rpcResult({ resultType: "complete" });
      }
      if (rpc.method === "tasks/update") {
        const { inputResponses } = rpc.params;
        if (typeof inputResponses !== "object" || inputResponses === null) {
          return rpcError(-32602, "inputResponses is required");
        }
        const current = states.at(0);
        if (!current || current.status !== "input_required") {
          return rpcError(-32602, "task is not awaiting input");
        }
        const { inputRequests, ...rest } = current;
        void inputRequests;
        this.states.set(taskId, [
          { ...rest, status: "working", lastUpdatedAt: "2026-08-20T10:00:04Z" },
        ]);
        return rpcResult({ resultType: "complete" });
      }
      // tasks/result and tasks/list no longer exist in the current draft.
      return rpcError(-32601, `Method not found: ${rpc.method}`);
    });
  }
}

function hasEnvelope(params: Record<string, unknown>): boolean {
  const meta = params["_meta"];
  return (
    typeof meta === "object" &&
    meta !== null &&
    PROTOCOL_VERSION_META_KEY in meta &&
    CLIENT_CAPABILITIES_META_KEY in meta
  );
}

let fake = new FakeTasksServer();
const mswServer = setupServer();

beforeAll(() => {
  mswServer.listen({ onUnhandledRequest: "error" });
});
beforeEach(() => {
  fake = new FakeTasksServer();
  mswServer.use(fake.handler());
});
afterEach(() => {
  mswServer.resetHandlers();
});
afterAll(() => {
  mswServer.close();
});

describe("callToolAsTask", () => {
  it("returns the created task from a flat resultType:'task' response", async () => {
    fake.toolCallResult = { ...working({ pollIntervalMs: 300 }), resultType: "task" };

    const outcome = await callToolAsTask(session, "long-crunch", { n: 42 });

    expect(outcome.kind).toBe("task");
    if (outcome.kind !== "task") {
      throw new Error("expected a task outcome");
    }
    expect(outcome.task.taskId).toBe(TASK_ID);
    expect(outcome.task.status).toBe("working");
    expect(outcome.task.pollIntervalMs).toBe(300);
  });

  it("declares the tasks extension in the per-request _meta envelope", async () => {
    fake.toolCallResult = { content: [] };
    await callToolAsTask(session, "long-crunch", {});

    const recorded = fake.requests.at(0);
    expect(recorded?.method).toBe("tools/call");
    const meta = z
      .looseObject({
        [PROTOCOL_VERSION_META_KEY]: z.literal(PROTOCOL_VERSION),
        [CLIENT_CAPABILITIES_META_KEY]: z.looseObject({
          extensions: z.record(z.string(), z.unknown()),
        }),
      })
      .parse(recorded?.params["_meta"]);
    expect(meta[CLIENT_CAPABILITIES_META_KEY].extensions).toHaveProperty(TASKS_EXTENSION_ID);
    expect(recorded?.headers["mcp-name"]).toBe("long-crunch");
    expect(recorded?.headers["mcp-method"]).toBe("tools/call");
  });

  it("returns the plain tool result when the server answers synchronously", async () => {
    fake.toolCallResult = { content: [{ type: "text", text: "instant" }] };

    const outcome = await callToolAsTask(session, "quick", {});

    expect(outcome).toEqual({
      kind: "result",
      result: { content: [{ type: "text", text: "instant" }] },
    });
  });
});

describe("getTask", () => {
  it("sends the negotiated session, auth, and Mcp-Name: <taskId> headers", async () => {
    fake.script(TASK_ID, [working()]);

    const task = await getTask(session, TASK_ID);

    expect(task.status).toBe("working");
    const recorded = fake.requests.at(0);
    expect(recorded?.headers).toEqual({
      authorization: `Bearer ${ACCESS_TOKEN}`,
      "mcp-method": "tasks/get",
      "mcp-name": TASK_ID,
      "mcp-protocol-version": PROTOCOL_VERSION,
      "mcp-session-id": SESSION_ID,
    });
  });

  it("surfaces a JSON-RPC error as TaskLaneError with the code", async () => {
    await expect(getTask(session, TASK_ID)).rejects.toThrowError(TaskLaneError);
    await expect(getTask(session, TASK_ID)).rejects.toMatchObject({ code: -32602 });
  });

  it("parses a one-shot SSE response body", async () => {
    mswServer.use(
      http.post(ENDPOINT, async ({ request }) => {
        const rpc = RpcRequestSchema.parse(await request.json());
        const message = JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          result: { ...completed({ ok: true }), resultType: "complete" },
        });
        const body = `event: message\ndata: ${message}\n\n`;
        return new HttpResponse(body, {
          headers: { "content-type": "text/event-stream" },
        });
      }),
    );

    const task = await getTask(session, TASK_ID);
    expect(task.status).toBe("completed");
  });
});

describe("updateTask", () => {
  it("answers input_required with Mcp-Name: <taskId> and passes inputResponses through", async () => {
    fake.script(TASK_ID, [inputRequired()]);
    const responses: InputResponses = {
      "elicit-1": { action: "accept", content: { confirmed: true } },
    };

    const ack = await updateTask(session, TASK_ID, responses);

    expect(ack).toEqual({ resultType: "complete" });
    const recorded = fake.requests.at(0);
    expect(recorded?.method).toBe("tasks/update");
    expect(recorded?.headers["mcp-method"]).toBe("tasks/update");
    expect(recorded?.headers["mcp-name"]).toBe(TASK_ID);
    expect(recorded?.params["taskId"]).toBe(TASK_ID);
    expect(recorded?.params["inputResponses"]).toEqual(responses);
  });

  it("transitions the task back to working, observable on the next tasks/get poll", async () => {
    fake.script(TASK_ID, [inputRequired()]);
    const before = await getTask(session, TASK_ID);
    expect(before.status).toBe("input_required");

    await updateTask(session, TASK_ID, { "elicit-1": { action: "accept", content: {} } });

    const after = await getTask(session, TASK_ID);
    expect(after.status).toBe("working");
  });

  it("surfaces the server's rejection when the task is not awaiting input", async () => {
    fake.script(TASK_ID, [working()]);

    await expect(updateTask(session, TASK_ID, { "elicit-1": {} })).rejects.toMatchObject({
      code: -32602,
    });
  });

  it("rejects malformed inputResponses before anything reaches the wire", async () => {
    fake.script(TASK_ID, [inputRequired()]);
    const malformed = { "elicit-1": "yes" } as unknown as InputResponses;

    await expect(updateTask(session, TASK_ID, malformed)).rejects.toThrow();
    expect(fake.requests).toHaveLength(0);
  });
});

/** Test sleep: records the requested delay and resolves immediately. */
const immediateSleep = (delays: number[]) => (ms: number) => {
  delays.push(ms);
  return Promise.resolve();
};

describe("pollTaskUntilTerminal", () => {
  it("polls working -> completed, honoring pollIntervalMs, and returns the inlined result", async () => {
    fake.script(TASK_ID, [
      working({ pollIntervalMs: 300 }),
      working({ pollIntervalMs: 700, lastUpdatedAt: "2026-08-20T10:00:03Z" }),
      completed({ content: [{ type: "text", text: "42" }] }),
    ]);
    const delays: number[] = [];
    const seen: string[] = [];

    const final = await pollTaskUntilTerminal(session, TASK_ID, {
      sleep: immediateSleep(delays),
      onUpdate: (task) => seen.push(task.status),
    });

    expect(seen).toEqual(["working", "working", "completed"]);
    expect(delays).toEqual([300, 700]);
    if (final.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(final.result).toEqual({ content: [{ type: "text", text: "42" }] });
  });

  it("returns the failed state with the JSON-RPC error inlined", async () => {
    fake.script(TASK_ID, [working(), failed({ code: -32603, message: "exploded" })]);

    const final = await pollTaskUntilTerminal(session, TASK_ID, {
      sleep: immediateSleep([]),
    });

    if (final.status !== "failed") {
      throw new Error("expected failed");
    }
    expect(final.error).toEqual({ code: -32603, message: "exploded" });
  });

  it("observes cancellation after tasks/cancel", async () => {
    fake.script(TASK_ID, [working()]);

    const ack = await cancelTask(session, TASK_ID);
    expect(ack).toEqual({ resultType: "complete" });
    const cancelRequest = fake.requests.at(0);
    expect(cancelRequest?.headers["mcp-method"]).toBe("tasks/cancel");
    expect(cancelRequest?.headers["mcp-name"]).toBe(TASK_ID);

    const final = await pollTaskUntilTerminal(session, TASK_ID, {
      sleep: immediateSleep([]),
    });
    expect(final.status).toBe("cancelled");
  });

  it("gives up after maxPolls instead of polling forever", async () => {
    fake.script(TASK_ID, [working()]);

    await expect(
      pollTaskUntilTerminal(session, TASK_ID, { sleep: immediateSleep([]), maxPolls: 3 }),
    ).rejects.toThrowError(TaskLaneError);
    expect(fake.requests).toHaveLength(3);
  });
});

describe("nextPollDelayMs", () => {
  it("defaults when the server gives no hint", () => {
    expect(nextPollDelayMs({})).toBe(DEFAULT_POLL_INTERVAL_MS);
  });

  it("honors the server's hint", () => {
    expect(nextPollDelayMs({ pollIntervalMs: 750 })).toBe(750);
  });

  it("clamps hints to sane bounds", () => {
    expect(nextPollDelayMs({ pollIntervalMs: 0 })).toBe(MIN_POLL_INTERVAL_MS);
    expect(nextPollDelayMs({ pollIntervalMs: 10_000_000 })).toBe(MAX_POLL_INTERVAL_MS);
  });

  it("lets the override win over the hint and the default", () => {
    expect(nextPollDelayMs({ pollIntervalMs: 5000 }, 500)).toBe(500);
    expect(nextPollDelayMs({}, 1000)).toBe(1000);
  });

  it("clamps the override to the same bounds", () => {
    expect(nextPollDelayMs({ pollIntervalMs: 5000 }, 1)).toBe(MIN_POLL_INTERVAL_MS);
    expect(nextPollDelayMs({}, 10_000_000)).toBe(MAX_POLL_INTERVAL_MS);
  });

  it("falls back to the hint when the override is cleared or unusable", () => {
    expect(nextPollDelayMs({ pollIntervalMs: 750 }, undefined)).toBe(750);
    expect(nextPollDelayMs({ pollIntervalMs: 750 }, Number.NaN)).toBe(750);
  });
});

describe("taskChangeKey", () => {
  const task = {
    taskId: TASK_ID,
    status: "working",
    createdAt: "2026-08-20T10:00:00Z",
    lastUpdatedAt: "2026-08-20T10:00:01Z",
    ttlMs: null,
  } as const;

  it("is stable for unchanged state and changes with status or message", () => {
    expect(taskChangeKey({ ...task })).toBe(taskChangeKey({ ...task }));
    expect(taskChangeKey({ ...task, statusMessage: "still going" })).not.toBe(
      taskChangeKey({ ...task }),
    );
    expect(taskChangeKey({ ...task, lastUpdatedAt: "2026-08-20T10:00:02Z" })).not.toBe(
      taskChangeKey({ ...task }),
    );
  });
});

describe("encodeMcpHeaderValue", () => {
  it("passes UUID-style task ids through unencoded", () => {
    expect(encodeMcpHeaderValue(TASK_ID)).toBe(TASK_ID);
  });

  it("wraps empty, padded, and non-ASCII values in the base64 sentinel", () => {
    expect(encodeMcpHeaderValue("")).toBe("=?base64??=");
    expect(encodeMcpHeaderValue(" padded ")).toBe(`=?base64?${btoa(" padded ")}?=`);
    expect(encodeMcpHeaderValue("tâche")).toMatch(/^=\?base64\?.+\?=$/);
  });

  it("re-wraps values already matching the sentinel to avoid ambiguity", () => {
    const ambiguous = "=?base64?aGk=?=";
    expect(encodeMcpHeaderValue(ambiguous)).toBe(`=?base64?${btoa(ambiguous)}?=`);
  });
});

describe("buildTaskLaneHeaders", () => {
  it("omits session and auth headers when the session has neither", () => {
    const headers = buildTaskLaneHeaders(
      { url: ENDPOINT, protocolVersion: PROTOCOL_VERSION },
      "tasks/get",
      TASK_ID,
    );
    expect(headers).toEqual({
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-method": "tasks/get",
      "mcp-name": TASK_ID,
      "mcp-protocol-version": PROTOCOL_VERSION,
    });
  });
});

describe("extractJsonRpcFromSse", () => {
  it("finds the response with the matching id across events", () => {
    const body = [
      'event: message\ndata: {"jsonrpc":"2.0","id":"other","result":{}}',
      'event: message\ndata: {"jsonrpc":"2.0","id":"wanted","result":{"ok":true}}',
    ].join("\n\n");
    expect(extractJsonRpcFromSse(body, "wanted")).toEqual({
      jsonrpc: "2.0",
      id: "wanted",
      result: { ok: true },
    });
  });

  it("joins multi-line data fields and ignores non-JSON events", () => {
    const body = 'data: not json\n\ndata: {"jsonrpc":"2.0",\ndata: "id":"x","result":{}}\n\n';
    expect(extractJsonRpcFromSse(body, "x")).toEqual({ jsonrpc: "2.0", id: "x", result: {} });
  });

  it("returns undefined when no event matches", () => {
    expect(extractJsonRpcFromSse("data: {}\n\n", "missing")).toBeUndefined();
  });
});
