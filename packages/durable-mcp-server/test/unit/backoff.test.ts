import { describe, expect, it } from "vitest";
import { exponential, jitter } from "../../src/engine/backoff";

describe("exponential", () => {
  it("doubles from the 1s default base", () => {
    expect(exponential(1)).toBe(1_000);
    expect(exponential(2)).toBe(2_000);
    expect(exponential(3)).toBe(4_000);
    expect(exponential(4)).toBe(8_000);
    expect(exponential(8)).toBe(128_000);
  });

  it("caps at the 5-minute default", () => {
    expect(exponential(9)).toBe(256_000);
    expect(exponential(10)).toBe(300_000);
    expect(exponential(50)).toBe(300_000);
  });

  it("honors custom base and cap", () => {
    expect(exponential(1, 100, 1_000)).toBe(100);
    expect(exponential(3, 100, 1_000)).toBe(400);
    expect(exponential(5, 100, 1_000)).toBe(1_000);
  });
});

describe("jitter", () => {
  it("stays between half and all of the delay", () => {
    for (let i = 0; i < 200; i++) {
      const value = jitter(10_000);
      expect(value).toBeGreaterThanOrEqual(5_000);
      expect(value).toBeLessThanOrEqual(10_000);
    }
  });

  it("composes with exponential for the engine's retry schedule", () => {
    for (let attempt = 1; attempt <= 12; attempt++) {
      const delay = exponential(attempt);
      const jittered = jitter(delay);
      expect(jittered).toBeGreaterThanOrEqual(delay / 2);
      expect(jittered).toBeLessThanOrEqual(delay);
      expect(jittered).toBeLessThanOrEqual(300_000);
    }
  });
});
