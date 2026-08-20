/**
 * Pure-logic coverage of the executor-side ReplayStep wrapper (stage 3):
 * overload dispatch, journal-directive handling, same-run duplicate-name
 * detection (decision D8), retry-policy math and dispositions, the
 * per-attempt timeout race, and the suspend/terminal taxonomy — against a
 * scripted protocol stub (a protocol fake, not a storage simulation; every
 * storage-touching flow runs against the real DO in the workflow suites).
 */

import { describe, expect, it } from "vitest";
import type {
  BeginStepOptions,
  BeginStepResult,
  CheckInputState,
  DurableStepStub,
  ElicitState,
  SleepState,
  StepFailureDisposition,
} from "../../src";
import { NonRetryableError, ResultSerializationError, RetryPolicyError } from "../../src";
import type { SerializedError } from "../../src";
import type { RetryPolicy } from "../../src";
import {
  computeStepRetryDelayMs,
  ReplayStep,
  resolveRetryPolicy,
  SuspendSignal,
} from "../../src/step/replay-step";

const TASK_RETRIES: Required<RetryPolicy> = { limit: 3, baseDelayMs: 1_000, maxDelayMs: 60_000 };

interface Recorded {
  begins: Array<{ stepKey: string; options: BeginStepOptions | undefined }>;
  completions: Array<{ stepKey: string; value: unknown }>;
  failures: Array<{ stepKey: string; error: SerializedError; disposition: StepFailureDisposition }>;
  sleeps: Array<{ stepKey: string; wakeAtMs: number }>;
  elicits: Array<{ stepKey: string; request: unknown; timeoutAtMs: number | undefined }>;
  offers: Array<{ key: string; request: unknown }>;
  checks: Array<{ stepKey: string; key: string }>;
  statuses: Array<{ message: string; meta: unknown }>;
}

interface Script {
  begin?: (stepKey: string) => BeginStepResult;
  sleep?: (stepKey: string) => SleepState;
  elicit?: (stepKey: string) => ElicitState;
  check?: (stepKey: string, key: string) => CheckInputState;
}

function scriptedStub(script: Script = {}): { stub: DurableStepStub; recorded: Recorded } {
  const recorded: Recorded = {
    begins: [],
    completions: [],
    failures: [],
    sleeps: [],
    elicits: [],
    offers: [],
    checks: [],
    statuses: [],
  };
  const stub: DurableStepStub = {
    taskId: "task-1",
    attempt: 1,
    async beginStep(stepKey, options) {
      recorded.begins.push({ stepKey, options });
      return script.begin?.(stepKey) ?? { state: "run", attempt: 1 };
    },
    async completeStep(stepKey, value) {
      recorded.completions.push({ stepKey, value });
      return true;
    },
    async failStep(stepKey, error, disposition) {
      recorded.failures.push({ stepKey, error, disposition });
      return true;
    },
    async recordSleep(stepKey, wakeAtMs) {
      recorded.sleeps.push({ stepKey, wakeAtMs });
      return script.sleep?.(stepKey) ?? { state: "pending" };
    },
    async recordElicit(stepKey, request, timeoutAtMs) {
      recorded.elicits.push({ stepKey, request, timeoutAtMs });
      return script.elicit?.(stepKey) ?? { state: "pending" };
    },
    async recordOffer(key, request) {
      recorded.offers.push({ key, request });
    },
    async checkInput(stepKey, key) {
      recorded.checks.push({ stepKey, key });
      return script.check?.(stepKey, key) ?? { state: "unanswered" };
    },
    async setStatus(message, meta) {
      recorded.statuses.push({ message, meta });
    },
    async checkCancel() {
      return false;
    },
  };
  return { stub, recorded };
}

const step = (script?: Script) => {
  const { stub, recorded } = scriptedStub(script);
  return { step: new ReplayStep(stub, "task-1", TASK_RETRIES), recorded };
};

describe("step.do", () => {
  it("runs the closure on a journal miss and persists the value", async () => {
    const { step: s, recorded } = step();
    const value = await s.do("fetch", async () => ({ rows: 3 }));
    expect(value).toEqual({ rows: 3 });
    expect(recorded.begins).toEqual([{ stepKey: "fetch", options: { timeoutMs: 300_000 } }]);
    expect(recorded.completions).toEqual([{ stepKey: "fetch", value: { rows: 3 } }]);
  });

  it("supports the (name, config, fn) overload and journals the timeout", async () => {
    const { step: s, recorded } = step();
    await s.do("cfg", { timeoutMs: 120_000 }, () => "v");
    expect(recorded.begins).toEqual([{ stepKey: "cfg", options: { timeoutMs: 120_000 } }]);
  });

  it("returns the memoized value on a journal hit without running the closure", async () => {
    const { step: s, recorded } = step({ begin: () => ({ state: "completed", value: 42 }) });
    let ran = false;
    const value = await s.do("memo", () => {
      ran = true;
      return 0;
    });
    expect(value).toBe(42);
    expect(ran).toBe(false);
    expect(recorded.completions).toHaveLength(0);
  });

  it("rehydrates a terminally-failed step from the journal", async () => {
    const { step: s } = step({
      begin: () => ({ state: "failed", error: { name: "NonRetryableError", message: "nope" } }),
    });
    let thrown: unknown;
    try {
      await s.do("dead", () => 1);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe("NonRetryableError");
    expect((thrown as Error).message).toBe("nope");
  });

  it("suspends on the cancelled directive", async () => {
    const { step: s } = step({ begin: () => ({ state: "cancelled" }) });
    await expect(s.do("late", () => 1)).rejects.toBeInstanceOf(SuspendSignal);
  });

  it("schedules a retry with the policy backoff on a retryable throw, then suspends", async () => {
    const { step: s, recorded } = step();
    const before = Date.now();
    await expect(
      s.do("flaky", { retries: { baseDelayMs: 10_000, maxDelayMs: 10_000 } }, () => {
        throw new Error("boom");
      }),
    ).rejects.toBeInstanceOf(SuspendSignal);
    const failure = recorded.failures.at(0);
    expect(failure?.error).toEqual({ name: "Error", message: "boom" });
    const disposition = failure?.disposition;
    if (disposition === undefined || !("retryAtMs" in disposition)) {
      throw new Error("expected a retry disposition");
    }
    // Equal jitter on base=cap=10s -> [5s, 10s] from now.
    expect(disposition.retryAtMs).toBeGreaterThanOrEqual(before + 5_000);
    expect(disposition.retryAtMs).toBeLessThanOrEqual(Date.now() + 10_000);
  });

  it("NonRetryableError is terminal immediately and rethrown", async () => {
    const { step: s, recorded } = step();
    await expect(
      s.do("doomed", () => {
        throw new NonRetryableError("bad");
      }),
    ).rejects.toMatchObject({ name: "NonRetryableError", message: "bad" });
    expect(recorded.failures.at(0)?.disposition).toEqual({ terminal: true });
  });

  it("the limit-th failed attempt is terminal and rethrows the original error", async () => {
    const { step: s, recorded } = step({ begin: () => ({ state: "run", attempt: 3 }) });
    await expect(
      s.do("worn", () => {
        throw new Error("third strike");
      }),
    ).rejects.toMatchObject({ message: "third strike" });
    expect(recorded.failures.at(0)?.disposition).toEqual({ terminal: true });
  });

  it("an attempt claimed beyond the limit (crash-consumed) is exhausted without running", async () => {
    const { step: s, recorded } = step({ begin: () => ({ state: "run", attempt: 4 }) });
    let ran = false;
    await expect(
      s.do("crashed", () => {
        ran = true;
        return 1;
      }),
    ).rejects.toMatchObject({ name: "AttemptsExhaustedError" });
    expect(ran).toBe(false);
    expect(recorded.failures.at(0)?.disposition).toEqual({ terminal: true });
  });

  it("races the closure against timeoutMs and records StepTimeoutError for retry", async () => {
    const { step: s, recorded } = step();
    await expect(
      s.do("hung", { timeoutMs: 20 }, () => new Promise<never>(() => {})),
    ).rejects.toBeInstanceOf(SuspendSignal);
    const failure = recorded.failures.at(0);
    expect(failure?.error.name).toBe("StepTimeoutError");
    expect(failure?.error.message).toContain("timed out after 20ms");
    expect(failure !== undefined && "retryAtMs" in failure.disposition).toBe(true);
  });

  it("a non-JSON-serializable value is a ResultSerializationError before any journal write", async () => {
    const { step: s, recorded } = step();
    await expect(s.do("bad-value", () => ({ fn: () => 1 }) as never)).rejects.toBeInstanceOf(
      ResultSerializationError,
    );
    expect(recorded.completions).toHaveLength(0);
  });

  it("an invalid retry policy is a RetryPolicyError before the journal is touched", async () => {
    const { step: s, recorded } = step();
    await expect(s.do("bad-policy", { retries: { limit: 0 } }, () => 1)).rejects.toBeInstanceOf(
      RetryPolicyError,
    );
    expect(recorded.begins).toHaveLength(0);
  });
});

describe("same-run duplicate names (decision D8)", () => {
  it("rejects reuse across do/sleep/elicit before any stub call", async () => {
    const { step: s, recorded } = step({ sleep: () => ({ state: "completed", latest: true }) });
    await s.do("once", () => 1);
    await expect(s.do("once", () => 2)).rejects.toMatchObject({ name: "DuplicateStepError" });
    await s.sleep("nap", "1h");
    await expect(s.sleep("nap", "1h")).rejects.toMatchObject({ name: "DuplicateStepError" });
    await expect(
      s.elicit("once", {
        method: "elicitation/create",
        params: { message: "m", requestedSchema: { type: "object", properties: {} } },
      }),
    ).rejects.toMatchObject({ name: "DuplicateStepError" });
    expect(recorded.begins).toHaveLength(1);
    expect(recorded.sleeps).toHaveLength(1);
    expect(recorded.elicits).toHaveLength(0);
  });
});

describe("step.sleep / step.sleepUntil", () => {
  it("records the parsed wake time and suspends while pending", async () => {
    const { step: s, recorded } = step();
    const before = Date.now();
    await expect(s.sleep("nap", "1h")).rejects.toBeInstanceOf(SuspendSignal);
    const wake = recorded.sleeps.at(0)?.wakeAtMs ?? 0;
    expect(wake).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(wake).toBeLessThanOrEqual(Date.now() + 3_600_000);
  });

  it("resolves instantly on a completed (elapsed) sleep", async () => {
    const { step: s } = step({ sleep: () => ({ state: "completed", latest: true }) });
    await expect(s.sleep("nap", 1_000)).resolves.toBeUndefined();
  });

  it("sleepUntil accepts a Date and rejects invalid times", async () => {
    const at = new Date(Date.now() + 60_000);
    const { step: s, recorded } = step({ sleep: () => ({ state: "completed", latest: true }) });
    await s.sleepUntil("until", at);
    expect(recorded.sleeps.at(0)?.wakeAtMs).toBe(at.getTime());
    await expect(s.sleepUntil("bad", new Date(Number.NaN))).rejects.toBeInstanceOf(RangeError);
  });
});

describe("step.elicit", () => {
  const REQUEST = {
    method: "elicitation/create",
    params: { message: "pick", requestedSchema: { type: "object", properties: {} } },
  } as const;

  it("suspends while the input request is unanswered", async () => {
    const { step: s, recorded } = step();
    await expect(s.elicit("color", REQUEST)).rejects.toBeInstanceOf(SuspendSignal);
    expect(recorded.elicits).toEqual([
      { stepKey: "color", request: REQUEST, timeoutAtMs: undefined },
    ]);
  });

  it("resolves with the recorded response once answered", async () => {
    const response = { action: "accept", content: { color: "blue" } };
    const { step: s } = step({ elicit: () => ({ state: "answered", response, latest: true }) });
    await expect(s.elicit("color", REQUEST)).resolves.toEqual(response);
  });
});

describe("step.elicit with a timeout config", () => {
  const REQUEST = {
    method: "elicitation/create",
    params: { message: "pick", requestedSchema: { type: "object", properties: {} } },
  } as const;

  it("records the computed deadline and suspends while pending", async () => {
    const { step: s, recorded } = step();
    const before = Date.now();
    await expect(s.elicit("gate", REQUEST, { timeoutMs: 60_000 })).rejects.toBeInstanceOf(
      SuspendSignal,
    );
    const elicited = recorded.elicits.at(0);
    expect(elicited?.stepKey).toBe("gate");
    expect(elicited?.timeoutAtMs).toBeGreaterThanOrEqual(before + 60_000);
    expect(elicited?.timeoutAtMs).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it("wraps an in-time answer in the discriminated answered outcome", async () => {
    const response = { action: "accept", content: { go: true } };
    const { step: s } = step({ elicit: () => ({ state: "answered", response, latest: true }) });
    await expect(s.elicit("gate", REQUEST, { timeoutMs: 60_000 })).resolves.toEqual({
      outcome: "answered",
      response,
    });
  });

  it("resolves the journaled timeout as the timed_out outcome", async () => {
    const { step: s } = step({ elicit: () => ({ state: "timed_out", latest: true }) });
    await expect(s.elicit("gate", REQUEST, { timeoutMs: 60_000 })).resolves.toEqual({
      outcome: "timed_out",
    });
  });

  it("a config without timeoutMs records no deadline but still wraps the outcome", async () => {
    const response = { action: "accept", content: {} };
    const { step: s, recorded } = step({
      elicit: () => ({ state: "answered", response, latest: true }),
    });
    await expect(s.elicit("gate", REQUEST, {})).resolves.toEqual({
      outcome: "answered",
      response,
    });
    expect(recorded.elicits.at(0)?.timeoutAtMs).toBeUndefined();
  });

  it("rejects a non-positive or non-integer timeoutMs before any stub call", async () => {
    const { step: s, recorded } = step();
    await expect(s.elicit("bad", REQUEST, { timeoutMs: 0 })).rejects.toBeInstanceOf(RangeError);
    expect(recorded.elicits).toHaveLength(0);
  });
});

describe("step.status across replay (live gate)", () => {
  it("a first-claim handler is live from the start", async () => {
    const { step: s, recorded } = step();
    await s.status("hello");
    expect(recorded.statuses.map((x) => x.message)).toEqual(["hello"]);
  });

  it("on a resumed claim, stays silent through earlier completed sleeps and goes live only after the LATEST suspension point", async () => {
    // The previous run published b0, slept (pace-0), published b1, slept (pace-1),
    // published b2, then suspended on pace-2. The resume replays all three
    // sleeps as hits; only pace-2 is the latest. Beats b0..b2 must NOT be
    // re-published; the first beat after pace-2 must.
    const { stub, recorded } = scriptedStub({
      sleep: (key) => ({ state: "completed", latest: key === "pace-2" }),
    });
    const s = new ReplayStep(stub, "task-1", TASK_RETRIES, 2);
    await s.status("b0");
    await s.sleep("pace-0", "1s");
    await s.status("b1");
    await s.sleep("pace-1", "1s");
    await s.status("b2");
    await s.sleep("pace-2", "1s"); // the latest suspension point: back on new ground
    await s.status("b3");
    expect(recorded.statuses.map((x) => x.message)).toEqual(["b3"]);
  });

  it("a resumed claim goes live at a genuine journal miss too (a closure that runs)", async () => {
    const { stub, recorded } = scriptedStub({
      sleep: () => ({ state: "completed", latest: false }),
      begin: () => ({ state: "run", attempt: 1 }),
    });
    const s = new ReplayStep(stub, "task-1", TASK_RETRIES, 2);
    await s.status("old");
    await s.sleep("pace-0", "1s");
    await s.do("work", async () => 1);
    await s.status("new");
    expect(recorded.statuses.map((x) => x.message)).toEqual(["new"]);
  });

  it("an answered elicit that is the latest suspension point puts the handler back on new ground", async () => {
    const { stub, recorded } = scriptedStub({
      sleep: () => ({ state: "completed", latest: false }),
      elicit: () => ({
        state: "answered",
        response: { action: "accept", content: {} },
        latest: true,
      }),
    });
    const s = new ReplayStep(stub, "task-1", TASK_RETRIES, 2);
    await s.status("before");
    await s.sleep("pace-0", "1s");
    await s.elicit("fork", {
      method: "elicitation/create",
      params: { message: "?", requestedSchema: { type: "object", properties: {} } },
    });
    await s.status("after");
    expect(recorded.statuses.map((x) => x.message)).toEqual(["after"]);
  });
});

describe("step.status", () => {
  it("delegates to the lease without touching the journal", async () => {
    const { step: s, recorded } = step();
    await expect(s.status("halfway there")).resolves.toBeUndefined();
    expect(recorded.statuses).toEqual([{ message: "halfway there", meta: undefined }]);
    expect(recorded.begins).toHaveLength(0); // not a journaled step
  });

  it("is repeatable within one run — no name to claim, no duplicate error", async () => {
    const { step: s, recorded } = step();
    await s.status("one");
    await s.status("two");
    expect(recorded.statuses.map((status) => status.message)).toEqual(["one", "two"]);
  });

  it("rejects a non-string message before any stub call", async () => {
    const { step: s, recorded } = step();
    await expect(s.status(42 as unknown as string)).rejects.toBeInstanceOf(TypeError);
    expect(recorded.statuses).toHaveLength(0);
  });

  it("passes a structured meta object through verbatim", async () => {
    const { step: s, recorded } = step();
    const meta = { scene: "lobby", offers: ["act-1"], depth: { level: 2 } };
    await s.status("act 1", meta);
    expect(recorded.statuses).toEqual([{ message: "act 1", meta }]);
  });

  it("rejects a non-object meta (array, null, primitive) before any stub call", async () => {
    const { step: s, recorded } = step();
    for (const bad of [[1, 2], null, "text", 7]) {
      await expect(s.status("m", bad as never)).rejects.toBeInstanceOf(TypeError);
    }
    expect(recorded.statuses).toHaveLength(0);
  });
});

describe("step.offer / step.checkInput", () => {
  const REQUEST = {
    method: "elicitation/create",
    params: { message: "what do you do?", requestedSchema: { type: "object", properties: {} } },
  } as const;

  it("offer delegates to the lease without suspending or journaling", async () => {
    const { step: s, recorded } = step();
    await expect(s.offer("act-1", REQUEST)).resolves.toBeUndefined();
    expect(recorded.offers).toEqual([{ key: "act-1", request: REQUEST }]);
    expect(recorded.begins).toHaveLength(0);
    expect(recorded.elicits).toHaveLength(0);
  });

  it("offer keys share the same-run name namespace (decision D8)", async () => {
    const { step: s, recorded } = step();
    await s.offer("act-1", REQUEST);
    await expect(s.offer("act-1", REQUEST)).rejects.toMatchObject({ name: "DuplicateStepError" });
    await expect(s.elicit("act-1", REQUEST)).rejects.toMatchObject({ name: "DuplicateStepError" });
    await expect(s.do("act-1", () => 1)).rejects.toMatchObject({ name: "DuplicateStepError" });
    expect(recorded.offers).toHaveLength(1);
    expect(recorded.elicits).toHaveLength(0);
    expect(recorded.begins).toHaveLength(0);
  });

  it("checkInput resolves null on a miss and the response on a hit, never suspending", async () => {
    const response = { action: "accept", content: { action: "enter" } };
    const { step: s, recorded } = step({
      check: (stepKey) =>
        stepKey === "c2" ? { state: "answered", response } : { state: "unanswered" },
    });
    await expect(s.checkInput("c1", "act-1")).resolves.toBeNull();
    await expect(s.checkInput("c2", "act-1")).resolves.toEqual(response);
    expect(recorded.checks).toEqual([
      { stepKey: "c1", key: "act-1" },
      { stepKey: "c2", key: "act-1" },
    ]);
  });

  it("checkInput claims its step name and rejects an empty key before any stub call", async () => {
    const { step: s, recorded } = step();
    await s.checkInput("c1", "act-1");
    await expect(s.checkInput("c1", "act-1")).rejects.toMatchObject({
      name: "DuplicateStepError",
    });
    await expect(s.checkInput("c2", "")).rejects.toBeInstanceOf(TypeError);
    expect(recorded.checks).toEqual([{ stepKey: "c1", key: "act-1" }]);
  });
});

describe("idempotencyKey", () => {
  it("is `${taskId}:${stepName}`", () => {
    const { step: s } = step();
    expect(s.idempotencyKey("send")).toBe("task-1:send");
  });
});

describe("policy helpers", () => {
  it("resolveRetryPolicy merges per-field over the task policy", () => {
    expect(resolveRetryPolicy(TASK_RETRIES, { limit: 7 }, "step")).toEqual({
      limit: 7,
      baseDelayMs: 1_000,
      maxDelayMs: 60_000,
    });
    expect(resolveRetryPolicy(TASK_RETRIES, undefined, "step")).toEqual(TASK_RETRIES);
  });

  it("rejects unusable policies", () => {
    expect(() => resolveRetryPolicy(TASK_RETRIES, { limit: 0 }, "s")).toThrow(RetryPolicyError);
    expect(() => resolveRetryPolicy(TASK_RETRIES, { limit: 1.5 }, "s")).toThrow(RetryPolicyError);
    expect(() => resolveRetryPolicy(TASK_RETRIES, { baseDelayMs: -1 }, "s")).toThrow(
      RetryPolicyError,
    );
    expect(() => resolveRetryPolicy(TASK_RETRIES, { maxDelayMs: Number.NaN }, "s")).toThrow(
      RetryPolicyError,
    );
  });

  it("computeStepRetryDelayMs backs off exponentially within jitter bounds", () => {
    const policy: Required<RetryPolicy> = { limit: 5, baseDelayMs: 1_000, maxDelayMs: 300_000 };
    for (const [attempt, expected] of [
      [1, 1_000],
      [2, 2_000],
      [3, 4_000],
    ] as const) {
      const delay = computeStepRetryDelayMs(policy, attempt, "s");
      expect(delay).toBeGreaterThanOrEqual(expected / 2);
      expect(delay).toBeLessThanOrEqual(expected);
    }
    // The cap holds for large attempts.
    expect(computeStepRetryDelayMs(policy, 40, "s")).toBeLessThanOrEqual(300_000);
  });
});
