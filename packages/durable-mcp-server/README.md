# durable-mcp-server

MCP Tasks support for stateless MCP servers on Cloudflare Workers, backed by Durable Objects.

The 2026-07-28 MCP spec made servers stateless; the Tasks extension (`io.modelcontextprotocol/tasks`, SEP-2663) lets a tool call return a task handle the client polls instead of blocking. This package makes that combination feel native: an additive `McpServer` (subclass of the SDK v2 class) with one new method, `server.registerTask(name, config, handler)`, plus a journaled, at-least-once, resumable `step.do` / `step.sleep` workflow engine on Durable Objects (SQLite + alarms) and spec-conformant Tasks wire behavior.

## Quickstart

The whole integration is four exports:

```ts
// src/index.ts
import { McpServer, TaskRunner, createTaskEntrypoint, createMcpHandler } from "durable-mcp-server";
import { z } from "zod";

const createServer = () => {
  const server = new McpServer({ name: "report-server", version: "1.0.0" });
  server.registerTask(
    "send_report",
    { inputSchema: z.object({ to: z.string() }) },
    async (input, step) => {
      const data = await step.do("fetch-data", async () => fetchData());
      await step.sleep("cool-off", "1h");
      await step.do("send", async () => send(input.to, data));
      return { content: [{ type: "text", text: "sent" }] };
    },
  );
  return server;
};

export { TaskRunner }; // standardized DO, zero user code
export const TaskExecutor = createTaskEntrypoint(createServer);
export default createMcpHandler(createServer);
```

`createServer` takes no arguments. Code that needs bindings imports them where it runs:

```ts
import { env } from "cloudflare:workers";
```

```jsonc
// wrangler.jsonc
{
  "name": "report-server",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-20",
  "durable_objects": {
    "bindings": [{ "name": "TASK_RUNNER", "class_name": "TaskRunner" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["TaskRunner"] }],
}
```

Two config obligations, both mechanical: the Durable Object binding and the SQLite migration. `TaskRunner` reaches the executor through `ctx.exports.TaskExecutor`, which is on by default at compatibility date 2026-08-20. On older compatibility dates, add the explicit self service-binding fallback:

```jsonc
"services": [
  { "binding": "TASK_EXECUTOR", "service": "report-server", "entrypoint": "TaskExecutor" }
]
```

A `tools/call` from a client that declares the tasks extension returns a `CreateTaskResult` immediately; the handler runs to completion on the Durable Object (surviving evictions and deploys), and the client polls `tasks/get` for the inlined result. Clients that do not declare the extension get the spec-mandated `-32021` refusal; ordinary `registerTool` tools are unaffected.

## Experimental: step.elicit

`step.elicit(name, request)` records an input request, moves the task to `input_required`, and suspends until a `tasks/update` supplies a matching response; the task then returns to `working` and the step resolves with the client's response. Experimental in v1: one input request can be outstanding per task (a suspending elicit ends the invocation), partial responses are accepted, unknown response keys are ignored, and the first answer for a key wins. With `{ timeoutMs }` the wait is bounded and the step resolves with a discriminated `ElicitOutcome` (`answered` or `timed_out`).

## Standing offers: step.offer / step.checkInput

Non-blocking input channels for long-running stories (the task keeps running while player actions ride `tasks/update`, no elicitation involved):

```ts
await step.offer("act-1", actionRequest); // registers a standing request; nothing suspends
for (let beat = 1; beat <= 3; beat++) {
  await step.status(`beat ${beat}`, { offers: ["act-1"] }); // announce the offer in-story
  await step.sleep(`beat-${beat}`, "30s"); // an answer cuts this short
  const action = await step.checkInput(`check-${beat}`, "act-1"); // journaled, consume-once
  if (action !== null) {
    /* branch into a sub-story, then re-offer under a fresh key */
  }
}
```

- `step.offer(key, request)` registers the request under a lifetime-unique key (shared with elicit names) and returns at once: the task stays `working`, the status is untouched, and the offer is never listed in `tasks/get` `inputRequests` (that field is tied to `input_required` and shows blocking elicits only). Re-offering the key on replay is a no-op.
- `tasks/update` naming the key stores the first answer (later answers ack and change nothing) and wakes the task immediately without touching its status: a pending `step.sleep` is cut short so the next `checkInput` runs; an answer that lands while the handler is executing is consumed by its next `checkInput`, or cuts the next sleep it records (a pending step retry backoff is never pre-empted). An outstanding offer never holds the task in `input_required` and never blocks a fork elicit's resume; an answer that lands while the task is `input_required` is stored and consumed after the elicit resumes.
- `step.checkInput(name, key)` is a journaled step: it resolves with the offer's answer (marking it consumed, so later checks resolve `null`) or `null`, never suspends, and replays deterministically (an answer that lands after a journaled miss is consumed by the next check).

## Structured status: step.status(message, meta?)

`step.status(message)` writes the task's `statusMessage` (the handler is its only writer). The optional `meta` is a plain JSON object (at most 8 KiB serialized) stored next to the message and surfaced by `tasks/get` under `_meta["io.durable-mcp-server/status"]` (absent until written). Every call that passes a `meta` replaces it wholesale; a call without one keeps the stored meta. Both share the single-writer, replay-idempotent, terminal-no-op, generation-guarded rules.

## Advanced: composing with an existing handler

`createMcpHandler` is the recommended one-liner: it runs the tasks front door
(`tasks/get` / `tasks/update` / `tasks/cancel` routed straight to the
TaskRunner Durable Object) and delegates everything else to the official
`createMcpHandler` from `@modelcontextprotocol/server`. If you already have a
fetch-based MCP handler (the official SDK handler with your own options, an
agents-SDK host, ...), compose the front door by hand with `createTasksRouter`:

```ts
import { createTasksRouter } from "durable-mcp-server";

const tasks = createTasksRouter(createServer);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return (await tasks.fetch(request, env, ctx)) ?? existingHandler.fetch(request);
  },
};
```

The router resolves `Response | null`: `null` means "not a tasks request —
yours". Both entry styles are wire-identical (asserted by the test suite).

## Limits and step guidance

- Task inputs and results cross a Durable Object RPC boundary, which caps serialized values at 32 MiB. Stay far below that; around 1 MB is the practical guidance.
- Step return values must be JSON-serializable. `undefined` round-trips faithfully; a non-JSON value fails the task with a serialization error.
- All side effects belong inside `step.do`. The whole handler body re-runs on every resume with completed steps returning persisted results, so code between steps must be cheap and deterministic.
- Keep individual steps short (minutes at most; the per-attempt closure timeout defaults to 5 minutes). For waits, use `step.sleep` / `step.sleepUntil`, which suspend the invocation instead of holding it open.
- Step names are journal keys, unique per task; loops must suffix an index. Reusing a name in one run throws `DuplicateStepError`.
- Execution is at-least-once per step: a crash between an external side effect and the journal commit re-runs exactly that step. Pass `step.idempotencyKey(name)` to external systems that support deduplication.
- Cancellation is cooperative: `tasks/cancel` acks immediately, the engine aborts at the next step boundary, and work that finishes first stays `completed`.
- Defaults (all per-task configurable): `ttlMs` 24h (`null` disables retention), `pollIntervalMs` 5s, step retries `{ limit: 5, baseDelayMs: 1_000, maxDelayMs: 300_000 }`.

How it works: `docs/how-it-works.md`. Testing: `docs/testing.md`.

## Credits

This package vendors external code rather than adding dependencies:

- The Durable Object RPC retry helpers are adapted from [durable-utils](https://github.com/lambrospetrou/durable-utils) by Lambros Petrou (MIT).
- The step ledger, alarm scheduling, retry machinery, and the replay-aware step wrapper in TaskRunner and the executor are adapted from [durability](https://github.com/avenceslau/durability) by Andre Venceslau (ISC).
- Task wire types adapted from the MCP Tasks extension specification ([modelcontextprotocol/ext-tasks](https://github.com/modelcontextprotocol/ext-tasks)), © Model Context Protocol contributors, Apache-2.0.
