/**
 * durable-mcp-server — MCP Tasks support for stateless MCP servers on
 * Cloudflare Workers, backed by Durable Objects (docs/how-it-works.md).
 *
 * The whole integration is a server factory plus three exports:
 *
 * ```ts
 * export { TaskRunner } from "durable-mcp-server";        // the standardized DO
 * export const TaskExecutor = createTaskEntrypoint(createServer);
 * export default createMcpHandler(createServer);
 * // ...where createServer builds an McpServer and calls server.registerTask(...)
 * ```
 *
 * NOTE: this barrel imports `cloudflare:workers` (via TaskRunner, the
 * executor factory, and the McpServer wire handler's env fallback) and
 * therefore only loads inside workerd.
 */

// The additive McpServer (registerTask) and its types.
export { McpServer } from "./server/mcp-server";
export type {
  RegisteredTask,
  TaskConfig,
  TaskHandler,
  TaskInput,
  TaskRegistration,
} from "./server/mcp-server";
export type { CreateServer } from "./server/create-server";

// The step API.
export type {
  ElicitConfig,
  ElicitOutcome,
  JsonObject,
  JsonSerializable,
  JsonValue,
  RetryPolicy,
  Step,
  StepConfig,
} from "./step/types";
export type { DurationString, DurationUnit } from "./engine/duration";
export { parseDuration } from "./engine/duration";

// The standardized Durable Object and its per-lease step capability.
export { DurableStep, STATUS_META_KEY, STATUS_META_MAX_BYTES, TaskRunner } from "./do/task-runner";
export type {
  CreateTaskInput,
  DetailedTaskSnapshot,
  LooseJsonValue,
  TaskNotFound,
  TaskRunnerEnv,
  TaskSnapshot,
  TaskSnapshotMeta,
} from "./do/task-runner";

// The TaskRunner <-> TaskExecutor protocol.
export { isStaleLeaseError, StaleLeaseError } from "./do/protocol";
export type {
  BeginStepOptions,
  BeginStepResult,
  CheckInputState,
  DurableStepStub,
  ElicitState,
  RunOutcome,
  SleepState,
  StepFailureDisposition,
  TaskExecutorLike,
  TaskInvocation,
} from "./do/protocol";

// The executor entrypoint factory.
export { createTaskEntrypoint } from "./do/task-entrypoint";
export type { TaskExecutorClass, TaskExecutorMethods } from "./do/task-entrypoint";

// The fetch entry: createMcpHandler is the recommended one-liner (tasks
// front door + the official SDK handler); createTasksRouter is the advanced
// escape hatch for composing with an existing fetch handler.
export { createMcpHandler } from "./handler/create-mcp-handler";
export type { DurableMcpHandlerOptions } from "./handler/create-mcp-handler";
export { createTasksRouter } from "./handler/tasks-router";
export type { TasksRouter, TasksRouterOptions } from "./handler/tasks-router";
export {
  DEFAULT_TASK_EXECUTOR_BINDING,
  DEFAULT_TASK_EXECUTOR_ENTRYPOINT,
  DEFAULT_TASK_RUNNER_BINDING,
} from "./handler/bindings";
export type { TaskBindingsOptions } from "./handler/bindings";

// Reliability helpers and the error taxonomy.
export { callTaskRunner } from "./engine/call-task-runner";
export {
  AttemptsExhaustedError,
  DuplicateStepError,
  isNonRetryable,
  NonRetryableError,
  ResultSerializationError,
  RetryPolicyError,
  serializeError,
  StepTimeoutError,
} from "./engine/errors";
export type { SerializedError } from "./engine/errors";
export {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_RETRY_POLICY,
  DEFAULT_STEP_TIMEOUT_MS,
  DEFAULT_TTL_MS,
} from "./engine/defaults";

// The MCP Tasks extension wire vocabulary (the only task-type import source
// in this repo — never the SDK's deprecated 2025-11-25 task exports).
export * from "./wire";
