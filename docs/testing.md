# Testing

How this repository tests the durable task engine and the apps built on it. Four vitest projects, three of them running inside workerd against real Durable Object SQLite:

| Project | Lane | Test files | Tests | One `vitest run` |
| --- | --- | --- | --- | --- |
| `packages/durable-mcp-server` | workerd (`@cloudflare/vitest-plugin`) | 36 | 274 | about 10 s |
| `apps/task-server` | workerd | 9 | 111 | about 85 s |
| `examples/report-task` | workerd | 5 | 10 | about 2 s |
| `apps/demo-client` | node | 11 | 188 | about 1.5 s |

The counts and timings come from running each project's `vitest run` on one machine. The `task-server` suite is slow on purpose: it plays whole stories over the wire and waits a real 20 second crisis window out.

How the engine itself works is in [how-it-works.md](how-it-works.md) and the apps are described in [demo.md](demo.md). This page is about how the code is exercised.

Contents

1. [The rules](#the-rules)
2. [The four-layer matrix](#the-four-layer-matrix)
3. [What a test drives, as callstacks](#what-a-test-drives-as-callstacks)
4. [Deterministic alarm idioms](#deterministic-alarm-idioms)
5. [How the package is tested](#how-the-package-is-tested)
6. [The apps and the example](#the-apps-and-the-example)
7. [Wire helpers and schema validation](#wire-helpers-and-schema-validation)
8. [Running everything](#running-everything)
9. [Flake discipline](#flake-discipline)

## The rules

Three rules hold across every suite.

1. Everything that touches the engine or a Durable Object runs in workerd through `@cloudflare/vitest-plugin` (the `cloudflareTest` plugin), against real Durable Object SQLite. No `node:sqlite`, no fake storage classes, no in-memory stand-ins for `ctx.storage`. Storage-adjacent logic is tested through a Durable Object fixture and `runInDurableObject` from `cloudflare:test`. The package has no node lane at all: its pure-logic suites under `test/unit/` run in the same workerd project as the Durable Object suites (`packages/durable-mcp-server/vitest.config.ts` includes `test/**/*.test.ts`, nothing else). The two unit suites that use fakes use protocol fakes, not storage fakes: `test/unit/replay-step.test.ts` scripts a `DurableStepStub` (`scriptedStub`) so `ReplayStep` can be driven without a Durable Object, and `test/unit/retries.test.ts` hands `callTaskRunner` a `fakeNamespace` whose `getByName` counts stub construction.
2. `fetch` is never mocked. No `vi.spyOn(globalThis, "fetch")`, no stub transports. msw is the only HTTP mocking tool, and it is used only where a node process makes the calls: `apps/demo-client/src/mcp-tasks/task-lane.test.ts` starts `setupServer` from `msw/node` with `onUnhandledRequest: "error"` and serves a `FakeTasksServer` handler, because the task lane's requests run in the vitest node process and msw intercepts them below `fetch`. Inside workerd msw cannot intercept egress, so an upstream API becomes a real auxiliary worker instead: `examples/report-task/vitest.config.ts` sets `miniflare.outboundService: "report-api"` and defines that worker from `test/support/report-api.js`.
3. Alarms are driven with `runDurableObjectAlarm` drain loops, never real or fake timers. `vi.useFakeTimers` does not reach workerd's alarm scheduler. Deadlines that honor the wall clock (TTL, elicit timeouts) are moved by rewriting the rows they are computed from (`ageTaskBy`, `ageElicitTimeoutBy` in `packages/durable-mcp-server/test/support/helpers.ts`), or, in the wire suites, really waited out (`waitOutCrisis` in `apps/task-server/test/support/play.ts`).

One production rule shows up in the tests from both sides. Every worker-to-`TaskRunner` call in `src` goes through `callTaskRunner` (`src/engine/call-task-runner.ts`), which builds a fresh stub per attempt and retries errors workerd marks `.retryable`. The test helper `createTask` in `test/support/helpers.ts` goes through the same wrapper. The control-plane suites call stub methods bare on purpose (`stub.get()`, `stub.beginStep(generation, ...)`, `stub.cancel()`), because a single RPC's return value or rejection is the thing under test.

## The four-layer matrix

Every engine flow gets asserted at four layers.

1. Data. The raw SQLite rows inside the Durable Object, read with `runInDurableObject`. The helpers in `packages/durable-mcp-server/test/support/helpers.ts` do the reading: `readTaskRow`, `readSteps`, `readInputRequests` (each tolerant of a schema that was never bootstrapped), `getAlarmTime`, `currentGeneration`, and `listTableNames`, whose `[]` result proves a Durable Object carries zero storage writes.
2. Control plane. The `TaskRunner` RPC methods (`create`, `get`, `update`, `cancel`) and the lease methods (`beginStep`, `completeStep`, `failStep`, `recordSleep`, `recordElicit`, `recordOffer`, `checkInput`, `setStatus`) called directly on stubs, plus `alarm()` invoked on the instance.
3. HTTP. Real JSON-RPC POSTs against the worker's `fetch` handler through `SELF.fetch`, with bodies, headers, and HTTP status codes asserted.
4. Integrations. The whole path: create over the wire, drain alarms, poll `tasks/get` to a terminal status, check what the handler closures did.

Where each layer lives:

`packages/durable-mcp-server` covers all four.

- Data and control plane are `test/do/`. Against the fake executor (binding `TASK_RUNNER`): `create-and-get` (9 tests: the exact task row, idempotent re-create, `ttlMs` and `pollIntervalMs` validation, an `undefined` input through the envelope, `get` on an unknown id leaves `listTableNames` empty), `execute` (10: claim bookkeeping and generation rotation, dispatch failure and redelivery, malformed outcomes, engine-level `failed`, non-JSON results, `alarm()` never rejecting, a stray alarm on an empty Durable Object, eviction mid-chain, the handoff race with `setHandoffMs(50)` and the `hang` behavior), `steps` (8: the journal rows, `failStep` retry and terminal dispositions, stale leases rejected while the successor works, `completeStep` on a non-pending step returning `false`, a sleep key reused as a `do` step), `cancel` (5), `update` (6), `ttl` (4), `reconcile` (2: the alarm follows `min(step retry, sleep wake)` and then the purge deadline; nothing pending deletes the alarm), `auth-key` (3), `set-status` (6), `status-meta` (7, including the 8 KiB boundary), `offer` (13), `elicit-timeout` (8), `inflight-wake` (5: updates that land while an attempt is executing, delivered from inside the attempt through the Durable Object's own stub), and `run-task` (5: `runTask` outcome mapping). Against the real executor (binding `TASK_RUNNER_REAL`): `workflow-execute` (4), `workflow-retries` (5), `workflow-cancel` (3), `workflow-elicit` (1), `workflow-elicit-timeout` (3), `workflow-offer` (5), `workflow-status` (2), `workflow-status-meta` (2). `d6-executor-addressing` (4) checks the two executor addresses and runs the untouched library class end to end.
- HTTP is `test/http/`: `conformance` (18: the error ladder, both protocol eras, capability advertising, `auth_key` rejection), `wire-create` (4: the exact flat `CreateTaskResult` bytes and the row persisted before the tool call answers), `composition` (2: `createTasksRouter` in front of the official SDK handler is wire-identical to the package's `createMcpHandler`), `flows` (12), `offer-flows` (4), `status-meta` (2).
- Integrations are the end-to-end paths inside `flows`, `wire-create`, and the `workflow-*` suites, plus the production-scheduling run in `d6-executor-addressing`.
- `test/unit/` holds the pure logic: `replay-step` (40), `wire-schemas` (27, two of them `it.each` tables over the vendored fixture), `errors` (13), `retries` (12), `envelope` (9), `duration` (6), `backoff` (5).

`apps/task-server` covers HTTP and integrations, and adds a pure lane for the story interpreter. `test/task-server.test.ts` (5) smoke-tests the handler wiring: the initialize handshake, `tools/list` answering exactly `["start"]` with the `story` / `name` / `seed` input schema, an unknown story id completing with an `isError` result that names `datacenter` and `odyssey`, `resources/list` present and `prompts/list` answering `-32601`, and 404 outside `/mcp`. `test/tasks.test.ts` (4) is the wire conformance subset for this server. `test/adventure.test.ts` (7), `test/odyssey.test.ts` (2), and `test/stories.test.ts` (16) play the shipped stories over the wire. `test/story-validate.test.ts` (30), `test/story-walk.test.ts` (14), `test/datacenter.test.ts` (14), and `test/story-readability.test.ts` (19) are pure. Engine data and control-plane coverage lives in the package suite, not here.

`examples/report-task` is integrations only. Five files exercise `send_report` and `approve_report` over the wire, including eviction and upstream failures, with no reach into the Durable Object except one probe that reads the alarm clock.

`apps/demo-client` sits outside the matrix: node-environment unit tests over `src/lib`, `src/mcp-tasks`, and a static render of `src/components`.

## What a test drives, as callstacks

These are the paths the suites exercise, written with the real function names. Frames in test support files are marked with their path; everything else is in `packages/durable-mcp-server/src`.

A `tools/call` of a task tool through the HTTP layer (`test/http/wire-create.test.ts`):

```
postModern("tools/call", { name: "echo_task", arguments })      test/support/jsonrpc.ts
  -> modernRequest(...)                                         the 2026-07-28 _meta envelope + Mcp-Method + Mcp-Name headers
  -> SELF.fetch(request)                                        cloudflare:test, the fixture's default export
    -> createMcpHandler(createServer, { bindings: { taskRunner: "TASK_RUNNER_REAL" } }).fetch
      -> createTasksRouter(...).fetch                           probe().taskNames has "echo_task", the request declares the extension: returns null
      -> sdkCreateMcpHandler(() => { server = createServer(); server.configureTaskRunner(env.TASK_RUNNER_REAL); return server }).fetch
        -> SDK tools/call dispatch -> the wire handler registerTask installed through registerTool
          -> McpServer.#createTask(registration, input, ctx)
            -> declaredTasksExtension(ctx)
            -> #resolveTaskRunnerNamespace()
            -> callTaskRunner(namespace, taskId, (stub) => stub.create({...}))
              -> tryWhile(...) -> ns.getByName(taskId) -> TaskRunner.create(req)
                -> #ensureSchema()                              the DDL commits here, on the first write
                -> ctx.storage.transaction: INSERT ... ON CONFLICT DO NOTHING, #readTask(), #reconcileAlarm(txn)
                  -> #nextScheduledAt(row) -> #earliestExecutionWake(row) -> txn.setAlarm(run_next_at)
            -> returns { resultType: "task", ...snapshot }
  <- createTaskResultSchema.parse(resultOf(readJsonRpcResponse(response)))
```

A deterministic tick on the pinned-schedule fixture (`test/do/execute.test.ts`, `test/do/steps.test.ts`):

```
drainTaskAlarms(taskId)                                         test/support/drain.ts
  -> taskStateSnapshot(stub)                                    runInDurableObject: getAlarm + SELECT * FROM task / steps / input_requests
  -> runDurableObjectAlarm(stub)                                cloudflare:test: deletes the pending alarm, awaits instance.alarm()
    -> TaskRunner.alarm()
      -> #alarmTick()
        -> ctx.storage.setAlarm(now + 60_000)                   re-arm first
        -> #readTask()
        -> (an attempt already in flight?) #awaitWithHandoff(#inFlight.settled) and return
        -> (TTL passed?) #purge() | #expire(row, now)
        -> (cancel_requested?) #settleCancelled(now)
        -> #resolveDueElicitTimeouts(now)
        -> #earliestExecutionWake(current)
        -> UPDATE steps SET status = 'completed' WHERE kind = 'sleep' AND wake_at <= horizon
        -> UPDATE task SET run_attempt = run_attempt + 1, run_generation = <uuid> WHERE status = 'working'
        -> #dispatch(current, generation, attempt)
          -> resolveExecutor()                                  the fixture subclass returns fakeExecutor (test/fixtures/fake-executor.ts)
          -> new DurableStep(this, taskId, attempt, generation)
          -> executor.runTask(desc, lease)
          -> #settleOutcome(generation, attempt, outcome)       or #settleDispatchFailure on a throw
            -> #validOutcome(outcome) -> UPDATE task ... WHERE run_generation = ? -> #reconcileAlarm(txn)
          -> #awaitWithHandoff(settled)                         races the attempt against alarmHandoffMs; on handoff #armForHandoff(now)
  -> taskStateSnapshot(stub) again; stop when nothing changed or no alarm is pending
```

The same tick on the real executor (`test/do/workflow-execute.test.ts`, binding `TASK_RUNNER_REAL`), from `runTask` down:

```
TaskExecutor.runTask(desc, step)                                the class createTaskEntrypoint(createServer) returns
  -> createServer().getTaskRegistration(desc.toolName)
  -> new ReplayStep(step, desc.taskId, registration.retries, desc.attempt)
  -> registration.handler(desc.input, replayStep)               the fixture's pipeline_task
    -> ReplayStep.do("step-1", fn)
      -> #runDo -> #claimName -> resolveRetryPolicy
      -> stub.beginStep("step-1", { timeoutMs })                DurableStep.beginStep -> TaskRunner.beginStep -> #requireLease -> INSERT pending row -> { state: "run", attempt: 1 }
      -> runClosureWithTimeout(name, fn, timeoutMs)             the closure calls recordRun(step.idempotencyKey("step-1"))  (test/fixtures/task-state.ts)
      -> serializeValue(value) -> stub.completeStep("step-1", value)   guarded UPDATE ... WHERE status = 'pending' AND run_generation = ?
    -> ReplayStep.sleep("nap", "1h")
      -> #claimName -> parseDuration("1h") -> #recordSleep
      -> stub.recordSleep("nap", wakeAtMs)                      TaskRunner.recordSleep: INSERT kind = 'sleep', #reconcileAlarm -> { state: "pending" }
      -> throw new SuspendSignal(...)
  -> catch: error instanceof SuspendSignal -> return { outcome: "suspended" }
TaskRunner.#settleOutcome: case "suspended" -> run_next_at = NULL (no wake was requested mid-attempt) -> #reconcileAlarm -> alarm = the sleep's wake_at
next drainTaskAlarms tick: the sleep row is marked completed, a fresh claim, runTask again
  -> ReplayStep.do("step-1") -> stub.beginStep -> { state: "completed", value }   the closure does not run; runCount stays 1
  -> ReplayStep.sleep("nap") -> stub.recordSleep -> { state: "completed", latest: true } -> resolves at once
  -> ReplayStep.do("step-2") -> { state: "run", attempt: 1 } -> closure -> completeStep
  -> return { outcome: "completed", result } -> #settleOutcome -> status = 'completed'
```

A TTL test without waiting (`test/do/ttl.test.ts`):

```
createTask(taskId, { ttlMs: 86_400_000 })                       test/support/helpers.ts, through callTaskRunner
ageTaskBy(stub, 2 * TTL)                                        runInDurableObject: UPDATE task SET created_at = created_at - ?
runInDurableObject(stub, (instance) => instance.alarm())
  -> #alarmTick: now >= created_at + ttl_ms, status is working -> #expire(row, now)
    -> UPDATE task SET status = 'failed', error = { code: -32603, message: "Task expired after ...ms" }
    -> #reconcileAlarm(txn)                                     the purge deadline is the same instant, clamped to now
drainTaskAlarms(taskId)
  -> #alarmTick: deadline passed, status is terminal -> #purge()
    -> ctx.storage.deleteAlarm() -> ctx.storage.deleteAll() -> #schemaReady = false
listTableNames(stub) === []   stub.get() === { notFound: true }   runDurableObjectAlarm(stub) === false
```

A poll, an answer, and a cancel through the router (`test/http/flows.test.ts`, `apps/task-server/test/support/play.ts`):

```
callResult("tasks/get", { taskId })                             test/support/jsonrpc.ts
  -> SELF.fetch -> createMcpHandler(...).fetch -> createTasksRouter(...).fetch
    -> JSON.parse(request.clone().text()) -> TASK_METHODS.has(bodyMethod) -> isLegacyRequest(request, message) is false
    -> Mcp-Method and Mcp-Name cross-checks -> declaresTasksExtension(params)
    -> callTaskRunner(namespace, taskId, (stub) => stub.get(undefined))
      -> TaskRunner.get -> #readTask -> #toDetailedSnapshot -> #baseSnapshot + #snapshotMeta (+ #outstandingBlockingRequests when input_required)
    -> completeResult(snapshot, probe().serverInfo) -> jsonRpcResponse(id, { result }, 200)
sendChoice(taskId, key, choice)                                 apps/task-server/test/support/play.ts
  -> callResult("tasks/update", { taskId, inputResponses: { [key]: { action: "accept", content: { choice } } } })
    -> router: stub.get, then stub.update(responses)
      -> TaskRunner.update: UPDATE input_requests SET response, answered = 1 ... RETURNING blocking
         blocking row and none left outstanding -> status = 'working', run_next_at = now + initialWakeDelayMs -> #noteWakeRequest()
         offer row on a working task -> #wakeForInput(now): a pending sleep is marked completed and run_next_at = now + initialWakeDelayMs
      -> #reconcileAlarm(txn)
callResult("tasks/cancel", { taskId })
  -> router: stub.get, then stub.cancel() -> cancel_requested = 1, run_next_at = COALESCE(run_next_at, now + initialWakeDelayMs) -> #reconcileAlarm
  -> the next tick: #settleCancelled(now) when nothing is in flight, or the suspended settle's cancelled UPDATE after a `cancelled` beginStep directive
```

A story played over the wire against its pure projection (`apps/task-server/test/adventure.test.ts`):

```
projectStory(datacenterStory, name, seed, script)               test/support/story-sim.ts: drives walkStory purely, answering asks from the script
startStory(storyId, name, seed)                                 test/support/play.ts -> callResult("tools/call", { name: "start", ... })
  -> the start handler (apps/task-server/src/index.ts)
    -> step.do("setup:seed", ...) -> walkStory(story, { name, seed })
    -> per WalkEvent: beat -> step.status(text, meta); sleep -> step.sleep(stepName, ms); roll -> step.do(stepName, pick);
       ask -> step.elicit(key, request[, { timeoutMs }]); offer -> step.offer(key, request); check -> step.checkInput(stepName, key)
playThrough(taskId, script, seen)                               test/support/play.ts
  -> awaitProgress(...)                                         polls tasks/get without ticking until the in-flight attempt lands its first beat
  -> drainTaskUntil(taskId, WAITING, { observe: collectBeats(seen) })    test/support/tasks.ts
  -> at input_required: sendChoice for scripted presses (to the key the last meta announced), then sendChoice for the fork, or waitOutCrisis for "timeout"
expect(seen).toEqual(projection.beats)   expect(resultText(done)).toBe(projection.ending)
```

The one msw path (`apps/demo-client/src/mcp-tasks/task-lane.test.ts`):

```
callToolAsTask(session, "long-crunch", { n: 42 })               apps/demo-client/src/mcp-tasks/task-lane.ts
  -> sendTaskLaneRequest(session, "tools/call", params, name, fetchImpl)
    -> taskEnvelopeMeta(session.protocolVersion) -> buildTaskLaneHeaders(session, method, mcpName) -> encodeMcpHeaderValue
    -> fetch(session.url, ...)                                  intercepted by msw/node setupServer -> FakeTasksServer.handler()
       the fake checks Bearer auth, Mcp-Session-Id, Mcp-Method vs body, the _meta envelope, Mcp-Name vs params.taskId (-32020)
    -> extractJsonRpcFromSse(text, id) or JSON.parse -> JsonRpcResponseSchema.safeParse
  -> CreateTaskResultSchema.parse(result)
```

## Deterministic alarm idioms

`runDurableObjectAlarm(stub)` deletes the pending alarm, then awaits `instance.alarm()` with no arguments, regardless of the alarm's scheduled time. A one hour `step.sleep` therefore tests instantly. An alarm the handler re-arms survives the call, so a loop walks the whole chain. The engine treats every execution wake as due when the alarm fires (`#alarmTick` honors any pending sleep at or before the wake it is delivering and claims whenever `run_next_at`, a step retry, or a sleep wake is pending), which is what makes early firing safe. TTL deadlines and elicit deadlines are different: they are compared to `Date.now()` inside the tick, so an early fire re-arms without acting.

### Pinned-schedule fixtures and production-scheduling fixtures

workerd under the plugin fires genuinely due alarms on its own. A task created with `setAlarm(now)` would start running before the test's first drain tick, and the drain loops would race the runtime. The package fixture pins the schedule out of the way: `TaskRunner` and `RealTaskRunner` in `packages/durable-mcp-server/test/fixtures/worker.ts` override `initialWakeDelayMs` and `invocationRetryDelayMs` to 300 000 ms, and the fixture tasks that retry use `FAR_FUTURE_RETRIES` (`{ limit: 3, baseDelayMs: 600_000, maxDelayMs: 600_000 }`). Nothing becomes due on its own, and the drain loop is the only driver. `alarmHandoffMs` is overridden to `currentHandoffMs()` so one test can shrink the handoff window to 50 ms.

Three Durable Object flavors are bound in `test/fixtures/wrangler.jsonc`:

- `TaskRunner` (binding `TASK_RUNNER`) also overrides `resolveExecutor()` to return `fakeExecutor` from `test/fixtures/fake-executor.ts`. That isolates the Durable Object state machine: a test sets the behavior with `setFakeBehavior("complete" | "throw" | "suspend" | "hang")` or passes a function that receives the `TaskInvocation` and the `DurableStepStub` and drives the lease methods by hand. The fake records every `invocations` entry and every lease in `leases`, so a test can pick up a superseded lease and prove it is rejected.
- `RealTaskRunner` (binding `TASK_RUNNER_REAL`) keeps the library's executor resolution (`ctx.exports.TaskExecutor`) and pins the schedule only. The `workflow-*` suites run here, and the fixture's default export routes wire-created tasks here through `createMcpHandler`'s `bindings.taskRunner` option, which covers that option at the same time.
- `LibraryTaskRunner` (binding `TASK_RUNNER_LIB`) is the library class untouched: production executor resolution and production scheduling (`initialWakeDelayMs` is 0, so `create()` arms `setAlarm(now)` and workerd fires it).

`apps/task-server` and `examples/report-task` export the library `TaskRunner` untouched, so they always run under production scheduling. Their tests poll instead of draining blindly.

### drainTaskAlarms

`drainTaskAlarms(taskId, { namespace?, max? })` in `packages/durable-mcp-server/test/support/drain.ts` is the driver for the pinned-schedule fixtures. It takes a `taskStateSnapshot` (the alarm time plus every row of `task`, `steps`, and `input_requests`, read with `runInDurableObject`), ticks with `runDurableObjectAlarm`, and stops when no alarm is pending or when a tick changed nothing observable. The quiesce check is what lets TTL tests call it safely: a completed task with a purge deadline 24 hours out keeps an alarm armed forever, and a naive "until no alarm" loop would spin. The safety valve is 100 ticks.

TTL and elicit-timeout tests never wait. `ageTaskBy(stub, ms)` rewinds `created_at`; `ageElicitTimeoutBy(stub, ms)` rewinds every `timeout_at`. The scheduled alarm stays where it was (far in the future), so nothing fires on its own, and the next deterministic tick observes the aged deadline. `test/do/ttl.test.ts` captures the expired `failed` row from inside `runInDurableObject` in the same call that invokes `alarm()`, because the purge deadline is the same instant and the tick's reconcile arms an already-due purge wake that workerd would fire by itself.

### drainTaskUntil

Under production scheduling a pure drain loop can see "no alarm pending" while an attempt is still in flight (workerd already fired the wake). `drainTaskUntil(taskId, statuses, ...)` combines `runDurableObjectAlarm` ticks, which still fast-forward not-yet-due sleeps, with bounded polling of the `tasks/get` wire snapshot until one of the wanted statuses appears, sleeping 25 ms between rounds, with a 15 second default deadline and a descriptive error on timeout. Two copies exist: `apps/task-server/test/support/tasks.ts` (with an `observe` callback that the story suites use to collect every beat) and `examples/report-task/test/support/tasks.ts`. The package's own production-scheduling test in `test/do/d6-executor-addressing.test.ts` uses the same pattern as a local `waitFor` over `readTaskRow`, and the example's `waitFor` polls its report API counts.

The story suites add one refinement in `apps/task-server/test/support/play.ts`. A freshly started or freshly answered task wakes itself (an immediate alarm). Ticking while that attempt is in flight finds no alarm, and the next tick would fast-forward the pace sleep past the beat the attempt just wrote. `awaitProgress` therefore polls `tasks/get` without ticking until the status or `statusMessage` moves, and only then does `playThrough` resume draining. Because every story beat is followed by a durable pace sleep, at most one new beat appears between suspensions, which makes the collected sequence complete rather than sampled.

### Eviction choreography

`evictDurableObject(stub)` is a graceful teardown: in-flight requests drain, the in-memory instance is discarded, SQLite survives, and the next `getByName` is a cold start through the `TaskRunner` constructor (`blockConcurrencyWhile` probing `#hasSchema`). The package uses it in `test/do/execute.test.ts` (eviction mid-chain after a failed dispatch, and eviction to recover a hung attempt), `test/do/workflow-execute.test.ts` (cold start from the journal; `runCount` proves `step-1` ran once across the eviction), `test/do/workflow-elicit-timeout.test.ts` (a journaled deadline survives the cold start), and `test/do/workflow-offer.test.ts` (the offer, its answer, and the armed wake survive).

The recipe that needs the most care is `examples/report-task/test/eviction.test.ts`, because the example runs under production scheduling:

1. Start `send_report` and wait for the first invocation to settle on the `cool-off` sleep. `waitForCoolOffSuspension` in `test/support/tasks.ts` polls until the report API has seen one `/data` call and the Durable Object's alarm, read with `runInDurableObject`, is between 2 and 30 seconds out. Wire snapshots cannot tell "executing fetch-data" from "suspended on the sleep" (both are `working`); while an attempt is in flight the pending alarm is an immediate redelivery or the 60 second backstop, and once it settles it is the sleep's wake, five seconds out.
2. Assert `reportApiCounts(to)` is `{ data: 1, send: 0 }`.
3. `evictDurableObject`, then `drainTaskUntil(taskId, TERMINAL)`.
4. Assert `completed` and `{ data: 1, send: 1 }`. The replay hit the journal for `fetch-data` instead of re-running its closure.

Stale-lease coverage needs no eviction. `test/do/steps.test.ts` runs two ticks with the `throw` behavior so the fake receives two leases, then exercises the first lease's `beginStep`, `completeStep`, and `recordSleep` from inside `runInDurableObject` (workerd forbids cross-actor I/O from the test isolate) and asserts each rejects with "superseded by a newer claim" while the journal stays empty.

## How the package is tested

The fixture worker `packages/durable-mcp-server/test/fixtures/worker.ts` imports from `../../src`, never from the package name. The package's `exports` map points at `./dist`, and the nx `test` target depends only on dependencies' builds (`^build` in `nx.json`), so the package's own `dist` may be stale or absent when its tests run. `apps/task-server` and `examples/report-task` depend on `"durable-mcp-server": "workspace:*"` and therefore import the built `dist` through the exports map; nx builds the package before their tests run. Both shapes stay covered: the source in the package suite, the published artifact in the app and the example.

The fixture mirrors a consumer exactly: a `createServer` factory, `export const TaskExecutor = createTaskEntrypoint(createServer)`, the three Durable Object classes, and `export default createMcpHandler(createServer, { bindings: { taskRunner: "TASK_RUNNER_REAL" } })`. It registers one plain tool (`echo_tool`) and one task per engine behavior: `echo_task` (proves `env` from `cloudflare:workers` resolves inside the executor), `pipeline_task` (two steps around a one hour sleep), `flaky_task`, `doomed_task` (`NonRetryableError`), `throwing_task`, `void_task` (an `undefined` step result through the envelope and a replay), `duplicate_task`, `slow_task` (a 50 ms per-attempt timeout), `elicit_task`, `timed_elicit_task`, `status_task`, `status_meta_task`, `story_task` (offer, beats, `checkInput`, sub-branch, re-offer), `fork_task` (a blocking elicit while an offer stands), `cancel_mid_task`, and `cancel_late_task`. The last two cancel themselves from inside a step through `callTaskRunner(env.TASK_RUNNER_REAL, taskId, (stub) => stub.cancel())`, which is also how `test/do/inflight-wake.test.ts` lands a `tasks/update` while the attempt that will consume it is still executing: no timers, no gates, the call is simply delivered to the Durable Object mid-attempt.

`test/fixtures/task-state.ts` keeps module-level closure-run counters keyed by the step idempotency key (`${taskId}:${stepName}`). Tests, the Durable Object, and the executor share one isolate under the plugin, so a handler closure's `recordRun` is readable from the test as `runCount`. That is how "this step executed exactly once" is proven across replay, retries, and eviction.

`test/fixtures/wrangler.jsonc` names the worker `durable-mcp-fixture`, binds the three Durable Object classes with a `new_sqlite_classes` migration, and declares a service binding whose `service` is the fixture's own name. The plugin rewrites it to the current worker, making `env.TASK_EXECUTOR` a real RPC binding to the fixture's own `TaskExecutor` export, which is the fallback `resolveExecutor()` takes when `ctx.exports` has no entrypoint. Renaming the fixture without updating that `services` entry silently breaks the binding.

Each workerd project's `vitest.config.ts` is one `cloudflareTest` call pointed at a wrangler config, with `additionalExports: { TaskExecutor: "WorkerEntrypoint" }`. That option is required wherever a worker exports the factory-made entrypoint, because esbuild cannot infer the export's kind from a `createTaskEntrypoint(...)` call. `apps/task-server` and `examples/report-task` point the plugin at their real `wrangler.jsonc`, so the tests run against the deployed binding names and migration. Types for `cloudflare:test` come from `test/cloudflare-test.d.ts` (one reference to `@cloudflare/vitest-plugin/types`); `Cloudflare.Env` comes from the generated, committed `env.d.ts` files. After changing bindings, regenerate them with `pnpm -r run types`, then run `pnpm format`, because `wrangler types` emits tabs. No coverage tooling is configured.

## The apps and the example

### apps/task-server

The server registers one task, `start`, whose handler adapts the pure generator `walkStory` (`src/story/walk.ts`) onto the step API. That split is what the test design rests on: the same generator that the handler drives is driven purely by `projectStory` and `sweepStory` in `test/support/story-sim.ts`, so a wire test can compute the exact beat sequence, status metas, ask shapes, offers, sleeps, and ending text a `(seed, inputs)` pair produces and compare the observed run against it beat for beat.

The validator. `test/story-validate.test.ts` (30 tests) covers the zod shape in `src/story/format.ts` (strict objects that reject author typos, kebab-case ids, scenes and sprites that must be `<svg>` documents, `buildPercent` in range, non-empty beats) and then `validateStory` in `src/story/validate.ts` rule by rule. Every problem string starts with a stable tag, and each test asserts its tag on a deliberately broken copy of a minimal valid story: `missing-start`, `reserved-id` (node ids may not collide with the `actions-{n}` offer keys), `unresolved-target`, `continuation` (exactly one of `ending`, `decision`, `roll`, `next`, `return`), `decision-question`, `duplicate-option`, `crisis-timeout` (`timeoutMs` and `fateGoto` together or not at all), `no-ending`, `duplicate-ending`, `duplicate-phase`, `unknown-phase`, `unknown-resource`, `unknown-scene`, `unknown-sprite`, `visual-needs-beat`, `duplicate-action`, `action-scope` (sub-stories stay off the main line and carry no decisions or action sets), `return-scope`, `unreachable`, `dead-end`, `cycle`, and `node-id`. The registry tests assert `registerStory` validates at registration, rejects invalid and duplicate stories, and that every registered story (the two shipped ones plus the test fixture) validates clean.

The interpreter. `test/story-walk.test.ts` (14) pins `walkStory` semantics against the fixture story in `test/support/fixture-story.ts` (`fixture-high-desert`: a two-way site fork, a 2 second timed crisis with a fate branch, a seeded wildlife roll with a sprite on one branch, two resource gates, a standing action set with two sub-stories, one triumphant and one catastrophic ending, 400 ms beat pacing). `seedForRollBranch` scans seeds 1 to 10 000 for one whose `rollValue` lands a wanted branch, so the owl and jackrabbit roads are each pinned deterministically. The suite asserts the contract strings exactly: the decision message is the scene plus one `- {id}: {label}` line per option, a timed ask carries `params.timeoutMs` and "You have N seconds." in the message, the status meta carries scene, sprite, phase, build, and the standing actions, every beat is paced by its own sleep under a unique journal name, a press is consumed at the next beat boundary and re-offered under a fresh key, a declined untimed fork takes the first option, and a malformed answer to a timed crisis lets fate decide.

Seeded sweeps. `test/stories.test.ts` runs `sweepStory` over seeds 1 to 40 under four input policies (first option, last option, rotating options with a press every third check, fate on every timed ask with a press at every check) for each shipped story, asserting every run ends in an `[ending:...]` text, claims unique journal names, names only published visuals, and offers `actions-1` first. `test/datacenter.test.ts` takes the same idea further for the big story: a graph census (at least 300 nodes, 70 decisions, 110 rolls, exactly 8 timed crises and 20 endings, the phase list in order, every ending id), the seams between the arcs, a monotonic build meter along the scripted routes, and balance sweeps over 60 seeds under 9 policies (the four above plus `preferEffect` policies for the cheapest, priciest, least and most goodwill, and most GPUs). The economic assertions are exact: the priciest road ends in `receivership` for every seed, the last-option road sells to the rival for every seed, a first-option run reaches receivership for at most a tenth of the seeds, and the most-GPUs policy can ship the frontier model.

The readability gate. `test/story-readability.test.ts` builds `textUnits` over every text a player reads (beats, roll-branch beats, fork scenes, option labels, action labels, endings, the blurb, with `{name}` filled) and `readabilityReport` over them, then asserts per story: no em dashes or en dashes, no semicolons, a mean sentence length of at most 14 words with no sentence over 22, beats averaging at most 14 words and never more than 2 sentences, every fork scene ending with `?`, and option and action labels of at most 4 words. `sentencesOf` is unit-tested to keep `a.m.`, decimals, and quoted endings whole. Failures print the first five offenders with node and field, which is how the prose was driven to green.

Wire playthroughs. `test/adventure.test.ts` plays the real datacenter story over `/mcp` against `projectStory` using the scripted routes in `test/support/datacenter-routes.ts`: `FRONTIER` (seed 1, the most GPUs at every fork, a town hall pressed at the first one, more than 100 beats, 180 second timeout), the fork ask's exact wire shape and a cancel mid-crisis, `RECEIVERSHIP` with the picket-line crisis left unanswered (the test really waits the 20 second window with `waitOutCrisis` after proving an early `runDurableObjectAlarm` tick leaves the ask `input_required`; 240 second timeout), `BLACKLISTED` with two ambient presses, three routes to three endings, the same seed played twice producing identical beats (`SOLD_OUT`, seed 11), and an omitted name falling back to the story's default. `test/odyssey.test.ts` does the same for the second story (seed 2 home to Penelope through the timed bag-of-winds crisis, plus a pure seed 3 route to the Sirens). `test/stories.test.ts` adds `resources/list` and `resources/read` for every URI in `storyResourceUris` (manifests parse to `storyManifest`, SVG bodies start with `<svg` and carry no scripts, external hrefs, `src=`, `url(http...)`, or `@import`), and a first-option wire playthrough of each story at seed 7 whose named scenes are all readable resources.

### examples/report-task

The example is the shape the README shows, as a real worker: `send_report` (fetch data, a 5 second `cool-off` sleep, send with `{ retries: { limit: 10 } }` and an `Idempotency-Key` from `step.idempotencyKey("send")`), `approve_report` (compile, `step.elicit("approval", ...)`, send or discard), and a plain `echo` tool. Five test files, ten tests, all over the wire with 20 to 30 second timeouts:

- `send-report.test.ts`: `tools/call` answers a flat `CreateTaskResult` carrying the registered policy (`ttlMs` 86 400 000, `pollIntervalMs` 5000), `tasks/get` is `working` before any drain, the drain completes with exactly `{ data: 1, send: 1 }` upstream calls; a `flakyRecipient(2)` gets two 500s on `/send` and completes with `{ data: 1, send: 3 }`, `fetch-data` memoized across the retries.
- `approve-report.test.ts`: `input_required` surfaces the `approval` request with the message `Send "Weekly metrics" to <to>?`, `tasks/update` with `{ action: "accept", content: { approve: true } }` resumes and sends once; `{ action: "decline" }` completes with the discarded text and `send` stays 0.
- `cancel.test.ts`: `tasks/cancel` acks, the task settles `cancelled`, `send` never runs (the cool-off sleep guarantees the flag is observed first), a repeat cancel still acks.
- `eviction.test.ts`: the choreography above.
- `conformance.test.ts`: `-32021` with HTTP 400 for non-declaring clients on the task tool and on each `tasks/*` method, `-32602` for unknown ids, and `echo` callable without the extension.

The upstream seam. `test/support/report-api.js` is plain JS because the plugin does not bundle auxiliary workers. It counts `/data` and `/send` requests per recipient, returns a 500 for the first n `/send` attempts of recipients named `flaky-<n>-...`, and reports counts at `GET /__counts?to=...`. Every outbound `fetch` from the example worker, and from the tests sharing its isolate, lands on it over real HTTP. One instance serves the whole run, so tests key everything on `uniqueRecipient` and `flakyRecipient` instead of resetting state. The same base URL is the `REPORT_API_URL` var in `wrangler.jsonc`, pointed at a real endpoint for `wrangler dev` and deploy.

### apps/demo-client

The client's tests run in node (`vitest.config.ts` sets `environment: "node"` and includes `src/**/*.test.{ts,tsx}`), 188 tests in 11 files:

- `src/mcp-tasks/schema.test.ts` (20): the vendored draft wire schemas accept the flat `CreateTaskResult`, `ttlMs: null`, a null `statusMessage`, and every `DetailedTask` variant, and reject the 2025 vocabulary (`ttl`, `pollInterval`, a wrapped `{ task }`).
- `src/mcp-tasks/task-lane.test.ts` (28): the raw JSON-RPC lane against the msw `FakeTasksServer`: `callToolAsTask`, `getTask`, `updateTask`, `cancelTask`, `pollTaskUntilTerminal` (with an injected `sleep`), `nextPollDelayMs` clamping, `taskChangeKey`, `encodeMcpHeaderValue`, `buildTaskLaneHeaders`, and `extractJsonRpcFromSse`.
- `src/lib/tasks.test.ts` (29): `observeTask` and `isStaleSnapshot`, the per-task view that keeps overlapping polls in order.
- `src/lib/playthrough.test.ts` (28): `newPlaythrough`, `observePlaythrough`, `foldObservationInto`, `prunePlaythroughs`, and the sprite, phase, build, fork, and ending folding, all pure and reference-stable.
- `src/lib/story-wire.test.ts` (23), `story-resources.test.ts` (11, including `sanitizeSvg`), `task-list.test.ts` (8), `route.test.ts` (5), `poll-controls.test.ts` (5), `crisis.test.ts` (5).
- `src/components/story-render.test.tsx` (26): the components rendered with `renderToStaticMarkup` (no DOM) against two different manifests, proving nothing in them is story-specific.

The agent in `src/server.ts` (`MyAgent`, with its watch loop `pollTaskWatchOnce` on `Agent.schedule` alarms) has no test file of its own. Its logic lives in the pure modules it calls (`foldObservationInto`, `observeTask`, the task lane), which is where the tests are.

## Wire helpers and schema validation

The package, the app, and the example each carry SSE-aware JSON-RPC helpers in `test/support/jsonrpc.ts`.

- `modernRequest(method, params, options?)` builds a 2026-07-28 request: the per-request `_meta` envelope with `PROTOCOL_VERSION_META_KEY` and `CLIENT_CAPABILITIES_META_KEY` (the tasks extension declared by default, `declareTasks: false` to omit it), plus the `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` headers a native client sends. `Mcp-Name` is derived from `params.name` or `params.taskId` (the task-server copy also accepts `params.uri`); `mcpName: null` omits it and any other string forces a mismatch. The package and app copies also carry `legacyRequest`, the claim-less 2025-era shape; the example sends modern requests only.
- `postModern` and `postLegacy` go through `SELF.fetch`. The endpoints differ per project: `http://fixture.test/mcp` for the package, `http://example.com/mcp` for the app, and the worker root for the example.
- `readJsonRpcResponse` accepts a plain JSON body or an SSE stream, parses the last `data:` frame, and always consumes the body. `resultOf` and `errorOf` validate the JSON-RPC envelope with zod; `callResult` posts, asserts HTTP 200, and returns the result.

Task responses are validated with the package's exported zod wire schemas (`createTaskResultSchema`, `getTaskResultSchema`), never the SDK's task types, because `@modelcontextprotocol/server` 2.0.0 carries only the removed 2025-11-25 vocabulary. The upstream generated JSON Schema is vendored at `packages/durable-mcp-server/test/fixtures/ext-tasks.schema.json`, and `test/unit/wire-schemas.test.ts` emits the package schemas with `z.toJSONSchema` and checks each task shape's property names and required set against the fixture's `$defs`. The demo client vendors its own copy of the draft in `src/mcp-tasks/schema.ts` and tests it separately.

## Running everything

Every project defines `"test": "vitest run"`. From the repository root:

- `pnpm test` runs `nx run-many -t test` across the workspace.
- `pnpm check` runs `oxlint`, the `oxfmt` check, then `nx run-many -t typecheck test build`. It is the pre-commit gate.
- `pnpm --filter <project> test` runs one suite: `durable-mcp-server`, `task-server`, `report-task-example`, or `demo-client`. `pnpm --filter <project> exec vitest run <file>` runs one file.

nx's `test` and `typecheck` targets depend on `^build` and are cached (`nx.json`). The package's own tests never see a fresh `dist` (its fixture imports `src`); the app and the example build the package first and test the published shape.

## Flake discipline

Storage is treated as shared within a test file: pending alarms, SQLite rows, the fixture's module state, and the story registry (`registerStory` is module-level, which is also why `test/support/fixture-story.ts` registers the fixture story by being imported) all persist across the tests of one file. What keeps files honest:

- A unique task id per test (`uniqueTaskId()` is `crypto.randomUUID()`). The Durable Object name is the task id, so a fresh id is a fresh Durable Object.
- The example uses a unique recipient per test; the report API's counters live for the whole run.
- The fixture's run counters are keyed by step idempotency key, so they need no reset. The fake executor is reset in `beforeEach` with `resetFakeExecutor()`.
- In the story suites, scripted ambient presses are tied to forks ("while parked at ask X, the player pressed Y"), the one moment a press is deterministic on the wire too, because the first `checkInput` after the resume consumes it.

Production-scheduling tests depend on workerd firing real alarms, and their timing moves with machine load. They carry explicit vitest timeouts above the 5 second default (20 seconds in `d6-executor-addressing`, 20 to 30 seconds in the example, 60 to 240 seconds in the story playthroughs), and every wait is a bounded poll with a descriptive timeout error, never a bare sleep.

Two traps in the workers pool:

- A Durable Object RPC rejection not consumed in the caller's same microtask counts as an unhandled test-run error; `expect(promise).rejects` attaches its handler a tick too late. `expectRejects` in `packages/durable-mcp-server/test/support/expect-rejects.ts` awaits inside try/catch instead. The "uncaught exception" lines that rejecting RPCs and the hang test print from the Durable Object side are cosmetic and do not fail the run.
- workerd deletes a due alarm just before invoking `alarm()`, and the handler's first act re-arms it, so a single-shot `getAlarm()` assertion can land inside that window and read `null`. `test/do/execute.test.ts` polls for a non-null alarm for up to two seconds in the handoff test for exactly this reason.

Green once is not green. A change to a workerd suite is held to several consecutive passing runs. A test that fails one run in five has a broken wait, usually a single-shot assertion where a poll belongs. Fix the probe; do not widen a sleep.
