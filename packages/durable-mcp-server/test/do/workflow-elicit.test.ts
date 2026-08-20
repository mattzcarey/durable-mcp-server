/**
 * Flow: step.elicit / input_required roundtrip through the REAL executor
 * (stage 3, decision D13): prep step -> elicit suspends the workflow into
 * input_required -> tasks/update answers -> replay resolves the elicit step
 * with the client's response and completes, with the prep step memoized.
 *
 * Layers: integration (full elicit lifecycle over drains), data
 * (input_requests rows, task transitions), control plane (update RPC).
 * HTTP layer arrives with stage 4.
 */

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { callTaskRunner } from "../../src";
import { runCount } from "../fixtures/task-state";
import { drainTaskAlarms } from "../support/drain";
import { createTask, readInputRequests, readTaskRow, uniqueTaskId } from "../support/helpers";

const NS = () => env.TASK_RUNNER_REAL;
const drain = (taskId: string) => drainTaskAlarms(taskId, { namespace: NS() });

const EXPECTED_REQUEST = {
  method: "elicitation/create",
  params: {
    message: "pick a color",
    requestedSchema: { type: "object", properties: { color: { type: "string" } } },
  },
};

const RESPONSE = { action: "accept", content: { color: "teal" } };

describe("elicit roundtrip (input_required)", () => {
  it("suspends into input_required, resumes on update, hands the response to the handler", async () => {
    const taskId = uniqueTaskId();
    await createTask(taskId, { toolName: "elicit_task", input: {} }, NS());
    const stub = NS().getByName(taskId);

    // Drain: prep runs, the elicit records its request and parks the task.
    await drain(taskId);
    expect(runCount(`${taskId}:prep`)).toBe(1);

    let row = await readTaskRow(stub);
    expect(row?.status).toBe("input_required");
    expect(row?.status_message).toBeNull(); // single writer: no engine narration
    expect(row?.run_next_at).toBeNull(); // waiting on the client, not the alarm

    const requests = await readInputRequests(stub);
    expect(requests).toHaveLength(1);
    expect(requests.at(0)).toMatchObject({ key: "color", step_key: "color", answered: 0 });
    expect(JSON.parse(String(requests.at(0)?.request))).toEqual(EXPECTED_REQUEST);

    // tasks/get inlines the outstanding request (spec shape).
    expect(await stub.get()).toMatchObject({
      taskId,
      status: "input_required",
      inputRequests: { color: EXPECTED_REQUEST },
    });

    // The chain stays quiescent while input is outstanding.
    await drain(taskId);
    expect((await readTaskRow(stub))?.status).toBe("input_required");
    expect(runCount(`${taskId}:prep`)).toBe(1);

    // Control plane: tasks/update answers (unknown keys ignored, partial ok).
    await callTaskRunner(NS(), taskId, (s) =>
      s.update({ bogus: { action: "decline" }, color: RESPONSE }),
    );

    row = await readTaskRow(stub);
    expect(row?.status).toBe("working"); // resumed
    expect((await readInputRequests(stub)).at(0)?.answered).toBe(1);

    // Resume: the replay memoizes prep, the elicit resolves with the client's
    // response, and the handler completes with it.
    await drain(taskId);
    expect(runCount(`${taskId}:prep`)).toBe(1); // memoized across the resume

    row = await readTaskRow(stub);
    expect(row?.status).toBe("completed");
    expect(JSON.parse(String(row?.result))).toEqual({
      content: [{ type: "text", text: JSON.stringify({ prep: "ready", answer: RESPONSE }) }],
    });
  });
});
