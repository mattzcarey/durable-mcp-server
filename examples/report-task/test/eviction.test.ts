/**
 * Durability across eviction (the integrations layer): the Durable Object is
 * evicted after the first step settled on the cool-off sleep; the journal
 * survives, the replay memoizes fetch-data (its closure does NOT re-run), and
 * the task completes — asserted from the outside via the report API's request
 * counts.
 */

import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  drainTaskUntil,
  reportApiCounts,
  startTask,
  TERMINAL,
  uniqueRecipient,
  waitForCoolOffSuspension,
} from "./support/tasks";

describe("send_report survives eviction mid-flow", () => {
  it(
    "evict after the first step -> drain -> completed, fetch-data ran exactly once",
    { timeout: 30_000 },
    async () => {
      const to = uniqueRecipient("evicted");
      const created = await startTask("send_report", { to });

      // Let the first invocation run fetch-data and suspend on the sleep.
      await waitForCoolOffSuspension(created.taskId, to);
      expect(await reportApiCounts(to)).toEqual({ data: 1, send: 0 });

      // Graceful teardown: in-memory instance gone, SQLite journal kept.
      await evictDurableObject(env.TASK_RUNNER.getByName(created.taskId));

      // Cold start + replay: fetch-data is a journal HIT (closure not re-run),
      // the sleep completes early under the drain, send runs once.
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
});
