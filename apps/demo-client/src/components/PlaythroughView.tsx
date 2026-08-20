import { useMemo } from "react";
import { Text } from "@cloudflare/kumo";
import { isRunning, liveSprites, type LogEntry, type Playthrough } from "../lib/playthrough";
import type { StoryManifest } from "../lib/story-resources";
import type { ActionOption, ForkOption } from "../lib/story-wire";
import { ActionBar } from "./ActionBar";
import { AdventureLog } from "./AdventureLog";
import { CancelTask } from "./CancelTask";
import { ChoicePanel } from "./ChoicePanel";
import { EndingCard } from "./EndingCard";
import { PhaseChecklist } from "./PhaseChecklist";
import { Stage, type StageArt, type StageSprite } from "./Stage";

/**
 * One task's playthrough, rendered from the agent's materialized record
 * as-is: the stage, the log (with the open ask in its slot), the ambient
 * bar, cancel, the phase checklist, the ending card. Presentation only —
 * every value is the playthrough's, every handler the page's; the only
 * local computation is presentational (sprite expiry, art lookup, merging
 * the page's own notes into the log).
 */
export function PlaythroughView({
  playthrough,
  nowMs,
  manifest,
  art,
  localNotes,
  pendingChoice,
  answering,
  acting,
  cancelling,
  confirmingCancel,
  restarting,
  onAnswer,
  onPress,
  onConfirmCancel,
  onAbandon,
  onKeepGoing,
  onRestart,
}: {
  playthrough: Playthrough;
  nowMs: number;
  /** The story's manifest, when the shelf has it (titles, phases, accent). */
  manifest?: StoryManifest;
  /** Sanitized scene / sprite SVG by resource URI (null = unreadable). */
  art: Record<string, string | null>;
  /** Page-local lines for this task (art that failed to load, …), merged into the log. */
  localNotes: readonly LogEntry[];
  /** The label chosen locally while the answer is in flight, before the agent's state lands. */
  pendingChoice?: { key: string; label: string };
  answering: boolean;
  acting: boolean;
  cancelling: boolean;
  confirmingCancel: boolean;
  restarting: boolean;
  onAnswer: (option: ForkOption) => void;
  onPress: (option: ActionOption) => void;
  onConfirmCancel: () => void;
  onAbandon: () => void;
  onKeepGoing: () => void;
  onRestart: () => void;
}) {
  const { visual, ending, openFork, view } = playthrough;
  const running = isRunning(playthrough);
  // Stable across the 100ms render ticks (a state push hands the page fresh
  // objects, so the log keys its pin-to-top on the newest entry's id, not
  // on this array's identity).
  const entries = useMemo(
    () => mergeLog(playthrough.log, localNotes),
    [playthrough.log, localNotes],
  );
  const artFor = (uri: string | undefined): StageArt | undefined =>
    uri === undefined ? undefined : { uri, svg: art[uri] };
  const sprites: StageSprite[] = liveSprites(visual, nowMs).map((sprite) => ({
    id: sprite.id,
    uri: sprite.uri,
    persist: sprite.persist,
    svg: art[sprite.uri],
  }));
  const phaseLabels = Object.fromEntries(
    (manifest?.phases ?? []).map((phase) => [phase.id, phase.label]),
  );
  const title = manifest?.title ?? playthrough.storyTitle ?? playthrough.storyId;
  const answeredLabel =
    openFork === undefined
      ? undefined
      : (playthrough.answeredForks[openFork.key] ??
        (pendingChoice?.key === openFork.key ? pendingChoice.label : undefined));

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-4 min-w-0">
        <Stage
          title={title}
          accent={manifest?.accent}
          scene={artFor(visual.scene)}
          sprites={sprites}
          nudges={visual.spriteFirings}
          build={visual.build}
          phaseLabel={
            visual.phase === undefined ? undefined : (phaseLabels[visual.phase] ?? visual.phase)
          }
          running={running}
        />
        {running && visual.actions !== undefined && (
          <ActionBar
            actions={visual.actions}
            spent={playthrough.spentActionKey === visual.actions.key}
            disabled={openFork !== undefined || playthrough.abandonRequested}
            busy={acting}
            onPress={onPress}
          />
        )}
        {/* Forks only: the choice panel renders INSIDE the log, in the slot
            of its fork entry (the newest line while the story waits), and
            unmounts the moment the observed status leaves input_required —
            a server-side timeout closes it without the player acting. */}
        <AdventureLog
          entries={entries}
          phaseLabels={phaseLabels}
          waiting={view === undefined || running}
          openFork={
            running && openFork !== undefined
              ? {
                  key: openFork.key,
                  panel: (
                    <ChoicePanel
                      fork={openFork}
                      askSinceMs={openFork.sinceMs}
                      nowMs={nowMs}
                      answered={answeredLabel}
                      busy={answering || playthrough.abandonRequested}
                      onChoose={onAnswer}
                    />
                  ),
                }
              : undefined
          }
        />
        {ending !== undefined && (
          <EndingCard
            ending={ending}
            art={ending.scene === undefined ? undefined : art[ending.scene]}
            restarting={restarting}
            onRestart={onRestart}
          />
        )}
      </div>

      <div className="space-y-4 min-w-0">
        <PhaseChecklist
          phases={manifest?.phases ?? []}
          seen={visual.phasesSeen}
          current={visual.phase}
          build={visual.build}
          ended={ending !== undefined}
        />
        {running && (
          <CancelTask
            confirming={confirmingCancel}
            cancelling={cancelling}
            requested={playthrough.abandonRequested}
            onConfirm={onConfirmCancel}
            onAbandon={onAbandon}
            onKeep={onKeepGoing}
          />
        )}
        {view === undefined && (
          <Text size="xs" variant="secondary">
            waiting for the first poll of the task…
          </Text>
        )}
      </div>
    </div>
  );
}

/**
 * The agent's log with the page's own lines merged in by time (stable, so
 * equal instants keep the agent's order first). Ids never collide: the
 * agent counts up from 1, the page counts down from -1.
 */
export function mergeLog(entries: readonly LogEntry[], notes: readonly LogEntry[]): LogEntry[] {
  if (notes.length === 0) {
    return [...entries];
  }
  const merged: LogEntry[] = [];
  let at = 0;
  let noteAt = 0;
  while (at < entries.length || noteAt < notes.length) {
    const entry = entries[at];
    const local = notes[noteAt];
    if (entry !== undefined && (local === undefined || entry.atMs <= local.atMs)) {
      merged.push(entry);
      at += 1;
    } else if (local !== undefined) {
      merged.push(local);
      noteAt += 1;
    }
  }
  return merged;
}
