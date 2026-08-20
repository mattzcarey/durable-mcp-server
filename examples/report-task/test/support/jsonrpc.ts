/**
 * SSE-aware JSON-RPC helpers: real Streamable HTTP POSTs against the example
 * worker's fetch surface (MCP is served at the worker root). The modern
 * (2026-07-28) builder threads the per-request `_meta` envelope and the
 * SEP-2243 routing headers (`Mcp-Method`, `Mcp-Name`) a native client sends.
 * Adapted from apps/task-server/test/support/jsonrpc.ts.
 */

import { SELF } from "cloudflare:test";
import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { TASKS_EXTENSION_ID } from "durable-mcp-server";
import { z } from "zod";

/** MCP lives at the worker root — no path wrapper in this example. */
export const MCP_URL = "http://example.com/";
export const MODERN_PROTOCOL_VERSION = "2026-07-28";

export interface ModernRequestOptions {
  id?: string | number;
  /** Declare the tasks extension in the request's client capabilities. Default true. */
  declareTasks?: boolean;
  /** Override the `Mcp-Method` header; `null` omits it. Default: the JSON-RPC method. */
  mcpMethod?: string | null;
  /**
   * Override the `Mcp-Name` header; `null` omits it. Default: derived from
   * `params.name` (tools/call) or `params.taskId` (tasks/*).
   */
  mcpName?: string | null;
}

/** Builds a modern-envelope JSON-RPC request (2026-07-28). */
export function modernRequest(
  method: string,
  params: Record<string, unknown>,
  options?: ModernRequestOptions,
): Request {
  const declareTasks = options?.declareTasks ?? true;
  const envelope: Record<string, unknown> = {
    [PROTOCOL_VERSION_META_KEY]: MODERN_PROTOCOL_VERSION,
    [CLIENT_CAPABILITIES_META_KEY]: declareTasks
      ? { extensions: { [TASKS_EXTENSION_ID]: {} } }
      : {},
  };
  const meta = params["_meta"];
  const body = {
    jsonrpc: "2.0",
    id: options?.id ?? 1,
    method,
    params: {
      ...params,
      _meta: { ...envelope, ...(typeof meta === "object" && meta !== null ? meta : {}) },
    },
  };
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION,
  });
  const mcpMethod = options?.mcpMethod === undefined ? method : options.mcpMethod;
  if (mcpMethod !== null) {
    headers.set("Mcp-Method", mcpMethod);
  }
  const name = params["name"];
  const taskId = params["taskId"];
  const derivedName =
    typeof name === "string" ? name : typeof taskId === "string" ? taskId : undefined;
  const mcpName = options?.mcpName === undefined ? derivedName : options.mcpName;
  if (mcpName !== null && mcpName !== undefined) {
    headers.set("Mcp-Name", mcpName);
  }
  return new Request(MCP_URL, { method: "POST", headers, body: JSON.stringify(body) });
}

export async function postModern(
  method: string,
  params: Record<string, unknown>,
  options?: ModernRequestOptions,
): Promise<Response> {
  return SELF.fetch(modernRequest(method, params, options));
}

/**
 * Reads a single JSON-RPC message from a Streamable HTTP response: a plain
 * JSON body, or an SSE stream whose last data frame carries the message. The
 * body is always fully consumed.
 */
export async function readJsonRpcResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("Content-Type") ?? "";
  const text = await response.text();
  if (contentType.includes("text/event-stream")) {
    const data = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .filter((line) => line.length > 0)
      .at(-1);
    if (data === undefined) {
      throw new Error(`Expected SSE data in response: ${text}`);
    }
    return JSON.parse(data) as unknown;
  }
  return JSON.parse(text) as unknown;
}

const resultMessageSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: z.record(z.string(), z.unknown()),
});

const errorMessageSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
});

/** Asserts a success message and returns its `result`. */
export function resultOf(message: unknown): Record<string, unknown> {
  return resultMessageSchema.parse(message).result;
}

/** Asserts an error message and returns its `error`. */
export function errorOf(message: unknown): { code: number; message: string; data?: unknown } {
  return errorMessageSchema.parse(message).error;
}

/** POST + read + assert-success in one step. */
export async function callResult(
  method: string,
  params: Record<string, unknown>,
  options?: ModernRequestOptions,
): Promise<Record<string, unknown>> {
  const response = await postModern(method, params, options);
  const message = await readJsonRpcResponse(response);
  if (response.status !== 200) {
    throw new Error(
      `expected 200 for ${method}, got ${response.status}: ${JSON.stringify(message)}`,
    );
  }
  return resultOf(message);
}
