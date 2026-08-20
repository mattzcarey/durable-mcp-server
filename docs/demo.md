# The demo

How the two demo apps use `durable-mcp-server` and talk to each other, and what the smallest integration looks like. `apps/task-server` is the MCP server: one tool, `start`, that plays a story as a durable task. `apps/demo-client` is the MCP client: an agents-SDK Durable Object that starts and watches tasks, and a React page that renders them. `examples/report-task` is the integration a developer writes. Paths are relative to the repo root unless a section says otherwise. The library itself is covered in [how-it-works.md](how-it-works.md) and the test harness in [testing.md](testing.md).

Contents

1. [The shape](#1-the-shape)
2. [The story engine in task-server](#2-the-story-engine-in-task-server)
   - [Format, validator, interpreter](#format-validator-interpreter)
   - [The handler: walk events onto the step API](#the-handler-walk-events-onto-the-step-api)
   - [What each event does in the engine](#what-each-event-does-in-the-engine)
   - [Resources](#resources)
   - [The status meta shape](#the-status-meta-shape)
3. [The client](#3-the-client)
   - [Why a raw tasks lane](#why-a-raw-tasks-lane)
   - [The lane](#the-lane)
   - [The agent's per-task watch loop](#the-agents-per-task-watch-loop)
   - [What is persisted](#what-is-persisted)
   - [The page as a projection](#the-page-as-a-projection)
   - [Reconnect and resync](#reconnect-and-resync)
   - [Several tasks at once](#several-tasks-at-once)
   - [Pseudo callstacks](#pseudo-callstacks)
   - [Upgrading off the lane](#upgrading-off-the-lane)
4. [The example](#4-the-example)

## 1. The shape

Two Workers and a browser page.

`apps/task-server/src/index.ts` is a stateless MCP server on the library. `createServer()` builds a `McpServer({ name: "durable-mcp-server-demo", version: "1.0.0" })`, calls `registerStoryResources(server, listStories())` so every registered story's manifest, scenes, and sprites are MCP resources, and calls `server.registerTask("start", ...)` exactly once. There are no other tools: `tools/list` returns `["start"]`. The worker exports the three things every integration exports, `TaskRunner`, `TaskExecutor = createTaskEntrypoint(createServer)`, and a default `fetch` that hands `/mcp` to `createMcpHandler<Env>(createServer).fetch` and answers 404 elsewhere. `wrangler.jsonc` binds `TASK_RUNNER` to the `TaskRunner` class with a `new_sqlite_classes` migration at compatibility date 2026-08-20; beyond observability there is nothing else in it. The stories themselves (`src/stories/datacenter`, `src/stories/odyssey`) are data modules that call `registerStory` at import; `src/index.ts` imports `./stories` once for that side effect.

`apps/demo-client` is two halves. `src/server.ts` is `MyAgent extends Agent<Env, MyAgentState>` from the `agents` package, one Durable Object per browser session (`wrangler.jsonc` binds the class `MyAgent`; the default `fetch` is `routeAgentRequest(request, env, { cors: true })`). The agent holds the MCP connection to task-server, starts tasks, polls them on alarms, and folds what it sees into one persisted record per task. `src/client.tsx` is the React page: it opens a WebSocket to its agent with `useAgent({ agent: "my-agent", name: sessionId })`, receives the agent's state on every change, calls `@callable` methods, and renders one task per URL. The page has no story knowledge and carries no art.

The wire between them is plain MCP plus the Tasks extension. The agent's SDK connection (the `agents` MCP client over Streamable HTTP) does the handshake and discovery (`initialize`, `tools/list`, `resources/list`, `prompts/list`) and `resources/read`. Everything about tasks rides four requests sent by the client's own lane (see [why a raw tasks lane](#why-a-raw-tasks-lane)): a `tools/call` of `start` that answers a flat `CreateTaskResult`, `tasks/get` polls that carry the task snapshot with `statusMessage`, `_meta`, `inputRequests`, or the final `result` inlined, `tasks/update` for fork answers and ambient presses, and `tasks/cancel`. There are no notifications (the library is polling-only), no custom endpoints, and no shared types between the two apps: the client parses the server's strings and meta with its own schemas.

## 2. The story engine in task-server

### Format, validator, interpreter

Paths in this section that start with `src/` or `test/` are relative to `apps/task-server`. A story is data. `src/story/format.ts` is the zod schema (`storySchema`, a `strictObject`; `StoryInput` is what authors write). The header declares `id`, `title`, `blurb`, `accent?`, `defaultName`, `phases` (the checklist the client lights), `resources` (named numbers with starting values), `start`, `defaultScene`, `beatSleepMs?`, `actions?` (the ambient action set standing from the start), `scenes` and `sprites` (self-contained SVG documents keyed by kebab-case id), and `nodes`. A node has `beats` (prose lines, one `statusMessage` each), optional `phase`, `scene`, `sprite`, `buildPercent`, `effects`, `gate`, `actions`, `beatSleepMs`, `sleepMs`, and exactly one continuation: `ending`, `decision` (the only kind of elicitation: `scene`, `options[{ id, label, goto, effects? }]`, and for a timed crisis `timeoutMs` with `fateGoto`), `roll` (weighted `branches[{ weight, goto, beat?, sprite?, effects? }]`), `next`, or `return` (back from an ambient sub-story). Every prose field may write `{name}`; `fillName` substitutes the protagonist. The rest of the module is pure helpers the interpreter uses: `decisionMessage` and `optionLines` (the scene text followed by one `- {id}: {label}` line per option), `windowSentence` ("You have N seconds."), `decisionRequest` and `actionRequest` (an `elicitation/create` request whose `requestedSchema` is an enum of option ids under `choice`; a timed decision also carries `params.timeoutMs`), `endingText` (`[ending:{id}] {prose}`), `chosenId` and `chosenOption` (an accept whose `content.choice` names an option), `applyEffects`, and the seeded randomness: `mulberry32`, `fnv1a`, `normalizeSeed`, `rollValue(seed, stepName)` (a pure function of the story seed and the step name), `pickBranchIndex`.

`src/story/index.ts` is the registry. `registerStory(input)` runs `storySchema.parse`, then `assertValidStory`, then stores the story by id; `getStory`, `listStories`, and `storyIds` read it. `src/story/validate.ts` checks the graph beyond the shape. `validateStory(story)` returns every problem as a string tagged with a stable rule name, and `assertValidStory` throws with the list: `node-id`, `reserved-id` (node ids matching `actions-\d+` would collide with the offer keys), `missing-start`, `unresolved-target`, `continuation` (exactly one of ending, decision, roll, next, return), `decision-question` (a decision scene ends with "?"), `duplicate-option`, `crisis-timeout` (`timeoutMs` and `fateGoto` together or not at all), `no-ending`, `duplicate-ending`, `duplicate-phase`, `unknown-phase`, `unknown-resource`, `unknown-scene`, `unknown-sprite`, `visual-needs-beat`, `duplicate-action`, `action-scope` (sub-stories reached from an action are disjoint from the main line, carry no decisions and no nested action sets), `return-scope` (no `return` on the main line), `unreachable`, `dead-end` (every node reaches an ending; every sub-story node reaches a return or an ending), and `cycle` (iterative three-color DFS over every edge kind). Acyclicity is what makes a playthrough terminate and what keeps each decision's elicit key, the node id, unique for the task's lifetime. A broken story fails at import, never mid-playthrough.

`src/story/walk.ts` is the interpreter, and it is pure: no step API, no I/O. `walkStory(story, { name, seed })` is a generator that yields `WalkEvent`s and takes `WalkFeedback` back through `next()`:

| Event | Fields | Feedback expected |
| --- | --- | --- |
| `beat` | `nodeId`, `text`, `meta` (the visual state, built by `buildMeta`) | none |
| `sleep` | `stepName`, `ms` | none |
| `roll` | `stepName`, `pick: () => number` | `{ kind: "rolled", index }` |
| `ask` | `key` (the node id), `request`, `optionIds`, `timeoutMs?` | `{ kind: "answered", response }` or `{ kind: "timed-out" }` |
| `offer` | `key` (`actions-{n}`), `request` | none |
| `check` | `stepName`, `key` | `{ kind: "checked", response }` (`null` when nothing was pressed) |

`walkLine(context, startId, frame)` plays one line from a node id. For each node, in order: the entry `gate` (a depleted resource jumps to `elseGoto` without playing the node), `effects`, the visual state (`scene` becomes `sceneUri(story.id, scene)`, `phase`, `buildPercent / 100`), a node-level `actions` set (main line only; `offerActions` yields an `offer` under the next key `actions-{n}` and remembers it as the standing set), then the beats. Every beat yields a `beat` event, then a `sleep` of `node.beatSleepMs ?? story.beatSleepMs ?? DEFAULT_BEAT_SLEEP_MS` (2500 ms; 0 skips it), then, on the main line with a standing set, a `check` of the standing key. A pressed action runs its sub-story as a nested `walkLine` with step-name prefix `a{n}:` and `main: false`; a sub-story that ends in `return` hands control back to the interrupted beat, after which `offerActions` re-offers the set under a fresh key (a consumed key is spent). After the beats come `sleepMs` (a `wait:{nodeId}` sleep), then the continuation: `ending` returns the `endingText`; `decision` yields an `ask` whose request is `decisionRequest(decisionMessage(scene, options), optionIds, timeoutMs)` (the scene gets `windowSentence` appended when timed), and routes on the answer through `chosenOption`, else `fateGoto` when declared, else the first option; `roll` yields a `roll` whose `pick` is `pickBranchIndex(branches, rollValue(seed, stepName))`, then optionally a branch beat and its pacing sleep; `next` continues. `walkStory` itself first yields the story-level action offer when `story.actions` exists, then walks the main line from `story.start`, and returns the ending text.

Step names are the journal keys, and the engine shares one namespace across `do`, `sleep`, `elicit`, `offer`, and `checkInput`, so the walk uses `:` separators that a kebab-case node id cannot contain: `pace:{nodeId}:{beatIndex}` and `pace:{nodeId}:roll` for pacing sleeps, `wait:{nodeId}` for `sleepMs`, `roll:{nodeId}` for rolls, `check:{nodeId}:{beatIndex}` for action checks, all prefixed `a{n}:` inside the n-th sub-story entry; fork keys are the node ids themselves and offer keys are `actions-{n}`. Because the walk is a pure function of `(story, name, seed)` and the feedbacks fed back in, an engine replay that re-drives the generator with journal-fed feedbacks repeats it exactly.

The shipped stories: `src/stories/datacenter` (Nortada One, a datacenter on the Atlantic coast at Sines; the tests in `test/datacenter.test.ts` assert at least 300 nodes, at least 70 decisions, exactly 8 timed crises, exactly 20 endings, 24 or more scenes, 27 or more sprites) and `src/stories/odyssey` (Troy to Ithaca; 3 timed crises, 13 endings). Both are plain data composed from arc and art modules; the art is authored with `svgDocument` and `fragments` from `src/story/svg.ts` (one 640 by 360 viewBox, `preserveAspectRatio="xMidYMid slice"`, no external references; a scene may read the CSS variable `--build-progress` that the client sets).

### The handler: walk events onto the step API

The `start` task in `src/index.ts` is a thin adapter. Its input schema is `{ story: string, name?: string (max 80), seed?: integer }` and it sets `pollIntervalMs: 1_000`. The handler body, as a pseudo callstack from the tool call down to the step calls:

```
start(input, step)                                  apps/task-server/src/index.ts
  getStory(input.story)                             unknown id -> return { isError: true, content: [...] } naming storyIds()
  name = input.name?.trim() || story.defaultName
  step.do("setup:seed", () => ({ seed: normalizeSeed(input.seed ?? random uint32) }))
                                                    journaled once; a replay reads the seed back
  walk = walkStory(story, { name, seed })
  loop: turn = walk.next(feedback)
    turn.done      -> return { content: [{ type: "text", text: turn.value }] }     "[ending:{id}] {prose}"
    event "beat"   -> step.status(event.text, event.meta)
    event "sleep"  -> step.sleep(event.stepName, event.ms)
    event "roll"   -> feedback = { kind: "rolled", index: await step.do(event.stepName, event.pick) }
    event "ask"    -> timeoutMs undefined:
                        feedback = { kind: "answered", response: await step.elicit(event.key, event.request) }
                      timeoutMs set:
                        outcome = await step.elicit(event.key, event.request, { timeoutMs: event.timeoutMs })
                        feedback = outcome.outcome === "answered"
                          ? { kind: "answered", response: outcome.response }
                          : { kind: "timed-out" }
    event "offer"  -> step.offer(event.key, event.request)
    event "check"  -> feedback = { kind: "checked", response: await step.checkInput(event.stepName, event.key) }
```

That is the whole server-side story logic that touches the engine. Every other rule (pacing, sub-stories, fate branches, resource gates) lives in the pure walk, so the same generator drives the wire playthroughs in `apps/task-server/test` and the pure projection in `test/support/story-sim.ts` (`projectStory`, `sweepStory`), which is how the tests compare beats and meta observed over `tasks/get` against the expected walk.

### What each event does in the engine

Each branch above lands in the library's replay-aware `ReplayStep` (`packages/durable-mcp-server/src/step/replay-step.ts`), crosses to the task's `TaskRunner` Durable Object through the per-lease `DurableStep` stub (`packages/durable-mcp-server/src/do/task-runner.ts`), and writes SQLite. The stacks below name the real functions; [how-it-works.md](how-it-works.md) has the engine rules behind them.

A beat. `step.status` is not a journal write; it is gated so a replay never re-publishes old prose.

```
step.status(text, meta)
  ReplayStep.status                                 returns without a call while #live is false (replaying old ground)
    DurableStep.setStatus(message, meta)
      TaskRunner.setStatus(generation, message, meta)
        serializeStatusMeta(meta)                   plain JSON object, at most STATUS_META_MAX_BYTES (8 KiB)
        #readTask; terminal -> no-op; generation mismatch -> StaleLeaseError
        UPDATE task SET status_message, status_meta, last_updated_at WHERE run_generation = ?
```

Pacing. `step.sleep` never holds the invocation open.

```
step.sleep("pace:land-scouts:0", 2500)
  ReplayStep.sleep -> #claimName -> parseDuration -> #recordSleep(name, now + ms)
    DurableStep.recordSleep -> TaskRunner.recordSleep(generation, stepKey, wakeAtMs)
      #requireLease; #readStep(stepKey)
      miss  -> INSERT INTO steps (kind 'sleep', status 'pending', wake_at) ; #reconcileAlarm -> txn.setAlarm(wake_at)
               returns { state: "pending" }
      hit   -> returns { state: "completed", latest: #isLatestSuspension(stepKey) }
    pending -> throw SuspendSignal                  TaskExecutor.runTask returns { outcome: "suspended" }
               TaskRunner.#settleOutcome clears run_next_at; the alarm at wake_at is the resume
    completed -> resolve; #live = true when latest  (earlier completed sleeps are old ground: status stays silent)

alarm() at wake_at
  TaskRunner.#alarmTick
    UPDATE steps SET status = 'completed' WHERE kind = 'sleep' AND status = 'pending' AND wake_at <= horizon
    claim: UPDATE task SET run_attempt + 1, run_generation = <uuid> WHERE status = 'working'
    #dispatch -> resolveExecutor() -> ctx.exports.TaskExecutor.runTask(desc, new DurableStep(...))
      TaskExecutor.runTask -> createServer().getTaskRegistration("start") -> new ReplayStep(stub, taskId, retries, attempt)
        start(input, step) again from the top: "setup:seed" is a journal hit, the walk re-drives,
        every earlier status call is skipped, every earlier sleep hits, the latest one flips #live
```

A roll. The pick closure is pure, but journaling it means the replay reuses the index rather than recomputing it.

```
step.do("roll:crisis-season", pick)
  ReplayStep.do -> #runDo -> #claimName -> resolveRetryPolicy(task retries, undefined)
    DurableStep.beginStep(name, { timeoutMs: 300_000 }) -> TaskRunner.beginStep
      miss -> INSERT INTO steps (kind 'do', status 'pending', attempt 1) ; { state: "run", attempt: 1 }
      hit  -> { state: "completed", value }                      closure does not run
    run -> runClosureWithTimeout(name, pick, timeoutMs) -> serializeValue(value) -> DurableStep.completeStep
           TaskRunner.completeStep: UPDATE steps SET status 'completed', result WHERE status = 'pending' AND generation matches
```

A fork. `step.elicit` records the ask, moves the task to `input_required`, and suspends; a timed ask also arms a deadline.

```
step.elicit("picket-news-van", request, { timeoutMs: 20_000 })
  ReplayStep.elicit -> #claimName -> timeoutAtMs = now + timeoutMs
    DurableStep.recordElicit(name, request, timeoutAtMs) -> TaskRunner.recordElicit
      #readInputRequest(name)
      none     -> INSERT INTO input_requests (key, request, blocking 1, timeout_at)
                  UPDATE task SET status = 'input_required', run_next_at = NULL
                  #reconcileAlarm                              min(TTL deadline, timeout_at)
                  { state: "pending" }      -> throw SuspendSignal
      answered -> { state: "answered", response, latest }
      timed_out-> { state: "timed_out", latest }
  tasks/get now carries status "input_required" and inputRequests["picket-news-van"] = the request

tasks/update { taskId, inputResponses: { "picket-news-van": { action: "accept", content: { choice } } } }
  createTasksRouter.fetch -> callTaskRunner -> stub.get -> stub.update(responses)
    TaskRunner.update
      UPDATE input_requests SET response, answered = 1 WHERE key = ? AND answered = 0 RETURNING blocking
      blocking and #outstandingBlockingRequestCount() == 0
        -> UPDATE task SET status = 'working', run_next_at = now ; #noteWakeRequest ; #reconcileAlarm -> setAlarm(now)
  alarm() -> #alarmTick -> claim -> #dispatch -> runTask -> replay -> recordElicit finds answered
    -> { state: "answered", response, latest: true } -> handler feeds { kind: "answered" } into the walk

alarm() at timeout_at, unanswered
  #alarmTick -> #resolveDueElicitTimeouts(now)
    UPDATE input_requests SET answered = 1, timed_out = 1 WHERE blocking = 1 AND timeout_at <= now
    none outstanding -> UPDATE task SET status = 'working', run_next_at = now
  claim -> replay -> recordElicit returns { state: "timed_out" } -> ReplayStep.elicit returns { outcome: "timed_out" }
    -> the walk takes decision.fateGoto
```

An ambient action. `step.offer` registers a standing request without suspending; `step.checkInput` is a journaled, consume-once read at every beat boundary; an answer that lands mid-beat cuts the pacing sleep short.

```
step.offer("actions-1", request)
  ReplayStep.offer -> #claimName -> DurableStep.recordOffer -> TaskRunner.recordOffer
    INSERT INTO input_requests (key, request, blocking 0)   no status change, no alarm, never listed in inputRequests
    (replay: the row exists -> return)

tasks/update { "actions-1": { action: "accept", content: { choice: "consult-the-gods" } } }   while working
  TaskRunner.update -> answered offer on a working task -> #wakeForInput(now)
    a pending sleep exists -> UPDATE steps SET status 'completed' (the pacing sleep is cut) ; run_next_at = now ; #noteWakeRequest
    no pending sleep but an attempt executing -> #inFlight.cutNextSleep = true (the next recordSleep journals completed on arrival)
  alarm() -> claim -> replay -> the cut sleep hits -> the walk reaches its next check

step.checkInput("check:cicones-landfall:0", "actions-1")
  ReplayStep.checkInput -> #claimName -> DurableStep.checkInput -> TaskRunner.checkInput
    journal hit (steps kind 'check') -> the journaled value, answered or null
    miss: answered and unconsumed -> UPDATE input_requests SET consumed = 1 ; INSERT steps (kind 'check', result = response)
          else                     -> INSERT steps (kind 'check', result = null)
  answered -> walkLine runs the sub-story with prefix "a1:" ... return -> offerActions yields offer "actions-2"
```

The ending. The handler returns a `CallToolResult`; `TaskExecutor.runTask` wraps it as `{ outcome: "completed", result }`; `TaskRunner.#settleOutcome` writes `status = 'completed'` and the result JSON; the next `tasks/get` carries `result.content[0].text = "[ending:{id}] {prose}"`. A handler throw becomes `completed` with `isError: true`; only engine errors produce `failed`. `tasks/cancel` sets `cancel_requested` and a wake. A story spends most of its life suspended in a pacing sleep, so the usual path is that the wake fires `#alarmTick` with nothing in flight and `#settleCancelled` flips the task to `cancelled`; if an invocation is executing, its next `step.do` (a roll) gets the `cancelled` directive from `beginStep`, the invocation suspends, and `#settleOutcome` makes the same flip.

### Resources

`src/story/resources.ts` registers every story's visuals and metadata as static resources through the SDK's `server.registerResource(name, uri, metadata, reader)`, so `resources/list` and `resources/read` work for every URI with nothing dynamic. URIs come from `src/story/uris.ts`: `manifestUri` is `story://{id}/manifest`, `sceneUri` is `story://{id}/scenes/{sceneId}`, `spriteUri` is `story://{id}/sprites/{spriteId}`. `storyResourceUris(story)` lists all three kinds for one story; `test/stories.test.ts` asserts every one is listed and readable over the wire.

| URI | mimeType | Body |
| --- | --- | --- |
| `story://{id}/manifest` | `application/json` | `storyManifest(story)`: `{ id, title, blurb, phases: [{ id, label }], defaultScene: <scene URI>, accent? }` |
| `story://{id}/scenes/{sceneId}` | `image/svg+xml` | the scene's SVG document, verbatim |
| `story://{id}/sprites/{spriteId}` | `image/svg+xml` | the sprite's SVG overlay, verbatim |

The client builds its story picker from the manifests it finds in `resources/list` and reads the scene and sprite URIs the status meta names; it never knows a story id ahead of time.

### The status meta shape

Every beat is `step.status(prose, meta)`. The prose is the `statusMessage` on `tasks/get`, with no tags; the visual state rides the engine's structured status under `_meta["io.durable-mcp-server/status"]` (the library's `STATUS_META_KEY`). `buildMeta` in `walk.ts` produces it:

```jsonc
{
  "scene": "story://odyssey/scenes/boat",                    // current scene URI; present once a node set one
  "sprite": { "uri": "story://odyssey/sprites/storm", "persist": false },  // only on the beat that fires it
  "phase": "aeolus",                                         // a manifest phase id; present once a node set one
  "build": 0.34,                                             // buildPercent / 100; present once a node set one
  "actions": {                                               // the standing ambient set, when one stands
    "key": "actions-2",
    "options": [{ "id": "consult-the-gods", "label": "Consult the gods" }]
  }
}
```

Three engine facts shape how the client reads it. The meta is replaced wholesale on every `step.status` call that passes one, and every beat passes one, so the walk re-sends `scene`, `phase`, `build`, and `actions` on every beat and a `sprite` appears only on the beat that fires it; the client reads each field as state (present applies, absent keeps the last value) and change-detects sprite and action firings (a new sprite object, a new action key), so a repeated meta never re-fires anything. The meta is capped at 8 KiB serialized (`STATUS_META_MAX_BYTES`) and must be a plain JSON object. And `step.status` is silent while a resumed invocation replays old ground, so a poller never sees an earlier beat come back with a fresh `lastUpdatedAt` after a fork or a cut sleep.

## 3. The client

Paths in this section that start with `src/` are relative to `apps/demo-client`.

### Why a raw tasks lane

The client must run task-augmented tool calls against the server per the current Tasks extension (`tools/call` returning a task, `tasks/get` polling with results inlined, `tasks/update`, `tasks/cancel`). The installed MCP SDK, `@modelcontextprotocol/client@2.0.0` (exact-pinned by `agents@0.21.0`), carries tasks only as the deprecated 2025-11-25 wire vocabulary with no runtime, and its request path refuses the current shapes: different field names, a wrapped result, a different notification name, a local era gate, and a reserved-header list that blocks the `Mcp-Name` header the extension requires. Seven claims were checked against the installed dist (the chunk `dist/src-D_zzAWoS.mjs` is hash-named, so line numbers hold only for this exact version) and against [modelcontextprotocol/ext-tasks](https://github.com/modelcontextprotocol/ext-tasks) at commit `dcc8d2b`:

| # | Claim | Verdict | Evidence |
| --- | --- | --- | --- |
| C1 | SDK 2.0.0 has tasks only as the deprecated 2025-11-25 vocabulary, no runtime | Confirmed | every task schema in the client and server dists is tagged `@deprecated 2025-11-25 wire vocabulary with no SDK runtime` (for example `src-D_zzAWoS.mjs:565`) |
| C2 | Field shapes differ: `ttl` and `pollInterval` are the old names | Confirmed | old `ttl` / `pollInterval` at `src-D_zzAWoS.mjs:1631,1634`; the extension uses `ttlMs` (required, nullable) and `pollIntervalMs` (`schema/draft/schema.ts` at `dcc8d2b`) |
| C3 | One side wraps the create result as `{ task }` | Confirmed, the old side wraps | `CreateTaskResultSchema$1 = ResultSchema$1.extend({ task: TaskSchema$1 })` at `src-D_zzAWoS.mjs:1642`; the extension's result is flat `Result & Task` discriminated by `resultType: "task"` |
| C4 | The notification name differs | Confirmed | old `notifications/tasks/status` (`src-D_zzAWoS.mjs:1655`); the extension uses `notifications/tasks` |
| C5 | An era gate locally refuses `tasks/get` toward a 2026 peer | Confirmed | `MethodNotSupportedByProtocolVersion` is documented with exactly this example, "raised locally, before anything reaches the transport" (`src-D_zzAWoS.mjs:288`, thrown at `:6027`) |
| C6 | The extension requires `Mcp-Name: <taskId>` on task requests | Confirmed | `specification/draft/tasks.md:511` at `dcc8d2b`: the client MUST set `Mcp-Name` to `params.taskId` on `tasks/get`, `tasks/update`, `tasks/cancel` over Streamable HTTP; on the initiating `tools/call` the base SEP-2243 convention puts the tool name there. The SDK can never send the taskId form: it reserves `mcp-name` (`dist/index.mjs:4905`) and derives it only from `params.name` or, for `resources/read`, `params.uri` (`dist/index.mjs:5067`) |
| C7 | That header can be the per-task Durable Object routing key server-side (`getByName(taskId)`) | Confirmed, viable | the extension motivates the header as instance routing for intermediaries; `params.taskId` is in every task-method body too, so body-based routing also works (see the routing note below) |

Upgrading the SDK or `agents` does not help: npm latest is 2.0.0 with the deprecated vocabulary only, `agents@0.21.0` exact-pins that client, and no release carries a runtime for the current extension. Patching the SDK with `pnpm patch` is unnecessary: the SDK blocks only its own request path (the era gate, a result decoder that rejects `resultType: "task"`, the reserved `mcp-name` header) and nothing stops a lane beside it, because everything the lane needs is public on the `agents` `MCPClientConnection` surface (`conn.url`, `conn.protocolVersion`, `conn.sessionId`, `conn.options.transport.authProvider?.tokens()`). A patch would have meant maintaining three SDK edits against a moving draft for no gain. The client therefore speaks tasks as raw JSON-RPC over `fetch`, reusing the SDK connection's negotiated state. There is no pnpm patch in the repo: `patches/` does not exist and `pnpm-workspace.yaml` has no `patchedDependencies`. Because the era gate, the decoder, and the header reservation all sit on the SDK request path, the initiating task-augmented `tools/call` rides the raw lane too, not only `tasks/get`, `tasks/update`, and `tasks/cancel`. Resources (`resources/list`, `resources/read`) have no tasks entanglement and ride the ordinary SDK connection.

Routing note for the server side: `createTasksRouter` in the library reads `params.taskId` from the body as the authority, addresses `env.TASK_RUNNER.getByName(taskId)`, and cross-checks the `Mcp-Name` header when present (a mismatch answers `-32020`). Anything that routes on the header before parsing the body must decode the SEP-2243 `=?base64?...?=` sentinel first; plain UUID task ids pass through unencoded.

### The lane

`apps/demo-client/src/mcp-tasks/schema.ts` vendors the extension's wire shapes as zod schemas, pinned to ext-tasks commit `dcc8d2b` and credited in `apps/demo-client/README.md`: a flat `CreateTaskResultSchema` discriminated by `resultType: "task"`, the `DetailedTaskSchema` union (`working`, `input_required` with `inputRequests`, `completed` with `result`, `failed` with `error`, `cancelled`), `ttlMs` required and nullable, `pollIntervalMs` optional, `statusMessage` nullable and optional (absent until the handler's first `step.status`), `TaskAckResultSchema` for the empty `tasks/update` and `tasks/cancel` acks, and `isTerminalStatus`. The schemas reject the 2025-11-25 shapes at parse time, so a server speaking the old vocabulary fails loudly instead of being misread. No task type is ever imported from `@modelcontextprotocol/*`.

`apps/demo-client/src/mcp-tasks/task-lane.ts` sends the four methods as plain JSON-RPC over `fetch`. `sendTaskLaneRequest(session, method, params, mcpName, fetchImpl)` builds one request with `id = crypto.randomUUID()`, `params` plus the per-request `_meta` envelope from `taskEnvelopeMeta(protocolVersion)` (the protocol version and `clientCapabilities.extensions["io.modelcontextprotocol/tasks"] = {}`; the extension has no initialize-time capability), and headers from `buildTaskLaneHeaders`: `accept: application/json, text/event-stream`, `content-type`, `mcp-method`, `mcp-name` through `encodeMcpHeaderValue` (the SEP-2243 sentinel for empty, padded, non-printable, or non-ASCII values), `mcp-protocol-version`, and when present `mcp-session-id` and `authorization: Bearer`. It reads the body as JSON or as a one-shot SSE stream (`extractJsonRpcFromSse` picks the event whose `id` matches), validates the JSON-RPC envelope, and throws `TaskLaneError` with the JSON-RPC code or the HTTP status on anything else. On top of it: `callToolAsTask(session, name, args)` sends `tools/call` with `Mcp-Name: <tool name>` and returns `{ kind: "task", task }` after `CreateTaskResultSchema.parse` when `result.resultType === "task"`, else `{ kind: "result", result }`; `getTask` sends `tasks/get` with `Mcp-Name: <taskId>` and parses `GetTaskResultSchema`; `updateTask` validates the responses with `InputResponsesSchema` and parses the ack; `cancelTask` likewise. `nextPollDelayMs(task, overrideMs)` honors the server's `pollIntervalMs` hint clamped to 250 ms..60 s (`MIN_POLL_INTERVAL_MS`, `MAX_POLL_INTERVAL_MS`), defaults to 2000 ms without a hint, and lets a client override win inside the same clamp. `taskChangeKey(task)` is `status`, `lastUpdatedAt`, and `statusMessage` joined, the change detector the watch loop uses. (`pollTaskUntilTerminal` is a plain loop with a 1000-poll cap for callers without an alarm scheduler; the agent does not use it.)

`MyAgent.taskLaneSession(serverId)` in `src/server.ts` builds the `TaskLaneSession` from the live SDK connection: `conn.url.href`, `conn.protocolVersion` (it throws before negotiation completes), `conn.sessionId` when the server issued one, and the OAuth access token from `conn.options.transport.authProvider?.tokens()` when the connection is authenticated. The lane never stores a session of its own.

Tests: `src/mcp-tasks/schema.test.ts` and `src/mcp-tasks/task-lane.test.ts`, the latter against an msw fake server that enforces auth, session, envelope, and header-to-body cross-checks (see [testing.md](testing.md)).

### The agent's per-task watch loop

A watch is one polling chain for one task, and it is alarm-driven. `MyAgent.startTaskWatch(serverId, taskId, toolName)` writes a `TaskWatch` record under the key `${serverId}/${taskId}` (`watchKey`) and runs the first poll inline. Every poll is `MyAgent.pollTaskWatchOnce(key)`:

1. Read the watch; a missing record means a stale alarm fired after the watch stopped, so return.
2. Cancel the pending alarm (`this.cancelSchedule(watch.scheduleId)`), so an out-of-band poll after `tasks/update` or `tasks/cancel` never forks the chain.
3. `taskLaneSession`, then `taskLane.getTask`. This `fetch` is the one point where another event can interleave (storage calls are input-gated, an outbound fetch is not), so afterwards the watch is read again and `isStaleSnapshot(fetched, latest.task)` keeps the newer snapshot by `lastUpdatedAt` when two polls land out of order.
4. `terminal = isTerminalStatus(task.status)`, `changeKey = taskChangeKey(task)`, `changed = changeKey !== latest.changeKey`, `seq = changed ? latest.seq + 1 : latest.seq`, and `nextPollAt = observedAt + nextPollDelayMs(task, pollIntervalOverrideMs)` unless the task is terminal or the watch is older than `WATCH_MAX_AGE_MS` (24 hours).
5. Build the `TaskObservation` (`serverId`, `taskId`, `seq`, `observedAt`, `task`, `toolName?`, `nextPollAt?`).
6. Terminal, or aged out: fold the observation with `foldObservationInto`, append a note with `noteInto` when it aged out, drop the watch, one `setState`. Otherwise: `this.schedule(new Date(nextPollAt), "pollWatchedTask", key)`, then one `setState` that writes the watch (`seq`, `changeKey`, `scheduleId`, `failures: 0`, `polls`, `task`, `observedAt`, `nextPollAt`) and the folded playthroughs together.

`MyAgent.pollWatchedTask(key)` is the public method the scheduler names; it calls `pollTaskWatchOnce` and routes any throw into `recordWatchFailure`, which increments `failures`, drops the watch with a note after `WATCH_MAX_FAILURES` (5) consecutive failures, and otherwise re-arms one alarm at the default delay. `pollNowIfWatched(serverId, taskId)` is the immediate path the write methods use after `tasks/update` and `tasks/cancel`; `pollTaskNow` and `pollAllWatchedNow` expose it to the page. `setPollIntervalOverride(ms | null)` stores the lane-clamped override and re-polls every watch at once so the new cadence applies without waiting out the old interval. `stopWatchingTask` cancels the alarm and deletes the record; `disconnectServer` stops every watch on that server first (their lane session dies with the connection) and leaves the playthroughs readable.

The fold is pure and lives in `src/lib/playthrough.ts` over `src/lib/tasks.ts`. `foldObservationInto(playthroughs, observation)` looks up the playthrough by the observation's own `taskId` (a task without one, the generic tasks surface, folds nowhere) and calls `observePlaythrough(playthrough, observation, observedAt)`. That first runs `observeTask(prev view, observation)`: a lower `seq` returns the same reference, an equal `seq` with a newer `observedAt` refreshes only `polledAtMs` and `nextPollAtMs` (a no-change poll), a higher `seq` builds a new `TaskView` (`makeTaskView`: status, `statusMessage`, `statusSinceMs` anchored when the status or the set of outstanding ask keys changes, `inputRequests`, `result`, `error`, the poll clocks). On a real change it then narrates: a fate entry for every ask key the previous `input_required` snapshot carried that is gone now and was never answered locally; a beat entry when `statusMessage` changed (`parseBeat`); `foldVisual` from `readStatusMeta(task)` (a new `scene` replaces the scene and clears sprites, a changed `uri#persist` sprite key fires a new sprite and bumps `spriteFirings`, `phase` is recorded in `phasesSeen`, `build` only ever rises, a new `actions.key` replaces the action set); a fork entry once per key plus `openFork` with `sinceMs = statusSinceMs` when `findFork(inputRequests)` finds one; and on the first terminal snapshot `finish`, which appends the ending entry, builds the ending card through `endingFor` (cancelled reads as abandoned, failed as a disaster with the error message, completed through `resultText` and `parseEnding` with `endingTone` from the ending id and `isError`), and retires the action bar. The log is capped at `LOG_MAX` (500) entries, non-persistent sprites live `SPRITE_TTL_MS` (6000 ms), and `prunePlaythroughs` keeps at most `MAX_PLAYTHROUGHS` (24), dropping the oldest finished ones first and never a running one.

### What is persisted

`MyAgentState` is the agent's whole durable state, and the agents SDK pushes every `setState` to connected pages:

```ts
type MyAgentState = {
  taskWatches: Record<string, TaskWatch>;       // live watches, keyed `${serverId}/${taskId}`; a watch ends with its task
  playthroughs: Record<string, Playthrough>;    // ONE materialized record per task, keyed by taskId
  pollIntervalOverrideMs?: number;              // the UI poll-rate override, already lane-clamped
};
```

A `TaskWatch` holds `serverId`, `taskId`, `toolName?`, `seq`, `changeKey?`, `scheduleId?` (the pending `Agent.schedule` alarm), `failures`, `polls`, `startedAt`, the last `task` snapshot, `observedAt`, and `nextPollAt`. A `Playthrough` holds `taskId`, `serverId`, `storyId`, `storyTitle?`, `startedAt`, `status`, `view?` (the `TaskView`), `log` (numbered `LogEntry`s: `beat`, `fork`, `choice`, `fate`, `action`, `note`, `ending`), `visual` (`scene?`, `sprites`, `phase?`, `phasesSeen`, `build`, `actions?`, `lastSpriteKey?`, `spriteFirings`), `openFork?`, `answeredForks`, `spentActionKey?`, `ending?`, `abandonRequested`, `updatedAt`, `nextId`. Because both the watch and the playthrough are state, a hibernated or redeployed agent wakes with its chains armed and its records intact; the only in-memory thing is `pendingElicitations`, the map behind `forwardElicitationToBrowser`, which serves SDK-path elicitations during a blocking tool call and is not on the adventure's path.

### The page as a projection

`src/client.tsx` renders the agent's state and calls its methods; it computes nothing durable. `parseRoute` in `src/lib/route.ts` reads two routes from the pathname: `/` is the home (connect, the `start()` picker, the task list) and `/task/<taskId>` is one task; `useRoute` owns `window.history` and `popstate`, `taskPath(taskId)` builds a link, `routedTaskId(route)` names the task on screen. `useAgent` wires `onStateUpdate` (store the whole `MyAgentState`, mirror `pollIntervalOverrideMs`, reconcile the local task list), `onMcpUpdate` (the `MCPServersState` snapshot: servers and their `resources` list), `onOpen`, `onClose`. The rendered playthrough is exactly `agentState.playthroughs[routedTaskId(route)]`; a task route with state but no record renders `NotFound`.

`PlaythroughView` (`src/components/PlaythroughView.tsx`) is presentation over that one record: `Stage` (the current scene SVG inlined and crossfaded, `liveSprites` overlaid, `--build-progress` and `--story-accent` set, the phase caption), `ActionBar` (the latest `visual.actions`, locked while `spentActionKey === actions.key`, while a fork is open, or after a cancel was requested), `AdventureLog` (the log newest first, with `ChoicePanel` rendered in the slot of the open fork's entry; the panel's countdown is `crisisRemainingMs(openFork.sinceMs, now, fork.windowMs)` and `crisisUrgency`, cosmetic only, since the server owns the deadline; the panel unmounts when the observed status leaves `input_required`), `EndingCard`, `PhaseChecklist` (manifest phases lit by `visual.phasesSeen`), and `CancelTask`. A 100 ms `setInterval` drives `now` for the countdown, sprite expiry, and the poll readouts.

Story assets arrive through the ordinary SDK connection. `findManifestResources(mcpState.resources)` picks every `story://{id}/manifest` URI; each is read once with `agent.call("readResource", [serverId, uri])`, parsed by `parseManifest`, and cached by URI; `StoryPicker` renders one tile per manifest. For the routed task, every scene and sprite URI the playthrough's `visual` or `ending` names is read the same way, decoded by `resourceText`, sanitized by `sanitizeSvg` (scripts, event handlers, external references, embedded documents stripped), cached by URI, and inlined; an unreadable asset adds a local note to the log and the last good scene stays. The home's task list is a pointer list in `localStorage` (`src/lib/task-list.ts`: `parseKnownTasks`, `rememberTask`, `forgetTask`, `orderKnownTasks`) so it paints before the agent's state arrives, and `reconcileKnownTasks` rewrites it against `agentState.playthroughs` on every push: the agent is the truth, ids it dropped disappear, ids it has (another tab started them) are adopted. The session id (`nanoid(8)`) lives in `localStorage` too; the reset button clears both and reloads.

### Reconnect and resync

Two layers survive a gap. The agent side needs nothing: its watches are `Agent.schedule` alarms and its records are state, so a hibernated agent keeps polling and a restored MCP connection keeps serving `taskLaneSession` once it has renegotiated. The page side re-syncs on every socket open: an effect keyed on `connectionStatus === "connected"` calls `pollAllWatchedNow` (fresh snapshots for every watched task, chains re-armed) and `refreshDiscovery` (re-run capability discovery for any ready server whose resource list is empty, since a connection restored from storage can report `ready` from a discovery snapshot saved before it finished). `MyAgent.onStart` also schedules `refreshDiscovery` two seconds after wake, and the page retries once more after 1.5 s when a ready server still lists no manifests. Both calls are idempotent and both push their results back over the socket. Nothing is replayed client-side: the page reads the materialized playthrough as it is.

### Several tasks at once

Every `startStory` creates a new task and a new playthrough; older ones, running or finished, keep their own records and watches. Watches are keyed per `${serverId}/${taskId}` and each has its own alarm, so N running stories are N independent polling chains inside one agent. The page renders one record at a time (`/task/<id>`), the home lists all of them (running first, then finished, newest first), `Restart` on an ending starts the same story as a new task and routes to it, `forgetPlaythrough` stops the watch (the task keeps running on the server) and drops the record, and `prunePlaythroughs` caps the map at 24, finished first. Observations can never cross between tasks: `foldObservationInto` keys on the snapshot's own `taskId`, and the page's `pendingChoice` is tagged with the task it belongs to.

### Pseudo callstacks

Start. From the picker to the first rendered beat.

```
StoryPicker.onStart -> startStory(request, title)                       apps/demo-client/src/client.tsx
  agent.call("startStory", [serverId, { storyId, seed?, defaultScene?, storyTitle? }])
    MyAgent.startStory                                                  apps/demo-client/src/server.ts
      taskLaneSession(serverId)
      taskLane.callToolAsTask(session, "start", { story, seed? })       apps/demo-client/src/mcp-tasks/task-lane.ts; no name, so the story's defaultName plays
        sendTaskLaneRequest -> POST /mcp  tools/call  (Mcp-Method: tools/call, Mcp-Name: start, _meta envelope)
          ---- task-server ----
          createMcpHandler(...).fetch                                   packages/durable-mcp-server/src/handler/create-mcp-handler.ts
            createTasksRouter(...).fetch -> null                        a declaring client's tools/call falls through
            sdkCreateMcpHandler(createServer with configureTaskRunner).fetch
              SDK tools/call dispatch -> wireHandler                    src/server/mcp-server.ts
                McpServer.#createTask -> declaredTasksExtension(ctx) -> #resolveTaskRunnerNamespace
                  callTaskRunner(namespace, taskId, stub => stub.create({...}))   src/engine/call-task-runner.ts -> tryWhile
                    TaskRunner.create -> #ensureSchema -> INSERT task (status 'working', run_next_at now) -> #reconcileAlarm -> setAlarm(now)
                  return { resultType: "task", ...snapshot }
          ---- back in the agent ----
        CreateTaskResultSchema.parse -> { kind: "task", task }
      newPlaythrough({ taskId, serverId, storyId, status, defaultScene?, storyTitle? }) -> prunePlaythroughs -> setState
      startTaskWatch(serverId, taskId, "start")
        setTaskWatch -> pollTaskWatchOnce(key)
          taskLane.getTask -> tasks/get
          foldObservationInto(playthroughs, observation) -> observePlaythrough -> observeTask
          this.schedule(new Date(nextPollAt), "pollWatchedTask", key) -> setState
      return { kind: "task", taskId }
  rememberTask(knownTasks, ...) -> navigate(taskPath(taskId))
  onStateUpdate(state) -> setAgentState -> reconcileKnownTasks
  render: playthroughs[taskId] -> PlaythroughView
```

A poll tick. The agent's alarm fires.

```
agents scheduler -> MyAgent.pollWatchedTask(key)
  pollTaskWatchOnce(key)
    cancelSchedule(watch.scheduleId)
    taskLaneSession -> taskLane.getTask(session, taskId)
      sendTaskLaneRequest -> POST /mcp  tasks/get  (Mcp-Method: tasks/get, Mcp-Name: <taskId>)
        ---- task-server ----
        createMcpHandler(...).fetch -> createTasksRouter(...).fetch        packages/durable-mcp-server/src/handler/tasks-router.ts
          isLegacyRequest -> false ; Mcp-Method vs body ; declaresTasksExtension ; Mcp-Name vs params.taskId
          callTaskRunner(namespace, taskId, stub => stub.get(undefined))
            TaskRunner.get -> #readTask -> #toDetailedSnapshot -> #baseSnapshot + #snapshotMeta (+ result | error | #outstandingBlockingRequests)
          completeResult(snapshot, serverInfo) -> { ..., resultType: "complete", _meta: { "io.durable-mcp-server/status", serverInfo } }
        ---- back in the agent ----
      GetTaskResultSchema.parse
    isStaleSnapshot(fetched, latest.task) ; taskChangeKey ; nextPollDelayMs(task, override)
    foldObservationInto -> observePlaythrough
      observeTask(prev, observation)                                    new seq -> makeTaskView
      parseBeat(statusMessage) -> log "beat"
      readStatusMeta(task) -> foldVisual                                scene / sprite / phase / build / actions
      findFork(inputRequests) -> log "fork" once, openFork              when input_required
      finish -> endingFor                                               on the first terminal snapshot
    this.schedule(new Date(nextPollAt), "pollWatchedTask", key)
    setState({ taskWatches, playthroughs })                             one write, pushed to every connected page
      onStateUpdate -> setAgentState -> PlaythroughView re-renders the routed record
```

An answer. From the choice panel to the story moving on.

```
ChoicePanel.onChoose(option) -> answerFork(option)                     client.tsx; sets pendingChoice for this taskId
  agent.call("answerFork", [taskId, openFork.key, option.id, option.label])
    MyAgent.answerFork
      requirePlaythrough -> updatePlaythrough(markChoice)               log "you chose", answeredForks[key]; setState
      taskLaneSession -> taskLane.updateTask(session, taskId, choiceResponse(key, optionId))
        InputResponsesSchema.parse -> sendTaskLaneRequest -> POST /mcp  tasks/update  (Mcp-Name: <taskId>)
          ---- task-server ----
          createTasksRouter(...).fetch -> callTaskRunner(namespace, taskId, stub => stub.get ; stub.update(responses))
            TaskRunner.update -> UPDATE input_requests SET response, answered = 1 WHERE key = ? AND answered = 0 RETURNING blocking
              blocking, none outstanding -> status 'working', run_next_at now ; #noteWakeRequest ; #reconcileAlarm -> setAlarm(now)
            -> { resultType: "complete" }                               the ack; nothing about the next beat yet
          ---- back in the agent ----
        TaskAckResultSchema.parse
      (a throw here -> updatePlaythrough(unmarkChoice) reopens the ask with a note, rethrows)
      pollNowIfWatched(serverId, taskId) -> pollTaskWatchOnce            immediate tasks/get; the chain's alarm is re-armed from here
        observePlaythrough: status left input_required -> openFork removed -> ChoicePanel unmounts
  (server side, meanwhile) alarm() -> #alarmTick -> claim -> #dispatch -> TaskExecutor.runTask -> start() replays
    -> recordElicit finds answered -> the walk routes on chosenOption -> next beat -> step.status -> next poll shows it
```

An ambient press and a cancel follow the same shape. `ActionBar.onPress` calls `MyAgent.pressAction`, which marks the action (`markAction` sets `spentActionKey`, the bar locks), sends `taskLane.updateTask` to the offered `actions-{n}` key, and re-polls; server side `TaskRunner.update` sees a non-blocking answer on a `working` task and calls `#wakeForInput`, the cut sleep or the flagged next sleep lets the replay reach `checkInput`, the sub-story plays, `offerActions` re-offers under a fresh key, and the next meta's `actions.key` changes, which `foldVisual` applies and which unlocks the bar. `CancelTask` calls `MyAgent.abandonStory`, which marks `abandonRequested` (`markAbandon`), sends `taskLane.cancelTask`, and re-polls; server side `TaskRunner.cancel` sets `cancel_requested` and a wake, `#alarmTick` calls `#settleCancelled` (or a running invocation's next `beginStep` answers `cancelled` and `#settleOutcome` flips it), the task reads `cancelled`, and the poll that observes it runs `finish` with the abandoned ending card.

### Upgrading off the lane

The lane exists only until `@modelcontextprotocol/client` ships the `ttlMs` vocabulary with a tasks runtime and `agents` bumps to it. At that point the `server.ts` callables move to the SDK path, `src/mcp-tasks/task-lane.ts` and its test go, and `schema.ts` stays only while the SDK exports no current task types. A later ext-tasks commit than `dcc8d2b` means re-diffing `schema/draft/schema.ts` and `specification/draft/tasks.md` against `schema.ts`; the upstream input-request shapes are marked TODO there, so `InputRequestSchema` and `InputResponseSchema` are the likely churn. Drift shows up as loud parse failures, not silent misreads. The lane's limits: polling only (`notifications/tasks` is optional in the extension), an expired OAuth token surfaces as a 401 `TaskLaneError` rather than auto-refreshing, and `taskLaneSession` requires a live negotiated connection.

## 4. The example

`examples/report-task/src/index.ts` is the integration a developer writes: a server factory plus three exports, and two lines of `wrangler.jsonc`.

```ts
const createServer = () => {
  const server = new McpServer({ name: "report-server", version: "1.0.0" });
  server.registerTask("send_report", { inputSchema: z.object({ to: z.string() }), ... }, async (input, step) => {
    const report = await step.do("fetch-data", async () => fetchReportData(input.to));
    await step.sleep("cool-off", "5s");
    await step.do("send", { retries: { limit: 10 } }, async () =>
      sendReport(input.to, report, step.idempotencyKey("send")),
    );
    return { content: [{ type: "text", text: `report "${report.title}" sent to ${input.to}` }] };
  });
  server.registerTask("approve_report", { inputSchema: z.object({ to: z.string() }) }, async (input, step) => {
    const report = await step.do("compile", async () => fetchReportData(input.to));
    const answer = await step.elicit("approval", { method: "elicitation/create", params: { message, requestedSchema } });
    if (!("action" in answer && answer.action === "accept")) return { content: [{ type: "text", text: `report "${report.title}" discarded` }] };
    await step.do("send", async () => sendReport(input.to, report, step.idempotencyKey("send")));
    return { content: [{ type: "text", text: `report "${report.title}" sent to ${input.to}` }] };
  });
  server.registerTool("echo", { inputSchema: z.object({ m: z.string() }) }, async ({ m }) => ({ content: [{ type: "text", text: m }] }));
  return server;
};

export { TaskRunner };
export const TaskExecutor = createTaskEntrypoint(createServer);
export default createMcpHandler(createServer);
```

`createServer` takes no arguments; `fetchReportData` and `sendReport` read `env.REPORT_API_URL` through `import { env } from "cloudflare:workers"`, which resolves inside the executor as well as in the fetch handler. `send_report` passes the default `ttlMs` (86,400,000), `pollIntervalMs` (5,000), and step retry policy (`{ limit: 5, baseDelayMs: 1_000, maxDelayMs: 300_000 }`) explicitly, and overrides `retries.limit` to 10 on the `send` step. `sendReport` puts `step.idempotencyKey("send")` (`${taskId}:send`) on an `Idempotency-Key` header because execution is at-least-once per step: a crash between the POST and the journal commit re-runs exactly that step. `echo` is an ordinary `registerTool` and is untouched by the tasks machinery. `wrangler.jsonc` adds the `TASK_RUNNER` binding to `TaskRunner`, the `new_sqlite_classes` migration, and the `REPORT_API_URL` var; `TaskRunner` reaches `ctx.exports.TaskExecutor` without a service binding at compatibility date 2026-08-20.

One `send_report` task, across its invocations:

```
tools/call send_report { to }            createMcpHandler.fetch -> router passes -> wireHandler -> McpServer.#createTask
                                         -> callTaskRunner -> TaskRunner.create -> setAlarm(now) -> CreateTaskResult
alarm() #1                               #alarmTick -> claim (attempt 1) -> #dispatch -> TaskExecutor.runTask
  handler: step.do("fetch-data")         beginStep miss -> run -> GET /data -> completeStep
           step.sleep("cool-off", "5s")  recordSleep pending -> SuspendSignal -> { outcome: "suspended" } -> #settleOutcome
                                         alarm re-armed at wake_at by #reconcileAlarm
alarm() #2 (5 s later)                   #alarmTick marks the sleep completed -> claim (attempt 2) -> runTask
  handler: step.do("fetch-data")         beginStep hit -> the journaled report, closure skipped
           step.sleep("cool-off")        recordSleep completed, latest: true
           step.do("send", limit 10)     beginStep miss -> POST /send
             500                         #settleFailedAttempt -> computeStepRetryDelayMs -> failStep({ retryAtMs }) -> SuspendSignal
alarm() #3 (after the backoff)           claim (attempt 3) -> runTask -> hits -> beginStep("send") pending -> { state: "run", attempt: 2 }
             200                         completeStep -> handler returns -> { outcome: "completed", result } -> #settleOutcome
tasks/get                                status "completed", result.content[0].text = 'report "..." sent to ...'
```

Driving it by hand is four requests, each a Streamable HTTP POST carrying the `Mcp-Method` header and the per-request `_meta` envelope:

```jsonc
// POST /  (Mcp-Method: tools/call, Mcp-Name: send_report)
{ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "send_report", "arguments": { "to": "alice@example.com" },
    "_meta": { "io.modelcontextprotocol/protocolVersion": "2026-07-28",
               "io.modelcontextprotocol/clientCapabilities": { "extensions": { "io.modelcontextprotocol/tasks": {} } } } } }
// -> { "result": { "resultType": "task", "taskId": "...", "status": "working", "ttlMs": 86400000, "pollIntervalMs": 5000, ... } }

// POST /  (Mcp-Method: tasks/get, Mcp-Name: <taskId>)
{ "jsonrpc": "2.0", "id": 2, "method": "tasks/get", "params": { "taskId": "<taskId>", "_meta": { /* same envelope */ } } }
// -> { "result": { "resultType": "complete", "status": "completed", "result": { "content": [ ... ] }, ... } }

// POST /  (Mcp-Method: tasks/update, Mcp-Name: <taskId>)   for approve_report, while input_required
{ "jsonrpc": "2.0", "id": 3, "method": "tasks/update",
  "params": { "taskId": "<taskId>", "inputResponses": { "approval": { "action": "accept", "content": { "approve": true } } },
              "_meta": { /* same envelope */ } } }

// POST /  (Mcp-Method: tasks/cancel, Mcp-Name: <taskId>)
{ "jsonrpc": "2.0", "id": 4, "method": "tasks/cancel", "params": { "taskId": "<taskId>", "_meta": { /* same envelope */ } } }
```

Without the extension declared, a task tool answers `-32021` with HTTP 400 and plain tools keep working; an unknown or expired task id answers `-32602`. The example's tests (`examples/report-task/test`) run these flows over real HTTP against the worker in workerd, including an eviction mid-sleep that replays the journal instead of re-fetching; [testing.md](testing.md) walks through that choreography.
