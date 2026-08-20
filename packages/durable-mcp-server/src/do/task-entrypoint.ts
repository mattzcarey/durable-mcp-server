/**
 * `createTaskEntrypoint` — builds the `WorkerEntrypoint` that is the stable
 * execution address for task handlers (docs/how-it-works.md §2 (the three layers) and §7 (wire contract)). TaskRunner reaches it
 * via `ctx.exports` (default entrypoint name `"TaskExecutor"`) or the
 * explicit self service-binding fallback (decision D6 as amended).
 *
 * `runTask` rebuilds the server via `createServer()` (zero-arg, API revision
 * 2026-08-21 — user code needing bindings imports `env` from
 * `cloudflare:workers`), resolves the handler from the task registration
 * table, wraps the incoming per-lease `DurableStep` stub in the local
 * replay-aware {@link ReplayStep}, and maps outcomes exactly per docs/how-it-works.md
 * §4.4: a handler throw is journaled DO-side as a `completed` + `isError`
 * result — never surfaced as a bare RPC rejection; `failed` is reserved for
 * engine-level errors (unknown tool, broken factory, serialization, invalid
 * retry policy). The entrypoint keeps `this.env`/`this.ctx` for its own
 * dispatch needs only; neither is passed to user code.
 */

import { WorkerEntrypoint } from "cloudflare:workers";
import { ResultSerializationError, RetryPolicyError, serializeError } from "../engine/errors";
import type { CreateServer } from "../server/create-server";
import type { TaskRegistration } from "../server/mcp-server";
import { ReplayStep, SuspendSignal } from "../step/replay-step";
import { isStaleLeaseError } from "./protocol";
import type { DurableStepStub, RunOutcome, TaskExecutorLike, TaskInvocation } from "./protocol";

export type { DurableStepStub, RunOutcome, TaskExecutorLike, TaskInvocation } from "./protocol";

/** The RPC surface of the entrypoint returned by {@link createTaskEntrypoint}. */
export type TaskExecutorMethods = TaskExecutorLike;

/** Constructor type of the generated executor entrypoint. */
export type TaskExecutorClass<Env> = new (
  ctx: ExecutionContext,
  env: Env,
) => WorkerEntrypoint<Env> & TaskExecutorMethods;

/**
 * Creates the task executor entrypoint for a server factory. A fresh server
 * is built per invocation — construction must be cheap and side-effect free.
 */
export function createTaskEntrypoint<Env>(createServer: CreateServer): TaskExecutorClass<Env> {
  class TaskExecutor extends WorkerEntrypoint<Env> implements TaskExecutorMethods {
    async runTask(desc: TaskInvocation, step: DurableStepStub): Promise<RunOutcome> {
      let registration: TaskRegistration | undefined;
      try {
        registration = createServer().getTaskRegistration(desc.toolName);
      } catch (error) {
        // A throwing factory is an engine failure, not a handler error.
        return { outcome: "failed", error: serializeError(error) };
      }
      if (registration === undefined) {
        return {
          outcome: "failed",
          error: {
            name: "UnknownTaskError",
            message: `No task named "${desc.toolName}" is registered`,
          },
        };
      }

      const replayStep = new ReplayStep(step, desc.taskId, registration.retries, desc.attempt);
      try {
        const result = await registration.handler(desc.input, replayStep);
        return { outcome: "completed", result };
      } catch (error) {
        if (error instanceof SuspendSignal) {
          // Sleep recorded / retry scheduled / input requested / cancelled —
          // the DO already journaled why.
          return { outcome: "suspended" };
        }
        if (isStaleLeaseError(error)) {
          // The lease is dead: abandon the attempt (docs/how-it-works.md §6 (reliability: DO RPC retries)). The DO's
          // settlement for this superseded generation is a guarded no-op.
          return { outcome: "suspended" };
        }
        if (error instanceof ResultSerializationError || error instanceof RetryPolicyError) {
          // Engine failures (docs/how-it-works.md §6 (reliability: limits and error taxonomy)) -> task `failed` + JSON-RPC error.
          return { outcome: "failed", error: serializeError(error) };
        }
        // Handler/step failure (docs/how-it-works.md §7 (the wire contract served)): exactly what the synchronous
        // tool call would have returned — `completed` with `isError: true`.
        const detail = serializeError(error);
        return {
          outcome: "completed",
          result: {
            content: [{ type: "text", text: `${detail.name}: ${detail.message}` }],
            isError: true,
          },
        };
      }
    }
  }
  return TaskExecutor;
}
