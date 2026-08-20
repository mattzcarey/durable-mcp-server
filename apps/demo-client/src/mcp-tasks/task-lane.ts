/**
 * Raw JSON-RPC lane for the MCP Tasks extension (current draft).
 *
 * The installed MCP SDK (2.0.0) cannot speak this draft: its era gate refuses
 * `tasks/get` / `tasks/cancel` toward a 2026-era peer, its result decoder
 * rejects `resultType: "task"` (discarding the taskId), and its transport can
 * never emit the `Mcp-Name: <taskId>` header the draft REQUIRES on task
 * methods. So every task leg — the initiating task-augmented `tools/call`
 * included — goes over plain `fetch`, REUSING the SDK connection's negotiated
 * endpoint URL, session id, protocol version, and OAuth token.
 *
 * Wire behavior follows https://github.com/modelcontextprotocol/ext-tasks
 * `specification/draft/tasks.md` @ dcc8d2bbecd50397901558dd66f46050c5b21de3
 * (see ./schema for the vendored shapes) plus the SEP-2243 header
 * conventions the draft builds on (Mcp-Method on every request, Mcp-Name,
 * and the `=?base64?…?=` sentinel encoding for non-ASCII header values).
 */
import { z } from "zod";
import {
  type CreateTaskResult,
  CreateTaskResultSchema,
  type DetailedTask,
  GetTaskResultSchema,
  type InputResponses,
  InputResponsesSchema,
  isTerminalStatus,
  type TaskAckResult,
  TaskAckResultSchema,
  TASKS_EXTENSION_ID,
} from "./schema";

/* Base-protocol `_meta` envelope keys (2026-era requests MUST carry both). */
export const PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion";
export const CLIENT_CAPABILITIES_META_KEY = "io.modelcontextprotocol/clientCapabilities";

/**
 * Everything the lane needs from the live SDK connection. Built by the agent
 * from the `agents` MCPClientConnection public surface — `conn.url`,
 * `conn.protocolVersion`, `conn.sessionId`, and
 * `conn.options.transport.authProvider?.tokens()`.
 */
export type TaskLaneSession = {
  /** Absolute URL of the server's Streamable HTTP endpoint. */
  url: string;
  /** The protocol version the SDK client negotiated (e.g. "2026-07-28"). */
  protocolVersion: string;
  /** Streamable HTTP session id, when the server issued one. */
  sessionId?: string;
  /** OAuth bearer token, when the connection is authenticated. */
  accessToken?: string;
};

/** Minimal structural fetch so tests and Workers both fit without casts. */
type MinimalResponse = {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};
export type TaskLaneFetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<MinimalResponse>;

const defaultFetch: TaskLaneFetch = (url, init) => fetch(url, init);

/** A task-lane request failed: HTTP-level, JSON-RPC error, or malformed body. */
export class TaskLaneError extends Error {
  /** JSON-RPC error code, when the failure was a JSON-RPC error response. */
  readonly code?: number;
  /** HTTP status, when the failure was at the HTTP level. */
  readonly status?: number;
  readonly data?: unknown;

  constructor(message: string, details: { code?: number; status?: number; data?: unknown } = {}) {
    super(message);
    this.name = "TaskLaneError";
    if (details.code !== undefined) {
      this.code = details.code;
    }
    if (details.status !== undefined) {
      this.status = details.status;
    }
    if (details.data !== undefined) {
      this.data = details.data;
    }
  }
}

/**
 * SEP-2243 header value encoding: plain ASCII field values pass through;
 * anything empty, padded, non-printable, non-ASCII, or already matching the
 * sentinel is wrapped as `=?base64?{b64-of-utf8}?=`. (UUID task ids pass
 * through unencoded.)
 */
export function encodeMcpHeaderValue(value: string): string {
  return needsBase64Sentinel(value) ? `=?base64?${utf8ToBase64(value)}?=` : value;
}

function needsBase64Sentinel(value: string): boolean {
  if (value.length === 0) {
    return true;
  }
  if (value.startsWith("=?base64?") && value.endsWith("?=")) {
    return true;
  }
  if (value !== value.trim()) {
    return true;
  }
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const printableAscii = code === 9 || (code >= 32 && code <= 126);
    if (!printableAscii) {
      return true;
    }
  }
  return false;
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
}

/**
 * The `_meta` envelope every 2026-era request must carry, declaring the tasks
 * extension per request (the draft has no initialize-time tasks capability).
 */
export function taskEnvelopeMeta(protocolVersion: string): Record<string, unknown> {
  return {
    [PROTOCOL_VERSION_META_KEY]: protocolVersion,
    [CLIENT_CAPABILITIES_META_KEY]: {
      extensions: { [TASKS_EXTENSION_ID]: {} },
    },
  };
}

/**
 * Headers for one task-lane request. `mcpName` is the SEP-2243 routing value:
 * the draft REQUIRES `Mcp-Name: <taskId>` on tasks/get|update|cancel, and the
 * base conventions put the tool name there on `tools/call`.
 */
export function buildTaskLaneHeaders(
  session: TaskLaneSession,
  method: string,
  mcpName: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-method": method,
    "mcp-name": encodeMcpHeaderValue(mcpName),
    "mcp-protocol-version": session.protocolVersion,
  };
  if (session.sessionId !== undefined) {
    headers["mcp-session-id"] = session.sessionId;
  }
  if (session.accessToken !== undefined) {
    headers.authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
}

const JsonRpcSuccessSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: z.record(z.string(), z.unknown()),
});

const JsonRpcErrorSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
});

const JsonRpcResponseSchema = z.union([JsonRpcSuccessSchema, JsonRpcErrorSchema]);

/**
 * Extracts the JSON-RPC response with the given id from a one-shot SSE body
 * (Streamable HTTP servers may answer a POST with a short event stream).
 */
export function extractJsonRpcFromSse(body: string, id: string): unknown {
  for (const event of body.split(/\r?\n\r?\n/)) {
    const dataLines = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());
    if (dataLines.length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(dataLines.join("\n"));
    } catch {
      continue;
    }
    if (typeof parsed === "object" && parsed !== null && "id" in parsed && parsed.id === id) {
      return parsed;
    }
  }
  return undefined;
}

/** POSTs one JSON-RPC request and returns the validated `result` object. */
async function sendTaskLaneRequest(
  session: TaskLaneSession,
  method: string,
  params: Record<string, unknown>,
  mcpName: string,
  fetchImpl: TaskLaneFetch,
): Promise<Record<string, unknown>> {
  const id = crypto.randomUUID();
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    params: { ...params, _meta: taskEnvelopeMeta(session.protocolVersion) },
  });
  const response = await fetchImpl(session.url, {
    method: "POST",
    headers: buildTaskLaneHeaders(session, method, mcpName),
    body,
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  let message: unknown;
  if (contentType.includes("text/event-stream")) {
    message = extractJsonRpcFromSse(text, id);
  } else if (contentType.includes("json")) {
    try {
      message = JSON.parse(text);
    } catch {
      message = undefined;
    }
  }
  if (message === undefined) {
    throw new TaskLaneError(
      `${method} to ${session.url} returned HTTP ${response.status} with no JSON-RPC response`,
      { status: response.status },
    );
  }

  const parsed = JsonRpcResponseSchema.safeParse(message);
  if (!parsed.success) {
    throw new TaskLaneError(`${method} returned a malformed JSON-RPC response`, {
      status: response.status,
    });
  }
  if ("error" in parsed.data) {
    const { error } = parsed.data;
    throw new TaskLaneError(`${method} failed: ${error.message} (code ${error.code})`, {
      code: error.code,
      data: error.data,
    });
  }
  return parsed.data.result;
}

/**
 * Outcome of a task-augmented tool call: the server either created a task
 * (`resultType: "task"`) or, being free to ignore the capability, answered
 * with the ordinary tool result.
 */
export type ToolCallOutcome =
  | { kind: "task"; task: CreateTaskResult }
  | { kind: "result"; result: Record<string, unknown> };

/**
 * Sends `tools/call` with the tasks extension declared in the per-request
 * `_meta` capability envelope. Task creation is entirely server-directed —
 * there is no per-request task param or TTL knob in the current draft.
 */
export async function callToolAsTask(
  session: TaskLaneSession,
  name: string,
  args: Record<string, unknown>,
  fetchImpl: TaskLaneFetch = defaultFetch,
): Promise<ToolCallOutcome> {
  const result = await sendTaskLaneRequest(
    session,
    "tools/call",
    { name, arguments: args },
    name,
    fetchImpl,
  );
  if (result.resultType === "task") {
    return { kind: "task", task: CreateTaskResultSchema.parse(result) };
  }
  return { kind: "result", result };
}

/** `tasks/get`: current task state, with terminal results/errors inlined. */
export async function getTask(
  session: TaskLaneSession,
  taskId: string,
  fetchImpl: TaskLaneFetch = defaultFetch,
): Promise<DetailedTask> {
  const result = await sendTaskLaneRequest(session, "tasks/get", { taskId }, taskId, fetchImpl);
  return GetTaskResultSchema.parse(result);
}

/**
 * `tasks/update`: answers the outstanding inputRequests of an
 * `input_required` task (each key MUST match a currently-outstanding
 * inputRequest key from `tasks/get`). Returns the empty ack; the task's
 * transition back to `working` shows up on the next `tasks/get` poll.
 */
export async function updateTask(
  session: TaskLaneSession,
  taskId: string,
  inputResponses: InputResponses,
  fetchImpl: TaskLaneFetch = defaultFetch,
): Promise<TaskAckResult> {
  const result = await sendTaskLaneRequest(
    session,
    "tasks/update",
    { taskId, inputResponses: InputResponsesSchema.parse(inputResponses) },
    taskId,
    fetchImpl,
  );
  return TaskAckResultSchema.parse(result);
}

/** `tasks/cancel`: an empty ack — cancellation is cooperative and eventual. */
export async function cancelTask(
  session: TaskLaneSession,
  taskId: string,
  fetchImpl: TaskLaneFetch = defaultFetch,
): Promise<TaskAckResult> {
  const result = await sendTaskLaneRequest(session, "tasks/cancel", { taskId }, taskId, fetchImpl);
  return TaskAckResultSchema.parse(result);
}

/* Polling */

export const DEFAULT_POLL_INTERVAL_MS = 2000;
export const MIN_POLL_INTERVAL_MS = 250;
export const MAX_POLL_INTERVAL_MS = 60_000;
const DEFAULT_MAX_POLLS = 1000;

const clampPollDelay = (ms: number): number =>
  Math.min(Math.max(ms, MIN_POLL_INTERVAL_MS), MAX_POLL_INTERVAL_MS);

/**
 * Next delay before re-polling `tasks/get`: honors the server's
 * `pollIntervalMs` hint (SHOULD, per the draft), clamped to sane bounds.
 * `overrideMs` is the client-side poll-rate override: when set it wins over
 * the hint (still clamped to the same bounds); clearing it falls back to the
 * server's hint.
 */
export function nextPollDelayMs(task: { pollIntervalMs?: number }, overrideMs?: number): number {
  if (overrideMs !== undefined && Number.isFinite(overrideMs)) {
    return clampPollDelay(overrideMs);
  }
  const hint = task.pollIntervalMs;
  if (hint === undefined || !Number.isFinite(hint)) {
    return DEFAULT_POLL_INTERVAL_MS;
  }
  return clampPollDelay(hint);
}

/**
 * Change key for status broadcasts: two polls with the same key carry no new
 * information, so the caller can skip re-broadcasting.
 */
export function taskChangeKey(task: DetailedTask): string {
  return `${task.status}\n${task.lastUpdatedAt}\n${task.statusMessage ?? ""}`;
}

export type PollTaskOptions = {
  /** Called with every polled state (including the terminal one). */
  onUpdate?: (task: DetailedTask) => void;
  /** Injected for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: TaskLaneFetch;
  /** Hard cap on tasks/get calls, so a stuck task cannot poll forever. */
  maxPolls?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls `tasks/get` until the task reaches a terminal status (completed,
 * failed, or cancelled) and returns that final state — the result or error
 * is already inlined in it; there is no separate `tasks/result` fetch in the
 * current draft.
 */
export async function pollTaskUntilTerminal(
  session: TaskLaneSession,
  taskId: string,
  options: PollTaskOptions = {},
): Promise<DetailedTask> {
  const sleep = options.sleep ?? defaultSleep;
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const maxPolls = options.maxPolls ?? DEFAULT_MAX_POLLS;
  for (let poll = 0; poll < maxPolls; poll++) {
    const task = await getTask(session, taskId, fetchImpl);
    options.onUpdate?.(task);
    if (isTerminalStatus(task.status)) {
      return task;
    }
    await sleep(nextPollDelayMs(task));
  }
  throw new TaskLaneError(
    `Task ${taskId} did not reach a terminal status within ${maxPolls} polls`,
  );
}
