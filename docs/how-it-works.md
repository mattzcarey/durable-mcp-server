# How it works

The internals of `durable-mcp-server`, end to end, as shipped in `packages/durable-mcp-server/src`. Read this before writing a task handler or extending the engine. File paths are relative to `packages/durable-mcp-server/src` unless stated otherwise. Section 9 is the API reference. The demo apps and the example are covered in [demo.md](demo.md), the test harness in [testing.md](testing.md).

Contents

1. [The problem](#1-the-problem)
2. [The three layers](#2-the-three-layers)
3. [Data model](#3-data-model)
4. [Data flow](#4-data-flow)
   - (a) [Task creation via tools/call](#a-task-creation-via-toolscall)
   - (b) [An alarm tick that claims and dispatches](#b-an-alarm-tick-that-claims-and-dispatches)
   - (c) [step.do on a journal miss vs hit](#c-stepdo-on-a-journal-miss-vs-hit)
   - (d) [step.sleep suspend and resume](#d-stepsleep-suspend-and-resume)
   - (e) [step.elicit, tasks/update, resume, and the timed variant](#e-stepelicit-tasksupdate-resume-and-the-timed-variant)
   - (f) [step.offer and step.checkInput](#f-stepoffer-and-stepcheckinput)
   - (g) [step.status and the replay live gate](#g-stepstatus-and-the-replay-live-gate)
   - (h) [tasks/get polling through the router](#h-tasksget-polling-through-the-router)
   - (i) [tasks/cancel](#i-taskscancel)
   - (j) [TTL expiry and purge](#j-ttl-expiry-and-purge)
5. [Replay and at-least-once](#5-replay-and-at-least-once)
6. [Reliability](#6-reliability)
7. [The wire contract served](#7-the-wire-contract-served)
8. [Limits and defaults](#8-limits-and-defaults)
9. [Reference](#9-reference)
   - [Exports](#exports)
   - [McpServer.registerTask](#mcpserverregistertask)
   - [The Step interface](#the-step-interface)
   - [createTaskEntrypoint, createMcpHandler, createTasksRouter](#createtaskentrypoint-createmcphandler-createtasksrouter)
   - [TaskRunner surface and seams](#taskrunner-surface-and-seams)
   - [Errors](#errors)
   - [Wrangler configuration](#wrangler-configuration)
   - [Dependencies and vendored code](#dependencies-and-vendored-code)

## 1. The problem

The 2026-07-28 MCP revision made servers stateless over Streamable HTTP: every JSON-RPC message is its own POST, the server instance that answered `tools/call` is gone by the time the next request arrives, and nothing on the server remembers a tool call that is still running. The Tasks extension (`io.modelcontextprotocol/tasks`, SEP-2663) lets a tool call answer with a task handle that the client polls with `tasks/get`, answers with `tasks/update`, and stops with `tasks/cancel`. Serving that on a stateless server needs three things the SDK does not provide: durable state per task that outlives any request, execution that keeps going with nobody connected and survives evictions and deploys, and routing that takes `tasks/*` requests to the right piece of state instead of to a fresh server instance. This package supplies all three on Cloudflare Workers: one Durable Object per task holding a SQLite journal and one alarm, a `WorkerEntrypoint` that re-runs the handler under a replay-aware step API, and a front-door router that sends `tasks/*` straight to the Durable Object.

## 2. The three layers

An integration is one server factory plus three exports:

```ts
const createServer = () => {
  const server = new McpServer({ name: "report-server", version: "1.0.0" });
  server.registerTask("send_report", { inputSchema }, async (input, step) => { ... });
  return server;
};
export { TaskRunner };                                   // the Durable Object, zero user code
export const TaskExecutor = createTaskEntrypoint(createServer);
export default createMcpHandler(createServer);
```

```
              POST /mcp (JSON-RPC over Streamable HTTP)
                              |
   +--------------------------v---------------------------------------+
   | fetch path                                                       |
   |   createMcpHandler(createServer)          handler/create-mcp-handler.ts
   |     createTasksRouter(createServer)       handler/tasks-router.ts
   |        tasks/get | tasks/update | tasks/cancel  -> TaskRunner RPC, no SDK
   |        -32021 gate on tools/call of a task tool
   |        everything else -> null
   |     official SDK createMcpHandler(() => createServer())
   |        tools/call -> McpServer.registerTask wire handler -> TaskRunner.create
   +------------------------------------------------------------------+
                              |  DO RPC, always through callTaskRunner (retries)
   +--------------------------v---------------------------------------+
   | TaskRunner  (DurableObject, SQLite)       do/task-runner.ts
   |   one instance per task, DO name = taskId                        |
   |   tables: task, steps, input_requests                            |
   |   one alarm, recomputed from the rows (#reconcileAlarm)          |
   |   alarm() -> claim an attempt -> dispatch -> settle              |
   +------------------------------------------------------------------+
                              |  ctx.exports.TaskExecutor.runTask(desc, DurableStep)
                              |  (the DurableStep lease travels as an RPC stub)
   +--------------------------v---------------------------------------+
   | TaskExecutor (WorkerEntrypoint)           do/task-entrypoint.ts
   |   runTask: createServer() -> getTaskRegistration -> handler(input, ReplayStep)
   |   ReplayStep (step/replay-step.ts) wraps the DurableStep stub:      |
   |     do / sleep / sleepUntil / elicit / offer / checkInput / status |
   |   outcome: completed | suspended | failed                         |
   +------------------------------------------------------------------+
```

What each layer owns:

The fetch path owns the wire. `createMcpHandler` composes `createTasksRouter` in front of the official `createMcpHandler` from `@modelcontextprotocol/server` (imported as `sdkCreateMcpHandler`). The router claims the three `tasks/*` methods and routes them to the Durable Object without constructing a server; it also enforces the `-32021` capability gate on a `tools/call` of a registered task tool. Everything else falls through to a per-request SDK handler built from `createServer()`, with the `TASK_RUNNER` namespace injected through `McpServer.configureTaskRunner`. `McpServer` (`server/mcp-server.ts`) is an additive subclass of the SDK class with one new method, `registerTask`, which registers a normal tool whose wire handler creates a task instead of doing the work.

`TaskRunner` owns state and scheduling. It is a `DurableObject` with SQLite storage, addressed everywhere as `env.TASK_RUNNER.getByName(taskId)`. It holds the task row, the step journal, and the input requests, and arms exactly one alarm, recomputed from the rows after every scheduling-relevant write. Its `alarm()` is the engine loop: claim an attempt under a fresh `run_generation`, dispatch to the executor, settle the outcome. It contains no user code.

`TaskExecutor` owns execution. `createTaskEntrypoint(createServer)` returns a `WorkerEntrypoint` class whose single method `runTask(desc, step)` rebuilds the server, finds the handler in the registration table, wraps the incoming `DurableStep` stub in a `ReplayStep`, and runs the handler body from the top. `DurableStep` (an `RpcTarget` in `do/task-runner.ts`) is the lease: constructed by `TaskRunner` for exactly one claimed attempt, it crosses the RPC as a stub whose method calls run back inside the Durable Object and which dies when the RPC settles. Every write it performs is additionally guarded in SQL by the attempt's `run_generation`. `ReplayStep` turns that lease into the `Step` API handlers see.

## 3. Data model

The schema is the `SCHEMA_DDL` constant in `do/task-runner.ts`. It is bootstrapped lazily: the constructor probes `sqlite_master` for a `task` table inside `blockConcurrencyWhile` (`#hasSchema`, a pure read), and the DDL commits on the first `create()` (`#ensureSchema`). A `tasks/get` for an unknown id therefore performs zero storage writes, and the Durable Object is never persisted.

All timestamps are integer milliseconds since the epoch. Statuses are the wire statuses.

### task (one row)

| Column | Type | Written by |
|---|---|---|
| `task_id` | TEXT PRIMARY KEY | `create` (INSERT OR IGNORE keyed by taskId) |
| `tool_name` | TEXT NOT NULL | `create` |
| `input` | TEXT NOT NULL | `create`, the validated tool input through `serializeValue` (undefined-safe envelope) |
| `status` | TEXT CHECK IN working, input_required, completed, failed, cancelled | `create` (working); `recordElicit` (input_required); `update` and `#resolveDueElicitTimeouts` (back to working); `#settleOutcome` (completed, failed, cancelled); `#settleCancelled`; `#expire` (failed) |
| `status_message` | TEXT | `setStatus` only. NULL until the handler's first `step.status`; the engine never writes it |
| `status_meta` | TEXT | `setStatus` only, when a `meta` is passed; replaced wholesale, at most 8 KiB serialized |
| `created_at` | INTEGER NOT NULL | `create` |
| `last_updated_at` | INTEGER NOT NULL | every state-changing write: the claim, `update`, `cancel`, `recordElicit`, `setStatus`, `#resolveDueElicitTimeouts`, `#settleOutcome`, `#settleDispatchFailure`, `#settleCancelled`, `#expire` |
| `ttl_ms` | INTEGER | `create`; NULL means unlimited |
| `poll_interval_ms` | INTEGER NOT NULL | `create` |
| `result` | TEXT | `#settleOutcome` on completed: the `CallToolResult` as plain JSON |
| `error` | TEXT | `#failTask` and `#expire`: a JSON-RPC error object `{ code: -32603, message }` |
| `cancel_requested` | INTEGER DEFAULT 0 | `cancel` |
| `run_attempt` | INTEGER DEFAULT 0 | the claim in `#alarmTick` (+1 per claim; counts claims, not completions) |
| `run_generation` | TEXT NOT NULL | `create` (initial UUID), then a fresh UUID at every claim; every lease write is guarded by it |
| `run_next_at` | INTEGER | the task-level redelivery anchor: `create` (now); `update` and `#resolveDueElicitTimeouts` (now, on resume); `#wakeForInput` (now); `cancel` (COALESCE to now); `recordElicit` (NULL); `#settleOutcome` (NULL on a suspended settle with no pending wake request, NULL on every terminal write, `#settleCancelled` and `#expire` included); `#settleDispatchFailure` (the backoff time) |
| `auth_key` | TEXT | `create`, from `authInfo.clientId` when the creating request carried one |

### steps (the journal)

| Column | Type | Written by |
|---|---|---|
| `step_key` | TEXT PRIMARY KEY | the step name: `beginStep` (kind do), `recordSleep` (sleep), `checkInput` (check) |
| `kind` | TEXT CHECK IN do, sleep, check | the inserting method; a key reused under another kind throws `DuplicateStepError` |
| `status` | TEXT CHECK IN pending, completed, failed | `beginStep` inserts pending; `completeStep` sets completed; `failStep` sets failed (terminal) or keeps pending (retry); `recordSleep` inserts pending, or completed when the sleep is cut on arrival; the wake honor in `#alarmTick` and `#wakeForInput` set sleeps completed; `checkInput` inserts completed |
| `result` | TEXT | `completeStep` (the value in the undefined-safe envelope); `checkInput` (the consumed response, or `null` for a miss) |
| `attempt` | INTEGER DEFAULT 0 | `beginStep`: 1 on insert, +1 on each retry claim. 0 for sleep and check rows |
| `next_attempt_at` | INTEGER | `failStep` with a retry disposition; cleared by the retry claim and by `completeStep` |
| `wake_at` | INTEGER | `recordSleep` |
| `timeout_ms` | INTEGER | `beginStep`, the per-attempt closure timeout (observability only; the race runs executor-side) |
| `last_error`, `last_error_name` | TEXT | `failStep`; cleared by `completeStep` |
| `created_at` | INTEGER NOT NULL | the insert |
| `completed_at` | INTEGER | `completeStep`, the sleep-honor UPDATEs, a cut sleep, `checkInput` |

Index `steps_pending_idx` on `(status, next_attempt_at, wake_at)` backs the alarm's MIN queries.

### input_requests (elicits and offers)

| Column | Type | Written by |
|---|---|---|
| `key` | TEXT PRIMARY KEY | `recordElicit` (the step name) and `recordOffer` (the offer key); one namespace per task |
| `step_key` | TEXT NOT NULL | same value as `key` |
| `request` | TEXT NOT NULL | the `InputRequest` as JSON, immutable after first record |
| `response` | TEXT | `update` (first answer wins) |
| `answered` | INTEGER DEFAULT 0 | `update` (1); `#resolveDueElicitTimeouts` (1, answered by timeout) |
| `timeout_at` | INTEGER | `recordElicit` when `step.elicit` was called with `timeoutMs`; never changed on replay |
| `timed_out` | INTEGER DEFAULT 0 | `#resolveDueElicitTimeouts` |
| `blocking` | INTEGER DEFAULT 1 | 1 for an elicit (the default), 0 for an offer (`recordOffer`) |
| `consumed` | INTEGER DEFAULT 0 | `checkInput`, when it takes an answered offer |
| `created_at` | INTEGER NOT NULL | the insert |

Only rows with `blocking = 1 AND answered = 0` appear as `inputRequests` on a `tasks/get` snapshot (`#outstandingBlockingRequests`) and only those hold the task in `input_required` (`#outstandingBlockingRequestCount`). Offers are ambient: they never show on the wire and never block a resume.

### The alarm is computed, not stored

`#reconcileAlarm(txn)` runs inside the same transaction as every scheduling-relevant write. It reads the task row, computes `#nextScheduledAt`, and sets the single physical alarm to that value clamped to now (or deletes the alarm when nothing is pending). `#nextScheduledAt` is the minimum of:

- the TTL deadline `created_at + ttl_ms` (for a live task that is expiry; for a terminal task it is purge time, and it is the only candidate),
- `#earliestExecutionWake`: `task.run_next_at`, the earliest pending do step's `next_attempt_at`, and the earliest pending sleep's `wake_at`,
- `#earliestElicitDeadline`: the earliest `timeout_at` among unanswered blocking requests.

Execution wakes are treated as due whenever the alarm fires. TTL and elicit deadlines are wall-clock honest: an early fire re-arms and waits.

## 4. Data flow

Each flow below is a pseudo callstack: indentation is call nesting, every name is a real function in `src` (private methods keep their `#`), and the right-hand column says what the call does. SQL is paraphrased in the comment column.

### (a) Task creation via tools/call

The client POSTs `tools/call` for a registered task tool with the tasks extension declared in `params._meta["io.modelcontextprotocol/clientCapabilities"].extensions`.

```
createMcpHandler.fetch(request, env, ctx)       handler/create-mcp-handler.ts
  createTasksRouter.fetch                        handler/tasks-router.ts; parses the body from request.clone()
    probe                                        once per isolate: createServer() for serverInfo + taskNames
    declaresTasksExtension(params)               declared -> the -32021 gate does not fire
    -> null                                      tools/call is not a tasks method: fall through
  sdkCreateMcpHandler(factory, options.sdk)      the official SDK handler, built per request
    createServer                                 user factory: new McpServer + registerTask(...)
    configureTaskRunner(env.TASK_RUNNER)         inject the DO namespace for this request
  handler.fetch(request)                         SDK validates the envelope, dispatches tools/call
    wireHandler                                  what registerTask handed to the SDK's registerTool
      #createTask(registration, input, ctx)      server/mcp-server.ts
        declaredTasksExtension(ctx)              defense in depth: throws MissingRequiredClientCapabilityError
        #resolveTaskRunnerNamespace              injected namespace, else env.TASK_RUNNER from cloudflare:workers
        crypto.randomUUID                        taskId: an unguessable bearer handle
        callTaskRunner(namespace, taskId, fn)    engine/call-task-runner.ts
          tryWhile                               vendor/retries.ts: up to 4 attempts, fresh stub each time
            ns.getByName(taskId)                 the DO name is the taskId
            stub.create({taskId, toolName, input, ttlMs, pollIntervalMs, authKey?})
              TaskRunner.create                  do/task-runner.ts
                #ensureSchema                    first write on this DO commits SCHEMA_DDL
                ctx.storage.transaction
                  serializeValue(input)          undefined-safe JSON envelope; rejects non-JSON
                  INSERT INTO task ... ON CONFLICT DO NOTHING    status working, run_attempt 0, run_next_at now
                  #readTask                      the winner row must be this taskId and toolName
                  #reconcileAlarm(txn)           -> txn.setAlarm(now): the eager path is the alarm
                #baseSnapshot(row)               taskId, status, createdAt, lastUpdatedAt, ttlMs, pollIntervalMs
        return { resultType: "task", ...snapshot }   flat CreateTaskResult; the SDK encodes it verbatim
```

The `tools/call` response is sent only after the DO transaction commits, so a `tasks/get` for the returned id always resolves. Execution is not started inline: the committed alarm is both the eager path and the redelivery path.

### (b) An alarm tick that claims and dispatches

```
TaskRunner.alarm(info?)                          never throws; on any failure setAlarm(now + 60_000)
  #alarmTick
    ctx.storage.setAlarm(Date.now() + ALARM_BACKSTOP_MS)   re-arm first: a wake survives whatever follows
    #readTask                                    no row -> deleteAlarm, return (stray alarm on a purged DO)
    #awaitWithHandoff(#inFlight.settled)         if an attempt is executing: attach to it, never double-claim
    (TTL) now >= created_at + ttl_ms             terminal -> #purge; live -> #expire; return
    isTerminal(row.status) -> #reconcileNow      waiting for the purge deadline; return
    cancel_requested -> #settleCancelled         nothing in flight: flip to cancelled; return
    #resolveDueElicitTimeouts(now)               answered-by-timeout sweep, may return the task to working
    #readTask                                    re-read after the sweep
    input_required -> #reconcileNow              waiting on tasks/update; return
    #earliestExecutionWake(current)              undefined -> #reconcileNow; return
    UPDATE steps SET status = completed WHERE kind = sleep AND pending AND wake_at <= horizon
    UPDATE task SET run_attempt + 1, run_generation = uuid WHERE status = working RETURNING run_attempt
    #dispatch(current, generation, attempt)
      resolveExecutor                            ctx.exports.TaskExecutor, else env.TASK_EXECUTOR
      deserializeValue(row.input)
      new DurableStep(this, taskId, attempt, generation)   the lease for exactly this claim
      executor.runTask(desc, lease)              RPC to the WorkerEntrypoint; the lease crosses as a stub
        #settleOutcome(generation, attempt, outcome)       completed / suspended / failed
        #settleDispatchFailure(generation, attempt, err)   RPC rejected or malformed outcome: backoff
      #inFlight = { generation, settled, wakeRequests: 0, cutNextSleep: false }
      #awaitWithHandoff(settled)                 race the attempt against alarmHandoffMs (14 min)
        #armForHandoff(now)                      on handoff: setAlarm(now) and return; next tick attaches
```

Each sub-step of the tick is its own transaction; the claim is a guarded UPDATE on `status = 'working'`, so two ticks cannot both claim. The Durable Object awaits the executor RPC with its input gate open, so `tasks/get`, `tasks/update`, `tasks/cancel`, and further alarms interleave with a running attempt. That is why every lease write is guarded in SQL by `run_generation` and why `#inFlight` exists.

### (c) step.do on a journal miss vs hit

```
ReplayStep.do(name, [config,] fn)                step/replay-step.ts
  #runDo
    #claimName(name, "step.do")                  same-run reuse -> DuplicateStepError before any RPC
    resolveRetryPolicy(taskRetries, config.retries)   invalid -> RetryPolicyError (engine failure)
    stub.beginStep(name, { timeoutMs })          RPC back into the DO
      DurableStep.beginStep
        TaskRunner.beginStep(generation, stepKey, options)
          #requireLease(generation)              purged / terminal / superseded -> StaleLeaseError
          cancel_requested -> { state: "cancelled" }
          #readStep(stepKey)
          miss:  INSERT INTO steps (kind do, pending, attempt 1, timeout_ms) WHERE run_generation = ?
                 -> { state: "run", attempt: 1 }
          hit, completed -> { state: "completed", value: deserializeValue(result) }
          hit, failed    -> { state: "failed", error: { name, message } }
          hit, pending   -> UPDATE steps SET attempt + 1, next_attempt_at NULL ... RETURNING attempt
                            -> { state: "run", attempt }   (a retry claim)
    "completed": return directive.value          the closure does not run
    "failed":    throw rehydrateError(error)     the journaled terminal failure surfaces again
    "cancelled": throw SuspendSignal             ends the invocation; the DO settles cancelled
    "run":       #live = true                    new ground (see (g))
      attempt > policy.limit                     a crash after a claim consumed an attempt
        stub.failStep(name, serializeError(exhausted), { terminal: true }); throw AttemptsExhaustedError
      runClosureWithTimeout(name, fn, timeoutMs) Promise.race against StepTimeoutError
      serializeValue(value)                      local JSON check -> ResultSerializationError
      stub.completeStep(name, value)
        TaskRunner.completeStep                  UPDATE steps SET completed, result WHERE pending AND run_generation = ?
                                                 #reconcileAlarm
      return value
    closure threw -> #settleFailedAttempt(name, attempt, policy, error)
      SuspendSignal -> rethrow                   a nested suspension passes through
      isNonRetryable(error) || attempt >= policy.limit
        stub.failStep(name, serializeError(error), { terminal: true })   steps.status = failed
        throw error                              the handler sees it; the task completes with isError
      computeStepRetryDelayMs(policy, attempt)   exponential from baseDelayMs, capped, equal jitter
      stub.failStep(name, error, { retryAtMs })  steps stays pending, next_attempt_at = retryAtMs
      throw SuspendSignal                        the alarm redelivers at next_attempt_at
```

On a hit the closure never runs: that is the whole point of the journal. On a miss the closure runs once under this lease; if the attempt dies after the closure's side effect and before `completeStep` commits, the next claim finds the row pending and runs the closure again (see section 5).

### (d) step.sleep suspend and resume

```
ReplayStep.sleep("cool-off", "5s")
  #claimName
  parseDuration("5s")                            engine/duration.ts -> 5_000
  #recordSleep(name, Date.now() + 5_000)
    stub.recordSleep(name, wakeAtMs)
      DurableStep.recordSleep
        TaskRunner.recordSleep(generation, stepKey, wakeAtMs)
          #requireLease
          #readStep: none                        first time here
          INSERT INTO steps (kind sleep, pending, wake_at) WHERE run_generation = ?
          #reconcileAlarm                        alarm = min(..., wake_at)
          -> { state: "pending" }
    #live = true
    throw SuspendSignal                          the invocation ends here
TaskExecutor.runTask                             catches SuspendSignal -> { outcome: "suspended" }
TaskRunner.#settleOutcome("suspended")
  wakeRequests == 0 -> UPDATE task SET run_next_at = NULL WHERE run_generation = ? AND working
  (cancel flip: UPDATE task SET cancelled WHERE cancel_requested = 1, guarded)
  #reconcileAlarm                                the sleep row alone carries the wake
```

Later, at `wake_at`:

```
TaskRunner.alarm -> #alarmTick
  #earliestExecutionWake -> wake_at
  UPDATE steps SET status = completed WHERE kind = sleep AND pending AND wake_at <= horizon
  claim: run_attempt 2, fresh run_generation
  #dispatch -> executor.runTask(desc, lease)
    registration.handler(input, replayStep)      the handler body runs from the top again
      ReplayStep.do("fetch-data") -> beginStep -> { state: "completed" }       hit, closure skipped
      ReplayStep.sleep("cool-off") -> recordSleep -> { state: "completed", latest: #isLatestSuspension }
        #live = true when latest                 the resume is back on new ground
      ReplayStep.do("send") -> beginStep -> { state: "run", attempt: 1 }      miss, runs
      return { content: [...] }
    -> { outcome: "completed", result }
  #settleOutcome("completed")
    toJsonText(result)                           plain JSON; failure -> #failTask (engine error)
    UPDATE task SET status = completed, result, run_next_at NULL WHERE run_generation = ? AND working
    #reconcileAlarm                              only the TTL purge deadline remains
```

A replay that reaches a sleep still pending (an eviction or handoff before the wake) gets `{ state: "pending" }` again and suspends again; the armed wake stands.

### (e) step.elicit, tasks/update, resume, and the timed variant

```
ReplayStep.elicit("approval", request[, { timeoutMs }])
  #claimName
  timeoutAtMs = Date.now() + timeoutMs           only with a config; recomputed on replay but ignored on a hit
  stub.recordElicit(name, request, timeoutAtMs)
    DurableStep.recordElicit
      TaskRunner.recordElicit(generation, stepKey, request, timeoutAtMs)
        #requireLease
        #readInputRequest(stepKey): none
        INSERT INTO input_requests (key, step_key, request, answered 0, timeout_at) WHERE run_generation = ?
        UPDATE task SET status = input_required, run_next_at = NULL WHERE working AND run_generation = ?
        #reconcileAlarm                          alarm = min(TTL deadline, timeout_at)
        -> { state: "pending" }
  #live = true
  throw SuspendSignal
TaskExecutor.runTask -> { outcome: "suspended" }
TaskRunner.#settleOutcome("suspended")           the guarded UPDATEs target status = working: no-ops now
```

The client polls `tasks/get`, sees `status: "input_required"` with `inputRequests: { approval: request }`, and answers:

```
createMcpHandler.fetch -> createTasksRouter.fetch          POST tasks/update { taskId, inputResponses: { approval } }
  claimed; isLegacyRequest -> false; Mcp-Method and Mcp-Name cross-checks; declaresTasksExtension
  callTaskRunner(namespace, taskId, fn)
    stub.get(undefined) -> TaskRunner.get        not found -> -32602 (no update attempted)
    stub.update(inputResponses)
      TaskRunner.update
        UPDATE input_requests SET response, answered = 1 WHERE key = ? AND answered = 0 RETURNING blocking
        blocking answered, status input_required, #outstandingBlockingRequestCount() == 0
          UPDATE task SET status = working, run_next_at = now WHERE status = input_required
          #noteWakeRequest                       if the recording attempt is still settling, keep the wake
        #reconcileAlarm                          -> setAlarm(now)
  -> { resultType: "complete", _meta: { serverInfo } }     the ack is eventually consistent
```

The resumed run:

```
TaskRunner.alarm -> #alarmTick -> claim -> #dispatch -> executor.runTask
  handler replays from the top; earlier do steps and sleeps are hits
  ReplayStep.elicit("approval", ...)
    stub.recordElicit -> TaskRunner.recordElicit
      existing.answered = 1 -> { state: "answered", response: JSON.parse(existing.response), latest }
    #live = true when latest
    return response                              or { outcome: "answered", response } with a config
  handler continues past the elicit
```

`#noteWakeRequest` matters because the elicit's own attempt may still be in `#settleOutcome` when the answer lands: without the note, the suspended settle would clear `run_next_at` and erase the wake. With `wakeRequests > 0` the settle leaves the anchor alone.

The timed variant, when the deadline passes unanswered:

```
TaskRunner.alarm -> #alarmTick                    fired at timeout_at (wall-clock honest)
  #resolveDueElicitTimeouts(now)
    UPDATE input_requests SET answered = 1, timed_out = 1
      WHERE answered = 0 AND blocking = 1 AND timeout_at <= now RETURNING key
    #outstandingBlockingRequestCount() == 0
      UPDATE task SET status = working, run_next_at = now WHERE status = input_required
      #noteWakeRequest
    #reconcileAlarm
  #readTask -> working -> claim -> #dispatch -> executor.runTask
    ReplayStep.elicit("gate", request, { timeoutMs })
      stub.recordElicit -> existing.timed_out = 1 -> { state: "timed_out", latest }
      return { outcome: "timed_out" }
```

A late `tasks/update` to a timed-out key is ignored by the `answered = 0` guard. First durable write wins between an answer and the sweep.

### (f) step.offer and step.checkInput

A standing offer is an input request that never suspends: `blocking = 0`, no status change, no wire presence, no alarm candidate.

```
ReplayStep.offer("actions-1", request)
  #claimName("actions-1", "step.offer")          offer keys share the step-name namespace
  stub.recordOffer(key, request)
    DurableStep.recordOffer
      TaskRunner.recordOffer(generation, key, request)
        #requireLease
        #readInputRequest(key)
          exists, blocking 0 -> return           replay: the first recorded offer stands
          exists, blocking 1 -> DuplicateStepError
        INSERT INTO input_requests (key, step_key, request, answered 0, blocking 0) WHERE run_generation = ?

ReplayStep.status("beat 1", { actions: { key: "actions-1", ... } })   the handler announces the offer
ReplayStep.sleep("pace:1", "30s") -> recordSleep pending -> SuspendSignal
```

The player answers the offer while the task is `working` (sleeping):

```
createTasksRouter.fetch -> callTaskRunner -> stub.get, stub.update({ "actions-1": response })
  TaskRunner.update
    UPDATE input_requests ... RETURNING blocking  -> 0: answeredOffer
    not resumed                                  offers never hold the task in input_required
    UPDATE task SET last_updated_at = now
    row.status == working -> #wakeForInput(now)
      UPDATE steps SET status = completed WHERE kind = sleep AND status = pending RETURNING step_key
      cut: UPDATE task SET run_next_at = now WHERE working; #noteWakeRequest
      not cut, #inFlight set: #inFlight.cutNextSleep = true
    #reconcileAlarm                              -> setAlarm(now): the sleep is over early
```

The resumed run reaches the check at once:

```
TaskRunner.alarm -> #alarmTick -> claim -> #dispatch -> executor.runTask
  ReplayStep.sleep("pace:1") -> recordSleep -> { state: "completed", latest: true }     resolves at once
  ReplayStep.checkInput("check:1", "actions-1")
    #claimName
    stub.checkInput(stepKey, key)
      DurableStep.checkInput
        TaskRunner.checkInput(generation, stepKey, key)
          #readStep(stepKey): none               first time at this check
          #readInputRequest(key)                 unknown or blocking -> TypeError
          answered 1, consumed 0:
            UPDATE input_requests SET consumed = 1 WHERE key = ? AND consumed = 0 AND run_generation = ?
            response = JSON.parse(offer.response); #inFlight.cutNextSleep = false
          INSERT INTO steps (kind check, completed, result = envelope(response | null)) WHERE run_generation = ?
          -> { state: "answered", response } | { state: "unanswered" }
    return response | null
  (the handler branches, then) ReplayStep.offer("actions-2", ...)   a consumed key is spent: fresh key
```

Three cases of "the wake that cuts a sleep":

- A sleep is pending when the answer lands (the task is suspended between beats): `#wakeForInput` marks it completed and pulls `run_next_at` to now; the resumed replay resolves the sleep instantly and the next `checkInput` consumes.
- No sleep is pending and an attempt is executing (the answer lands mid-handler): `#wakeForInput` sets `#inFlight.cutNextSleep`. The next `recordSleep` from that attempt inserts the row already completed (`cut`), returns `{ state: "completed", latest: true }`, and the handler continues without suspending. A `checkInput` that consumes the answer first clears the flag, so the following sleep is left intact.
- No sleep is pending and nothing is executing (a step retry backoff or a redelivery is scheduled): the schedule stands; the next run's `checkInput` consumes. A retry backoff is never pre-empted.

While the task is `input_required` (a fork is open), an answer to an offer is stored only; `update` neither resumes nor wakes. The fork's own resume replays through the next `checkInput`, which consumes it.

### (g) step.status and the replay live gate

`step.status` is durable telemetry, not a journal row: no step name is claimed and replay ordering is untouched.

```
ReplayStep.status(message, meta?)
  typeof checks                                  string message; meta a plain object or absent
  if (!#live) return                             silent while replaying ground an earlier run published
  stub.setStatus(message, meta)
    DurableStep.setStatus
      TaskRunner.setStatus(generation, message, meta)
        serializeStatusMeta(meta)                plain JSON object, <= STATUS_META_MAX_BYTES (8 KiB)
        #readTask                                none -> StaleLeaseError; terminal -> no-op
        run_generation mismatch -> StaleLeaseError
        UPDATE task SET status_message [, status_meta], last_updated_at
          WHERE run_generation = ? AND status IN (working, input_required)
```

`#live` in `ReplayStep` is the gate. Its transitions:

```
constructor                                      #live = attempt <= 1      the first claim has nothing to replay
#runDo            directive "run"                #live = true              a closure actually runs: new ground
#recordSleep      { state: "pending" }           #live = true              a fresh suspension
#recordSleep      { state: "completed", latest } #live = true iff latest
elicit            { state: "pending" }           #live = true
elicit            answered | timed_out, latest   #live = true iff latest
```

`latest` comes from `TaskRunner.#isLatestSuspension(stepKey)`, computed inside `recordSleep` and `recordElicit` on a hit:

```
SELECT step_key FROM (
  SELECT step_key, created_at FROM steps WHERE kind = 'sleep'
  UNION ALL
  SELECT step_key, created_at FROM input_requests WHERE blocking = 1
) ORDER BY created_at DESC LIMIT 1
```

So a resumed claim goes live at the most recently created sleep or blocking elicit row, or at its first journal miss, whichever comes first. Why not at the first hit of any suspension? Because the handler body re-runs from the top on every resume, and a story chains `step.status` beats with pacing sleeps: beat 1, sleep, beat 2, sleep, fork. On the resume after the fork, every earlier sleep is a completed hit. If each hit flipped `#live`, the replay would re-publish beats 1 and 2 with a fresh `last_updated_at` before reaching the fork, and a poller keyed on `lastUpdatedAt` (the demo client's change key in `apps/demo-client/src/mcp-tasks/task-lane.ts` is status, `lastUpdatedAt`, and `statusMessage`) would see old prose come back as new. Gating on the latest suspension row means the resume is silent through everything before the point where the previous run stopped, and speaks again from there. The first claim is live from the start because nothing precedes it. Offers are not suspension points (they never suspend), so they are excluded from the query; checks are journaled steps but not suspensions, and a `checkInput` hit does not change `#live`.

### (h) tasks/get polling through the router

```
createMcpHandler.fetch(request, env, ctx)       POST tasks/get { taskId, _meta }, Mcp-Method: tasks/get, Mcp-Name: <taskId>
  createTasksRouter.fetch
    JSON.parse(request.clone().text())           not JSON / no method string -> null (the SDK answers)
    TASK_METHODS.has(bodyMethod) || header names a tasks method   claimed; probe().hasTasks must be true
    isLegacyRequest(request, message)            legacy envelope -> null (the SDK answers -32601)
    id must be string | number                   a notification is not ours
    Mcp-Method != body method -> headerMismatch  -32020, HTTP 400
    declaresTasksExtension(params)               else -32021, HTTP 400
    params.taskId non-empty string               else -32602, HTTP 200
    Mcp-Name != taskId -> headerMismatch         -32020, HTTP 400
    env[taskRunnerBinding]                       missing -> -32603, HTTP 200
    callTaskRunner(namespace, taskId, stub => stub.get(undefined))
      tryWhile -> ns.getByName(taskId) -> stub.get
        TaskRunner.get(callerAuthKey)
          #readTask                              schema never bootstrapped -> undefined with zero writes
          auth_key set and != callerAuthKey -> { notFound: true }
          #toDetailedSnapshot(row)
            #baseSnapshot                        taskId, status, createdAt, lastUpdatedAt, ttlMs, pollIntervalMs, statusMessage?
            #snapshotMeta                        _meta["io.durable-mcp-server/status"] when status_meta is set
            completed -> result (JSON)  |  failed -> error  |  input_required -> #outstandingBlockingRequests
    notFound -> errorResponse(-32602, "Task not found"), HTTP 200
    completeResult(snapshot, probe().serverInfo) resultType "complete"; _meta gains io.modelcontextprotocol/serverInfo
    jsonRpcResponse(id, { result }, 200)
  (the SDK handler is never constructed for this request)
```

The router polls with `callerAuthKey = undefined`: the Workers `fetch` surface carries no verified `authInfo`, so a task created with an `auth_key` answers `-32602` to everyone through the router. Fail closed, no existence leak.

### (i) tasks/cancel

```
createTasksRouter.fetch                          POST tasks/cancel { taskId }
  callTaskRunner(namespace, taskId, fn)
    stub.get -> not found -> -32602
    stub.cancel
      TaskRunner.cancel
        #readTask; terminal or missing -> return   idempotent ack
        UPDATE task SET cancel_requested = 1, run_next_at = COALESCE(run_next_at, now)
          WHERE status IN (working, input_required)
        #reconcileAlarm                          -> setAlarm(now)
  -> { resultType: "complete" }                  ack does not mean stopped
```

Cancellation is cooperative and settles on one of three paths:

```
nothing executing:
  TaskRunner.alarm -> #alarmTick -> cancel_requested -> #settleCancelled
    UPDATE task SET status = cancelled, run_next_at NULL WHERE status IN (working, input_required) AND cancel_requested = 1

an attempt is executing:
  ReplayStep.do(...) -> stub.beginStep -> TaskRunner.beginStep -> { state: "cancelled" }
    throw SuspendSignal -> runTask { outcome: "suspended" }
  TaskRunner.#settleOutcome("suspended")
    UPDATE task SET status = cancelled WHERE run_generation = ? AND status IN (working, input_required) AND cancel_requested = 1

the handler finishes first:
  #settleOutcome("completed") -> status completed; cancel_requested stays set and is ignored
```

`DurableStep.checkCancel` (`TaskRunner.checkCancel`, a pure read of `cancel_requested`) is on the lease surface but `ReplayStep` does not expose it; the step boundary is the observation point.

### (j) TTL expiry and purge

The TTL deadline `created_at + ttl_ms` is part of every `#reconcileAlarm` computation: for a live task it is the latest the alarm can sleep, for a terminal task it is the only candidate.

```
TaskRunner.alarm -> #alarmTick                    at or after the deadline
  deadline !== undefined && now >= deadline
    isTerminal(row.status)
      #purge                                     deleteAlarm; storage.deleteAll (schema included); #schemaReady = false
    else
      #expire(row, now)
        UPDATE task SET status = failed, error = { code: -32603, message: "Task expired after <ttl>ms" }, run_next_at NULL
        #reconcileAlarm                          the purge deadline is the same instant, clamped to now
  (next tick) -> #purge
```

After the purge the Durable Object has zero storage and evaporates. A later `tasks/get` runs `#readTask` against no schema, gets `undefined`, and the router answers `-32602`. Because expiry and purge share one deadline, the expired `failed` state is observable only in the window between two consecutive ticks. A task created with `ttlMs: null` never arms a TTL alarm: while live it retries dispatch failures without bound (section 6), and once terminal it keeps its row indefinitely, because nothing purges it.

## 5. Replay and at-least-once

What is journaled: every `step.do` (a `steps` row of kind `do` with its result or terminal error), every `step.sleep` / `step.sleepUntil` (kind `sleep` with `wake_at`), every `step.checkInput` (kind `check` with the consumed response or a `null` miss), every `step.elicit` and `step.offer` (an `input_requests` row with the request, the answer, the deadline, and the timed-out and consumed marks), and the task's own `result` or `error`. Not journaled: `step.status` (it overwrites two columns on the task row) and any code between steps.

What replays: on every claim the executor runs the handler body from the top with a fresh `ReplayStep` built around a fresh lease. Each step call first asks the Durable Object. A `do` hit returns the stored value (or rethrows the stored terminal failure) without running the closure; a `sleep` hit resolves at once; an `elicit` hit resolves with the stored answer or the timeout marker; a `checkInput` hit returns the journaled value even if an answer landed since (a later answer is consumed by the next check, never retroactively by the replay of this one); an `offer` re-record is a no-op. The first miss is where real work resumes. Step names are the journal keys, unique per task: a same-run reuse throws `DuplicateStepError` in `ReplayStep.#claimName` before any RPC, and a cross-run reuse under a different kind throws it in the Durable Object. Loops must suffix an index. Code between steps runs on every replay and must be cheap and deterministic.

Where duplicates can happen: in exactly one step closure per crash. `completeStep` is one guarded UPDATE (`WHERE step_key = ? AND status = 'pending' AND (SELECT run_generation FROM task) = ?`), so a closure whose side effect happened but whose completion never committed leaves a pending row, and the next claim runs that closure again under a new attempt number. Nothing before it re-runs (hits) and nothing after it ran yet. The `limit` in the retry policy counts claims, so a crash after a claim consumes an attempt, and `beginStep` answering `attempt > policy.limit` makes `ReplayStep` fail the step with `AttemptsExhaustedError` without running the closure.

The idempotency key: `step.idempotencyKey(name)` returns `${taskId}:${name}` (`ReplayStep.idempotencyKey`), stable across replays and attempts. Pass it to any external system that deduplicates; `examples/report-task/src/index.ts` sends it as an `Idempotency-Key` header on the `send` step.

Failure semantics at the task level: a handler throw (or an exhausted or non-retryable step) is a normal tool failure, so `runTask` returns `{ outcome: "completed", result: { content: [...], isError: true } }` and the task is `completed`, exactly what the synchronous tool call would have returned. `failed` is reserved for engine errors: an unknown tool, a throwing factory, `ResultSerializationError` (from a step result in the executor or from the task result in `#settleOutcome`), `RetryPolicyError`, and TTL expiry, each stored as a JSON-RPC error object with code `-32603`. A rejected `runTask` RPC or a malformed outcome is not a failure: `#settleDispatchFailure` schedules a redelivery (section 6).

## 6. Reliability

DO RPC retries. Every call from the worker into `TaskRunner` goes through `callTaskRunner` (`engine/call-task-runner.ts`), never a bare stub call. It wraps `tryWhile` from the vendored `vendor/retries.ts`: at most 4 attempts, full-jitter backoff between 100 ms and 3 s, retrying only errors workerd marks `.retryable` and not `.overloaded` (`isErrorRetryable`). The stub is constructed inside the retried closure (`ns.getByName(taskId)` per attempt), because many DO exceptions leave a stub unusable. The retried methods are idempotent by construction: `create` is INSERT OR IGNORE keyed by `taskId`, `get` is a pure read, `update` and `cancel` are guarded flag and row writes.

The alarm never throws. workerd retries a throwing `alarm()` at most 6 times and then drops the alarm silently, so the engine never leans on that. `alarm()` wraps `#alarmTick` in a try/catch whose fallback is `setAlarm(now + 60_000)`, and the first durable act of `#alarmTick` is the same 60-second backstop re-arm, before any read. Whatever fails after that, a wake survives. workerd deletes a due alarm before invoking `alarm()`, so `getAlarm()` reads null inside the delivery window; the re-arm closes it.

The 14-minute handoff. An alarm invocation has a wall-clock limit of roughly 15 minutes. `#awaitWithHandoff` races the attempt's settlement promise against `alarmHandoffMs` (`DEFAULT_ALARM_HANDOFF_MS`, 14 minutes). On handoff it calls `#armForHandoff(now)`, which sets the alarm to now unless an earlier one is pending, and returns. The next invocation finds `#inFlight` set and attaches to the same in-memory promise instead of claiming again. If the Durable Object is evicted in between, `#inFlight` is gone, the pending rows carry the schedule, and the next tick claims a fresh generation and replays.

Dispatch failures are not retried inline. When `executor.runTask` rejects, or resolves a malformed outcome, `#settleDispatchFailure` writes `run_next_at = now + invocationRetryDelayMs(attempt)` (exponential from a 1-second base to a 5-minute cap with equal jitter, `engine/backoff.ts`) and the alarm redelivers with a fresh lease. There is no attempt cap; the TTL bounds it, and a `ttlMs: null` task against a permanently broken executor retries until cancelled. Inline retry would risk two concurrent executions of one attempt.

Generation guards. Every claim writes a fresh `run_generation` UUID. `DurableStep` carries the generation it was minted for and passes it into every `TaskRunner` method; `#requireLease` rejects a purged, terminal, or superseded lease with `StaleLeaseError`, and every write additionally carries `WHERE (SELECT run_generation FROM task) = ?` or `WHERE run_generation = ?`. The executor recognizes `StaleLeaseError` duck-typed (`isStaleLeaseError`: instance, `name`, or the "Stale lease for task" message prefix, whichever survives the RPC boundary) and abandons the attempt with `{ outcome: "suspended" }`; the Durable Object's settlement for a superseded generation is a guarded no-op. The runtime also kills the stub when the `runTask` RPC settles; the SQL guard covers the orphaned case the runtime cannot see, an invocation that timed out DO-side while the executor kept running.

In-flight bookkeeping. `#inFlight` is in-memory only and holds `generation`, the settlement promise, `wakeRequests`, and `cutNextSleep`. `wakeRequests` is incremented by `#noteWakeRequest` whenever `tasks/update` or the timeout sweep writes a `run_next_at` while an attempt is executing, so the attempt's suspended settle does not clear an anchor the alarm has not honored yet. `cutNextSleep` is set by `#wakeForInput` when an offer is answered mid-handler with no sleep pending, and cleared by the sleep that honors it or the `checkInput` that consumes the answer first.

## 7. The wire contract served

Exactly three client-to-server task methods exist, plus the task-creating `tools/call`. There is no `tasks/result` and no `tasks/list`; results are inlined in `tasks/get`.

| Method | Params | Result |
|---|---|---|
| `tools/call` of a task tool | the tool's arguments | flat `CreateTaskResult`: `resultType: "task"`, `taskId`, `status: "working"`, `createdAt`, `lastUpdatedAt`, `ttlMs`, `pollIntervalMs` (no `statusMessage` yet) |
| `tasks/get` | `{ taskId }` | the `DetailedTask` snapshot with `resultType: "complete"`: `completed` carries `result` (the full `CallToolResult`), `failed` carries `error` (a JSON-RPC error object), `input_required` carries `inputRequests`; `statusMessage` once the handler wrote one; `_meta["io.durable-mcp-server/status"]` once the handler wrote a meta |
| `tasks/update` | `{ taskId, inputResponses }` | empty ack with `resultType: "complete"`. Stores responses on matching unanswered keys (first answer wins, unknown keys ignored, partial responses accepted); resumes when no blocking request remains; wakes a working task when an offer was answered |
| `tasks/cancel` | `{ taskId }` | empty ack with `resultType: "complete"`. Cooperative; a task that finishes first stays `completed` |

Every router result stamps `_meta["io.modelcontextprotocol/serverInfo"]` with the server's `Implementation`, merged over the snapshot's own `_meta`, matching the SDK's responses. Lifecycle: `working` and `input_required` interchange; `completed`, `failed`, and `cancelled` are terminal and immutable.

Error codes and HTTP pairings, as `createTasksRouter` and the SDK answer them:

| Code | Meaning | HTTP | When |
|---|---|---|---|
| `-32021` | MissingRequiredClientCapability | 400 | a modern `tasks/*`, or a modern `tools/call` of a registered task tool, whose `_meta` envelope does not declare the tasks extension. `data.requiredCapabilities.extensions` names it. Answered by the router before the SDK |
| `-32020` | HeaderMismatch | 400 | `Mcp-Method` disagrees with the body method, or `Mcp-Name` disagrees with `params.taskId`. `data.mismatch: { header, body }` |
| `-32602` | Invalid params | 200 | unknown, expired, purged, or auth-bound taskId; missing `taskId`; `inputResponses` not an object |
| `-32601` | Method not found | 404 modern, 200 legacy | `tasks/result`, `tasks/list`, and legacy-era `tasks/*`: the router falls through and the SDK answers |
| `-32603` | Internal error | 200 | a `tasks/*` call whose DO RPC still fails after retries, or no `TASK_RUNNER` binding |

Era policy. Tasks ride the 2026-07-28 envelope only. The router runs the SDK's own `isLegacyRequest` on every claimed request and falls through for legacy traffic, so legacy `tasks/*` gets the SDK's `-32601` in-band on 200 and legacy `tools/call` of a task tool reaches `#createTask`, whose `declaredTasksExtension` check throws `MissingRequiredClientCapabilityError`, which the SDK's legacy lane turns into an `isError` tool result on 200 (the 2025 idiom). The client declares support per request under `params._meta["io.modelcontextprotocol/clientCapabilities"].extensions["io.modelcontextprotocol/tasks"]`; the server advertises `capabilities.extensions["io.modelcontextprotocol/tasks"] = {}` once the first `registerTask` call runs (`server.registerCapabilities` in `registerTask`), so a server with no tasks never advertises the extension and its `tasks/*` traffic falls through unchanged.

`Mcp-Name`. The extension requires `Mcp-Name: <taskId>` on `tasks/get`, `tasks/update`, and `tasks/cancel`. The router treats the body as authoritative: it routes on `params.taskId` (`ns.getByName(taskId)`), claims the request when either `Mcp-Method` or the body names a tasks method (the body-parse fallback means a request without the routing headers is still served), and rejects a present `Mcp-Name` that disagrees with the body with `-32020`. Header values are compared after stripping RFC 9110 optional whitespace (`stripHttpOws`).

`outputSchema` is forbidden on `registerTask` at compile time (`never`) and at runtime (`TypeError`): the SDK's output validation would reject the flat task result. The task is registered through the SDK's `registerTool` seam without one, and the 2026 encode seam passes `resultType: "task"` through verbatim; `test/http/wire-create.test.ts` locks those bytes.

## 8. Limits and defaults

Numbers from the code, all in `engine/defaults.ts` unless a file is named:

| Name | Value | Where |
|---|---|---|
| `DEFAULT_TTL_MS` | 86_400_000 (24 h); `null` disables retention | `TaskConfig.ttlMs` |
| `DEFAULT_POLL_INTERVAL_MS` | 5_000 | `TaskConfig.pollIntervalMs` |
| `DEFAULT_STEP_TIMEOUT_MS` | 300_000 (5 min) per closure attempt | `StepConfig.timeoutMs` |
| `DEFAULT_RETRY_POLICY` | `{ limit: 5, baseDelayMs: 1_000, maxDelayMs: 300_000 }`; `limit` counts claims | `TaskConfig.retries`, `StepConfig.retries` |
| `STATUS_META_MAX_BYTES` | 8 * 1024 serialized UTF-8 bytes for a `step.status` meta | `do/task-runner.ts` |
| `ALARM_BACKSTOP_MS` | 60_000: the re-arm on entry and the last-resort re-arm | `do/task-runner.ts` |
| `DEFAULT_ALARM_HANDOFF_MS` | 14 * 60_000: one alarm invocation hands off after 14 minutes | `do/task-runner.ts` |
| `invocationRetryDelayMs(attempt)` | `jitter(exponential(attempt))`: 1 s base, 5 min cap, equal jitter, no count limit | `do/task-runner.ts`, `engine/backoff.ts` |
| `callTaskRunner` | `MAX_ATTEMPTS` 4, `tryWhile` backoff 100 ms to 3_000 ms full jitter | `engine/call-task-runner.ts` |
| duration literals | `ms`, `s`, `m`, `h`, `d` (`"250ms"`, `"30s"`, `"5m"`, `"1h"`, `"2d"`) or a number of ms; fractional values round to the nearest ms | `engine/duration.ts` |
| `ElicitConfig.timeoutMs` | positive safe integer; the deadline is journaled on first record and never recomputed | `step/replay-step.ts` |
| DO RPC payloads | the runtime caps a serialized RPC value at 32 MiB; task inputs, step results, and tool results all cross that boundary. Stay around 1 MB | runtime limit |

Practical consequences:

- Keep one `step.do` closure to minutes at most. The closure timeout defaults to 5 minutes, the alarm invocation hands off at 14, and a closure that outlives its attempt is re-run by the next claim. Use `step.sleep` or `step.sleepUntil` for waits; they suspend the invocation instead of holding it open.
- All side effects belong inside `step.do`. Code between steps runs on every replay.
- Step results must be `JsonSerializable`; `undefined` round-trips through the envelope, nested `undefined` property values and non-JSON values are rejected with `ResultSerializationError`, which fails the task.
- One blocking elicit can be outstanding per task, because a suspending `step.elicit` ends the invocation. Offers are unbounded and never suspend.
- Cancellation lands at the next step boundary, never mid-closure.
- Task ids are `crypto.randomUUID()` bearer handles. Through the shipped router, an `auth_key`-bound task is unreachable; tasks created without an auth context are pure bearer handles.

## 9. Reference

The public surface, as exported from `index.ts`. The barrel imports `cloudflare:workers` (through `TaskRunner`, the executor factory, and the `McpServer` env fallback), so it loads only inside workerd.

### Exports

| Group | Exports | Source |
|---|---|---|
| Server | `McpServer`; types `TaskConfig`, `TaskHandler`, `TaskInput`, `RegisteredTask`, `TaskRegistration`, `CreateServer` | `server/mcp-server.ts`, `server/create-server.ts` |
| Step API | types `Step`, `StepConfig`, `RetryPolicy`, `ElicitConfig`, `ElicitOutcome`, `JsonSerializable`, `JsonValue`, `JsonObject`; `parseDuration`, types `DurationString`, `DurationUnit` | `step/types.ts`, `engine/duration.ts` |
| Durable Object | `TaskRunner`, `DurableStep`, `STATUS_META_KEY`, `STATUS_META_MAX_BYTES`; types `CreateTaskInput`, `TaskSnapshot`, `DetailedTaskSnapshot`, `TaskSnapshotMeta`, `TaskNotFound`, `TaskRunnerEnv`, `LooseJsonValue` | `do/task-runner.ts` |
| Protocol | `StaleLeaseError`, `isStaleLeaseError`; types `TaskInvocation`, `RunOutcome`, `BeginStepOptions`, `BeginStepResult`, `SleepState`, `ElicitState`, `CheckInputState`, `StepFailureDisposition`, `DurableStepStub`, `TaskExecutorLike` | `do/protocol.ts` |
| Executor | `createTaskEntrypoint`; types `TaskExecutorClass`, `TaskExecutorMethods` | `do/task-entrypoint.ts` |
| Fetch entry | `createMcpHandler`, `createTasksRouter`; types `DurableMcpHandlerOptions`, `TasksRouter`, `TasksRouterOptions`, `TaskBindingsOptions`; `DEFAULT_TASK_RUNNER_BINDING` (`"TASK_RUNNER"`), `DEFAULT_TASK_EXECUTOR_BINDING` (`"TASK_EXECUTOR"`), `DEFAULT_TASK_EXECUTOR_ENTRYPOINT` (`"TaskExecutor"`) | `handler/*` |
| Reliability | `callTaskRunner`; `NonRetryableError`, `StepTimeoutError`, `RetryPolicyError`, `ResultSerializationError`, `AttemptsExhaustedError`, `DuplicateStepError`, `serializeError`, `isNonRetryable`, type `SerializedError` | `engine/call-task-runner.ts`, `engine/errors.ts` |
| Defaults | `DEFAULT_TTL_MS`, `DEFAULT_POLL_INTERVAL_MS`, `DEFAULT_STEP_TIMEOUT_MS`, `DEFAULT_RETRY_POLICY` | `engine/defaults.ts` |
| Wire | `TASKS_EXTENSION_ID`, `TASK_STATUSES`; types `Task`, `TaskStatus`, `WorkingTask`, `InputRequiredTask`, `CompletedTask`, `FailedTask`, `CancelledTask`, `DetailedTask`, `CreateTaskResult`, `GetTaskParams`, `GetTaskRequest`, `GetTaskResult`, `UpdateTaskParams`, `UpdateTaskRequest`, `UpdateTaskResult`, `CancelTaskParams`, `CancelTaskRequest`, `CancelTaskResult`, `TasksExtensionCapability`, `InputRequest`, `InputRequests`, `InputResponse`, `InputResponses`; zod schemas `taskStatusSchema`, `taskSchema`, `workingTaskSchema`, `inputRequiredTaskSchema`, `completedTaskSchema`, `failedTaskSchema`, `cancelledTaskSchema`, `detailedTaskSchema`, `createTaskResultSchema`, `getTaskResultSchema`, `updateTaskResultSchema`, `cancelTaskResultSchema`, `getTaskParamsSchema`, `getTaskRequestSchema`, `updateTaskParamsSchema`, `updateTaskRequestSchema`, `cancelTaskParamsSchema`, `cancelTaskRequestSchema`, `inputRequestSchema`, `inputRequestsSchema`, `inputResponseSchema`, `inputResponsesSchema`, `tasksExtensionCapabilitySchema` | `wire/types.ts`, `wire/schemas.ts` |

`wire/` is the only import source for task wire types in the repo. The SDK's own task exports carry the removed 2025-11-25 shapes (`ttl`, `pollInterval`, a wrapped `{ task }` create result, `tasks/result`, `tasks/list`) and are not used.

### McpServer.registerTask

`McpServer` (`server/mcp-server.ts`) extends the SDK's `McpServer` with the same constructor, `(serverInfo: Implementation, options?: ServerOptions)`, and one new method:

```ts
server.registerTask(
  "send_report",
  {
    title: "Send report",                         // optional, passed to the SDK tool
    description: "Compile and send a report",     // optional, passed to the SDK tool
    inputSchema: z.object({ to: z.string() }),    // zod v4 or any Standard Schema with JSON, as for registerTool
    annotations: {},                              // optional ToolAnnotations, passed to the SDK tool
    ttlMs: 86_400_000,                            // default DEFAULT_TTL_MS; null disables retention
    pollIntervalMs: 5_000,                        // default DEFAULT_POLL_INTERVAL_MS
    retries: { limit: 5, baseDelayMs: 1_000, maxDelayMs: 300_000 },  // default DEFAULT_RETRY_POLICY
  },
  async (input, step) => {                        // TaskHandler<In>: (input: TaskInput<In>, step: Step) => Promise<CallToolResult>
    ...
    return { content: [{ type: "text", text: "sent" }] };
  },
);
```

`TaskConfig.outputSchema` is typed `never` and a runtime value throws `TypeError`. Registering a name twice throws. The returned `RegisteredTask` has `enable()`, `disable()`, and `remove()`; `remove()` also drops the registration the executor resolves. `registerTool` and every other SDK method are untouched, so ordinary tools live on the same server.

`CreateServer` is `() => McpServer` (`server/create-server.ts`). The factory runs once per request under `createMcpHandler`, once per `runTask` invocation in the executor, and once lazily in the router's probe, so it must be cheap and free of side effects. Code that needs bindings imports `env` from `cloudflare:workers`, which resolves in all three places.

### The Step interface

`step/types.ts`:

```ts
interface Step {
  do<T extends JsonSerializable>(name: string, fn: () => T | Promise<T>): Promise<T>;
  do<T extends JsonSerializable>(name: string, config: StepConfig, fn: () => T | Promise<T>): Promise<T>;
  sleep(name: string, duration: number | DurationString): Promise<void>;
  sleepUntil(name: string, when: number | Date): Promise<void>;
  elicit(name: string, request: InputRequest): Promise<InputResponse>;
  elicit(name: string, request: InputRequest, config: ElicitConfig): Promise<ElicitOutcome>;
  offer(key: string, request: InputRequest): Promise<void>;
  checkInput(name: string, key: string): Promise<InputResponse | null>;
  status(message: string, meta?: JsonObject): Promise<void>;
  readonly idempotencyKey: (stepName: string) => string;
}

interface RetryPolicy { limit?: number; baseDelayMs?: number; maxDelayMs?: number }
interface StepConfig { retries?: RetryPolicy; timeoutMs?: number }
interface ElicitConfig { timeoutMs?: number }
type ElicitOutcome = { outcome: "answered"; response: InputResponse } | { outcome: "timed_out" };
```

`JsonSerializable` is plain JSON plus top-level `undefined`; `JsonObject` is a plain JSON object with no `undefined` anywhere. `StepConfig.retries` overrides the task policy field by field (`resolveRetryPolicy` in `step/replay-step.ts`: `limit` must be a safe integer of at least 1, delays finite and non-negative, else `RetryPolicyError`). `StepConfig.timeoutMs` must be a positive safe integer (default `DEFAULT_STEP_TIMEOUT_MS`). `sleepUntil` accepts a Date or epoch milliseconds and rounds to the nearest millisecond. The behavior of each method is in section 4.

### createTaskEntrypoint, createMcpHandler, createTasksRouter

`createTaskEntrypoint<Env>(createServer)` returns a `WorkerEntrypoint` class with one method, `runTask(desc: TaskInvocation, step: DurableStepStub): Promise<RunOutcome>`. Export it as `TaskExecutor`: `TaskRunner.resolveExecutor` looks up `ctx.exports.TaskExecutor` by that exact name (`DEFAULT_TASK_EXECUTOR_ENTRYPOINT`) and falls back to a `TASK_EXECUTOR` service binding (`DEFAULT_TASK_EXECUTOR_BINDING`).

`createMcpHandler<Env>(createServer, options?)` returns an `ExportedHandler<Env>` whose `fetch(request, env, ctx)` runs `createTasksRouter(createServer, options).fetch` first and, on `null`, builds the SDK handler for this request with `sdkCreateMcpHandler(() => { const server = createServer(); server.configureTaskRunner(env[binding]); return server }, options.sdk)`. `options.bindings.taskRunner` names the Durable Object binding (default `"TASK_RUNNER"`); `options.sdk` is the SDK's `CreateMcpHandlerOptions` (`legacy`, `responseMode`, `onerror`, and so on), passed through unchanged.

`createTasksRouter(createServer, options?)` returns `{ fetch(request, env, ctx): Promise<Response | null> }` for composing with an existing fetch-based MCP handler:

```ts
const tasks = createTasksRouter(createServer);
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return (await tasks.fetch(request, env, ctx)) ?? existingHandler.fetch(request);
  },
};
```

Both entry styles are wire-identical (`test/http/composition.test.ts`). When the server is mounted through the composition, nothing calls `configureTaskRunner`, so the task-tool wire handler falls back to `env.TASK_RUNNER` from `cloudflare:workers` (`McpServer.#resolveTaskRunnerNamespace`). There is no executor option on either entry: executor addressing happens inside the Durable Object, and the override seam is subclassing `TaskRunner` and overriding `resolveExecutor()`.

### TaskRunner surface and seams

Worker-facing RPC methods, all idempotent and called only through `callTaskRunner`: `create(req: CreateTaskInput): Promise<TaskSnapshot>`, `get(callerAuthKey?: string): Promise<DetailedTaskSnapshot | TaskNotFound>`, `update(inputResponses: Record<string, unknown>): Promise<void>`, `cancel(): Promise<void>`. The engine loop is `alarm()`.

Lease-facing methods, reached through a `DurableStep` stub and each taking the lease's `generation` as the first argument: `beginStep`, `completeStep`, `failStep`, `recordSleep`, `recordElicit`, `recordOffer`, `checkInput`, `setStatus`, `checkCancel`. The stub surface is `DurableStepStub` in `do/protocol.ts`.

Protected seams for subclasses and test fixtures: `resolveExecutor()` (executor lookup), `alarmHandoffMs` (default 14 minutes), `initialWakeDelayMs` (default 0: `create`, `update`, `cancel`, and the wake paths arm `setAlarm(now)`), and `invocationRetryDelayMs(attempt)` (default `jitter(exponential(attempt))`).

### Errors

`engine/errors.ts` defines the classes a handler can meet. `NonRetryableError` marks a closure failure terminal; `isNonRetryable` recognizes it by instance, by `name`, or by constructor name, so it survives the RPC boundary and also honors the `cloudflare:workflows` class of the same name. `StepTimeoutError` is what `runClosureWithTimeout` rejects with and follows the step's retry policy. `AttemptsExhaustedError` is thrown when a claim lands past `limit`. `DuplicateStepError` is thrown for a reused step name, executor-side for a same-run reuse and DO-side for a cross-run kind mismatch. `RetryPolicyError` and `ResultSerializationError` are engine failures that fail the task. `StaleLeaseError` (`do/protocol.ts`) is thrown by every lease method once the lease is superseded, terminal, or purged. `serializeError(value)` reduces any thrown value to `{ name, message }` without trusting getters.

### Wrangler configuration

Two obligations, both mechanical: the Durable Object binding and its SQLite migration.

```jsonc
{
  "name": "my-task-server",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-20",
  "durable_objects": {
    "bindings": [{ "name": "TASK_RUNNER", "class_name": "TaskRunner" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["TaskRunner"] }]
}
```

No service binding is needed: `TaskRunner` reaches the executor through `ctx.exports.TaskExecutor`, which is on by default at compatibility date 2026-08-20. On older compatibility dates add the fallback the engine checks second:

```jsonc
"services": [{ "binding": "TASK_EXECUTOR", "service": "my-task-server", "entrypoint": "TaskExecutor" }]
```

The shipped configs are `examples/report-task/wrangler.jsonc` and `apps/task-server/wrangler.jsonc`.

### Dependencies and vendored code

`packages/durable-mcp-server/package.json` depends on `zod` (`^4.4.3`) and peer-depends on `@modelcontextprotocol/server` at exactly `2.0.0`. Everything else is vendored with a file-header notice and credited in the package README:

- `vendor/retries.ts`: `tryWhile`, `tryN`, `jitterBackoff`, and `isErrorRetryable` from lambrospetrou/durable-utils (MIT), pinned at commit 9f29c7c. The local change is in `engine/call-task-runner.ts`, which constructs a fresh stub per attempt instead of reusing one.
- `do/task-runner.ts`, `step/replay-step.ts`, `engine/backoff.ts`, `engine/errors.ts`, `engine/serialization.ts`: the alarm reconciliation, generation-guarded claim and guarded-write idiom, handoff race, step timeout race, retry and terminal dispositions, error taxonomy, and undefined-safe envelope from avenceslau/durability (ISC), pinned at commit 78cb099. The in-Durable-Object handler call is replaced by the `TaskRunner` to `TaskExecutor` RPC, and the alarm schedule is computed from the rows instead of stored.
- `wire/types.ts`, `wire/schemas.ts`: the MCP Tasks extension wire types and hand-written zod schemas from modelcontextprotocol/ext-tasks (Apache-2.0, Model Context Protocol contributors), pinned at commit dcc8d2b. The generated JSON Schema from the same commit is vendored at `test/fixtures/ext-tasks.schema.json` as the conformance fixture.
