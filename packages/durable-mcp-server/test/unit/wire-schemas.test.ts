import { describe, expect, it } from "vitest";
import { z } from "zod";
import fixture from "../fixtures/ext-tasks.schema.json";
import {
  cancelledTaskSchema,
  cancelTaskRequestSchema,
  cancelTaskResultSchema,
  completedTaskSchema,
  createTaskResultSchema,
  detailedTaskSchema,
  failedTaskSchema,
  getTaskRequestSchema,
  getTaskResultSchema,
  inputRequiredTaskSchema,
  taskSchema,
  tasksExtensionCapabilitySchema,
  taskStatusSchema,
  updateTaskRequestSchema,
  updateTaskResultSchema,
  workingTaskSchema,
} from "../../src/wire/schemas";
import {
  TASK_STATUSES,
  TASKS_EXTENSION_ID,
  type CancelTaskRequest,
  type DetailedTask,
  type GetTaskRequest,
  type Task,
  type TaskStatus,
} from "../../src/wire/types";

/* ------------------------------------------------------------------ */
/* Fixture plumbing: the vendored ext-tasks generated JSON Schema      */
/* (`schema/draft/schema.json` @ dcc8d2b) is the conformance fixture.  */
/* ------------------------------------------------------------------ */

interface FixtureDef {
  type?: string;
  properties?: Record<string, FixtureDef>;
  required?: string[];
  anyOf?: FixtureDef[];
  allOf?: FixtureDef[];
  const?: string;
}

const defs = (fixture as unknown as { $defs: Record<string, FixtureDef> }).$defs;

const fixtureDef = (name: string): FixtureDef => {
  const def = defs[name];
  if (def === undefined) {
    throw new Error(`fixture $defs is missing "${name}"`);
  }
  return def;
};

/** Extracts the const values of an `anyOf` of string consts. */
const anyOfConsts = (def: FixtureDef): string[] =>
  (def.anyOf ?? []).map((branch) => branch.const ?? "");

interface EmittedObjectSchema {
  properties?: Record<string, unknown>;
  required?: string[];
}

/** Object-level view of one of our zod schemas, via zod's own JSON Schema emitter. */
const emitted = (schema: z.ZodType): EmittedObjectSchema =>
  z.toJSONSchema(schema, { io: "output" }) as EmittedObjectSchema;

const asSet = (values: Iterable<string> | undefined): Set<string> => new Set(values ?? []);

/* ------------------------------------------------------------------ */
/* Conformance against the vendored fixture                            */
/* ------------------------------------------------------------------ */

describe("conformance with the vendored ext-tasks schema fixture", () => {
  it("TaskStatus enumerates exactly the fixture's statuses", () => {
    expect(asSet(TASK_STATUSES)).toEqual(asSet(anyOfConsts(fixtureDef("TaskStatus"))));
    expect(asSet(taskStatusSchema.options)).toEqual(asSet(anyOfConsts(fixtureDef("TaskStatus"))));
  });

  it.each([
    ["Task", taskSchema],
    ["WorkingTask", workingTaskSchema],
    ["InputRequiredTask", inputRequiredTaskSchema],
    ["CompletedTask", completedTaskSchema],
    ["FailedTask", failedTaskSchema],
    ["CancelledTask", cancelledTaskSchema],
  ] as const)("%s matches the fixture's properties and required set", (name, schema) => {
    const ours = emitted(schema);
    const theirs = fixtureDef(name);
    expect(asSet(Object.keys(ours.properties ?? {}))).toEqual(
      asSet(Object.keys(theirs.properties ?? {})),
    );
    expect(asSet(ours.required)).toEqual(asSet(theirs.required));
  });

  it("DetailedTask covers exactly the fixture's five status variants", () => {
    const theirs = (fixtureDef("DetailedTask").anyOf ?? []).map(
      (branch) => branch.properties?.status?.const ?? "",
    );
    const ours = detailedTaskSchema.options.map((option) => option.shape.status.value);
    expect(asSet(ours)).toEqual(asSet(theirs));
    expect(asSet(theirs)).toEqual(asSet(TASK_STATUSES));
  });

  it("CreateTaskResult carries every Task field the fixture requires", () => {
    // The fixture encodes CreateTaskResult as allOf [Result, Task]; the Task
    // half carries the required list.
    const taskHalf = (fixtureDef("CreateTaskResult").allOf ?? []).find(
      (branch) => branch.required !== undefined,
    );
    const ours = emitted(createTaskResultSchema);
    expect(taskHalf).toBeDefined();
    expect(asSet(ours.required)).toEqual(
      // resultType is our (spec-MUST) addition; the generated fixture omits
      // the field entirely because the upstream TS source leaves it to the
      // old SDK Result's index signature.
      asSet([...(taskHalf?.required ?? []), "resultType"]),
    );
  });

  it.each([
    ["GetTaskRequest", getTaskRequestSchema, "tasks/get"],
    ["UpdateTaskRequest", updateTaskRequestSchema, "tasks/update"],
    ["CancelTaskRequest", cancelTaskRequestSchema, "tasks/cancel"],
  ] as const)("%s pins the fixture's method and params contract", (name, schema, method) => {
    const theirs = fixtureDef(name);
    expect(theirs.properties?.method?.const).toBe(method);
    expect(schema.shape.method.value).toBe(method);
    expect(asSet(theirs.required)).toEqual(asSet(["jsonrpc", "id", "method", "params"]));

    const ours = emitted(schema);
    expect(asSet(ours.required)).toEqual(asSet(theirs.required));

    // Params: every fixture-required param key is required by our schema too
    // (our params additionally allow the modern _meta envelope).
    const theirParams = theirs.properties?.params;
    const ourParams = emitted(schema.shape.params);
    for (const key of theirParams?.required ?? []) {
      expect(ourParams.required).toContain(key);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Behavior of the runtime schemas                                     */
/* ------------------------------------------------------------------ */

const baseTask = {
  taskId: "3fa16c9d-5f04-4f43-8a26-1e01f0f7f4e6",
  status: "working",
  createdAt: "2026-08-20T12:00:00.000Z",
  lastUpdatedAt: "2026-08-20T12:00:00.000Z",
  ttlMs: 86_400_000,
  pollIntervalMs: 5_000,
} as const;

describe("task schemas", () => {
  it("accepts a minimal task (ttlMs null, no pollIntervalMs)", () => {
    const parsed = taskSchema.parse({ ...baseTask, ttlMs: null, pollIntervalMs: undefined });
    expect(parsed.ttlMs).toBeNull();
    expect(parsed.pollIntervalMs).toBeUndefined();
  });

  it("requires ttlMs — REQUIRED even when unlimited", () => {
    const { ttlMs: _dropped, ...withoutTtl } = baseTask;
    expect(taskSchema.safeParse(withoutTtl).success).toBe(false);
  });

  it("rejects unknown statuses and non-integer intervals", () => {
    expect(taskSchema.safeParse({ ...baseTask, status: "paused" }).success).toBe(false);
    expect(taskSchema.safeParse({ ...baseTask, ttlMs: 1.5 }).success).toBe(false);
    expect(taskSchema.safeParse({ ...baseTask, pollIntervalMs: 0.25 }).success).toBe(false);
  });

  it("passes unknown keys through (loose wire objects)", () => {
    const parsed = taskSchema.parse({ ...baseTask, "x-vendor": "kept" });
    expect(parsed["x-vendor"]).toBe("kept");
  });

  it("discriminates DetailedTask variants and their payload fields", () => {
    const completed = detailedTaskSchema.parse({
      ...baseTask,
      status: "completed",
      result: { content: [{ type: "text", text: "sent" }] },
    });
    expect(completed.status).toBe("completed");

    // completed without result / failed without error are invalid
    expect(detailedTaskSchema.safeParse({ ...baseTask, status: "completed" }).success).toBe(false);
    expect(detailedTaskSchema.safeParse({ ...baseTask, status: "failed" }).success).toBe(false);

    const failed = detailedTaskSchema.parse({
      ...baseTask,
      status: "failed",
      error: { code: -32603, message: "task expired" },
    });
    expect(failed.status).toBe("failed");

    const inputRequired = detailedTaskSchema.parse({
      ...baseTask,
      status: "input_required",
      inputRequests: {
        "confirm-send": { method: "elicitation/create", params: { message: "Send it?" } },
      },
    });
    expect(inputRequired.status).toBe("input_required");
  });
});

describe("result schemas", () => {
  it("CreateTaskResult requires resultType 'task' (spec MUST)", () => {
    const wire = { ...baseTask, resultType: "task", _meta: { "io.example/trace": "abc" } };
    const parsed = createTaskResultSchema.parse(wire);
    expect(parsed.resultType).toBe("task");
    expect(createTaskResultSchema.safeParse(baseTask).success).toBe(false);
    expect(createTaskResultSchema.safeParse({ ...baseTask, resultType: "complete" }).success).toBe(
      false,
    );
  });

  it("GetTaskResult inlines the DetailedTask variant with resultType 'complete'", () => {
    const parsed = getTaskResultSchema.parse({
      ...baseTask,
      status: "completed",
      result: { content: [] },
      resultType: "complete",
    });
    expect(parsed.status).toBe("completed");
    expect(
      getTaskResultSchema.safeParse({ ...baseTask, status: "completed", result: {} }).success,
    ).toBe(false);
  });

  it("update/cancel acks are empty results with resultType 'complete'", () => {
    expect(updateTaskResultSchema.parse({ resultType: "complete" }).resultType).toBe("complete");
    expect(cancelTaskResultSchema.parse({ resultType: "complete" }).resultType).toBe("complete");
    expect(updateTaskResultSchema.safeParse({}).success).toBe(false);
  });
});

describe("request schemas", () => {
  const envelope = {
    "io.modelcontextprotocol/clientCapabilities": {
      extensions: { [TASKS_EXTENSION_ID]: {} },
    },
  };

  it("parses modern tasks/get with the _meta envelope in params", () => {
    const parsed = getTaskRequestSchema.parse({
      jsonrpc: "2.0",
      id: 7,
      method: "tasks/get",
      params: { taskId: baseTask.taskId, _meta: envelope },
    });
    expect(parsed.params.taskId).toBe(baseTask.taskId);
    expect(parsed.params["_meta"]).toEqual(envelope);
  });

  it("parses tasks/update with inputResponses and ignores none of the keys", () => {
    const parsed = updateTaskRequestSchema.parse({
      jsonrpc: "2.0",
      id: "req-2",
      method: "tasks/update",
      params: {
        taskId: baseTask.taskId,
        inputResponses: { "confirm-send": { action: "accept", content: { confirmed: true } } },
      },
    });
    expect(Object.keys(parsed.params.inputResponses)).toEqual(["confirm-send"]);
  });

  it("rejects the wrong method literal and missing params", () => {
    expect(
      getTaskRequestSchema.safeParse({
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/result", // legacy 2025 vocabulary — not a real method
        params: { taskId: baseTask.taskId },
      }).success,
    ).toBe(false);
    expect(
      cancelTaskRequestSchema.safeParse({ jsonrpc: "2.0", id: 1, method: "tasks/cancel" }).success,
    ).toBe(false);
    expect(
      updateTaskRequestSchema.safeParse({
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/update",
        params: { taskId: baseTask.taskId }, // inputResponses required
      }).success,
    ).toBe(false);
  });

  it("accepts string and integer request ids only", () => {
    const request = (id: unknown) => ({
      jsonrpc: "2.0",
      id,
      method: "tasks/get",
      params: { taskId: baseTask.taskId },
    });
    expect(getTaskRequestSchema.safeParse(request("abc")).success).toBe(true);
    expect(getTaskRequestSchema.safeParse(request(12)).success).toBe(true);
    expect(getTaskRequestSchema.safeParse(request(1.5)).success).toBe(false);
    expect(getTaskRequestSchema.safeParse(request(null)).success).toBe(false);
  });
});

describe("capability schema", () => {
  it("accepts only the empty object", () => {
    expect(tasksExtensionCapabilitySchema.parse({})).toEqual({});
    expect(tasksExtensionCapabilitySchema.safeParse({ settings: true }).success).toBe(false);
  });

  it("exports the extension id constant", () => {
    expect(TASKS_EXTENSION_ID).toBe("io.modelcontextprotocol/tasks");
  });
});

describe("schema outputs satisfy the wire types", () => {
  it("compile-time assignability (fails typecheck, not this assertion)", () => {
    // The input_required variant and tasks/update params are exempt: their
    // schemas validate embedded input requests/responses structurally (the
    // fixture degenerates them to `anyOf [{}, {}, {}]`), which is looser than
    // the SDK-typed InputRequests/InputResponses interfaces.
    const status: TaskStatus = {} as z.output<typeof taskStatusSchema>;
    const task: Task = {} as z.output<typeof taskSchema>;
    const working: DetailedTask = {} as z.output<typeof workingTaskSchema>;
    const completed: DetailedTask = {} as z.output<typeof completedTaskSchema>;
    const failed: DetailedTask = {} as z.output<typeof failedTaskSchema>;
    const cancelled: DetailedTask = {} as z.output<typeof cancelledTaskSchema>;
    const get: GetTaskRequest = {} as z.output<typeof getTaskRequestSchema>;
    const cancel: CancelTaskRequest = {} as z.output<typeof cancelTaskRequestSchema>;
    expect([status, task, working, completed, failed, cancelled, get, cancel]).toBeDefined();
  });
});
