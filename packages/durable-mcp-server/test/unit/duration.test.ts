import { describe, expect, it } from "vitest";
import { parseDuration, type DurationString } from "../../src/engine/duration";

describe("parseDuration", () => {
  it("parses the RFC's documented forms", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("1h")).toBe(3_600_000);
    expect(parseDuration("2d")).toBe(172_800_000);
  });

  it("parses millisecond strings", () => {
    expect(parseDuration("250ms")).toBe(250);
    expect(parseDuration("0ms")).toBe(0);
  });

  it("parses fractional values, rounding to whole milliseconds", () => {
    expect(parseDuration("0.5s")).toBe(500);
    expect(parseDuration("1.5m")).toBe(90_000);
    expect(parseDuration("0.5ms")).toBe(1);
  });

  it("passes plain numbers through as milliseconds", () => {
    expect(parseDuration(0)).toBe(0);
    expect(parseDuration(1_234)).toBe(1_234);
    expect(parseDuration(1_500.4)).toBe(1_500);
  });

  it("rejects negative and non-finite numbers", () => {
    expect(() => parseDuration(-1)).toThrow(RangeError);
    expect(() => parseDuration(Number.NaN)).toThrow(RangeError);
    expect(() => parseDuration(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("rejects malformed duration strings", () => {
    const bad = ["5x", "s", "5", "-5s", "5 s", "1h30m", "", "5S"];
    for (const value of bad) {
      expect(() => parseDuration(value as DurationString)).toThrow(RangeError);
    }
  });
});
