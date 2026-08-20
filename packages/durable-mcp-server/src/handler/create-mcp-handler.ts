/**
 * `createMcpHandler` — the recommended one-line fetch entry (docs/how-it-works.md §2 (the three layers) and §7 (wire contract), as
 * amended 2026-08-21): the tasks front-door router composed in front of the
 * OFFICIAL `createMcpHandler` from `@modelcontextprotocol/server`.
 *
 * ```ts
 * import { createMcpHandler } from "durable-mcp-server";
 * export default createMcpHandler(createServer);
 * ```
 *
 * Per request: `Mcp-Method ∈ {tasks/get, tasks/update, tasks/cancel}` (with
 * body-parse fallback) routes straight to the TaskRunner DO — never touching
 * the SDK — and everything else falls through to a per-request SDK handler
 * built from `createServer()` bare (user code needing bindings imports `env`
 * from `cloudflare:workers`; this wrapper's own `fetch(request, env, ctx)`
 * params remain how the library itself reaches TASK_RUNNER).
 *
 * Users with an existing fetch handler (or an agents-SDK host) compose by
 * hand with {@link createTasksRouter} instead — see that module.
 */

import {
  createMcpHandler as sdkCreateMcpHandler,
  type CreateMcpHandlerOptions as SdkCreateMcpHandlerOptions,
} from "@modelcontextprotocol/server";
import type { TaskRunner } from "../do/task-runner";
import type { CreateServer } from "../server/create-server";
import { DEFAULT_TASK_RUNNER_BINDING } from "./bindings";
import type { TaskBindingsOptions } from "./bindings";
import { createTasksRouter } from "./tasks-router";

/** Options for {@link createMcpHandler}. */
export interface DurableMcpHandlerOptions {
  bindings?: TaskBindingsOptions;
  /** Passed through to the SDK handler (`legacy`, `responseMode`, `onerror`, ...). */
  sdk?: SdkCreateMcpHandlerOptions;
}

/**
 * Wraps a server factory into a Workers `ExportedHandler`: the tasks router
 * first (docs/how-it-works.md §4(h) (tasks/get through the router)), then the official SDK handler constructed inside
 * `fetch` — the SDK never sees Workers `env`/`ctx`, so per-request
 * construction is the only way to thread the TaskRunner namespace into the
 * task-tool wire handler (it is also the SDK's own model; construction is
 * cheap).
 */
export function createMcpHandler<Env = unknown>(
  createServer: CreateServer,
  options?: DurableMcpHandlerOptions,
): ExportedHandler<Env> {
  const tasks = createTasksRouter(createServer, options);
  const taskRunnerBinding = options?.bindings?.taskRunner ?? DEFAULT_TASK_RUNNER_BINDING;
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const routed = await tasks.fetch(request, env, ctx);
      if (routed !== null) {
        return routed;
      }
      const handler = sdkCreateMcpHandler(() => {
        const server = createServer();
        const bindings = env as Record<string, unknown>;
        const namespace = bindings[taskRunnerBinding];
        if (namespace !== undefined && namespace !== null) {
          server.configureTaskRunner(namespace as DurableObjectNamespace<TaskRunner>);
        }
        return server;
      }, options?.sdk);
      return handler.fetch(request);
    },
  };
}
