# Portability

Status: design note (not built). What the shipped engine locks down to keep other execution engines cheap to add later. The shipped engine itself is documented in `docs/how-it-works.md`.

I want this in the future to use multiple workflow execution engines. atm we are making our own on durable objects but maybe in the future we could use Cloudflare Workflows or an api to Restate or Temporal.

How would this work? is our api designed to be able to do this easily with minimal code changes on the MCP server side?

## the answer

Mostly yes, and it becomes fully yes if we lock two shapes in v0. The MCP side touches an engine in exactly two places. Handler bodies run against the step api, and the tasks/* request handlers call a four method control interface (create, status, result, cancel). Freeze both now and `server.registerTask(name, {inputSchema}, handler)` plus every handler body stays byte-identical across engines. `registerTask` itself never changes.

That is the one design rule that makes it true: the step api and the engine control calls are the only things the MCP side touches, so we lock their shapes now and keep everything engine-specific out of them. No DO types in public signatures, opaque task ids, step api copied from Cloudflare Workflows because that is the convention, engine chosen in `createMcpHandler` config and never in handler code.

The per-engine diff a user sees is config, a few lines of entrypoint wiring, and for external engines, where the handler code deploys:

| engine | registerTask + handlers | wiring | infra |
|---|---|---|---|
| DO engine (v0 default) | unchanged | export `TaskRunner` + `TaskExecutor` | DO binding + sqlite migration |
| Cloudflare Workflows | unchanged | swap to a `createTaskWorkflow` export, engine arg, ~5 lines | `[[workflows]]` binding |
| Restate | unchanged | engine arg + mount a restate endpoint route | run or rent a Restate server, `nodejs_compat` |
| Temporal | unchanged | engine arg | separate Node deployment runs the handlers |

The honest limit sits in operations, not code. Restate adds a server you operate or rent. Temporal moves handler code into a separate Node deployment and forces it to change shape. No api design on our side removes that.

## the boundary

Two seams, with different portability.

### control seam

What the tasks/* handlers call. Everything here is request/response over JSON, so every engine can satisfy it cheaply.

```ts
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type TaskStatus = "working" | "input_required" | "completed" | "failed" | "cancelled";

// Dialect-neutral snapshot. The MCP layer projects this onto whichever wire
// version the client negotiated. Engines never see wire shapes.
interface TaskSnapshot {
  taskId: string;                 // opaque, unguessable
  status: TaskStatus;
  statusMessage?: string;         // the only progress channel the spec allows
  createdAt: string;              // ISO 8601
  lastUpdatedAt: string;
  ttlMs: number | null;
  pollIntervalMs?: number;
  result?: CallToolResult;        // present iff completed
  error?: { code: number; message: string; data?: JsonValue };  // iff failed
}

interface CreateTaskParams {
  taskName: string;               // the registerTask name
  input: JsonValue;               // schema-validated tool arguments
  ttlMs?: number | null;
  pollIntervalMs?: number;
  principal?: string;             // auth binding, re-checked on every tasks/* request
}

interface TaskEngine {
  // Durably create AND schedule. Must not resolve before a subsequent
  // status(taskId) would succeed. ext-tasks hard rule.
  create(params: CreateTaskParams): Promise<TaskSnapshot>;

  // Throws TaskNotFoundError for unknown or expired ids.
  status(taskId: string): Promise<TaskSnapshot>;

  // Terminal result. Exists because SDK 2.0.0 still speaks the 2025-11-25
  // dialect with a separate tasks/result method, while the current draft
  // inlines the result in tasks/get. The engine serves both from one record.
  result(taskId: string): Promise<CallToolResult>;

  // Cooperative. Resolves on acknowledgement, the task may still finish
  // completed or failed. Idempotent.
  cancel(taskId: string): Promise<void>;

  // Reserved, optional in v0. tasks/update and notifications/tasks.
  provideInput?(taskId: string, responses: InputResponses): Promise<void>;
  watch?(taskId: string, onStatus: (s: TaskSnapshot) => void): () => void;
}

type TaskEngineFactory = (env: unknown) => TaskEngine;
```

There is no `list`. The current ext-tasks draft (dcc8d2b, 2026-08-20) removed tasks/list deliberately, cross-caller correlation is a security problem. Keep it out of the engine interface. If an admin UI wants a listing later, that is a capability of our task record, not of engines.

### execution seam

The `(input, step) => Promise<CallToolResult>` handler body and the step contract it runs against. This is not an interface you call, it is a runtime the engine provides, and that difference is the whole portability problem. The handler must physically run inside the engine's runtime.

```ts
type Duration = number | `${number} ${"second" | "minute" | "hour" | "day" | "week" | "month" | "year"}${"s" | ""}`;

// Field names identical to CF's WorkflowStepConfig.
interface StepConfig {
  retries?: { limit: number; delay: Duration; backoff?: "constant" | "linear" | "exponential" };
  timeout?: Duration;
}

interface Step {
  // Durable, at-least-once, journaled by (name, occurrence count).
  // Callbacks are zero-arg on purpose. () => Promise<T> is assignable to
  // CF's (ctx) => Promise<T>, so we can add an optional ctx later.
  do<T extends JsonValue | void>(name: string, fn: () => Promise<T>): Promise<T>;
  do<T extends JsonValue | void>(name: string, config: StepConfig, fn: () => Promise<T>): Promise<T>;

  // name required. It is the replay cache key on CF Workflows.
  sleep(name: string, duration: Duration): Promise<void>;
  sleepUntil(name: string, timestamp: Date | number): Promise<void>;

  // Feeds TaskSnapshot.statusMessage. At-least-once, may re-emit on replay.
  report(message: string): Promise<void>;

  // Reserved: waitForEvent(name, { type, timeout? }). Pairs with tasks/update.
}

type TaskHandler<In extends JsonValue = JsonValue> = (input: In, step: Step) => Promise<CallToolResult>;
```

The signatures are Cloudflare Workflows' signatures, verified against `@cloudflare/workers-types@5.20260820.1`. `step.do(name, config?, cb)` matches, including the config shape and its defaults (limit 5, delay 10s, exponential backoff, 10 minute timeout). CF's current type has grown optional extras we skip: delay functions, rollback handlers, a sensitive flag. Our shape is the assignable core. This is deliberate. CF Workflows is the convention on this platform and the closest future engine, so matching it verbatim makes that adapter nearly a pass-through. One correction to the brief falls out: `step.sleep()` with no name cannot exist, the name is load-bearing.

Rules that keep the public api engine-neutral:

- No `DurableObjectNamespace`, `RpcTarget`, `WorkflowStep`, alarm or SQLite type in any public signature. `DurableStep` implements `Step`, users never see it. Engine factories take binding names as strings and resolve `env` internally.
- Task ids are opaque entropy strings. The spec lets ids act as bearer tokens, so they must be unguessable, and we never promise any relationship between a taskId and a DO id, Workflows instance id, or Restate invocationId. Adapters keep an internal mapping.
- Step returns, inputs and results are plain JSON, 1 MiB max serialized. JSON is stricter than the structured clone the DO engine could accept, and that strictness is what buys Restate and Temporal later. Enforce it in the DO engine from day one so nobody ships a handler that only works there.
- Determinism rules copied from CF's rules-of-workflows as our documented contract. Side effects only inside `step.do`, state built only from step returns, deterministic step names, idempotent steps, `Date.now` and `Math.random` inside steps only. Restate and Temporal impose the same rules, so handler semantics transfer.
- The task record always lives in our store, on every engine. Engines execute, the record answers tasks/get. This rule is load-bearing, not an optimization. The spec bans notifications/progress on tasks so `statusMessage` is the only progress channel, and CF's `InstanceStatus` has no message field at all. It also covers results past engine retention, `inputRequests`, and per-session auth scoping, none of which any engine stores for us.

## engine by engine

### our DO engine (default)

The `TaskRunner` DO holds the task record and the step journal in SQLite and drives execution with alarms. `create` writes the row, then schedules the alarm, then resolves, which satisfies the spec's durable-creation rule by construction. The alarm calls `TaskExecutor` (a WorkerEntrypoint built from `createServer`) over RPC, through the vendored retry wrapper, passing a `DurableStep` RpcTarget as the step. `status` and `result` read the row. `cancel` sets a flag the executor checks between steps.

The four methods map onto one SQLite row, which is why this engine can do things the others cannot: `statusMessage` is a column, ttl is arbitrary, small tasks can complete near-inline, step count is bounded only by storage. The catch is that we build and operate everything ourselves. Retries, backoff, timers, observability, and the vitest helpers, none of it comes free. The vitest-pool-workers Workflows introspection api (`introspectWorkflowInstance`, `disableSleeps`, `mockStepResult`) is a good blueprint for the test helpers we owe ourselves.

### cloudflare workflows

The closest fit. If v0 adopts the signatures above verbatim, the handler diff is zero. The adapter is a generated `WorkflowEntrypoint` that reads `{taskName, input}` from `event.payload`, looks up the registered handler, and hands it the real CF `step`. One line of unwrapping. The remaining api diff is `waitForEvent`, which returns `{payload, timestamp, type}` per the `.d.ts`, and which we have reserved rather than shipped, so the shape decision is still open.

The four methods map as: `create` is `env.TASK_WORKFLOW.create({id: taskId, params})`, which throws on a duplicate id and so enforces uniqueness for us. `status` is `instance.status()` with queued, running, paused, waiting and waitingForPause mapped to `working`, errored to `failed`, terminated to `cancelled`, complete to `completed`. `result` is `status().output`. `cancel` is `instance.terminate()`, guarded because it throws on already-terminal instances.

The catch is that Workflows replaces the execution engine, not the task record. `InstanceStatus` has no message field, the binding has no list method, retention caps at 30 days paid and 3 days free so `ttlMs` beyond that would silently lose results, and "waiting" conflates sleeping with waiting for an event, so `input_required` needs side metadata. Every one of those is served by our record instead. Limits that bite: 1 MiB per step result and per event payload, 1,024 steps free and 10,000 paid by default, `create()` enqueues so there is no synchronous path for small tasks, and per-step billing was announced 2026-07-07 to start no earlier than 2026-08-10, so a chatty many-tiny-steps design now has a direct cost here.

What we get in exchange: managed retries and backoff, 365 day sleeps at zero CPU cost, restart-from-step, the dashboard and visualizer, and shipped vitest helpers.

### restate

The control plane is plain HTTP from the Worker, zero new dependencies. `POST {ingress}/restate/send/TaskWorkflow/{taskId}/run` creates (workflow keys run once, resubmitting the same key returns the same invocationId with status "PreviouslyAccepted" instead of starting a second run, so creation retries are idempotent for free). `GET /restate/output/{invocationId}` peeks the result, HTTP 470 while still running (verified from the SDK client source, not a documented status table, confirm against a live server during implementation). `GET /restate/attach/{id}` blocks for the result, but prefer polling `output` from a Worker. `cancel` is `PATCH :9070/invocations/{id}/cancel` on the admin api, same bearer key on Restate Cloud.

The surprise is that handler code can stay in the user's Worker. The Restate TS SDK officially runs on Workers as a fetch endpoint (`nodejs_compat` required). The Restate server invokes the Worker and journals every step, `step.do(name, fn)` maps to `ctx.run(name, fn)`, `step.sleep` to `ctx.sleep` (Restate's journal is positional, the name drops). The closure model survives intact.

The catch is operational. A Restate server, self-hosted or Restate Cloud, becomes mandatory infrastructure, and the invocation direction inverts: Restate calls the Worker, so the Worker must be publicly reachable and authenticated, and journal progress flows over inbound HTTP requests whose count per task, latency and invocation cost we have not measured. Completed results are retained 24 hours by default, so the adapter re-persists results into our record at completion. Licensing is fine for our use, the server is BSL 1.1 (using it behind your own product is explicitly permitted) and the SDK is MIT. The endpoint SDK is a new npm dependency and needs Matt's explicit approval per the dependency policy. The control adapter needs no dependency at all.

### temporal

Self-hosted Temporal since v1.22 has a real HTTP api (grpc-gateway on the frontend, default port 7243), verified from the proto annotations: `POST /api/v1/namespaces/{ns}/workflows/{taskId}` starts with a `request_id` for idempotency, `GET .../workflows/{taskId}` describes, the result comes from `GET .../history` with the close-event filter, `POST .../cancel` requests cooperative cancellation, exactly MCP's semantics, and signal or update carries input for `input_required`. Payloads are protobuf JSON with base64 bytes envelopes, easy to get subtly wrong, and any customer using Temporal payload codecs would break a naive fetch adapter.

Temporal Cloud is the problem. Its data plane is gRPC only, the sole HTTP api is the Cloud Ops api, whose docs state it does not allow interaction with workflows (checked 2026-08-20), and `@temporalio/client` does not run on Workers, it needs Node. So control from a Worker means self-hosted Temporal only, today.

The catch is bigger than control. Handler code moves wholesale into Temporal workers, long-lived Node processes polling task queues, and it changes shape when it moves. Temporal has no inline journaled closure, side effects must be pre-registered named activities, so `step.do(name, fn)` cannot cross that boundary as written. Adopting Temporal restructures handlers, it does not relocate them. Treat Temporal as possible with a planned code migration, never as an adapter swap, and say so in the readme when the time comes.

## what we lock down in v0

1. `step.do(name, fn)` and `step.do(name, config, fn)`, with `StepConfig` copied field-for-field from CF's `WorkflowStepConfig`.
2. `step.sleep(name, duration)` with a required name, plus `step.sleepUntil(name, timestamp)`. Fix the brief's `step.sleep()` example. Synthesizing names later is fragile in loops and branches.
3. Zero-arg step callbacks, so an optional ctx parameter can arrive later without breaking anyone.
4. JSON-serializable step returns, inputs and results, 1 MiB max, enforced by the DO engine from day one. Loosening later is easy, tightening later breaks users.
5. Journal keyed by step name plus occurrence count, matching CF's replay cache and its restart-from-step semantics.
6. The determinism rules above, documented as our contract, copied from CF's rules-of-workflows.
7. The `TaskEngine` interface as written, with engine selection in `createMcpHandler` config plus which classes the user exports. `createServer` with its `registerTask` calls is the engine-invariant artifact.
8. No engine types in public signatures. Binding names as strings.
9. Opaque entropy task ids, with an `engineRef` column in the task record from day one so external adapters never need a schema migration.
10. `step.report(message)` as the single progress channel, written to our task record, documented as at-least-once.
11. The task record lives in our store on every engine. Build `TaskRunner` as record plus driver internally, so the Workflows adapter reuses the record and only replaces the driver.
12. Export a `NonRetryableError` mirroring the one in `cloudflare:workflows`.
13. Reserve `provideInput`, `watch` and `step.waitForEvent` as optional members now, so adding them is not a breaking change.

## open questions

1. `waitForEvent` return shape, bare payload or `{payload, timestamp, type}`. CF's `.d.ts` says wrapped, and the docs examples never read a property off the return value, so they settle nothing. Recommendation: wrapped, matching the `.d.ts`. Unwrapping later is additive, wrapping later breaks every handler that uses it.
2. Which tasks dialect 001 targets. SDK 2.0.0 dispatches the 2025-11-25 dialect (separate tasks/result, tasks/list, notifications/tasks/status), the current ext-tasks draft inlines the result in tasks/get, adds tasks/update, and drops list. Recommendation: engines return `TaskSnapshot` only and the MCP layer projects per negotiated version, so the drift never reaches an engine. Align this with 001 once it lands.
3. `input_required` in v0. Recommendation: reserve the interface, build nothing. It pairs with tasks/update and `step.waitForEvent` later.
4. Per-task `ttlMs` and `pollIntervalMs` overrides in the `registerTask` options object. Recommendation: accept them now, defaults from package config. Cheap now, annoying to retrofit.
5. Temporal adapter architecture, if ever built. Bundle the user's handlers into a Node Temporal worker (code moves, no callback hops) or ship a generic interpreter workflow whose single activity calls back into `TaskExecutor` over HTTP (code stays put, per-step network hops, Worker must be reachable from the Temporal worker). Recommendation: decide nothing until someone asks for Temporal, and recheck Temporal Cloud's HTTP support first, since that could flip the picture.
6. Restate and Temporal SDK dependencies each need Matt's explicit approval per the dependency policy before any adapter work. Recommendation: a spike per engine before any design commitment. Noting the policy here, not deciding it.
7. Whether Workflows' `create()` resolves only after durable persistence, which the spec's durable-creation rule requires. Unverified. Recommendation: every adapter writes our task record first, which makes the answer moot.
