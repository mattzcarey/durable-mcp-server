/**
 * examples/report-task — the RFC 001 §4.1 example, as a real worker.
 *
 * The whole integration is a server factory plus three exports: the factory
 * feeds `registerTask` handlers to the `TaskExecutor` entrypoint, `TaskRunner`
 * is the standardized Durable Object (zero user code), and `createMcpHandler`
 * serves MCP at the worker root. Bindings resolve anywhere via the
 * `cloudflare:workers` env import — `createServer` takes no arguments.
 */

import { env } from "cloudflare:workers";
import { createMcpHandler, createTaskEntrypoint, McpServer, TaskRunner } from "durable-mcp-server";
import { z } from "zod";

const reportSchema = z.object({ title: z.string(), rows: z.array(z.string()) });
type Report = z.infer<typeof reportSchema>;

async function fetchReportData(to: string): Promise<Report> {
  const response = await fetch(`${env.REPORT_API_URL}/data?to=${encodeURIComponent(to)}`);
  if (!response.ok) {
    throw new Error(`report API /data answered ${response.status}`);
  }
  return reportSchema.parse(await response.json());
}

async function sendReport(to: string, report: Report, idempotencyKey: string): Promise<null> {
  const response = await fetch(`${env.REPORT_API_URL}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Execution is at-least-once per step: a crash between this call and
      // the journal commit re-runs exactly this step, so the report API
      // should deduplicate on the step's idempotency key.
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ to, report }),
  });
  if (!response.ok) {
    throw new Error(`report API /send answered ${response.status}`);
  }
  return null;
}

const createServer = () => {
  const server = new McpServer({ name: "report-server", version: "1.0.0" });

  server.registerTask(
    "send_report",
    {
      description: "Compile a report and send it to a recipient",
      inputSchema: z.object({ to: z.string() }),
      ttlMs: 86_400_000, // default; null = unlimited
      pollIntervalMs: 5_000, // default
      retries: { limit: 5, baseDelayMs: 1_000, maxDelayMs: 300_000 }, // default step policy
    },
    async (input, step) => {
      const report = await step.do("fetch-data", async () => fetchReportData(input.to));

      await step.sleep("cool-off", "5s");

      await step.do("send", { retries: { limit: 10 } }, async () =>
        sendReport(input.to, report, step.idempotencyKey("send")),
      );

      return { content: [{ type: "text", text: `report "${report.title}" sent to ${input.to}` }] };
    },
  );

  // EXPERIMENTAL (decision D13): step.elicit suspends the task as
  // input_required until a tasks/update answers the approval request.
  server.registerTask(
    "approve_report",
    {
      description: "Compile a report, then send it only if the client approves",
      inputSchema: z.object({ to: z.string() }),
    },
    async (input, step) => {
      const report = await step.do("compile", async () => fetchReportData(input.to));

      const answer = await step.elicit("approval", {
        method: "elicitation/create",
        params: {
          message: `Send "${report.title}" to ${input.to}?`,
          requestedSchema: {
            type: "object",
            properties: { approve: { type: "boolean" } },
            required: ["approve"],
          },
        },
      });

      const approved = "action" in answer && answer.action === "accept";
      if (!approved) {
        return { content: [{ type: "text", text: `report "${report.title}" discarded` }] };
      }

      await step.do("send", async () => sendReport(input.to, report, step.idempotencyKey("send")));

      return { content: [{ type: "text", text: `report "${report.title}" sent to ${input.to}` }] };
    },
  );

  // Ordinary tools are unchanged by the tasks machinery.
  server.registerTool(
    "echo",
    { description: "Returns its input unchanged", inputSchema: z.object({ m: z.string() }) },
    async ({ m }) => ({ content: [{ type: "text", text: m }] }),
  );

  return server;
};

export { TaskRunner }; // standardized DO, zero user code
export const TaskExecutor = createTaskEntrypoint(createServer);
export default createMcpHandler(createServer); // ExportedHandler { fetch(req, env, ctx) }
