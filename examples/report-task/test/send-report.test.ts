/**
 * send_report end to end over real Streamable HTTP (the integrations layer):
 * tools/call with the tasks extension declared -> flat CreateTaskResult ->
 * tasks/get pollable before any drain -> alarm-driven execution through
 * fetch-data, the cool-off sleep, and send -> tasks/get with the inlined
 * result. The report API is a real auxiliary workerd worker counting every
 * upstream call.
 */

import { describe, expect, it } from "vitest";
import {
  drainTaskUntil,
  flakyRecipient,
  getTask,
  reportApiCounts,
  startTask,
  TERMINAL,
  uniqueRecipient,
} from "./support/tasks";

describe("send_report over the wire", () => {
  it(
    "tools/call -> CreateTaskResult -> working before any drain -> drain -> completed",
    { timeout: 20_000 },
    async () => {
      const to = uniqueRecipient("alice");
      const created = await startTask("send_report", { to });

      // The flat CreateTaskResult carries the registerTask config's policy.
      expect(created.resultType).toBe("task");
      expect(created.status).toBe("working");
      expect(created.ttlMs).toBe(86_400_000);
      expect(created.pollIntervalMs).toBe(5_000);

      // Strong consistency at creation: pollable before any drain.
      expect((await getTask(created.taskId)).status).toBe("working");

      const done = await drainTaskUntil(created.taskId, TERMINAL);
      expect(done.status).toBe("completed");
      if (done.status !== "completed") {
        throw new Error("unreachable");
      }
      expect(done.result).toEqual({
        content: [{ type: "text", text: `report "Weekly metrics" sent to ${to}` }],
      });

      // Exactly one fetch-data call and one send: no step re-ran.
      expect(await reportApiCounts(to)).toEqual({ data: 1, send: 1 });
    },
  );

  it(
    "a report API that fails twice is retried through the step journal: exactly 3 send calls",
    { timeout: 20_000 },
    async () => {
      const to = flakyRecipient(2);
      const created = await startTask("send_report", { to });

      const done = await drainTaskUntil(created.taskId, TERMINAL);
      expect(done.status).toBe("completed");
      if (done.status !== "completed") {
        throw new Error("unreachable");
      }
      expect(done.result).toEqual({
        content: [{ type: "text", text: `report "Weekly metrics" sent to ${to}` }],
      });

      // Two 500s + the success; fetch-data was memoized across the retries.
      expect(await reportApiCounts(to)).toEqual({ data: 1, send: 3 });
    },
  );
});
