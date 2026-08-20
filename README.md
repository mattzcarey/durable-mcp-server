# durable-mcp-server

MCP Tasks for stateless MCP servers on Cloudflare Workers, backed by Durable Objects.

`registerTask` is `registerTool` for long-running work: the handler runs as a durable, replayable workflow (`step.do`, `step.sleep`, `step.elicit`, `step.status`, `step.offer`), and the MCP Tasks extension methods (`tasks/get`, `tasks/update`, `tasks/cancel`) route straight to per-task storage. It is additive over the official `@modelcontextprotocol/server` v2 SDK.

```ts
import { createMcpHandler, createTaskEntrypoint, McpServer, TaskRunner } from "durable-mcp-server";
import { z } from "zod";

const createServer = () => {
  const server = new McpServer({ name: "report-server", version: "1.0.0" });

  server.registerTask(
    "send_report",
    { description: "Compile and send a report", inputSchema: z.object({ to: z.string() }) },
    async (input, step) => {
      const report = await step.do("fetch-data", () => fetchReportData(input.to));
      await step.sleep("cool-off", "5s");
      await step.do("send", { retries: { limit: 10 } }, () => sendReport(input.to, report));
      return { content: [{ type: "text", text: `report sent to ${input.to}` }] };
    },
  );

  return server;
};

export { TaskRunner }; // the Durable Object every user exports
export const TaskExecutor = createTaskEntrypoint(createServer);
export default createMcpHandler(createServer);
```

Plus a Durable Object binding and a SQLite migration in `wrangler.jsonc`. The full example is `examples/report-task`; how it all works, with data flow and pseudo callstacks, is `docs/how-it-works.md`.

## What is in the repo

| Path                          | What                                                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/durable-mcp-server` | The library: `McpServer.registerTask`, the `TaskRunner` Durable Object, `createTaskEntrypoint`, `createMcpHandler` (and `createTasksRouter` to compose by hand).                       |
| `apps/task-server`            | The demo MCP server: one tool, `start`, that plays a branching story (Nortada One, a datacenter on the Atlantic; the Odyssey) as a durable task, with visuals served as MCP resources. |
| `apps/demo-client`            | The demo client: an agents-SDK Durable Object plus a React page that starts stories, watches them, answers forks, and shows each task at `/task/<id>`.                                 |
| `examples/report-task`        | The minimal integration a developer writes, tested with the Workers test harness.                                                                                                      |
| `docs/`                       | How it works, the demo, testing.                                                                                                                                                       |
| `design/`                     | The project brief and the portability design note.                                                                                                                                     |

## Getting started

```sh
pnpm install
pnpm dev        # task-server on :8787, demo-client on :5173
```

Open http://localhost:5173, press Connect, pick a story, start it.

Deployed demo: https://task-demo.mattzcarey.workers.dev (client) and https://task-server.mattzcarey.workers.dev/mcp (server).

## Commands

- `pnpm check`: lint, format check, typecheck, tests, build
- `pnpm test`, `pnpm build`, `pnpm typecheck`: across all projects via nx
- `pnpm lint`, `pnpm format`: oxlint, oxfmt

## Credits

The Durable Object RPC retry helpers are adapted from [durable-utils](https://github.com/lambrospetrou/durable-utils) by Lambros Petrou (MIT). The step ledger, alarm scheduling, and retry machinery in `TaskRunner` are adapted from [durability](https://github.com/avenceslau/durability) by Andre Venceslau (ISC). Task wire types are adapted from the MCP Tasks extension specification ([modelcontextprotocol/ext-tasks](https://github.com/modelcontextprotocol/ext-tasks)), Apache-2.0.
