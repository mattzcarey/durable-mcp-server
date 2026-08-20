import { describe, expect, it } from "vitest";
import {
  formatPollSeconds,
  isActivePollChoice,
  lastPollAgoMs,
  POLL_RATE_CHOICES,
} from "./poll-controls";

const NOW = 1_700_000_000_000;

describe("POLL_RATE_CHOICES", () => {
  it("leads with the server hint and offers the contract's three overrides", () => {
    expect(POLL_RATE_CHOICES.map((choice) => choice.overrideMs)).toEqual([null, 500, 1000, 2000]);
  });
});

describe("lastPollAgoMs", () => {
  it("ages from the observed snapshot", () => {
    expect(lastPollAgoMs(NOW, NOW)).toBe(0);
    expect(lastPollAgoMs(NOW, NOW + 750)).toBe(750);
  });

  it("never reports a poll from the future", () => {
    expect(lastPollAgoMs(NOW + 5000, NOW)).toBe(0);
  });
});

describe("formatPollSeconds", () => {
  it("renders tenths of a second and clamps below zero", () => {
    expect(formatPollSeconds(0)).toBe("0.0s");
    expect(formatPollSeconds(430)).toBe("0.4s");
    expect(formatPollSeconds(12_040)).toBe("12.0s");
    expect(formatPollSeconds(-100)).toBe("0.0s");
  });
});

describe("isActivePollChoice", () => {
  it("matches the agent's override, with undefined meaning the hint", () => {
    const [hint, half, one] = POLL_RATE_CHOICES;
    expect(hint).toBeDefined();
    expect(half).toBeDefined();
    expect(one).toBeDefined();
    if (!hint || !half || !one) return;
    expect(isActivePollChoice(hint, undefined)).toBe(true);
    expect(isActivePollChoice(half, undefined)).toBe(false);
    expect(isActivePollChoice(half, 500)).toBe(true);
    expect(isActivePollChoice(one, 500)).toBe(false);
  });
});
