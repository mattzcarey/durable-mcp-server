import { type ReactNode, useEffect, useRef, useState } from "react";
import { Surface, Text } from "@cloudflare/kumo";
import { BookOpenTextIcon } from "@phosphor-icons/react";
import { COPY } from "../lib/copy";
import type { LogEntry } from "../lib/playthrough";
import { Hint } from "./Hint";

/* Kumo tokens only: they follow the page's data-mode toggle, where a
   `dark:` variant would follow the OS preference instead. */
const TONE_TEXT = {
  triumph: "text-kumo-success",
  disaster: "text-kumo-danger",
  abandoned: "text-kumo-subtle",
  neutral: "text-kumo-accent",
} as const;

/** How close to the top counts as "pinned" to the newest line. */
const PIN_THRESHOLD_PX = 32;

function Entry({ entry, phaseLabel }: { entry: LogEntry; phaseLabel?: string }) {
  switch (entry.kind) {
    case "beat":
      return (
        <p className="log-enter">
          {entry.phase !== undefined && (
            <span className="mr-2 align-middle font-mono text-[10px] uppercase tracking-wider text-kumo-subtle">
              {phaseLabel ?? entry.phase}
            </span>
          )}
          {/* statusMessage prose is third-party text: rendered as text, never markup. */}
          <span>{entry.text}</span>
        </p>
      );
    case "fork":
      // While the ask is open the live choice panel renders in this slot
      // (see AdventureLog); once it closes, a compact record of the question.
      return (
        <p className="log-enter font-mono text-xs text-kumo-subtle">
          <span className="mr-2 text-[10px] uppercase tracking-wider">asked</span>
          <span className="font-serif text-[15px] text-kumo-default">{entry.scene}</span>
        </p>
      );
    case "choice":
      return (
        <p className="log-enter italic text-(--story-accent,var(--color-kumo-accent))">
          {`you chose: ${entry.label}`}
        </p>
      );
    case "fate":
      return (
        <p className="log-enter italic text-kumo-warning">
          fate decided — the story moved on without your answer.
        </p>
      );
    case "action":
      return (
        <p className="log-enter font-mono text-xs text-(--story-accent,var(--color-kumo-accent))">
          {`you · ${entry.label}`}
        </p>
      );
    case "note":
      return <p className="log-enter font-mono text-xs text-kumo-subtle">{entry.text}</p>;
    case "ending":
      return (
        <p className={`log-enter font-semibold ${TONE_TEXT[entry.tone]}`}>
          <span className="mr-2 font-mono text-[10px] uppercase tracking-wider opacity-80">
            {`ending: ${entry.endingId}`}
          </span>
          <span>{entry.text}</span>
        </p>
      );
  }
}

/**
 * The adventure log — the main narrative surface. Beats land server-paced
 * (the agent folds them into the task's playthrough; this renders that log
 * as-is), NEWEST FIRST: the latest line sits at the top, and the view stays
 * pinned there unless the reader has scrolled down into the past.
 */
export function AdventureLog({
  entries,
  phaseLabels,
  waiting,
  openFork,
}: {
  entries: LogEntry[];
  phaseLabels: Record<string, string>;
  /** The task is live but no beat has landed yet. */
  waiting: boolean;
  /**
   * The open ask, rendered IN the log where it happened (in place of its
   * fork entry, which is the newest line while the story waits): the live
   * ChoicePanel plus the key it answers.
   */
  openFork?: { key: string; panel: ReactNode };
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  // A line landing is the signal to stay at the top (the newest line) while
  // pinned. The agent's state arrives as fresh objects on every push, so the
  // array's identity says nothing; the newest entry's id does (ids only ever
  // grow, and a new ask arrives as a new fork entry).
  const newestId = entries.at(-1)?.id;
  useEffect(() => {
    const element = scrollRef.current;
    if (element && pinned && newestId !== undefined) {
      element.scrollTop = 0;
    }
  }, [newestId, pinned]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    setPinned(element.scrollTop < PIN_THRESHOLD_PX);
  };

  // Render order only: the fold keeps arrival order (seq logic, tests).
  const newestFirst = entries.toReversed();

  return (
    <Surface className="rounded-xl ring ring-kumo-line">
      <div className="flex items-center gap-2 px-4 pt-3">
        <Hint label="About the log" content={COPY.hoverLog}>
          <BookOpenTextIcon size={16} weight="bold" />
        </Hint>
        <Text size="sm" bold>
          Story
        </Text>
        {!pinned && (
          <button
            type="button"
            className="ml-auto font-mono text-xs text-kumo-accent hover:underline"
            onClick={() => setPinned(true)}
          >
            back to the latest
          </button>
        )}
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="max-h-[52vh] min-h-40 overflow-y-auto px-4 pb-4 pt-2 font-serif text-[15px] leading-7 text-kumo-default space-y-1"
        aria-live="polite"
      >
        {entries.length === 0 && (
          <p className="font-mono text-xs text-kumo-subtle">
            {waiting ? "the story is gathering itself…" : "nothing yet"}
          </p>
        )}
        {newestFirst.map((entry) =>
          entry.kind === "fork" && openFork !== undefined && entry.key === openFork.key ? (
            <div key={entry.id} className="log-enter py-1">
              {openFork.panel}
            </div>
          ) : (
            <Entry
              key={entry.id}
              entry={entry}
              phaseLabel={
                entry.kind === "beat" && entry.phase ? phaseLabels[entry.phase] : undefined
              }
            />
          ),
        )}
      </div>
    </Surface>
  );
}
