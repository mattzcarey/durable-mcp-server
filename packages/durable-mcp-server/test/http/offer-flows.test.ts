/**
 * The HTTP layer for standing offers (non-blocking input channels): tasks/get
 * never lists a non-blocking offer in `inputRequests` while a blocking fork
 * shows alone; tasks/update to an offer key returns the empty ack and wakes
 * the story; tasks/update to a consumed offer is a no-op ack; a fork answered
 * over HTTP while an offer is outstanding resumes the task — all through real
 * JSON-RPC POSTs against the fixture worker, alarms drained deterministically.
 */

import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getTaskResultSchema } from "../../src/wire";
import { runCount } from "../fixtures/task-state";
import { drainTaskAlarms } from "../support/drain";
import { readInputRequests, readSteps, taskStub } from "../support/helpers";
import { callResult } from "../support/jsonrpc";

const NS = () => env.TASK_RUNNER_REAL;
const drain = (taskId: string) => drainTaskAlarms(taskId, { namespace: NS() });

const ACTION = { action: "accept", content: { action: "enter" } };
const LATE = { action: "accept", content: { action: "leave" } };
const FORK_ANSWER = { action: "accept", content: { way: "left" } };

async function startTask(name: string, args: Record<string, unknown>): Promise<string> {
  const result = await callResult("tools/call", { name, arguments: args });
  expect(result["resultType"]).toBe("task");
  return z.string().parse(result["taskId"]);
}

async function getTask(taskId: string): Promise<z.output<typeof getTaskResultSchema>> {
  return getTaskResultSchema.parse(await callResult("tasks/get", { taskId }));
}

describe("standing offers over HTTP", () => {
  it("tasks/get never lists a non-blocking offer; a blocking fork shows alone", async () => {
    const storyId = await startTask("story_task", { beats: 2 });
    expect(await runDurableObjectAlarm(taskStub(storyId, NS()))).toBe(true); // offer stands, beat 1 sleeps
    const story = await getTask(storyId);
    expect(story.status).toBe("working");
    expect("inputRequests" in story).toBe(false);
    expect((await readInputRequests(taskStub(storyId, NS()))).at(0)).toMatchObject({
      key: "act-1",
      blocking: 0,
    });

    const forkId = await startTask("fork_task", {});
    await drain(forkId);
    const fork = await getTask(forkId);
    expect(fork.status).toBe("input_required");
    if (fork.status !== "input_required") {
      throw new Error("unreachable");
    }
    expect(Object.keys(fork.inputRequests)).toEqual(["fork"]); // act-1 is ambient
    expect(
      Object.fromEntries(
        (await readInputRequests(taskStub(forkId, NS()))).map((row) => [
          String(row.key),
          row.blocking,
        ]),
      ),
    ).toEqual({ "act-1": 0, fork: 1 });
  });

  it("tasks/update to an offer key returns the empty ack and wakes the story, which consumes and branches", async () => {
    const taskId = await startTask("story_task", { beats: 3 });
    const stub = taskStub(taskId, NS());
    expect(await runDurableObjectAlarm(stub)).toBe(true); // beat 1
    expect(await runDurableObjectAlarm(stub)).toBe(true); // check-1 misses, beat 2
    expect((await getTask(taskId)).statusMessage).toBe("beat 2");

    const ack = await callResult("tasks/update", { taskId, inputResponses: { "act-1": ACTION } });
    expect(ack["resultType"]).toBe("complete");
    // Status untouched, no input_required, the beat sleep cut short.
    const woken = await getTask(taskId);
    expect(woken.status).toBe("working");
    expect(woken.statusMessage).toBe("beat 2");
    expect((await readSteps(stub)).find((s) => s.step_key === "beat-2")?.status).toBe("completed");

    // One tick: the story consumes the answer and branches.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(runCount(`${taskId}:sub-branch`)).toBe(1);
    expect((await getTask(taskId)).statusMessage).toBe("epilogue");

    await drain(taskId);
    const done = await getTask(taskId);
    expect(done.status).toBe("completed");
    if (done.status !== "completed") {
      throw new Error("unreachable");
    }
    expect(done.result).toEqual({
      content: [{ type: "text", text: `branch:${JSON.stringify(ACTION)}|act-2:open` }],
    });
  });

  it("tasks/update to a consumed offer is a no-op ack", async () => {
    const taskId = await startTask("story_task", { beats: 3 });
    const stub = taskStub(taskId, NS());
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await callResult("tasks/update", { taskId, inputResponses: { "act-1": ACTION } });
    expect(await runDurableObjectAlarm(stub)).toBe(true); // consumed, sub-branch, epilogue sleep
    expect((await readInputRequests(stub)).find((r) => r.key === "act-1")?.consumed).toBe(1);
    const before = await getTask(taskId);
    expect(before.statusMessage).toBe("epilogue");

    const ack = await callResult("tasks/update", { taskId, inputResponses: { "act-1": LATE } });
    expect(ack["resultType"]).toBe("complete");

    expect(await getTask(taskId)).toEqual(before); // not even lastUpdatedAt moved
    const row = (await readInputRequests(stub)).find((r) => r.key === "act-1");
    expect(JSON.parse(String(row?.response))).toEqual(ACTION);
    expect((await readSteps(stub)).find((s) => s.step_key === "epilogue")?.status).toBe("pending");
  });

  it("a fork answered over HTTP while an offer is outstanding resumes the task", async () => {
    const taskId = await startTask("fork_task", {});
    await drain(taskId);
    expect((await getTask(taskId)).status).toBe("input_required");

    const ack = await callResult("tasks/update", {
      taskId,
      inputResponses: { fork: FORK_ANSWER },
    });
    expect(ack["resultType"]).toBe("complete");
    expect((await getTask(taskId)).status).toBe("working"); // the open offer never blocks it

    await drain(taskId);
    const done = await getTask(taskId);
    expect(done.status).toBe("completed");
    if (done.status !== "completed") {
      throw new Error("unreachable");
    }
    expect(done.result).toEqual({
      content: [{ type: "text", text: `fork:${JSON.stringify(FORK_ANSWER)}|act-1:open` }],
    });
  });
});
