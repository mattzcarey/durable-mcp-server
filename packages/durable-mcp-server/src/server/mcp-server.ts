/**
 * The additive `McpServer` subclass: one new method, `registerTask` (docs/how-it-works.md
 * §4.2). Tasks feel native — same registration shape as `registerTool`.
 *
 * The registered tool's wire handler (decision D3, path A) rides the SDK's
 * `registerTool` seam WITHOUT an `outputSchema`: the 2026 encode seam passes
 * `resultType: "task"` through verbatim for `tools/call`, so the handler can
 * answer a flat `CreateTaskResult` — locked by the D3 wire test. Handler
 * behavior per request:
 *
 * 1. Client did not declare the tasks extension on this request → the call
 *    is refused (decision D4, no synchronous fallback in v1). The
 *    spec-mandated `-32021` + HTTP 400 rejection is enforced by the
 *    front-door router BEFORE the SDK (`createTasksRouter` claims a modern
 *    `tools/call` of a registered task tool from a non-declaring client):
 *    the SDK's own tools/call dispatch converts every handler throw into an
 *    `isError` tool result (verified against 2.0.0 dist — only
 *    `UrlElicitationRequired` is re-thrown), so the handler-level throw here
 *    is defense-in-depth for hosts mounted without the router, where it
 *    degrades to an `isError` result carrying the same message.
 * 2. Otherwise: `taskId = crypto.randomUUID()`, `await TaskRunner.create`
 *    through the retry wrapper (strong consistency at creation — the tool
 *    call answers only after the DO write commits; a create failure surfaces
 *    as `-32603`, never an unfindable task), then the flat `CreateTaskResult`.
 *
 * The TaskRunner namespace is injected per request by this package's
 * `createMcpHandler` (`configureTaskRunner`); when the server is mounted
 * through the OFFICIAL SDK handler instead (the `createTasksRouter`
 * composition), the handler falls back to the default `TASK_RUNNER` binding
 * via `import { env } from "cloudflare:workers"`.
 */

import {
  CLIENT_CAPABILITIES_META_KEY,
  McpServer as SdkMcpServer,
  MissingRequiredClientCapabilityError,
  type CallToolResult,
  type Implementation,
  // The SDK's per-request tool-handler context (its exported name; aliased so
  // no home-grown context-object type is ever mistaken for it).
  type ServerContext as SdkToolContext,
  type ServerOptions,
  type StandardSchemaWithJSON,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import { env as workerEnv } from "cloudflare:workers";
import type { TaskRunner } from "../do/task-runner";
import { callTaskRunner } from "../engine/call-task-runner";
import { DEFAULT_POLL_INTERVAL_MS, DEFAULT_RETRY_POLICY, DEFAULT_TTL_MS } from "../engine/defaults";
import { DEFAULT_TASK_RUNNER_BINDING } from "../handler/bindings";
import type { RetryPolicy, Step } from "../step/types";
import { TASKS_EXTENSION_ID } from "../wire/types";
import type { CreateTaskResult } from "../wire/types";

/** The validated input type a task handler receives for its input schema. */
export type TaskInput<In> =
  In extends StandardSchemaWithJSON<unknown, infer Output> ? Output : undefined;

/**
 * A task handler: receives the validated tool input and the replay-aware
 * {@link Step} API, and returns the `CallToolResult` that `tasks/get` will
 * inline once the task completes. A throwing handler completes the task with
 * an `isError: true` result (docs/how-it-works.md §7 (the wire contract served) — `failed` is reserved for
 * engine/protocol errors).
 */
export type TaskHandler<In extends StandardSchemaWithJSON | undefined = undefined> = (
  input: TaskInput<In>,
  step: Step,
) => Promise<CallToolResult>;

/** Configuration for {@link McpServer.registerTask}. */
export interface TaskConfig<In extends StandardSchemaWithJSON | undefined = undefined> {
  title?: string;
  description?: string;
  /** zod v4 object (or any Standard Schema with JSON), same as `registerTool`. */
  inputSchema?: In;
  annotations?: ToolAnnotations;
  /**
   * Forbidden: an `outputSchema` breaks the `CreateTaskResult` wire path
   * (docs/how-it-works.md §7 (the wire contract served)). Enforced at compile time (`never`) and at runtime.
   */
  outputSchema?: never;
  /** Task retention from creation, ms; `null` = unlimited. Default 86_400_000 (24h). */
  ttlMs?: number | null;
  /** Suggested client polling interval, ms. Default 5_000. */
  pollIntervalMs?: number;
  /** Default step retry policy for this task. */
  retries?: RetryPolicy;
}

/** Handle returned by {@link McpServer.registerTask}. */
export interface RegisteredTask {
  enable(): void;
  disable(): void;
  remove(): void;
}

/** @internal Type-erased handler stored in the registration table. */
export type AnyTaskHandler = (input: unknown, step: Step) => Promise<CallToolResult>;

/** @internal A resolved task registration (defaults applied). */
export interface TaskRegistration {
  name: string;
  ttlMs: number | null;
  pollIntervalMs: number;
  retries: Required<RetryPolicy>;
  inputSchema: StandardSchemaWithJSON | undefined;
  handler: AnyTaskHandler;
}

/** Whether this request's `_meta` envelope declared the tasks extension. */
const declaredTasksExtension = (ctx: SdkToolContext): boolean => {
  const envelope = ctx?.mcpReq?.envelope as Record<string, unknown> | undefined;
  const capabilities = envelope?.[CLIENT_CAPABILITIES_META_KEY];
  if (capabilities === null || typeof capabilities !== "object") {
    return false;
  }
  const extensions = (capabilities as Record<string, unknown>)["extensions"];
  return extensions !== null && typeof extensions === "object" && TASKS_EXTENSION_ID in extensions;
};

export class McpServer extends SdkMcpServer {
  readonly #taskRegistrations = new Map<string, TaskRegistration>();
  readonly #serverInfo: Implementation;
  #taskRunnerNamespace: DurableObjectNamespace<TaskRunner> | undefined;

  constructor(serverInfo: Implementation, options?: ServerOptions) {
    super(serverInfo, options);
    this.#serverInfo = serverInfo;
  }

  /** @internal The implementation info, for serverInfo `_meta` stamping. */
  get taskServerInfo(): Implementation {
    return this.#serverInfo;
  }

  /**
   * @internal Injects the TaskRunner namespace the task-tool wire handler
   * creates tasks in. Called per request by this package's `createMcpHandler`;
   * without it, the handler falls back to the default `TASK_RUNNER` binding
   * from the `cloudflare:workers` module-level `env`.
   */
  configureTaskRunner(namespace: DurableObjectNamespace<TaskRunner>): void {
    this.#taskRunnerNamespace = namespace;
  }

  /**
   * Registers a durable task. The task is advertised as a normal tool (no
   * `outputSchema`); a `tools/call` from a client that declared the tasks
   * extension returns a `CreateTaskResult` immediately while the handler runs
   * to completion on the TaskRunner Durable Object.
   */
  registerTask<In extends StandardSchemaWithJSON | undefined = undefined>(
    name: string,
    config: TaskConfig<In>,
    handler: TaskHandler<In>,
  ): RegisteredTask {
    if ("outputSchema" in config && config.outputSchema !== undefined) {
      throw new TypeError(
        `registerTask("${name}"): outputSchema is not supported — ` +
          `it breaks the CreateTaskResult wire path (docs/how-it-works.md §7 (the wire contract served))`,
      );
    }
    if (this.#taskRegistrations.has(name)) {
      throw new Error(`Task "${name}" is already registered`);
    }

    const registration: TaskRegistration = {
      name,
      ttlMs: config.ttlMs === undefined ? DEFAULT_TTL_MS : config.ttlMs,
      pollIntervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      retries: {
        limit: config.retries?.limit ?? DEFAULT_RETRY_POLICY.limit,
        baseDelayMs: config.retries?.baseDelayMs ?? DEFAULT_RETRY_POLICY.baseDelayMs,
        maxDelayMs: config.retries?.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs,
      },
      inputSchema: config.inputSchema,
      handler: handler as AnyTaskHandler,
    };

    const sdkConfig: {
      title?: string;
      description?: string;
      inputSchema?: StandardSchemaWithJSON;
      annotations?: ToolAnnotations;
    } = {
      title: config.title,
      description: config.description,
      inputSchema: config.inputSchema,
      annotations: config.annotations,
    };
    // The SDK invokes the callback as (args, ctx) when an inputSchema is
    // registered and as (ctx) otherwise; one wire handler covers both.
    const hasInput = config.inputSchema !== undefined;
    const wireHandler = (first: unknown, second?: unknown): Promise<CallToolResult> => {
      const ctx = (hasInput ? second : first) as SdkToolContext;
      const input = hasInput ? first : undefined;
      return this.#createTask(registration, input, ctx);
    };
    const tool = this.registerTool(name, sdkConfig, wireHandler);

    this.#taskRegistrations.set(name, registration);

    // Advertise the extension only when at least one task exists (D10).
    if (this.#taskRegistrations.size === 1) {
      this.server.registerCapabilities({ extensions: { [TASKS_EXTENSION_ID]: {} } });
    }

    return {
      enable: () => tool.enable(),
      disable: () => tool.disable(),
      remove: () => {
        this.#taskRegistrations.delete(name);
        tool.remove();
      },
    };
  }

  /** @internal Resolved registration for the executor and wire handler. */
  getTaskRegistration(name: string): TaskRegistration | undefined {
    return this.#taskRegistrations.get(name);
  }

  /** @internal Number of currently registered tasks. */
  get taskCount(): number {
    return this.#taskRegistrations.size;
  }

  /** @internal The registered task tool names, for the front-door router. */
  get taskNames(): string[] {
    return [...this.#taskRegistrations.keys()];
  }

  // ------------------------------------------------------------ internals --

  #resolveTaskRunnerNamespace(): DurableObjectNamespace<TaskRunner> {
    if (this.#taskRunnerNamespace !== undefined) {
      return this.#taskRunnerNamespace;
    }
    const fallback = (workerEnv as unknown as Record<string, unknown>)[DEFAULT_TASK_RUNNER_BINDING];
    if (fallback !== undefined && fallback !== null) {
      return fallback as DurableObjectNamespace<TaskRunner>;
    }
    throw new Error(
      `McpServer cannot reach the task store: no TaskRunner namespace was configured and ` +
        `no "${DEFAULT_TASK_RUNNER_BINDING}" Durable Object binding exists`,
    );
  }

  /** The task-tool wire handler (docs/how-it-works.md §2 (the three layers) and §7 (wire contract)). */
  async #createTask(
    registration: TaskRegistration,
    input: unknown,
    ctx: SdkToolContext,
  ): Promise<CallToolResult> {
    if (!declaredTasksExtension(ctx)) {
      // Decision D4: hard refusal, no synchronous fallback — durable tasks
      // are long-running by nature. Primary -32021/400 enforcement lives in
      // the front-door router; this throw is defense-in-depth (the SDK's
      // dispatch surfaces it as an isError tool result).
      throw new MissingRequiredClientCapabilityError(
        { requiredCapabilities: { extensions: { [TASKS_EXTENSION_ID]: {} } } },
        `Tool "${registration.name}" executes as a durable task; the request must declare the ` +
          `"${TASKS_EXTENSION_ID}" extension capability`,
      );
    }
    const namespace = this.#resolveTaskRunnerNamespace();
    const taskId = crypto.randomUUID(); // unguessable bearer handle, header-safe
    const authKey = ctx.http?.authInfo?.clientId; // opportunistic binding (D12)
    const snapshot = await callTaskRunner(namespace, taskId, (stub) =>
      stub.create({
        taskId,
        toolName: registration.name,
        input,
        ttlMs: registration.ttlMs,
        pollIntervalMs: registration.pollIntervalMs,
        ...(authKey !== undefined && { authKey }),
      }),
    );
    const result: CreateTaskResult = { resultType: "task", ...snapshot };
    // D3 path A: cast through the sanctioned encode-seam hole; the wire test
    // locks the resulting bytes against SDK upgrades.
    return result as unknown as CallToolResult;
  }
}
