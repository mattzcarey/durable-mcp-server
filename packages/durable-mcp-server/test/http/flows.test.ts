/**
 * The HTTP layer for every engine flow (four-layer matrix): multi-step
 * execute + replay, cancellation, tasks/update semantics, and the elicit
 * (input_required) roundtrip — all through real JSON-RPC POSTs against the
 * fixture worker, with alarms drained deterministically between polls.
 */

import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getTaskResultSchema } from "../../src/wire";
import { runCount } from "../fixtures/task-state";
import { drainTaskAlarms } from "../support/drain";
import { ageElicitTimeoutBy, ageTaskBy, readInputRequests, taskStub } from "../support/helpers";
import { callResult, errorOf, postModern, readJsonRpcResponse } from "../support/jsonrpc";

const NS = () => env.TASK_RUNNER_REAL;
const drain = (taskId: string) => drainTaskAlarms(taskId, { namespace: NS() });

async function startTask(name: string, args: Record<string, unknown>): Promise<string> {
  const result = await callResult("tools/call", { name, arguments: args });
  expect(result["resultType"]).toBe("task");
  return z.string().parse(result["taskId"]);
}

async function getTask(taskId: string): Promise<z.output<typeof getTaskResultSchema>> {
  return getTaskResultSchema.parse(await callResult("tasks/get", { taskId }));
}

describe("execute + replay over HTTP", () => {
  it("multi-step pipeline: working -> drain -> completed, steps exactly once", async () => {
    const taskId = await startTask("pipeline_task", { text: "hi" });

    expect((await getTask(taskId)).status).toBe("working");

    await drain(taskId);

    const done = await getTask(taskId);
    expect(done.status).toBe("completed");
    if (done.status !== "completed") {
      throw new Error("unreachable");
    }
    expect(done.result).toEqual({ content: [{ type: "text", text: "hi-1-2" }] });
    expect(runCount(`${taskId}:step-1`)).toBe(1);
    expect(runCount(`${taskId}:step-2`)).toBe(1);
  });

  it("a throwing handler completes with isError (never `failed`)", async () => {
    const taskId = await startTask("throwing_task", {});
    await drain(taskId);
    const done = await getTask(taskId);
    expect(done.status).toBe("completed");
    if (done.status !== "completed") {
      throw new Error("unreachable");
    }
    expect(done.result["isError"]).toBe(true);
  });
});

describe("step retries over HTTP", () => {
  it("a flaky step retries through the journal and completes", async () => {
    const taskId = await startTask("flaky_task", { failures: 2 });
    await drain(taskId);

    const done = await getTask(taskId);
    expect(done.status).toBe("completed");
    if (done.status !== "completed") {
      throw new Error("unreachable");
    }
    expect(done.result).toEqual({ content: [{ type: "text", text: "steady after 3" }] });
    expect(runCount(`${taskId}:wobbly`)).toBe(3); // 2 failures + the success
  });
});

describe("TTL retention + purge over HTTP", () => {
  it("a completed task stays pollable until the deadline, then tasks/get is -32602", async () => {
    const taskId = await startTask("echo_task", { text: "retained" });
    await drain(taskId);
    expect((await getTask(taskId)).status).toBe("completed");

    // Deadline passes (created_at rewound, wall-clock honest) -> purge.
    await ageTaskBy(taskStub(taskId, NS()), 86_400_000 * 2);
    await drain(taskId);

    const response = await postModern("tasks/get", { taskId });
    expect(response.status).toBe(200);
    expect(errorOf(await readJsonRpcResponse(response)).code).toBe(-32602);
  });
});

describe("cancellation over HTTP", () => {
  it("tasks/cancel acks and the task settles cancelled", async () => {
    const taskId = await startTask("pipeline_task", { text: "doomed" });

    const ack = await callResult("tasks/cancel", { taskId });
    expect(ack["resultType"]).toBe("complete");

    // Ack does not mean stopped: the status flips when the engine observes
    // the flag (here: the next drained alarm tick).
    await drain(taskId);
    const done = await getTask(taskId);
    expect(done.status).toBe("cancelled");

    // Terminal states are immutable; a repeat cancel still acks.
    const again = await callResult("tasks/cancel", { taskId });
    expect(again["resultType"]).toBe("complete");
    expect((await getTask(taskId)).status).toBe("cancelled");
  });
});

describe("tasks/update semantics over HTTP", () => {
  it("acks and ignores unknown keys on a working task (eventually consistent)", async () => {
    const taskId = await startTask("pipeline_task", { text: "steady" });
    const ack = await callResult("tasks/update", {
      taskId,
      inputResponses: { bogus: { action: "decline" } },
    });
    expect(ack["resultType"]).toBe("complete");
    expect((await getTask(taskId)).status).toBe("working");
  });

  it("rejects malformed inputResponses with invalid params", async () => {
    const taskId = await startTask("pipeline_task", { text: "shape" });
    const response = await postModern("tasks/update", { taskId, inputResponses: "nope" });
    expect(response.status).toBe(200);
    const message = await readJsonRpcResponse(response);
    expect(z.object({ error: z.object({ code: z.number() }) }).parse(message).error.code).toBe(
      -32602,
    );
  });
});

describe("elicit roundtrip over HTTP (D13, input_required)", () => {
  it("input_required surfaces the request; tasks/update resumes; result carries the answer", async () => {
    const response = { action: "accept", content: { color: "blue" } };
    const taskId = await startTask("elicit_task", {});

    await drain(taskId);
    const waiting = await getTask(taskId);
    expect(waiting.status).toBe("input_required");
    if (waiting.status !== "input_required") {
      throw new Error("unreachable");
    }
    expect(waiting.inputRequests).toEqual({
      color: {
        method: "elicitation/create",
        params: {
          message: "pick a color",
          requestedSchema: { type: "object", properties: { color: { type: "string" } } },
        },
      },
    });

    const ack = await callResult("tasks/update", {
      taskId,
      inputResponses: { color: response, unknownKey: { ignored: true } },
    });
    expect(ack["resultType"]).toBe("complete");

    // Back to working, then drain to completion with the answer visible and
    // the prep step memoized across the resume.
    expect((await getTask(taskId)).status).toBe("working");
    await drain(taskId);

    const done = await getTask(taskId);
    expect(done.status).toBe("completed");
    if (done.status !== "completed") {
      throw new Error("unreachable");
    }
    expect(done.result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ prep: "ready", answer: response }) }],
    });
    expect(runCount(`${taskId}:prep`)).toBe(1);
  });
});

describe("elicit timeout over HTTP (timed step.elicit)", () => {
  it("input_required, then past the deadline: working on the timeout branch; late answers ack but change nothing", async () => {
    const taskId = await startTask("timed_elicit_task", { timeoutMs: 600_000 });
    const stub = taskStub(taskId, NS());

    await drain(taskId);
    const waiting = await getTask(taskId);
    expect(waiting.status).toBe("input_required");
    if (waiting.status !== "input_required") {
      throw new Error("unreachable");
    }
    expect(Object.keys(waiting.inputRequests)).toEqual(["pit-call"]);

    // The deadline passes (rewound, wall-clock honest); one tick resolves
    // the timeout and the handler resumes on the timed_out branch, parked on
    // its limp-home sleep: pollers see working again with no inputRequests.
    await ageElicitTimeoutBy(stub, 1_200_000);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await getTask(taskId)).status).toBe("working");

    // Late answer: the empty ack, and nothing changes — the request was
    // answered by timeout, so the key is ignored.
    const ack = await callResult("tasks/update", {
      taskId,
      inputResponses: { "pit-call": { action: "accept", content: { box: true } } },
    });
    expect(ack["resultType"]).toBe("complete");
    expect((await getTask(taskId)).status).toBe("working");
    expect((await readInputRequests(stub)).at(0)?.response).toBeNull();

    await drain(taskId);
    const done = await getTask(taskId);
    expect(done.status).toBe("completed");
    if (done.status !== "completed") {
      throw new Error("unreachable");
    }
    expect(done.result).toEqual({ content: [{ type: "text", text: "ready:timed-out" }] });
    expect(runCount(`${taskId}:prep`)).toBe(1);
  });

  it("answered before the deadline: the handler receives the response, no timeout", async () => {
    const taskId = await startTask("timed_elicit_task", { timeoutMs: 600_000 });
    const response = { action: "accept", content: { box: false } };

    await drain(taskId);
    expect((await getTask(taskId)).status).toBe("input_required");

    const ack = await callResult("tasks/update", {
      taskId,
      inputResponses: { "pit-call": response },
    });
    expect(ack["resultType"]).toBe("complete");
    await drain(taskId);

    const done = await getTask(taskId);
    expect(done.status).toBe("completed");
    if (done.status !== "completed") {
      throw new Error("unreachable");
    }
    expect(done.result).toEqual({
      content: [{ type: "text", text: `ready:${JSON.stringify(response)}` }],
    });
  });
});

describe("handler telemetry over HTTP (step.status)", () => {
  it("statusMessage is the handler's channel: visible across polls, kept at terminal", async () => {
    const taskId = await startTask("status_task", { text: "hi" });
    const stub = taskStub(taskId, NS());

    // Tick 1 suspends on the cool-down sleep; the poll shows the handler's
    // last write — no engine narration exists to clobber it.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const working = await getTask(taskId);
    expect(working.status).toBe("working");
    expect(working.statusMessage).toBe('sent "HI"');

    await drain(taskId);
    const done = await getTask(taskId);
    expect(done.status).toBe("completed");
    expect(done.statusMessage).toBe("wrapping up"); // last write survives terminal
    if (done.status !== "completed") {
      throw new Error("unreachable");
    }
    expect(done.result).toEqual({ content: [{ type: "text", text: "done:HI" }] });
  });

  it("a task that never calls step.status has no statusMessage at any stage", async () => {
    const taskId = await startTask("pipeline_task", { text: "quiet" });
    const stub = taskStub(taskId, NS());

    expect(await runDurableObjectAlarm(stub)).toBe(true); // mid-flight, sleeping
    const working = await getTask(taskId);
    expect("statusMessage" in working).toBe(false);

    await drain(taskId);
    const done = await getTask(taskId);
    expect(done.status).toBe("completed");
    expect("statusMessage" in done).toBe(false);
  });
});
