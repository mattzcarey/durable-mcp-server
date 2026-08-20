import { describe, expect, it } from "vitest";
import {
  AttemptsExhaustedError,
  DuplicateStepError,
  isNonRetryable,
  NonRetryableError,
  ResultSerializationError,
  RetryPolicyError,
  serializeError,
  StepTimeoutError,
} from "../../src/engine/errors";

describe("error taxonomy", () => {
  it("every class sets its duck-typing name and extends Error", () => {
    const cases: Array<[Error, string]> = [
      [new NonRetryableError("nope"), "NonRetryableError"],
      [new StepTimeoutError("fetch-data", 5_000), "StepTimeoutError"],
      [new RetryPolicyError('step "send"'), "RetryPolicyError"],
      [new ResultSerializationError('step "send"'), "ResultSerializationError"],
      [new AttemptsExhaustedError('step "send"', 5), "AttemptsExhaustedError"],
      [new DuplicateStepError("fetch-data"), "DuplicateStepError"],
    ];
    for (const [error, name] of cases) {
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(name);
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it("carries context in messages", () => {
    expect(new StepTimeoutError("fetch-data", 5_000).message).toContain("fetch-data");
    expect(new StepTimeoutError("fetch-data", 5_000).message).toContain("5000ms");
    expect(new AttemptsExhaustedError('step "send"', 5).message).toContain("5 attempts");
    expect(new DuplicateStepError("send").message).toContain('"send"');
  });

  it("attaches reasons as non-enumerable cause", () => {
    const reason = new Error("inner");
    const error = new ResultSerializationError('step "x"', reason);
    expect((error as { cause?: unknown }).cause).toBe(reason);
    // Non-enumerable: JSON.stringify of the error must not drag the cause along.
    expect(Object.keys(error)).not.toContain("cause");
  });
});

describe("isNonRetryable", () => {
  it("recognizes this package's class", () => {
    expect(isNonRetryable(new NonRetryableError("stop"))).toBe(true);
  });

  it("recognizes a same-named class from another realm/module by duck typing", () => {
    // Simulates cloudflare:workflows' NonRetryableError (and RPC-crossed
    // instances): a different class identity carrying the same name.
    class OtherNonRetryableError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "NonRetryableError";
      }
    }
    expect(isNonRetryable(new OtherNonRetryableError("stop"))).toBe(true);
  });

  it("recognizes constructor-name matches even without an own name", () => {
    class NRImpostor extends Error {}
    Object.defineProperty(NRImpostor, "name", { value: "NonRetryableError" });
    const error = new NRImpostor("stop");
    error.name = "Error";
    expect(isNonRetryable(error)).toBe(true);
  });

  it("recognizes plain serialized objects with the name", () => {
    expect(isNonRetryable({ name: "NonRetryableError", message: "stop" })).toBe(true);
  });

  it("rejects ordinary errors and primitives", () => {
    expect(isNonRetryable(new Error("transient"))).toBe(false);
    expect(isNonRetryable(new StepTimeoutError("x", 1))).toBe(false);
    expect(isNonRetryable("NonRetryableError")).toBe(false);
    expect(isNonRetryable(null)).toBe(false);
    expect(isNonRetryable(undefined)).toBe(false);
    expect(isNonRetryable(42)).toBe(false);
  });

  it("survives hostile getters", () => {
    const hostile = {
      get name(): string {
        throw new Error("gotcha");
      },
    };
    expect(isNonRetryable(hostile)).toBe(false);
  });
});

describe("serializeError", () => {
  it("extracts name and message from real errors", () => {
    expect(serializeError(new StepTimeoutError("x", 9))).toEqual({
      name: "StepTimeoutError",
      message: 'Step "x" timed out after 9ms',
    });
  });

  it("handles primitives and null", () => {
    expect(serializeError(null)).toEqual({ name: "Error", message: "null" });
    expect(serializeError("boom")).toEqual({ name: "Error", message: "boom" });
    expect(serializeError(7)).toEqual({ name: "Error", message: "7" });
    expect(serializeError(undefined)).toEqual({
      name: "Error",
      message: "undefined",
    });
  });

  it("falls back on empty or non-string fields", () => {
    expect(serializeError({ name: "", message: "" })).toEqual({
      name: "Error",
      message: "Unknown thrown value",
    });
    expect(serializeError({ name: 42, message: ["x"] })).toEqual({
      name: "Error",
      message: "Unknown thrown value",
    });
  });

  it("defends against hostile getters per field", () => {
    const hostileName = {
      get name(): string {
        throw new Error("no name for you");
      },
      message: "still readable",
    };
    expect(serializeError(hostileName)).toEqual({
      name: "Error",
      message: "still readable",
    });

    const hostileBoth = {
      get name(): string {
        throw new Error("x");
      },
      get message(): string {
        throw new Error("y");
      },
    };
    expect(serializeError(hostileBoth)).toEqual({
      name: "Error",
      message: "Unknown thrown value",
    });
  });
});
