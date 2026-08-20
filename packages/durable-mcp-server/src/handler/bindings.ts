/**
 * Binding-name defaults and overrides shared by the tasks router, the fetch
 * wrapper, and TaskRunner's executor resolution (docs/how-it-works.md §2 (the three layers) and §7 (wire contract), decision D6).
 * Kept in a leaf module so `do/task-runner.ts` and the handler layer can share
 * them without importing each other.
 */

/** Default Durable Object binding name for the task store. */
export const DEFAULT_TASK_RUNNER_BINDING = "TASK_RUNNER";

/** Default service-binding name for the executor fallback (decision D6). */
export const DEFAULT_TASK_EXECUTOR_BINDING = "TASK_EXECUTOR";

/** Default `ctx.exports` entrypoint name for the executor (decision D6 as amended). */
export const DEFAULT_TASK_EXECUTOR_ENTRYPOINT = "TaskExecutor";

/**
 * Binding-name overrides for the handler/router layer.
 *
 * Note there is deliberately no executor override here: executor addressing
 * happens inside the TaskRunner Durable Object (which a handler-level option
 * can never reach) — it always tries `ctx.exports.TaskExecutor`, then the
 * `TASK_EXECUTOR` service binding. To customize it, subclass `TaskRunner` and
 * override the protected `resolveExecutor()` seam.
 */
export interface TaskBindingsOptions {
  /** DO binding name for TaskRunner. Default `"TASK_RUNNER"`. */
  taskRunner?: string;
}
