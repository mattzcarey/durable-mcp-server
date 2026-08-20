/**
 * Pure logic for the poll-rate controls. Polling is the transport of the
 * whole adventure — every beat, fork, and fate-decided timeout is only ever
 * OBSERVED on a `tasks/get` poll — so the demo surfaces it: a manual "poll
 * now" and a poll-rate override (server hint / 0.5s / 1s / 2s) live in the
 * utilities drawer behind the header's gear, with when the task was last
 * polled and when it polls next. This module owns the choices and the
 * readout math; the agent owns the actual alarms.
 */

export type PollRateChoice = {
  /** Override in ms, or null for the server's own pollIntervalMs hint. */
  overrideMs: number | null;
  /** Button label. */
  label: string;
};

/** The poll-rate presets, in display order. */
export const POLL_RATE_CHOICES: readonly PollRateChoice[] = [
  { overrideMs: null, label: "auto" },
  { overrideMs: 500, label: "0.5s" },
  { overrideMs: 1000, label: "1s" },
  { overrideMs: 2000, label: "2s" },
];

/**
 * Milliseconds since the snapshot was observed — the "last poll" age.
 * Clamped at zero so a skewed clock never shows a poll from the future.
 */
export function lastPollAgoMs(observedAtMs: number, nowMs: number): number {
  return Math.max(0, nowMs - observedAtMs);
}

/** Compact seconds readout for the tower's poll cells: "0.4s", "12.0s". */
export function formatPollSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

/**
 * Whether a preset is the active one for the agent's current override
 * (undefined = no override = the server-hint preset).
 */
export function isActivePollChoice(
  choice: PollRateChoice,
  activeOverrideMs: number | undefined,
): boolean {
  return choice.overrideMs === (activeOverrideMs ?? null);
}
