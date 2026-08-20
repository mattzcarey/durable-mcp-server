# task-server

The adventure server: a stateless MCP server on Cloudflare Workers built on the `durable-mcp-server` package. The package's `createMcpHandler` runs the MCP Tasks front door (`tasks/get` / `tasks/update` / `tasks/cancel` routed straight to the TaskRunner Durable Object) in front of the official `@modelcontextprotocol/server` handler; one server factory serves Stateless clients and the Legacy compatibility lane.

The server registers exactly one tool, the durable task `start`, and serves every story's visuals and metadata as MCP resources. The demo-client UI is story-agnostic: it builds its picker from the manifests, plays whichever story the player picks, and reads the art the status meta names.

## The adventure

**Nortada One** (`datacenter`) is the campaign: there was once a project to build a datacenter on the Atlantic Ocean, on the coast at Sines where a coal plant left a cold seawater basin and a wind that never stops. You are the name on the permit, from the land scouts' shortlist to the first training run: the land choice, the permits and the town, power and seawater cooling, GPUs and the people to rack them, the crises (a timed earthquake, the channel-ownership lawsuit, the corruption probe), the protected ponds, and going online. Decisions are the forks; ambient actions ride `tasks/update` between beats. Roughly 310 nodes, 74 decisions, 8 timed crises, 20 endings. The positive spine is real (an ocean-cooled campus on a closed coal site) and so are the rabbit holes; the datacenter and its people are fictional.

**The Odyssey** (`odyssey`, `src/stories/datacenter/*.ts`) ships beside it: Troy to Ithaca as 121 nodes, 20 forks (3 timed), 24 rolls, 9 gates, and 13 endings, with a boat that crosses the stage on SMIL waves as the voyage progresses and its own ambient actions aboard, alone, and at home.

Content is plain data: a story module (`src/stories/{id}/story.ts`) composes arc modules and art and registers with `registerStory`; authors never touch the interpreter. A broken story fails at registration (schema + graph validation), never mid-playthrough.

## The story contract (v3)

**Tool** — `start`, input `{ story: string, name?: string, seed?: number }`. The description says plainly that it is long-running, executes as a durable task, and may ask the player for input. An unknown `story` completes the task with an `isError` result naming the known ids. `name` defaults per story (the datacenter's name, the hero's name); the same `seed` with the same inputs replays the identical story (random events roll inside journaled steps).

**Resources** — registered statically with the SDK's `registerResource`, so `resources/list` and `resources/read` work for every URI:

- `story://{id}/manifest` (`application/json`): `{ id, title, blurb, phases: [{ id, label }], defaultScene, accent? }`
- `story://{id}/scenes/{sceneId}` (`image/svg+xml`): self-contained SVG, CSS/SMIL animation, no external references; scenes may read `--build-progress` (0..1) to animate their fill
- `story://{id}/sprites/{spriteId}` (`image/svg+xml`): transparent overlays

**Beats** — every narrative line is a `step.status(prose, meta)`: `statusMessage` is pure prose (no bracket tags), and the visual state rides the engine's structured status meta, read from `tasks/get` as `_meta["io.durable-mcp-server/status"]`:

```jsonc
{
  "scene": "story://odyssey/scenes/boat", // the centerpiece (crossfade on change)
  "sprite": { "uri": "story://odyssey/sprites/storm", "persist": false }, // present only on the beat it fires
  "phase": "aeolus", // a manifest phase id
  "build": 0.34, // 0..1 progress
  "actions": {
    "key": "actions-2",
    "options": [{ "id": "consult-the-gods", "label": "Consult the gods" }],
  },
}
```

The interpreter sleeps between beats (`beatSleepMs`, default 2500 ms, authorable per story and per node) so beats land one at a time.

**Forks** — the only elicitations. `step.elicit` key = the node id; message = the scene text ending with its question, followed by one `- {id}: {label}` line per option; `requestedSchema = { type: "object", properties: { choice: { type: "string", enum: [ids] } }, required: ["choice"] }`. Timed crises carry the window on the request itself (`params.timeoutMs`, the same value passed to `step.elicit`) and in words ("You have 20 seconds."); unanswered, the node's fate branch plays. Answer with `tasks/update { [key]: { action: "accept", content: { choice } } }`.

**Ambient actions** — standing, non-blocking `step.offer` requests under lifetime-unique keys (`actions-1`, `actions-2`, ...), announced in `meta.actions` (each new object replaces the set), never listed in the wire `inputRequests`. A press is the same `tasks/update` shape to the offered key; the interpreter consumes it at the next beat boundary with the journaled, consume-once `step.checkInput`, plays the action's sub-story (nodes that end in `return`, back to the interrupted beat, or in an ending), and re-offers the set under a fresh key.

**Endings** — the task completes with result text `[ending:{id}] {prose}`; triumphant and catastrophic alike are completions, and the final meta carries the scene for the ending card. `tasks/cancel` is always legal; a cancelled playthrough is an ending, not an error.

## The story format

`src/story/format.ts` is the zod schema (`StoryInput` is what authors write): a header (`id`, `title`, `blurb`, `accent?`, `defaultName`, `phases`, `resources` with starting values, `start`, `defaultScene`, `beatSleepMs?`, `actions?`, `scenes`, `sprites`) and `nodes` keyed by kebab-case id. A node plays gate -> effects -> visuals (`scene`, `sprite`, `phase`, `buildPercent`) -> `actions` (replace the standing set) -> `beats` (each paced, each followed by an action check) -> `sleepMs` -> exactly one continuation: `ending`, `decision` (`scene`, `options[{ id, label, goto, effects? }]`, `timeoutMs?` + `fateGoto?`), `roll` (`branches[{ weight, goto, beat?, sprite?, effects? }]`, resolved inside `step.do` with the seeded rng), `next`, or `return`.

`src/story/validate.ts` checks the graph beyond the shape (every tag is a test hook): `node-id`, `reserved-id`, `missing-start`, `unresolved-target`, `continuation`, `decision-question`, `duplicate-option`, `crisis-timeout`, `no-ending`, `duplicate-ending`, `duplicate-phase`, `unknown-phase`, `unknown-resource`, `unknown-scene`, `unknown-sprite`, `visual-needs-beat`, `duplicate-action`, `action-scope`, `return-scope`, `unreachable`, `dead-end`, `cycle`.

`src/story/walk.ts` is the pure interpreter: a generator that yields beats, sleeps, rolls, asks, offers, and checks and takes the journal results back; the `start` handler in `src/index.ts` adapts those events onto the durable step API, so replays re-drive the same walk with journal-fed feedback. Step names use `:` separators (`pace:{node}:{i}`, `wait:{node}`, `roll:{node}`, `check:{node}:{i}`, sub-story entries prefixed `a{n}:`) because the engine shares one journal namespace across do / sleep / elicit / offer / checkInput, and kebab-case node ids never contain a colon.

Task state lives in the `TaskRunner` Durable Object (one instance per task, SQLite + alarms); execution dispatches through the `TaskExecutor` entrypoint via `ctx.exports`. Clients must declare the tasks extension (`io.modelcontextprotocol/tasks`) in each request's `_meta` client capabilities to call `start` or any `tasks/*` method; a legacy-era client calling it gets an `isError` result explaining the required extension.

## Run

```sh
pnpm --filter task-server run dev
```

The MCP endpoint is `http://localhost:8787/mcp` (all other paths return 404). The demo-client UI (`pnpm --filter demo-client run dev`, at `http://localhost:5173`) connects to it, lists the stories from the manifests, and plays them live.

## Verify

```sh
pnpm --filter task-server run typecheck
pnpm --filter task-server run test
```

Tests run against the real Worker via `@cloudflare/vitest-plugin`, speaking Streamable HTTP JSON-RPC to `/mcp`. The adventure suite (`test/adventure.test.ts`) plays the REAL datacenter story over the wire along three seeded routes to three different endings (`test/support/datacenter-routes.ts`) and compares every beat and meta against the pure projection of the same walk (the fork ask shape, a timed crisis really waiting out its window into the fate branch, ambient presses and fresh offer keys, exact ending texts, seeded determinism, cancellation). `test/datacenter.test.ts` takes the census of the merged graph, checks every seam, and sweeps the balance (every policy and seed reaches an ending, the build meter never runs backwards, the money is the main gate). `test/odyssey.test.ts` plays the Odyssey over the wire along a scripted route from Troy to Penelope (the timed bag-of-winds window, the ship's standing orders, the voyage meter's one authored retreat) beat for beat against its projection. The interpreter's semantics are pinned on the small fixture story (`test/support/fixture-story.ts`, in `test/story-walk.test.ts`); the validator is unit-tested rule by rule; both shipped stories are swept purely across seeds and policies, have every resource listed and read over the wire, and each plays to an ending over the wire.
