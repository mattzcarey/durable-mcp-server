import { Button, Surface, Text } from "@cloudflare/kumo";
import { SignpostIcon } from "@phosphor-icons/react";
import { COPY } from "../lib/copy";
import { crisisRemainingMs, crisisUrgency } from "../lib/crisis";
import type { Fork, ForkOption } from "../lib/story-wire";
import { Hint } from "./Hint";

/**
 * Forks only: the open `input_required` ask rendered as the scene question
 * with one button per option (the log only marks the pause). A timed crisis drains a countdown anchored to when the ask was
 * FIRST observed (`statusSinceMs`); at zero the buttons lock — the server
 * has already decided, and the panel closes on the next observed poll. An
 * answer sent locally locks the panel too, until the story moves on.
 */
export function ChoicePanel({
  fork,
  askSinceMs,
  nowMs,
  answered,
  busy,
  onChoose,
}: {
  fork: Fork;
  askSinceMs: number;
  nowMs: number;
  /** The label chosen locally, while the tasks/update is in flight or pending a poll. */
  answered?: string;
  busy: boolean;
  onChoose: (option: ForkOption) => void;
}) {
  const windowMs = fork.windowMs;
  const remaining =
    windowMs === undefined ? undefined : crisisRemainingMs(askSinceMs, nowMs, windowMs);
  const urgency =
    windowMs === undefined || remaining === undefined
      ? undefined
      : crisisUrgency(remaining, windowMs);
  const expired = remaining !== undefined && remaining <= 0;
  const locked = busy || expired || answered !== undefined;

  const ring =
    urgency === undefined
      ? "ring-2 ring-(--story-accent,var(--color-kumo-accent))"
      : urgency === "steady"
        ? "ring-2 ring-kumo-warning"
        : urgency === "urgent"
          ? "ring-2 ring-orange-500"
          : "ring-2 ring-red-500 crisis-critical";
  const barColor =
    urgency === "steady" ? "bg-yellow-500" : urgency === "urgent" ? "bg-orange-500" : "bg-red-500";
  const clockColor =
    urgency === "steady"
      ? "text-kumo-warning"
      : urgency === "urgent"
        ? "text-orange-500"
        : "text-red-500";

  return (
    <Surface className={`p-4 rounded-xl ${ring}`}>
      <div className="flex items-start gap-2">
        <Hint label="About this question" content={COPY.hoverFork} className="mt-1">
          <SignpostIcon size={16} weight="bold" />
        </Hint>
        {/* The scene text is the question; it is third-party prose, rendered as text. */}
        <p className="flex-1 font-serif text-[15px] leading-7 text-kumo-default whitespace-pre-line">
          {fork.scene}
        </p>
        {remaining !== undefined && windowMs !== undefined && (
          <span className={`shrink-0 font-mono text-sm font-bold tabular-nums ${clockColor}`}>
            {expired ? "0.0s" : `${(remaining / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>

      {remaining !== undefined && windowMs !== undefined && (
        <div className="mt-2 h-1.5 rounded-full bg-kumo-fill overflow-hidden">
          <span
            className={`block h-1.5 rounded-full ${barColor}`}
            style={{ width: `${Math.round((remaining / windowMs) * 100)}%` }}
          />
        </div>
      )}

      {(answered !== undefined || expired || windowMs !== undefined) && (
        <span className="mt-2 block">
          <Text size="xs" variant="secondary">
            {answered !== undefined
              ? `You chose: ${answered}. The story is taking it in…`
              : expired
                ? "Too late — fate is deciding for you."
                : "Timed: answer before the window closes, or fate decides."}
          </Text>
        </span>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {fork.options.map((option) => (
          <Button
            key={option.id}
            variant="secondary"
            size="sm"
            disabled={locked}
            onClick={() => onChoose(option)}
          >
            {option.label}
          </Button>
        ))}
        {fork.options.length === 0 && (
          <Button
            variant="secondary"
            size="sm"
            disabled={locked}
            onClick={() => onChoose({ id: "continue", label: "Continue" })}
          >
            Continue
          </Button>
        )}
      </div>
    </Surface>
  );
}
