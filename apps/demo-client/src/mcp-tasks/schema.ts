/**
 * Vendored wire schema for the MCP Tasks extension, CURRENT DRAFT.
 *
 * Source (vendored per the repo vendoring policy, credited in this app's
 * README): https://github.com/modelcontextprotocol/ext-tasks —
 * `schema/draft/schema.ts` and `specification/draft/tasks.md` at commit
 * dcc8d2bbecd50397901558dd66f46050c5b21de3 (2026-08-19).
 *
 * Never import task shapes from `@modelcontextprotocol/*`: the installed SDK
 * (2.0.0) only carries the deprecated 2025-11-25 vocabulary — `ttl` /
 * `pollInterval` field names, a wrapped `{ task }` CreateTaskResult, a
 * `notifications/tasks/status` notification, and `tasks/result` / `tasks/list`
 * methods — all of which are wire-incompatible with the current draft
 * (`ttlMs` / `pollIntervalMs`, flat `CreateTaskResult` discriminated by
 * `resultType: "task"`, `notifications/tasks`, results inlined in `tasks/get`).
 */
import { z } from "zod";

/** Extension identifier, used as the capability key on both sides. */
export const TASKS_EXTENSION_ID = "io.modelcontextprotocol/tasks";

/**
 * The three task-lifecycle methods of the current draft. `tasks/result` and
 * `tasks/list` do not exist any more (compliant servers answer -32601).
 */
export const TASK_METHODS = ["tasks/get", "tasks/update", "tasks/cancel"] as const;
export type TaskMethod = (typeof TASK_METHODS)[number];

export const TaskStatusSchema = z.enum([
  "working",
  "input_required",
  "completed",
  "failed",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/**
 * Fields shared by every task shape. `ttlMs` is REQUIRED (null = unlimited);
 * its presence is also what separates current-draft tasks from the old
 * 2025-11-25 `ttl` vocabulary at parse time.
 */
const taskFields = {
  taskId: z.string(),
  status: TaskStatusSchema,
  /**
   * Absent (or null) until the task's first `step.status` call — the engine
   * writes no auto-narration. Clients MUST read a missing statusMessage as
   * pre-telemetry, never as an error.
   */
  statusMessage: z.string().nullable().optional(),
  /** ISO 8601 timestamp when the task was created. */
  createdAt: z.string(),
  /** ISO 8601 timestamp when the task was last updated. */
  lastUpdatedAt: z.string(),
  /** Time-to-live from creation in integer milliseconds, null for unlimited. */
  ttlMs: z.number().int().nullable(),
  /** Suggested polling interval in integer milliseconds. Clients SHOULD honor it. */
  pollIntervalMs: z.number().int().optional(),
};

/** Base task data, as embedded flat in CreateTaskResult. */
export const TaskSchema = z.looseObject(taskFields);
export type Task = z.infer<typeof TaskSchema>;

/**
 * The result a server returns from a task-augmented `tools/call` in lieu of
 * the standard result shape. FLAT `Result & Task` — the `resultType: "task"`
 * discriminator lives at the top level of `result` (no `{ task }` wrapper).
 */
export const CreateTaskResultSchema = z.looseObject({
  ...taskFields,
  resultType: z.literal("task"),
});
export type CreateTaskResult = z.infer<typeof CreateTaskResultSchema>;

/* Detailed task variants — used by tasks/get results and notifications/tasks. */

export const WorkingTaskSchema = z.looseObject({
  ...taskFields,
  status: z.literal("working"),
});
export type WorkingTask = z.infer<typeof WorkingTaskSchema>;

/**
 * A single outstanding server-to-client request (sampling, roots, or
 * elicitation). The draft schema itself defers the exact MRTR shapes to a
 * future SDK update, so we validate only the request framing here.
 */
export const InputRequestSchema = z.looseObject({
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type InputRequest = z.infer<typeof InputRequestSchema>;

/**
 * A single input response from the client (a CreateMessageResult,
 * ListRootsResult, or ElicitResult), sent via `tasks/update`. The draft
 * schema defers the exact MRTR shapes to a future SDK update (marked TODO
 * upstream), so — mirroring InputRequestSchema — we validate only that each
 * response is an object.
 */
export const InputResponseSchema = z.record(z.string(), z.unknown());
export type InputResponse = z.infer<typeof InputResponseSchema>;

/**
 * `tasks/update` params payload: responses to outstanding inputRequests.
 * Each key MUST correspond to a currently-outstanding inputRequest key.
 */
export const InputResponsesSchema = z.record(z.string(), InputResponseSchema);
export type InputResponses = z.infer<typeof InputResponsesSchema>;

export const InputRequiredTaskSchema = z.looseObject({
  ...taskFields,
  status: z.literal("input_required"),
  /** Keyed by identifiers unique over the lifetime of the task. */
  inputRequests: z.record(z.string(), InputRequestSchema),
});
export type InputRequiredTask = z.infer<typeof InputRequiredTaskSchema>;

export const CompletedTaskSchema = z.looseObject({
  ...taskFields,
  status: z.literal("completed"),
  /**
   * The final result, inlined — the exact structure the original request
   * would have returned (a CallToolResult for tool tasks, `isError: true`
   * results included: those are `completed`, not `failed`).
   */
  result: z.record(z.string(), z.unknown()),
});
export type CompletedTask = z.infer<typeof CompletedTaskSchema>;

export const FailedTaskSchema = z.looseObject({
  ...taskFields,
  status: z.literal("failed"),
  /** The JSON-RPC error that caused the failure (`failed` = JSON-RPC errors only). */
  error: z.record(z.string(), z.unknown()),
});
export type FailedTask = z.infer<typeof FailedTaskSchema>;

export const CancelledTaskSchema = z.looseObject({
  ...taskFields,
  status: z.literal("cancelled"),
});
export type CancelledTask = z.infer<typeof CancelledTaskSchema>;

/**
 * Task state with status-specific fields inlined, as returned by `tasks/get`
 * and carried by `notifications/tasks` params.
 */
export const DetailedTaskSchema = z.discriminatedUnion("status", [
  WorkingTaskSchema,
  InputRequiredTaskSchema,
  CompletedTaskSchema,
  FailedTaskSchema,
  CancelledTaskSchema,
]);
export type DetailedTask = z.infer<typeof DetailedTaskSchema>;

/** The response to `tasks/get`: `Result & DetailedTask`, resultType "complete". */
export const GetTaskResultSchema = DetailedTaskSchema;
export type GetTaskResult = z.infer<typeof GetTaskResultSchema>;

/**
 * The response to `tasks/cancel` and `tasks/update`: an empty acknowledgement
 * (NOT a Task — cancellation is cooperative and eventually consistent).
 */
export const TaskAckResultSchema = z.looseObject({
  resultType: z.literal("complete").optional(),
});
export type TaskAckResult = z.infer<typeof TaskAckResultSchema>;

/** Params of the optional `notifications/tasks` notification: a full DetailedTask. */
export const TaskStatusNotificationParamsSchema = DetailedTaskSchema;
export type TaskStatusNotificationParams = z.infer<typeof TaskStatusNotificationParamsSchema>;

/** Terminal statuses: polling stops here. `input_required` is NOT terminal. */
export function isTerminalStatus(status: TaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
