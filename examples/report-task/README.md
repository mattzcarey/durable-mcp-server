# report-task

The `durable-mcp-server` example, as a real worker: a stateless MCP server on Cloudflare Workers whose long-running tools are durable tasks. The whole integration is `src/index.ts` — a server factory plus three exports — and the two mechanical `wrangler.jsonc` obligations (the `TASK_RUNNER` Durable Object binding and its SQLite migration).

```ts
export { TaskRunner }; // standardized DO, zero user code
export const TaskExecutor = createTaskEntrypoint(createServer);
export default createMcpHandler(createServer); // MCP at the worker root
```

`createServer` takes no arguments; code that needs bindings imports `env` from `cloudflare:workers`.

## What the server registers

- **`send_report`** (task) — the canonical durable workflow:
  1. `step.do("fetch-data")` — GET `${REPORT_API_URL}/data` for the recipient. Journaled: on any replay the persisted report is returned without re-fetching.
  2. `step.sleep("cool-off", "5s")` — a durable sleep. The invocation suspends; a Durable Object alarm resumes it. No compute is held open (tests fire the alarm instantly).
  3. `step.do("send", { retries: { limit: 10 } })` — POST `${REPORT_API_URL}/send`, with a per-step retry override. A 500 is retried with backoff through the journal; the step's idempotency key (`${taskId}:send`) is sent along, since execution is at-least-once per step.
- **`approve_report`** (task, experimental `step.elicit`) — compile the report, then suspend as `input_required` until the client answers the approval elicitation via `tasks/update`; send or discard accordingly.
- **`echo`** (plain tool) — ordinary tools are unchanged by the tasks machinery.

## Running it

```sh
pnpm --filter report-task-example dev    # wrangler dev on port 8789
```

MCP is served at the worker root: `http://localhost:8789/`. Point `REPORT_API_URL` (a var in `wrangler.jsonc`, default `https://report-api.example.com`) at a real endpoint serving `GET /data` and `POST /send` — in tests an auxiliary workerd worker plays that role.

## Driving it as a client

Every request is a modern (2026-07-28) Streamable HTTP POST: one JSON-RPC message, `Mcp-Method` header, and the per-request `_meta` envelope. Task-capable clients declare the extension per request:

```jsonc
// POST /  (Mcp-Method: tools/call, Mcp-Name: send_report)
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "send_report",
    "arguments": { "to": "alice@example.com" },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {
        "extensions": { "io.modelcontextprotocol/tasks": {} },
      },
    },
  },
}
```

The call returns a flat `CreateTaskResult` (`resultType: "task"`) as soon as the task row is durably committed — never an unfindable task. Without the extension declared, a task tool is refused with `-32021` (+HTTP 400); plain tools still work.

Poll with `tasks/get` (`Mcp-Name: <taskId>`): the response is the task snapshot with status-specific fields inlined — a completed task carries the full `CallToolResult` in `result` (there is no `tasks/result` in SEP-2663). `working ⇄ input_required` until terminal `completed | failed | cancelled`; unknown or expired taskIds answer `-32602`.

For `approve_report`, a `tasks/get` in `input_required` carries the elicitation under `inputRequests.approval`; answer it with:

```jsonc
// POST /  (Mcp-Method: tasks/update, Mcp-Name: <taskId>)
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tasks/update",
  "params": {
    "taskId": "<taskId>",
    "inputResponses": { "approval": { "action": "accept", "content": { "approve": true } } },
    "_meta": {/* same envelope */},
  },
}
```

`tasks/cancel` acks immediately and cancels cooperatively at the next step boundary; work that finishes first stays `completed`.

## Tests

```sh
pnpm --filter report-task-example test
```

Integration tests only (the package suite owns the internals): full task lifecycles over real Streamable HTTP against the worker's fetch surface, wire shapes validated with the package's exported zod schemas, alarms driven with `runDurableObjectAlarm`, and eviction simulated with `evictDurableObject`. The report API is a real auxiliary workerd worker (`test/support/report-api.js`) wired in as the example worker's outbound service — workerd egress cannot be intercepted by msw/node, so upstream behavior (request counts, injected 500s) is observed over real HTTP instead of mocks.
