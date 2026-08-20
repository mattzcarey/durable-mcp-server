/**
 * Cooperative cancellation mid-flow (the integrations layer): tasks/cancel
 * acks immediately, the engine observes the flag at the next boundary (the
 * cool-off sleep guarantees the task is still non-terminal), and the report
 * is never sent.
 */

import { describe, expect, it } from "vitest";
import { callResult } from "./support/jsonrpc";
import {
  drainTaskUntil,
  getTask,
  reportApiCounts,
  startTask,
  TERMINAL,
  uniqueRecipient,
} from "./support/tasks";

describe("send_report cancellation mid-flow", () => {
  it(
    "tasks/cancel acks, the task settles cancelled, send never runs",
    {
      timeout: 20_000,
    },
    async () => {
      const to = uniqueRecipient("doomed");
      const created = await startTask("send_report", { to });

      const ack = await callResult("tasks/cancel", { taskId: created.taskId });
      expect(ack["resultType"]).toBe("complete");

      // Ack does not mean stopped: the status flips when the engine observes
      // the flag (mid-run directive or the next alarm tick).
      const done = await drainTaskUntil(created.taskId, TERMINAL);
      expect(done.status).toBe("cancelled");

      // The cool-off sleep sits between fetch-data and send, so the cancel
      // always lands before the report goes out.
      expect((await reportApiCounts(to)).send).toBe(0);

      // Terminal states are immutable; a repeat cancel still acks.
      const again = await callResult("tasks/cancel", { taskId: created.taskId });
      expect(again["resultType"]).toBe("complete");
      expect((await getTask(created.taskId)).status).toBe("cancelled");
    },
  );
});
