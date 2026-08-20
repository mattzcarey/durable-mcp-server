/**
 * Decision D6 verification (as amended): TaskRunner reaches the executor via
 * `ctx.exports.TaskExecutor` by default, with the TASK_EXECUTOR service
 * binding as fallback — verified against the UNMODIFIED library TaskRunner
 * (binding TASK_RUNNER_LIB) at compatibility_date 2026-08-20 under the
 * workers pool, now end to end through the REAL stage-3 `runTask`. Also
 * verifies `import { env } from "cloudflare:workers"` resolves in the pool
 * (API revision 2026-08-21).
 *
 * The library DO uses PRODUCTION scheduling (immediate wakes), so workerd
 * fires its alarms on its own here; assertions poll for the settled state
 * instead of using deterministic drains.
 */

import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { DurableStep } from "../../src";
import type { DurableStepStub, TaskInvocation, TaskRunner } from "../../src";
import { baseCreateInput, readTaskRow, uniqueTaskId } from "../support/helpers";

async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  what: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("cloudflare:workers env (API revision 2026-08-21)", () => {
  it("resolves with the fixture bindings in the pool", () => {
    expect(env.TASK_RUNNER).toBeDefined();
    expect(env.TASK_RUNNER_REAL).toBeDefined();
    expect(env.TASK_RUNNER_LIB).toBeDefined();
    expect(env.TASK_EXECUTOR).toBeDefined();
  });
});

describe("ctx.exports loopback (D6 default)", () => {
  it("exposes the factory-made TaskExecutor inside a DO and runTask executes the handler", async () => {
    const stub = env.TASK_RUNNER_LIB.getByName(uniqueTaskId());
    const outcome = await runInDurableObject(stub, async (instance, state) => {
      const names = Object.keys(state.exports);
      if (!names.includes("TaskExecutor")) {
        return `ctx.exports is missing TaskExecutor (has: ${names.join(", ")})`;
      }
      // Call through the loopback exactly as resolveExecutor does, with a
      // real DurableStep lease crossing as an RPC stub (echo_task never uses
      // it — the call must still dispose cleanly).
      const desc: TaskInvocation = {
        taskId: "t",
        toolName: "echo_task",
        input: { text: "d6" },
        attempt: 1,
      };
      const lease = new DurableStep(instance as TaskRunner, "t", 1, "gen");
      return state.exports.TaskExecutor.runTask(desc, lease);
    });
    expect(outcome).toEqual({
      outcome: "completed",
      result: { content: [{ type: "text", text: "d6:object" }] },
    });
  });
});

describe("TASK_EXECUTOR service binding (D6 fallback)", () => {
  it("the self service-binding reaches the same real runTask", async () => {
    const desc: TaskInvocation = {
      taskId: "t",
      toolName: "echo_task",
      input: { text: "fallback" },
      attempt: 1,
    };
    // echo_task never touches the lease; a plain placeholder crosses fine.
    const outcome = await env.TASK_EXECUTOR.runTask(desc, {} as DurableStepStub);
    expect(outcome).toEqual({
      outcome: "completed",
      result: { content: [{ type: "text", text: "fallback:object" }] },
    });
  });
});

describe("library TaskRunner end to end (production scheduling)", () => {
  // Explicit test timeout: the internal waitFor allows 10s (workerd fires the
  // alarm itself, timing depends on machine load), which exceeds the 5s
  // vitest default.
  it(
    "create -> immediate alarm -> ctx.exports dispatch -> completed",
    { timeout: 20_000 },
    async () => {
      const taskId = uniqueTaskId();
      const stub = env.TASK_RUNNER_LIB.getByName(taskId);
      await stub.create(baseCreateInput(taskId, { input: { text: "prod" } }));

      // workerd fires the immediate alarm itself; the engine claims, resolves
      // the executor through ctx.exports, and the real runTask completes the
      // task — the full production path with zero test seams.
      const row = await waitFor(async () => {
        const current = await readTaskRow(stub);
        return current?.status === "completed" ? current : undefined;
      }, "the library engine to complete the task");

      expect(Number(row.run_attempt)).toBeGreaterThanOrEqual(1);
      expect(JSON.parse(String(row.result))).toEqual({
        content: [{ type: "text", text: "prod:object" }],
      });
    },
  );
});
