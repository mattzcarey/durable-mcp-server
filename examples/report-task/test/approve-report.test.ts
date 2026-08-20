/**
 * approve_report's step.elicit roundtrip over HTTP (experimental, decision
 * D13): compile -> input_required with the elicitation surfaced in
 * tasks/get -> tasks/update answers -> the resumed run memoizes compile and
 * sends (or discards) the report.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { callResult } from "./support/jsonrpc";
import {
  drainTaskUntil,
  getTask,
  reportApiCounts,
  startTask,
  TERMINAL,
  uniqueRecipient,
} from "./support/tasks";

const WAITING = ["input_required", ...TERMINAL] as const;

describe("approve_report over the wire (step.elicit, D13)", () => {
  it(
    "input_required surfaces the approval request; tasks/update approves; the report is sent",
    { timeout: 20_000 },
    async () => {
      const to = uniqueRecipient("boss");
      const created = await startTask("approve_report", { to });

      const waiting = await drainTaskUntil(created.taskId, WAITING);
      expect(waiting.status).toBe("input_required");
      if (waiting.status !== "input_required") {
        throw new Error("unreachable");
      }
      const approval = z
        .looseObject({ method: z.string(), params: z.looseObject({ message: z.string() }) })
        .parse(waiting.inputRequests["approval"]);
      expect(approval.method).toBe("elicitation/create");
      expect(approval.params.message).toBe(`Send "Weekly metrics" to ${to}?`);

      const ack = await callResult("tasks/update", {
        taskId: created.taskId,
        inputResponses: { approval: { action: "accept", content: { approve: true } } },
      });
      expect(ack["resultType"]).toBe("complete");

      // Back to working, then the resumed run sends. Production scheduling can
      // finish the whole resumed replay before this poll lands, so completed is
      // also legal here. compile is a journal HIT across the resume either way:
      // the report API sees exactly one /data call.
      expect(["working", "completed"]).toContain((await getTask(created.taskId)).status);
      const done = await drainTaskUntil(created.taskId, TERMINAL);
      expect(done.status).toBe("completed");
      if (done.status !== "completed") {
        throw new Error("unreachable");
      }
      expect(done.result).toEqual({
        content: [{ type: "text", text: `report "Weekly metrics" sent to ${to}` }],
      });
      expect(await reportApiCounts(to)).toEqual({ data: 1, send: 1 });
    },
  );

  it(
    "a declined approval completes with the discarded text and never sends",
    { timeout: 20_000 },
    async () => {
      const to = uniqueRecipient("skeptic");
      const created = await startTask("approve_report", { to });

      const waiting = await drainTaskUntil(created.taskId, WAITING);
      expect(waiting.status).toBe("input_required");

      const ack = await callResult("tasks/update", {
        taskId: created.taskId,
        inputResponses: { approval: { action: "decline" } },
      });
      expect(ack["resultType"]).toBe("complete");

      const done = await drainTaskUntil(created.taskId, TERMINAL);
      expect(done.status).toBe("completed");
      if (done.status !== "completed") {
        throw new Error("unreachable");
      }
      expect(done.result).toEqual({
        content: [{ type: "text", text: 'report "Weekly metrics" discarded' }],
      });
      expect(await reportApiCounts(to)).toEqual({ data: 1, send: 0 });
    },
  );
});
