import { describe, expect, it } from "vitest";
import { callTaskRunner } from "../../src/engine/call-task-runner";
import type { TaskRunner } from "../../src/do/task-runner";
import { isErrorRetryable, jitterBackoff, tryN, tryWhile } from "../../src/vendor/retries";

// Keep test backoffs tiny: constraint is 0 < base < max.
const FAST = { baseDelayMs: 1, maxDelayMs: 2 };

const retryableError = (): Error => {
  const error = new Error("do stub broke");
  Object.assign(error, { retryable: true });
  return error;
};

const neverRuns = async () => "unreachable";

describe("tryWhile", () => {
  it("counts attempts from 1 and returns the first success", async () => {
    const seen: number[] = [];
    const result = await tryWhile(
      async (attempt) => {
        seen.push(attempt);
        if (attempt < 3) {
          throw new Error(`fail ${attempt}`);
        }
        return "ok";
      },
      () => true,
      FAST,
    );
    expect(result).toBe("ok");
    expect(seen).toEqual([1, 2, 3]);
  });

  it("passes the NEXT attempt number to isRetryable and stops when it declines", async () => {
    const nexts: number[] = [];
    await expect(
      tryWhile(
        async () => {
          throw new Error("always");
        },
        (_err, next) => {
          nexts.push(next);
          return next <= 3;
        },
        FAST,
      ),
    ).rejects.toThrow("always");
    // Attempts 1..3 ran; isRetryable saw next = 2, 3, 4 and declined at 4.
    expect(nexts).toEqual([2, 3, 4]);
  });

  it("propagates the original error without retrying when not retryable", async () => {
    let calls = 0;
    await expect(
      tryWhile(
        async () => {
          calls += 1;
          throw new Error("terminal");
        },
        () => false,
        FAST,
      ),
    ).rejects.toThrow("terminal");
    expect(calls).toBe(1);
  });

  it("validates its delay options", async () => {
    await expect(tryWhile(neverRuns, () => true, { baseDelayMs: 0 })).rejects.toThrow(
      "baseDelayMs and maxDelayMs must be greater than 0",
    );
    await expect(
      tryWhile(neverRuns, () => true, { baseDelayMs: 500, maxDelayMs: 100 }),
    ).rejects.toThrow("baseDelayMs must be less than maxDelayMs");
  });
});

describe("tryN", () => {
  it("makes exactly n attempts then throws the last error", async () => {
    let calls = 0;
    await expect(
      tryN(
        3,
        async () => {
          calls += 1;
          throw new Error(`attempt ${calls}`);
        },
        FAST,
      ),
    ).rejects.toThrow("attempt 3");
    expect(calls).toBe(3);
  });

  it("combines the attempt budget with a caller isRetryable", async () => {
    let calls = 0;
    await expect(
      tryN(
        5,
        async () => {
          calls += 1;
          throw new Error("nope");
        },
        { ...FAST, isRetryable: (_err, next) => next <= 2 },
      ),
    ).rejects.toThrow("nope");
    expect(calls).toBe(2);
  });

  it("rejects a non-positive attempt budget", async () => {
    await expect(tryN(0, async () => "x")).rejects.toThrow("n must be greater than 0");
  });
});

describe("jitterBackoff", () => {
  it("stays below the exponential upper bound and the cap", () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      for (let i = 0; i < 50; i++) {
        const delay = jitterBackoff(attempt, 100, 3_000);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(Math.min(2 ** attempt * 100, 3_000));
      }
    }
  });
});

describe("isErrorRetryable", () => {
  it("follows the official Cloudflare guidance: .retryable && !.overloaded", () => {
    expect(isErrorRetryable(Object.assign(new Error("x"), { retryable: true }))).toBe(true);
    expect(
      isErrorRetryable(Object.assign(new Error("x"), { retryable: true, overloaded: true })),
    ).toBe(false);
    expect(isErrorRetryable(Object.assign(new Error("x"), { retryable: false }))).toBe(false);
    expect(isErrorRetryable(new Error("plain"))).toBe(false);
    expect(isErrorRetryable(null)).toBe(false);
    expect(isErrorRetryable("retryable")).toBe(false);
  });
});

describe("callTaskRunner", () => {
  type FakeStub = { id: number };

  /** A fake namespace observing stub construction — no HTTP, no workerd. */
  const fakeNamespace = (names: string[]) => {
    let constructed = 0;
    const stubs: FakeStub[] = [];
    const ns = {
      getByName(name: string) {
        names.push(name);
        constructed += 1;
        const stub: FakeStub = { id: constructed };
        stubs.push(stub);
        return stub;
      },
    };
    return { ns: ns as unknown as DurableObjectNamespace<TaskRunner>, stubs };
  };

  it("constructs a FRESH stub per attempt (correction over upstream)", async () => {
    const names: string[] = [];
    const { ns, stubs } = fakeNamespace(names);
    const seenStubs: unknown[] = [];

    const result = await callTaskRunner(ns, "task-123", async (stub, attempt) => {
      seenStubs.push(stub);
      if (attempt < 3) {
        throw retryableError();
      }
      return "created";
    });

    expect(result).toBe("created");
    expect(names).toEqual(["task-123", "task-123", "task-123"]);
    expect(seenStubs).toEqual(stubs);
    expect(new Set(seenStubs).size).toBe(3);
  });

  it("does not retry non-retryable errors", async () => {
    const names: string[] = [];
    const { ns } = fakeNamespace(names);
    await expect(
      callTaskRunner(ns, "task-123", async () => {
        throw new Error("app-level failure");
      }),
    ).rejects.toThrow("app-level failure");
    expect(names).toHaveLength(1);
  });

  it("gives up after 4 attempts even on retryable errors", async () => {
    const names: string[] = [];
    const { ns } = fakeNamespace(names);
    await expect(
      callTaskRunner(ns, "task-123", async () => {
        throw retryableError();
      }),
    ).rejects.toThrow("do stub broke");
    expect(names).toHaveLength(4);
  });
});
