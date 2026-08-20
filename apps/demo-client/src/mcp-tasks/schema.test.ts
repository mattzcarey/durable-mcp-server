import { describe, expect, it } from "vitest";
import {
  CreateTaskResultSchema,
  DetailedTaskSchema,
  GetTaskResultSchema,
  InputResponsesSchema,
  isTerminalStatus,
  TaskAckResultSchema,
  TaskSchema,
} from "./schema";

/** A minimal current-draft task, spread into shapes under test. */
const baseTask = {
  taskId: "0b6e5a1a-9f0e-4f6a-8d51-111111111111",
  status: "working",
  createdAt: "2026-08-20T10:00:00Z",
  lastUpdatedAt: "2026-08-20T10:00:01Z",
  ttlMs: 60_000,
} as const;

describe("TaskSchema", () => {
  it("accepts a current-draft task with ttlMs and pollIntervalMs", () => {
    const task = TaskSchema.parse({
      ...baseTask,
      statusMessage: "crunching",
      pollIntervalMs: 5000,
    });
    expect(task.ttlMs).toBe(60_000);
    expect(task.pollIntervalMs).toBe(5000);
  });

  it("accepts ttlMs: null (unlimited)", () => {
    expect(TaskSchema.parse({ ...baseTask, ttlMs: null }).ttlMs).toBeNull();
  });

  it("accepts statusMessage: null (pre-telemetry, before the first step.status)", () => {
    expect(TaskSchema.parse({ ...baseTask, statusMessage: null }).statusMessage).toBeNull();
    expect(DetailedTaskSchema.parse({ ...baseTask, statusMessage: null }).statusMessage).toBeNull();
  });

  it("rejects the deprecated 2025-11-25 vocabulary (ttl / pollInterval)", () => {
    const { ttlMs, ...withoutTtlMs } = baseTask;
    void ttlMs;
    const oldShape = { ...withoutTtlMs, ttl: 60_000, pollInterval: 5000 };
    expect(TaskSchema.safeParse(oldShape).success).toBe(false);
  });

  it("rejects unknown statuses", () => {
    expect(TaskSchema.safeParse({ ...baseTask, status: "running" }).success).toBe(false);
  });
});

describe("CreateTaskResultSchema", () => {
  it("accepts the FLAT current-draft shape discriminated by resultType: 'task'", () => {
    const created = CreateTaskResultSchema.parse({
      ...baseTask,
      resultType: "task",
      pollIntervalMs: 500,
    });
    expect(created.taskId).toBe(baseTask.taskId);
    expect(created.resultType).toBe("task");
  });

  it("rejects the deprecated wrapped { task } shape", () => {
    expect(CreateTaskResultSchema.safeParse({ task: { ...baseTask } }).success).toBe(false);
  });

  it("rejects a plain CallToolResult (no resultType: 'task')", () => {
    const callToolResult = { content: [{ type: "text", text: "done" }] };
    expect(CreateTaskResultSchema.safeParse(callToolResult).success).toBe(false);
  });
});

describe("DetailedTaskSchema", () => {
  it("parses a working task", () => {
    const task = DetailedTaskSchema.parse(baseTask);
    expect(task.status).toBe("working");
  });

  it("parses a completed task with the result inlined", () => {
    const task = DetailedTaskSchema.parse({
      ...baseTask,
      status: "completed",
      result: { content: [{ type: "text", text: "42" }] },
    });
    if (task.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(task.result).toEqual({ content: [{ type: "text", text: "42" }] });
  });

  it("rejects a completed task without its inlined result", () => {
    const completed = { ...baseTask, status: "completed" };
    expect(DetailedTaskSchema.safeParse(completed).success).toBe(false);
  });

  it("parses a failed task with the JSON-RPC error inlined", () => {
    const task = DetailedTaskSchema.parse({
      ...baseTask,
      status: "failed",
      error: { code: -32603, message: "boom" },
    });
    if (task.status !== "failed") {
      throw new Error("expected failed");
    }
    expect(task.error).toEqual({ code: -32603, message: "boom" });
  });

  it("parses an input_required task with keyed inputRequests", () => {
    const task = DetailedTaskSchema.parse({
      ...baseTask,
      status: "input_required",
      inputRequests: {
        "elicit-1": { method: "elicitation/create", params: { message: "confirm?" } },
      },
    });
    if (task.status !== "input_required") {
      throw new Error("expected input_required");
    }
    expect(Object.keys(task.inputRequests)).toEqual(["elicit-1"]);
  });

  it("parses a cancelled task", () => {
    const task = GetTaskResultSchema.parse({ ...baseTask, status: "cancelled" });
    expect(task.status).toBe("cancelled");
  });
});

describe("InputResponsesSchema", () => {
  it("accepts responses keyed like the inputRequests they answer", () => {
    const responses = {
      "elicit-1": { action: "accept", content: { confirmed: true } },
      "sample-2": { role: "assistant", content: { type: "text", text: "hi" }, model: "m" },
    };
    expect(InputResponsesSchema.parse(responses)).toEqual(responses);
    expect(InputResponsesSchema.parse({})).toEqual({});
  });

  it("rejects responses that are not objects", () => {
    expect(InputResponsesSchema.safeParse({ "elicit-1": "yes" }).success).toBe(false);
    expect(InputResponsesSchema.safeParse({ "elicit-1": 42 }).success).toBe(false);
  });
});

describe("TaskAckResultSchema", () => {
  it("accepts the empty ack of tasks/cancel and tasks/update", () => {
    expect(TaskAckResultSchema.safeParse({}).success).toBe(true);
    expect(TaskAckResultSchema.safeParse({ resultType: "complete" }).success).toBe(true);
  });

  it("rejects an ack claiming a different resultType", () => {
    expect(TaskAckResultSchema.safeParse({ resultType: "task" }).success).toBe(false);
  });
});

describe("isTerminalStatus", () => {
  it("treats completed, failed, and cancelled as terminal", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
  });

  it("keeps polling on working and input_required", () => {
    expect(isTerminalStatus("working")).toBe(false);
    expect(isTerminalStatus("input_required")).toBe(false);
  });
});
