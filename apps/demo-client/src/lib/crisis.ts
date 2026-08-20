/**
 * The fate-decides countdown for timed crisis forks. The SERVER owns the
 * deadline — an unanswered ask resolves on its own and the task returns to
 * `working` — so this is cosmetic urgency, anchored to when the ask was
 * FIRST observed (`TaskView.statusSinceMs`, never `observedAtMs`, which any
 * equal-status refresh would re-anchor and reset the drain). At zero the
 * buttons lock and the panel waits for the next observed poll to close it.
 */

/**
 * Milliseconds left in the window, clamped to 0..windowMs — a clock skewed
 * into the future still shows a full window, an expired one holds at zero.
 */
export function crisisRemainingMs(askSinceMs: number, nowMs: number, windowMs: number): number {
  return Math.min(Math.max(windowMs - (nowMs - askSinceMs), 0), windowMs);
}

/** Escalation bands for the countdown treatment, as fractions of the window. */
export type CrisisUrgency = "steady" | "urgent" | "critical";

export function crisisUrgency(remainingMs: number, windowMs: number): CrisisUrgency {
  if (windowMs <= 0) return "critical";
  const fraction = remainingMs / windowMs;
  if (fraction > 0.6) return "steady";
  if (fraction > 0.3) return "urgent";
  return "critical";
}
