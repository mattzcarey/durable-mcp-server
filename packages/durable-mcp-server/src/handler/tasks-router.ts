/**
 * `createTasksRouter` — the tasks/* front door (docs/how-it-works.md §4(h) (tasks/get through the router), decision D7):
 * intercepts `Mcp-Method ∈ {tasks/get, tasks/update, tasks/cancel}` (with
 * body-parse fallback when the header is absent) BEFORE any SDK handler and
 * routes straight to the TaskRunner Durable Object — no `McpServer` instance
 * is ever constructed for a poll. Every other request resolves `null` so the
 * caller can fall through to the official `createMcpHandler` from
 * `@modelcontextprotocol/server` (or any fetch-based MCP host):
 *
 * ```ts
 * const tasks = createTasksRouter(createServer);
 * // inside fetch(request, env, ctx):
 * return (await tasks.fetch(request, env, ctx)) ?? existingHandler.fetch(request);
 * ```
 *
 * Wire behavior, per docs/how-it-works.md §7 (the wire contract served)/§3.3:
 * - tasks are served on the modern (2026-07-28) envelope only — legacy-era
 *   tasks/* falls through to the SDK and gets `-32601` (decision D9), as do
 *   the removed `tasks/result` / `tasks/list` vocabulary on both eras (D1);
 * - `Mcp-Name` / body `taskId` cross-check: mismatch → `-32020`, HTTP 400;
 *   `Mcp-Method` / body method mismatch likewise;
 * - per-request client capability check: a tasks/* request — or a modern
 *   `tools/call` of a registered task tool — that does not declare the tasks
 *   extension → `-32021`, HTTP 400 (decision D4; enforced here because the
 *   SDK's tools/call dispatch converts handler throws into isError results);
 * - unknown/expired/purged taskId → `-32602` (in-band, HTTP 200);
 * - success results carry `resultType: "complete"` and stamp
 *   `_meta["io.modelcontextprotocol/serverInfo"]`, matching the SDK's own
 *   HTTP status pairings so the front door looks native.
 */

import {
  CLIENT_CAPABILITIES_META_KEY,
  isLegacyRequest,
  SERVER_INFO_META_KEY,
  type Implementation,
} from "@modelcontextprotocol/server";
import type { DetailedTaskSnapshot, TaskNotFound, TaskRunner } from "../do/task-runner";
import { callTaskRunner } from "../engine/call-task-runner";
import type { CreateServer } from "../server/create-server";
import { TASKS_EXTENSION_ID } from "../wire/types";
import { DEFAULT_TASK_RUNNER_BINDING, type TaskBindingsOptions } from "./bindings";

/** Options for {@link createTasksRouter}. */
export interface TasksRouterOptions {
  bindings?: TaskBindingsOptions;
}

/**
 * The tasks front door: `fetch` resolves a `Response` for the requests it
 * owns and `null` for everything else (fall through to the MCP handler).
 */
export interface TasksRouter {
  fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response | null>;
}

/** The three extension methods the front door owns (docs/how-it-works.md §7 (the wire contract served)). */
const TASK_METHODS = new Set(["tasks/get", "tasks/update", "tasks/cancel"]);

const JSON_RPC_INVALID_PARAMS = -32602;
const JSON_RPC_INTERNAL_ERROR = -32603;
/** SEP-2243 HeaderMismatch. */
const JSON_RPC_HEADER_MISMATCH = -32020;
/** MissingRequiredClientCapability (ext-tasks `index.md`'s -32003 is a doc bug). */
const JSON_RPC_MISSING_CAPABILITY = -32021;

type JsonRpcId = string | number;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Strip RFC 9110 optional whitespace (SP / HTAB) around a header field value. */
const stripHttpOws = (value: string): string => value.replace(/^[ \t]+|[ \t]+$/g, "");

const jsonRpcResponse = (id: JsonRpcId, body: Record<string, unknown>, status: number): Response =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, ...body }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const errorResponse = (
  id: JsonRpcId,
  status: number,
  code: number,
  message: string,
  data?: Record<string, unknown>,
): Response =>
  jsonRpcResponse(id, { error: { code, message, ...(data !== undefined && { data }) } }, status);

const headerMismatch = (id: JsonRpcId, header: string, body: string): Response =>
  errorResponse(
    id,
    400,
    JSON_RPC_HEADER_MISMATCH,
    `Bad Request: the request headers and body disagree: ${body}`,
    { mismatch: { header, body } },
  );

/** Whether the request's `_meta` envelope declares the tasks extension. */
const declaresTasksExtension = (params: Record<string, unknown> | undefined): boolean => {
  const meta = params !== undefined && isRecord(params["_meta"]) ? params["_meta"] : undefined;
  const capabilities = meta?.[CLIENT_CAPABILITIES_META_KEY];
  const extensions = isRecord(capabilities) ? capabilities["extensions"] : undefined;
  return isRecord(extensions) && TASKS_EXTENSION_ID in extensions;
};

interface RouterProbe {
  serverInfo: Implementation;
  hasTasks: boolean;
  taskNames: ReadonlySet<string>;
}

/**
 * Stamps `resultType: "complete"` and the serverInfo `_meta` (docs/how-it-works.md §4(h) (tasks/get through the router)),
 * merged over any `_meta` the snapshot already carries (the engine's
 * package-namespaced keys, e.g. the handler's status meta); serverInfo wins.
 */
const completeResult = (
  base: Record<string, unknown>,
  serverInfo: Implementation,
): Record<string, unknown> => {
  const { _meta: baseMeta, ...rest } = base;
  return {
    ...rest,
    resultType: "complete",
    _meta: { ...(isRecord(baseMeta) ? baseMeta : {}), [SERVER_INFO_META_KEY]: serverInfo },
  };
};

/**
 * Builds the tasks front-door router for a server factory. The factory is
 * probed lazily (once) for the server's implementation info (stamped into
 * `_meta` on every result) and its task registrations — a server with zero
 * registered tasks never advertises the extension (decision D10), so its
 * tasks/* traffic falls through to the SDK's `-32601` unchanged.
 */
export function createTasksRouter(
  createServer: CreateServer,
  options?: TasksRouterOptions,
): TasksRouter {
  const taskRunnerBinding = options?.bindings?.taskRunner ?? DEFAULT_TASK_RUNNER_BINDING;
  let probed: RouterProbe | undefined;
  const probe = (): RouterProbe => {
    if (probed === undefined) {
      const server = createServer();
      probed = {
        serverInfo: server.taskServerInfo,
        hasTasks: server.taskCount > 0,
        taskNames: new Set(server.taskNames),
      };
    }
    return probed;
  };

  return {
    async fetch(request: Request, env: unknown, _ctx: ExecutionContext): Promise<Response | null> {
      if (request.method !== "POST") {
        return null;
      }
      let message: unknown;
      try {
        message = JSON.parse(await request.clone().text());
      } catch {
        return null; // the SDK answers parse errors
      }
      if (!isRecord(message) || typeof message["method"] !== "string") {
        return null; // batches, responses, malformed frames -> SDK
      }
      const bodyMethod = message["method"];
      const rawMethodHeader = request.headers.get("Mcp-Method");
      const methodHeader = rawMethodHeader === null ? undefined : stripHttpOws(rawMethodHeader);
      const params = isRecord(message["params"]) ? message["params"] : undefined;

      // Capability gate for task-tool calls (decision D4): the SDK's own
      // tools/call dispatch converts a handler-thrown -32021 into an isError
      // tool result, so the spec-mandated -32021 + HTTP 400 for a modern
      // non-declaring client is enforced here, before the SDK. Declared
      // clients (and everything else about tools/call) fall through.
      if (bodyMethod === "tools/call") {
        const toolName = params?.["name"];
        if (
          typeof toolName === "string" &&
          probe().taskNames.has(toolName) &&
          !declaresTasksExtension(params) &&
          !(await isLegacyRequest(request, message))
        ) {
          const callId = message["id"];
          if (typeof callId === "string" || typeof callId === "number") {
            return errorResponse(
              callId,
              400,
              JSON_RPC_MISSING_CAPABILITY,
              `Tool "${toolName}" executes as a durable task; the request must declare the "${TASKS_EXTENSION_ID}" extension capability`,
              { requiredCapabilities: { extensions: { [TASKS_EXTENSION_ID]: {} } } },
            );
          }
        }
        return null;
      }

      // Claim the request when either the routing header or the body names a
      // tasks method (body-parse fallback per docs/how-it-works.md §4(h) (tasks/get through the router)).
      const claimed =
        TASK_METHODS.has(bodyMethod) ||
        (methodHeader !== undefined && TASK_METHODS.has(methodHeader));
      if (!claimed || !probe().hasTasks) {
        return null;
      }
      // Tasks ride the modern envelope only (decision D9): legacy-lane
      // traffic falls through and the SDK answers -32601. The predicate runs
      // exactly the SDK's own era classification.
      if (await isLegacyRequest(request, message)) {
        return null;
      }
      const id = message["id"];
      if (typeof id !== "string" && typeof id !== "number") {
        return null; // a tasks notification is not ours to answer
      }

      if (methodHeader !== undefined && methodHeader !== bodyMethod) {
        return headerMismatch(
          id,
          methodHeader,
          `the body names method ${bodyMethod} but the Mcp-Method header names "${methodHeader}"`,
        );
      }

      if (!declaresTasksExtension(params)) {
        return errorResponse(
          id,
          400,
          JSON_RPC_MISSING_CAPABILITY,
          `${bodyMethod} requires the "${TASKS_EXTENSION_ID}" extension capability to be declared in the request's client capabilities`,
          { requiredCapabilities: { extensions: { [TASKS_EXTENSION_ID]: {} } } },
        );
      }

      const taskId = params?.["taskId"];
      if (typeof taskId !== "string" || taskId.length === 0) {
        return errorResponse(
          id,
          200,
          JSON_RPC_INVALID_PARAMS,
          "Invalid params: taskId is required",
        );
      }
      const rawNameHeader = request.headers.get("Mcp-Name");
      if (rawNameHeader !== null && stripHttpOws(rawNameHeader) !== taskId) {
        return headerMismatch(
          id,
          stripHttpOws(rawNameHeader),
          `the body carries params.taskId="${taskId}" but the Mcp-Name header names "${stripHttpOws(rawNameHeader)}"`,
        );
      }
      let inputResponses: Record<string, unknown> | undefined;
      if (bodyMethod === "tasks/update") {
        const raw = params?.["inputResponses"];
        if (!isRecord(raw)) {
          return errorResponse(
            id,
            200,
            JSON_RPC_INVALID_PARAMS,
            "Invalid params: inputResponses must be an object keyed by input-request key",
          );
        }
        inputResponses = raw;
      }

      const namespaceCandidate = isRecord(env) ? env[taskRunnerBinding] : undefined;
      if (namespaceCandidate === undefined || namespaceCandidate === null) {
        return errorResponse(
          id,
          200,
          JSON_RPC_INTERNAL_ERROR,
          `Internal error: no "${taskRunnerBinding}" Durable Object binding`,
        );
      }
      const namespace = namespaceCandidate as DurableObjectNamespace<TaskRunner>;
      // Auth (decision D12): task IDs are unguessable bearer handles. The
      // Workers `fetch` surface carries no verified `authInfo`, so the router
      // polls with no caller key — a task bound to an `auth_key` at creation
      // is deliberately answered `-32602` here (fail closed, no existence
      // leak) rather than served to an unauthenticated poller.
      const callerAuthKey = undefined;

      try {
        switch (bodyMethod) {
          case "tasks/get": {
            const snapshot = await callTaskRunner(
              namespace,
              taskId,
              async (stub): Promise<DetailedTaskSnapshot | TaskNotFound> => {
                const polled = await stub.get(callerAuthKey);
                return polled;
              },
            );
            if ("notFound" in snapshot) {
              return errorResponse(id, 200, JSON_RPC_INVALID_PARAMS, "Task not found");
            }
            return jsonRpcResponse(
              id,
              {
                result: completeResult(
                  snapshot as unknown as Record<string, unknown>,
                  probe().serverInfo,
                ),
              },
              200,
            );
          }
          case "tasks/update": {
            const responses = inputResponses ?? {};
            const outcome = await callTaskRunner(
              namespace,
              taskId,
              async (stub): Promise<DetailedTaskSnapshot | TaskNotFound> => {
                const snapshot = await stub.get(callerAuthKey);
                if (!("notFound" in snapshot)) {
                  await stub.update(responses);
                }
                return snapshot;
              },
            );
            if ("notFound" in outcome) {
              return errorResponse(id, 200, JSON_RPC_INVALID_PARAMS, "Task not found");
            }
            return jsonRpcResponse(id, { result: completeResult({}, probe().serverInfo) }, 200);
          }
          case "tasks/cancel": {
            const outcome = await callTaskRunner(
              namespace,
              taskId,
              async (stub): Promise<DetailedTaskSnapshot | TaskNotFound> => {
                const snapshot = await stub.get(callerAuthKey);
                if (!("notFound" in snapshot)) {
                  await stub.cancel();
                }
                return snapshot;
              },
            );
            if ("notFound" in outcome) {
              return errorResponse(id, 200, JSON_RPC_INVALID_PARAMS, "Task not found");
            }
            return jsonRpcResponse(id, { result: completeResult({}, probe().serverInfo) }, 200);
          }
          default:
            return null;
        }
      } catch (error) {
        void error;
        return errorResponse(id, 200, JSON_RPC_INTERNAL_ERROR, "Internal error");
      }
    },
  };
}
