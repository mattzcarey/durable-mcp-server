import { describe, expect, it } from "vitest";
import { ResultSerializationError } from "../../src/engine/errors";
import {
  deserializeValue,
  serializeValue,
  storedValueSchema,
} from "../../src/engine/serialization";

describe("serialization envelope", () => {
  it("round-trips plain JSON values", () => {
    const values: unknown[] = [
      null,
      0,
      -1.5,
      "text",
      true,
      false,
      [],
      [1, "two", null],
      { nested: { deep: [{ a: 1 }] } },
      {},
    ];
    for (const value of values) {
      expect(deserializeValue(serializeValue(value))).toEqual(value);
    }
  });

  it("round-trips top-level undefined faithfully", () => {
    const text = serializeValue(undefined);
    expect(JSON.parse(text)).toEqual({ kind: "undefined" });
    expect(deserializeValue(text)).toBeUndefined();
  });

  it("distinguishes undefined from null", () => {
    expect(deserializeValue(serializeValue(null))).toBeNull();
    expect(deserializeValue(serializeValue(undefined))).toBeUndefined();
  });

  it("rejects nested undefined property values instead of dropping them", () => {
    expect(() => serializeValue({ a: undefined })).toThrow(ResultSerializationError);
  });

  it("rejects non-JSON-serializable values with ResultSerializationError", () => {
    const cases: unknown[] = [
      () => "function",
      10n,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Map([["k", "v"]]),
      Symbol("s"),
    ];
    for (const value of cases) {
      expect(() => serializeValue(value, 'step "bad"')).toThrow(ResultSerializationError);
    }
  });

  it("rejects circular structures with ResultSerializationError", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => serializeValue(circular)).toThrow(ResultSerializationError);
  });

  it("names the failing entity in the error message", () => {
    expect(() => serializeValue(() => 0, 'step "send"')).toThrow('step "send"');
  });

  it("rejects stored text that is not a valid envelope", () => {
    expect(() => deserializeValue('{"kind":"mystery"}')).toThrow();
    expect(() => deserializeValue('"bare string"')).toThrow();
    expect(() => deserializeValue("not json")).toThrow();
  });

  it("storedValueSchema accepts both envelope kinds", () => {
    expect(storedValueSchema.parse({ kind: "undefined" })).toEqual({ kind: "undefined" });
    expect(storedValueSchema.parse({ kind: "value", value: [1, 2] })).toEqual({
      kind: "value",
      value: [1, 2],
    });
  });
});
