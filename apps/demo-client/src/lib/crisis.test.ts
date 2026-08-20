import { describe, expect, it } from "vitest";
import { crisisRemainingMs, crisisUrgency } from "./crisis";

const NOW = 1_700_000_000_000;
const WINDOW = 8000;

describe("crisisRemainingMs", () => {
  it("drains from the full window at the observed instant to zero", () => {
    expect(crisisRemainingMs(NOW, NOW, WINDOW)).toBe(WINDOW);
    expect(crisisRemainingMs(NOW, NOW + 3000, WINDOW)).toBe(WINDOW - 3000);
    expect(crisisRemainingMs(NOW, NOW + WINDOW, WINDOW)).toBe(0);
  });

  it("holds at zero once the server's deadline has passed unobserved", () => {
    expect(crisisRemainingMs(NOW, NOW + WINDOW + 5000, WINDOW)).toBe(0);
  });

  it("clamps a future-skewed snapshot to a full window", () => {
    expect(crisisRemainingMs(NOW + 60_000, NOW, WINDOW)).toBe(WINDOW);
  });
});

describe("crisisUrgency", () => {
  it("escalates as the window drains, by fraction", () => {
    expect(crisisUrgency(WINDOW, WINDOW)).toBe("steady");
    expect(crisisUrgency(4801, WINDOW)).toBe("steady");
    expect(crisisUrgency(4800, WINDOW)).toBe("urgent");
    expect(crisisUrgency(2401, WINDOW)).toBe("urgent");
    expect(crisisUrgency(2400, WINDOW)).toBe("critical");
    expect(crisisUrgency(0, WINDOW)).toBe("critical");
  });

  it("treats a zero window as critical", () => {
    expect(crisisUrgency(0, 0)).toBe("critical");
  });
});
