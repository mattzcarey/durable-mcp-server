# demo-client

**MCP Task Adventure** — a React UI + Worker Agent that acts as an MCP **client** and plays server-hosted stories as long-running MCP tasks: the server's `start` tool creates a durable task, every `statusMessage` is a beat of the adventure log, the structured status meta drives a server-served SVG stage (scenes, sprites, phases, build), forks arrive as `input_required` elicitations answered through `tasks/update`, and the ending is the task's result.

Built on the Cloudflare `agents` SDK: `MyAgent` (a Durable Object) manages the MCP connection server-side; the React frontend talks to it over WebSocket via `useAgent` and `@callable` methods.

## One playthrough per task

Every story you start is its own task, and every task has exactly one **playthrough** — a materialized record (the log, the stage state, the open ask, the ending) that the **agent** folds from the snapshots its watch observes and persists in its state, keyed by taskId (`MyAgentState.playthroughs`). The **page** is a routed, read-only projection of that state:

- `/` — the home: connect, the `start()` picker, and **your tasks** (running first with status, finished below; each links to its page and has a forget control).
- `/task/<taskId>` — that task's playthrough: the stage, the log, actions, forks, cancel, the ending in the log, **Restart** (the same story again as a NEW task, routed to).

Starting a story routes to `/task/<id>` once the task exists; the header title is the way home. Several stories can run at once: navigate away and back, reload, close the tab — the agent keeps polling on alarms, and the page reads the materialized playthrough on return. **No replay, no shared reducer**: a playthrough only ever sees its own task's snapshots (`src/lib/playthrough.ts`, pure, agent-safe), and the page renders exactly the task in the URL (`src/lib/route.ts`). The page keeps a pointer list of known tasks in localStorage (`src/lib/task-list.ts`) so the home list is instant; it reconciles against the agent's playthroughs on every state push (the agent is the truth). Each log is capped at 500 lines (oldest first); the agent keeps at most 24 playthroughs (oldest finished first; running ones are never dropped). A watch follows its task for up to 24 hours (an age, not a poll count — a fork can wait on the player for an hour) or until five polls in a row fail; either way the playthrough gets a note and stays readable. Future work: store pointers (seq + snapshot) in the log instead of materialized lines to save space.

## The demo

The client is story-agnostic — it carries no story art and no phase lists. Everything on screen comes from the server:

1. **Connect** — the connect affordance and one line; nothing else until a server is connected (OAuth **Authorize** popup when the server needs it; session reset, the utilities gear, and dark mode in the header).
2. **start()** — the one card: the tool, one line on what it does (the wire detail — durable task, `tasks/get` polling, elicitation via `tasks/update`, `tasks/cancel` — sits behind an info icon), and one tile per story the server publishes as a `story://{id}/manifest` resource (title, blurb, accent — read through `resources/read`). Pick one, optionally seed it (utilities drawer), start.
3. **The stage** — the centerpiece: the current scene SVG (`story://{id}/scenes/*`, sanitized, inlined, crossfaded on change) with sprites overlaid (`story://{id}/sprites/*`; 6s fade, or pinned until the next scene), `--build-progress` set for scenes that animate their own fill. All of it rides `_meta["io.durable-mcp-server/status"]` on `tasks/get`: `{ scene, sprite, phase, build, actions }`.
4. **The log** — beats land server-paced (the agent folds them into the task's playthrough as they are observed; arrival order), auto-scrolled to the newest line unless you scroll up. Forks, your choices, fate, ambient presses, and the ending all live in the same log.
5. **Forks only** — an `input_required` ask opens the choice panel (scene in the log, one button per option; answers go back as `tasks/update { [key]: { action: "accept", content: { choice } } }`). A timed crisis drains a countdown anchored to when the ask was first observed; when the server decides on its own, the panel closes and the log says "fate decided".
6. **Ambient actions** — the latest `meta.actions` set renders as a persistent bar; each press sends `tasks/update` to the offered key and the bar locks until the story re-offers under a fresh key.
7. **Cancel** — visible the whole time the task runs (`tasks/cancel`, one confirm); a cancelled story is an ending card, not an error.
8. **Utilities** — poll-rate override, poll now, last/next poll, task id, the server line and disconnect, the story seed, in a drawer behind the header's gear.

Every control that speaks the MCP Tasks wire — the choice card's signpost, each ambient action, cancel, the log's book icon — carries a hover/focus tooltip naming the call it makes (`tasks/update`, `tasks/cancel`, `tasks/get`); the same text is the control's accessible description, and each fact is said once across the UI (`src/lib/copy.ts`). The footer links the MCP Tasks extension spec.

Missing or unreadable art never breaks play: the log notes it and the last scene stays.

- **The adventure (agent-side)**: `startStory` (calls `start` as a task, creates the playthrough, starts the watch), `answerFork` / `pressAction` (mark the playthrough, `tasks/update`, re-poll), `abandonStory` (`tasks/cancel`), `forgetPlaythrough`.
- **MCP Tasks (current draft), generic**: `callToolAsTask` (always declares the tasks extension; auto-watches created tasks), `getTask`, `getTaskResult`, `updateTask`, `cancelTask`, `readResource` (story manifests and art), and a hibernation-proof watch loop (`watchTask` / `stopWatchingTask` / `pollTaskNow` / `pollAllWatchedNow`) that polls on `Agent.schedule` alarms and folds each observation into the task's playthrough in the same state write — the `setState` push to connected pages is the one path observations travel. Pure modules: `src/lib/playthrough.ts` (the fold) over `src/lib/tasks.ts` (the per-task view), with `src/lib/story-wire.ts` and `src/lib/story-resources.ts` parsing the wire.

## MCP Tasks lane

The installed MCP SDK (2.0.0) carries tasks only as the deprecated 2025-11-25 vocabulary with no runtime — its era gate refuses `tasks/*` toward 2026-era peers, its decoder rejects `resultType: "task"`, and its transport cannot emit the `Mcp-Name: <taskId>` header the draft requires. So `src/mcp-tasks/` speaks the current tasks draft as raw JSON-RPC over `fetch`, reusing the SDK connection's negotiated endpoint, session id, protocol version, and OAuth token (all public on the `agents` connection surface). Resources ride the ordinary SDK connection.

Vendored code credit: the wire schema in `src/mcp-tasks/schema.ts` is vendored from [modelcontextprotocol/ext-tasks](https://github.com/modelcontextprotocol/ext-tasks) (`schema/draft/schema.ts` + `specification/draft/tasks.md` at commit `dcc8d2b`, 2026-08-19); the SEP-2243 header-value sentinel encoding in `src/mcp-tasks/task-lane.ts` mirrors `encodeMcpParamValue` from `@modelcontextprotocol/client`.

## Dev

From the repo root:

```sh
pnpm --filter demo-client run dev
```

## Connecting to the local server

Connect is one button: the client is hardwired to its MCP server, the one running the Tasks extension (`http://localhost:8787/mcp` locally, the deployed `task-server` worker otherwise). Run the sibling [`task-server`](../task-server/) app alongside this one and click **Connect**. Its `start` task and `story://` resources are what the adventure plays.

## Checks

```sh
pnpm --filter demo-client run typecheck
pnpm --filter demo-client run test
pnpm --filter demo-client run build
```

`env.d.ts` is generated by `pnpm --filter demo-client run types`; regenerate it after changing `wrangler.jsonc` bindings.
