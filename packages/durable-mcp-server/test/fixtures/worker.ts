/**
 * The package's fixture worker (design/002 §3): imports from ../../src (never
 * the package name — dist may be stale when the package's own tests run) and
 * mirrors the docs/how-it-works.md §2 (the three layers) and §7 (wire contract) consumer shape.
 *
 * Three TaskRunner flavors are bound:
 *
 * - `TaskRunner` (binding TASK_RUNNER): the stage-2 test subclass — executor
 *   resolution goes to the module-level fake (test/fixtures/fake-executor)
 *   so the DO state machine is testable in isolation; execution wakes are
 *   scheduled far in the future so workerd never fires alarms on its own
 *   (`runDurableObjectAlarm` drain loops are the only driver), and the
 *   handoff deadline is test-overridable.
 * - `RealTaskRunner` (binding TASK_RUNNER_REAL): the REAL dispatch under
 *   deterministic scheduling — executor resolution untouched (decision D6:
 *   ctx.exports.TaskExecutor first, TASK_EXECUTOR service binding fallback),
 *   wakes pinned far-future. Stage-3 workflow tests run here.
 * - `LibraryTaskRunner` (binding TASK_RUNNER_LIB): the library class
 *   untouched — production executor resolution AND production scheduling
 *   (workerd fires its immediate wakes on its own).
 */

import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  callTaskRunner,
  createMcpHandler,
  createTaskEntrypoint,
  McpServer,
  NonRetryableError,
  TaskRunner as LibTaskRunner,
} from "../../src";
import type { InputRequest, TaskExecutorLike } from "../../src";
import { currentHandoffMs, fakeExecutor } from "./fake-executor";
import { recordRun } from "./task-state";

/**
 * Far-future execution wake (design/002 determinism rule): genuinely-due
 * alarms would be fired by workerd itself, racing the deterministic drain
 * loops. Execution wakes are due-on-fire, so pushing them out changes
 * nothing about what a drained alarm does.
 */
const FAR_FUTURE_WAKE_DELAY_MS = 300_000;

/**
 * Step retry policy whose backoff lands far in the future, for the same
 * determinism reason: retry wakes are executor-computed wall-clock times.
 */
const FAR_FUTURE_RETRIES = { limit: 3, baseDelayMs: 600_000, maxDelayMs: 600_000 };

/** The standing player-action request the story fixtures offer. */
const ACTION_REQUEST: InputRequest = {
  method: "elicitation/create",
  params: {
    message: "what do you do?",
    requestedSchema: { type: "object", properties: { action: { type: "string" } } },
  },
};

export const createServer = () => {
  const server = new McpServer({ name: "durable-mcp-fixture", version: "0.0.0" });

  // An ordinary (non-task) tool: stage-4 conformance asserts it is entirely
  // unaffected by the tasks machinery on both protocol eras.
  server.registerTool(
    "echo_tool",
    { description: "ordinary synchronous tool", inputSchema: z.object({ text: z.string() }) },
    async ({ text }) => ({ content: [{ type: "text", text: `echo:${text}` }] }),
  );

  // env must resolve via cloudflare:workers everywhere (API revision
  // 2026-08-21) — reference it from a handler so a resolution failure is
  // loud in every lane.
  server.registerTask(
    "echo_task",
    { description: "fixture task", inputSchema: z.object({ text: z.string() }) },
    async (input) => ({
      content: [{ type: "text", text: `${input.text}:${String(typeof env)}` }],
    }),
  );

  // Multi-step workflow: journaling, durable sleep, replay memoization.
  server.registerTask(
    "pipeline_task",
    {
      description: "two steps around a durable sleep",
      inputSchema: z.object({ text: z.string() }),
    },
    async (input, step) => {
      const first = await step.do("step-1", async () => {
        recordRun(step.idempotencyKey("step-1"));
        return `${input.text}-1`;
      });
      await step.sleep("nap", "1h"); // long sleep: determinism rule
      const second = await step.do("step-2", async () => {
        recordRun(step.idempotencyKey("step-2"));
        return `${first}-2`;
      });
      return { content: [{ type: "text", text: second }] };
    },
  );

  // Step retries: fails `failures` times, then succeeds. Far-future backoff.
  server.registerTask(
    "flaky_task",
    {
      description: "step that fails N times",
      inputSchema: z.object({ failures: z.number() }),
      retries: FAR_FUTURE_RETRIES,
    },
    async (input, step) => {
      const value = await step.do("wobbly", async () => {
        const run = recordRun(step.idempotencyKey("wobbly"));
        if (run <= input.failures) {
          throw new Error(`wobble ${run}`);
        }
        return `steady after ${run}`;
      });
      return { content: [{ type: "text", text: value }] };
    },
  );

  // NonRetryableError: immediate terminal step failure -> completed + isError.
  server.registerTask(
    "doomed_task",
    { description: "non-retryable throw" },
    async (_input, step) => {
      await step.do("explode", async () => {
        recordRun(step.idempotencyKey("explode"));
        throw new NonRetryableError("bad input, giving up");
      });
      return { content: [{ type: "text", text: "unreachable" }] };
    },
  );

  // Handler throw with no step involved -> completed + isError.
  server.registerTask("throwing_task", { description: "handler throws" }, async () => {
    throw new Error("handler exploded");
  });

  // A step returning `undefined`: the undefined-safe envelope must round-trip
  // it through the journal, and the post-sleep replay proves the memoized
  // value is genuinely `undefined` (not a serialization artifact).
  server.registerTask(
    "void_task",
    { description: "step that returns undefined" },
    async (_input, step) => {
      const value = await step.do("void-step", async () => {
        recordRun(step.idempotencyKey("void-step"));
        return undefined;
      });
      await step.sleep("void-nap", "1h"); // forces a replay through the journal hit
      return { content: [{ type: "text", text: `undef:${String(value === undefined)}` }] };
    },
  );

  // Same-run duplicate step name -> DuplicateStepError (decision D8).
  server.registerTask(
    "duplicate_task",
    { description: "duplicate step name" },
    async (_input, step) => {
      await step.do("twice", async () => 1);
      await step.do("twice", async () => 2);
      return { content: [{ type: "text", text: "unreachable" }] };
    },
  );

  // Per-attempt timeout: first attempt hangs past timeoutMs, second is quick.
  server.registerTask(
    "slow_task",
    { description: "first attempt times out", retries: FAR_FUTURE_RETRIES },
    async (_input, step) => {
      const value = await step.do("slow", { timeoutMs: 50, retries: { limit: 2 } }, async () => {
        const run = recordRun(step.idempotencyKey("slow"));
        if (run === 1) {
          await new Promise<never>(() => {
            // hang past the 50ms timeout; only the race resolves this attempt
          });
        }
        return `quick ${run}`;
      });
      return { content: [{ type: "text", text: value }] };
    },
  );

  // step.elicit (decision D13): prep step, then wait for client input.
  server.registerTask(
    "elicit_task",
    { description: "asks the client for a color" },
    async (_input, step) => {
      const prep = await step.do("prep", async () => {
        recordRun(step.idempotencyKey("prep"));
        return "ready";
      });
      const answer = await step.elicit("color", {
        method: "elicitation/create",
        params: {
          message: "pick a color",
          requestedSchema: { type: "object", properties: { color: { type: "string" } } },
        },
      });
      return { content: [{ type: "text", text: JSON.stringify({ prep, answer }) }] };
    },
  );

  // step.elicit with an answer deadline: answered in time resolves with the
  // discriminated answered outcome; unanswered past the deadline resolves as
  // timed out and takes the limp-home branch (the sleep keeps a working
  // window open so tests can observe the resumed state and prove late
  // answers change nothing). Deadlines are wall-clock honest — tests pass a
  // far-future timeoutMs and rewind `timeout_at` instead of waiting.
  server.registerTask(
    "timed_elicit_task",
    {
      description: "asks with a deadline; times out into a limp-home branch",
      inputSchema: z.object({ timeoutMs: z.number() }),
    },
    async (input, step) => {
      const prep = await step.do("prep", async () => {
        recordRun(step.idempotencyKey("prep"));
        return "ready";
      });
      const outcome = await step.elicit(
        "pit-call",
        {
          method: "elicitation/create",
          params: {
            message: "box this lap?",
            requestedSchema: { type: "object", properties: { box: { type: "boolean" } } },
          },
        },
        { timeoutMs: input.timeoutMs },
      );
      if (outcome.outcome === "timed_out") {
        await step.sleep("limp-home", "1h"); // long sleep: determinism rule
        return { content: [{ type: "text", text: `${prep}:timed-out` }] };
      }
      return {
        content: [{ type: "text", text: `${prep}:${JSON.stringify(outcome.response)}` }],
      };
    },
  );

  // step.status telemetry: the handler is the only status_message writer.
  // The replay after the sleep re-delivers the earlier messages harmlessly
  // before the final one lands (single-writer semantics, revision 2).
  server.registerTask(
    "status_task",
    {
      description: "handler-owned statusMessage telemetry",
      inputSchema: z.object({ text: z.string() }),
    },
    async (input, step) => {
      // Each delivered beat is recorded so tests can prove replay silence:
      // the counter is bumped by the HANDLER call, but `step.status` itself
      // only writes when the handler is past its last journal hit.
      const say = async (text: string) => {
        await step.status(text);
        recordRun(step.idempotencyKey("status"));
      };
      await say("warming up");
      const value = await step.do("work", async () => {
        recordRun(step.idempotencyKey("work"));
        return input.text.toUpperCase();
      });
      await say(`sent "${value}"`);
      await step.sleep("cool-down", "1h"); // long sleep: determinism rule
      await say("wrapping up");
      return { content: [{ type: "text", text: `done:${value}` }] };
    },
  );

  // Standing offers (non-blocking input channels): the datacenter-adventure
  // shape. A standing offer rides tasks/update WITHOUT elicitation while the
  // story keeps running (working); beats are long sleeps (determinism rule)
  // that an answer cuts short; the journaled checkInput at the next beat
  // boundary consumes the answer, a sub-branch runs, and a fresh offer
  // replaces the consumed one. Nobody answering runs the beats to the end.
  server.registerTask(
    "story_task",
    {
      description: "standing offer + beats + sub-branch",
      inputSchema: z.object({ beats: z.number() }),
    },
    async (input, step) => {
      await step.offer("act-1", ACTION_REQUEST);
      for (let beat = 1; beat <= input.beats; beat++) {
        await step.status(`beat ${beat}`);
        await step.sleep(`beat-${beat}`, "1h");
        const action = await step.checkInput(`check-${beat}`, "act-1");
        if (action === null) {
          continue;
        }
        const branch = await step.do("sub-branch", async () => {
          recordRun(step.idempotencyKey("sub-branch"));
          return `branch:${JSON.stringify(action)}`;
        });
        await step.offer("act-2", ACTION_REQUEST); // re-offer under a fresh key
        await step.status("epilogue");
        await step.sleep("epilogue", "1h");
        const encore = await step.checkInput("check-epilogue", "act-2");
        return {
          content: [
            {
              type: "text",
              text: `${branch}|act-2:${encore === null ? "open" : JSON.stringify(encore)}`,
            },
          ],
        };
      }
      return { content: [{ type: "text", text: "no action taken" }] };
    },
  );

  // A blocking fork elicit WHILE a standing offer is outstanding: the fork
  // parks the task in input_required (the offer never holds it there and
  // never blocks the resume); after the resume the story checks the offer.
  server.registerTask(
    "fork_task",
    { description: "blocking fork elicit while a standing offer waits" },
    async (_input, step) => {
      await step.offer("act-1", ACTION_REQUEST);
      const fork = await step.elicit("fork", {
        method: "elicitation/create",
        params: {
          message: "left or right?",
          requestedSchema: { type: "object", properties: { way: { type: "string" } } },
        },
      });
      const action = await step.checkInput("check-after-fork", "act-1");
      return {
        content: [
          {
            type: "text",
            text: `fork:${JSON.stringify(fork)}|act-1:${action === null ? "open" : JSON.stringify(action)}`,
          },
        ],
      };
    },
  );

  // step.status with structured meta: the first call writes meta, the
  // message-only call keeps it, the sleep forces a replay (which re-delivers
  // the same calls harmlessly), and the final call replaces it wholesale.
  server.registerTask(
    "status_meta_task",
    {
      description: "handler-owned structured status meta",
      inputSchema: z.object({ text: z.string() }),
    },
    async (input, step) => {
      await step.status("warming up", { phase: "warmup", lap: 0 });
      const value = await step.do("work", async () => {
        recordRun(step.idempotencyKey("work"));
        return input.text.toUpperCase();
      });
      await step.status(`sent "${value}"`); // no meta: the warmup meta stands
      await step.sleep("cool-down", "1h"); // long sleep: determinism rule
      await step.status("wrapping up", { phase: "done", lap: 3 }); // replaced wholesale
      return { content: [{ type: "text", text: `done:${value}` }] };
    },
  );

  // Cooperative cancel observed MID-RUN: a step closure cancels its own task,
  // so the next beginStep returns the `cancelled` directive.
  server.registerTask(
    "cancel_mid_task",
    { description: "cancels itself between steps", inputSchema: z.object({ taskId: z.string() }) },
    async (input, step) => {
      await step.do("step-1", async () => {
        recordRun(step.idempotencyKey("step-1"));
        return "one";
      });
      await step.do("request-cancel", async () => {
        await callTaskRunner(env.TASK_RUNNER_REAL, input.taskId, (stub) => stub.cancel());
        return true;
      });
      await step.do("step-2", async () => {
        recordRun(step.idempotencyKey("step-2"));
        return "two";
      });
      return { content: [{ type: "text", text: "unreachable" }] };
    },
  );

  // Cancel AFTER the last step: work that finishes first stays completed.
  server.registerTask(
    "cancel_late_task",
    {
      description: "cancel lands after the last step",
      inputSchema: z.object({ taskId: z.string() }),
    },
    async (input, step) => {
      await step.do("work", async () => "done-work");
      await step.do("late-cancel", async () => {
        await callTaskRunner(env.TASK_RUNNER_REAL, input.taskId, (stub) => stub.cancel());
        return true;
      });
      return { content: [{ type: "text", text: "finished anyway" }] };
    },
  );

  return server;
};

/** Stage-2 fixture DO: fake executor + deterministic scheduling seams. */
export class TaskRunner extends LibTaskRunner {
  protected override resolveExecutor(): TaskExecutorLike {
    return fakeExecutor;
  }

  protected override get alarmHandoffMs(): number {
    return currentHandoffMs();
  }

  protected override get initialWakeDelayMs(): number {
    return FAR_FUTURE_WAKE_DELAY_MS;
  }

  protected override invocationRetryDelayMs(attempt: number): number {
    void attempt;
    return FAR_FUTURE_WAKE_DELAY_MS;
  }
}

/**
 * Stage-3 fixture DO: REAL executor dispatch (library resolution — decision
 * D6: ctx.exports loopback, service-binding fallback) with deterministic
 * scheduling seams only.
 */
export class RealTaskRunner extends LibTaskRunner {
  protected override get alarmHandoffMs(): number {
    return currentHandoffMs();
  }

  protected override get initialWakeDelayMs(): number {
    return FAR_FUTURE_WAKE_DELAY_MS;
  }

  protected override invocationRetryDelayMs(attempt: number): number {
    void attempt;
    return FAR_FUTURE_WAKE_DELAY_MS;
  }
}

/** The library DO exactly as consumers export it (D6 verification target). */
export class LibraryTaskRunner extends LibTaskRunner {}

export const TaskExecutor = createTaskEntrypoint(createServer);

/**
 * The HTTP surface under test. Tasks created over the wire land in
 * TASK_RUNNER_REAL (real executor dispatch, deterministic scheduling seams —
 * workerd never fires the far-future wakes on its own), which also exercises
 * the `bindings.taskRunner` option plumbing; the default `TASK_RUNNER`
 * binding stays on the stage-2 fake-executor lane.
 */
export default createMcpHandler(createServer, {
  bindings: { taskRunner: "TASK_RUNNER_REAL" },
});
