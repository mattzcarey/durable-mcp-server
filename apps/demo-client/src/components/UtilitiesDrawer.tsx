import { useEffect, useRef } from "react";
import { Button, Surface, Text } from "@cloudflare/kumo";
import { ArrowClockwiseIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import {
  formatPollSeconds,
  isActivePollChoice,
  lastPollAgoMs,
  POLL_RATE_CHOICES,
} from "../lib/poll-controls";
import { elapsedMs, isPollOverdue, nextPollCountdownMs, type TaskView } from "../lib/tasks";

/** The drawer's DOM id, for the gear button's aria-controls. */
export const UTILITIES_DRAWER_ID = "utilities-drawer";

/**
 * The utilities, behind the gear in the header: the poll-rate override, a
 * manual poll, the poll clocks, the task id, and the server line with its
 * disconnect. A right-hand drawer over the page; Escape, the backdrop, or
 * the X closes it. Presentation only — every value and handler is the
 * page's.
 */
export function UtilitiesDrawer({
  open,
  onClose,
  view,
  nowMs,
  pollOverrideMs,
  serverName,
  serverUrl,
  onSetPollRate,
  onPollNow,
  onDisconnect,
  seed,
  onSetSeed,
}: {
  open: boolean;
  onClose: () => void;
  view?: TaskView;
  nowMs: number;
  pollOverrideMs: number | undefined;
  serverName?: string;
  serverUrl?: string;
  onSetPollRate: (overrideMs: number | null) => void;
  onPollNow: () => void;
  onDisconnect: () => void;
  /** The story randomness seed for the NEXT start; blank = random. */
  seed?: number;
  onSetSeed: (seed: number | undefined) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);

  // Focus moves into the drawer when it opens; Escape closes it.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const countdown = view === undefined ? undefined : nextPollCountdownMs(view, nowMs);
  const overdue = view !== undefined && isPollOverdue(view, nowMs);
  const live = view !== undefined && !view.terminal;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-kumo-recessed/80"
        onClick={onClose}
        aria-hidden="true"
      />
      <Surface
        render={
          <aside
            ref={panelRef}
            id={UTILITIES_DRAWER_ID}
            role="dialog"
            aria-modal="true"
            aria-label="Utilities"
            tabIndex={-1}
          />
        }
        className="drawer-in fixed inset-y-0 right-0 z-50 w-80 max-w-full overflow-y-auto p-4 space-y-4 shadow-lg ring ring-kumo-line focus:outline-none"
      >
        <div className="flex items-center justify-between gap-2">
          <Text size="sm" bold>
            Utilities
          </Text>
          <Button
            variant="ghost"
            shape="square"
            size="sm"
            aria-label="Close utilities"
            icon={<XIcon size={14} />}
            onClick={onClose}
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-xs text-kumo-subtle mb-1">Story randomness seed</span>
            <input
              type="number"
              value={seed === undefined ? "" : String(seed)}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                onSetSeed(Number.isFinite(parsed) ? parsed : undefined);
              }}
              placeholder="random"
              className="px-3 py-1.5 text-sm rounded-lg border border-kumo-line bg-kumo-base text-kumo-default placeholder:text-kumo-inactive focus:outline-none focus:ring-1 focus:ring-kumo-accent w-32"
            />
            <span className="mt-1 block text-xs text-kumo-subtle">
              Same seed, same choices, same story.
            </span>
          </label>
          <div>
            <span className="block text-xs text-kumo-subtle mb-1">Poll rate</span>
            <div className="flex gap-1">
              {POLL_RATE_CHOICES.map((choice) => (
                <Button
                  key={choice.label}
                  variant={isActivePollChoice(choice, pollOverrideMs) ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => onSetPollRate(choice.overrideMs)}
                >
                  {choice.label}
                </Button>
              ))}
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowClockwiseIcon size={14} />}
            disabled={!live}
            onClick={onPollNow}
          >
            Poll now
          </Button>
        </div>

        {view !== undefined && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs text-kumo-subtle">
            <dt>task</dt>
            <dd className="truncate text-kumo-default">{view.taskId}</dd>
            <dt>status</dt>
            <dd className="text-kumo-default">{view.status}</dd>
            <dt>elapsed</dt>
            <dd className="text-kumo-default">{formatPollSeconds(elapsedMs(view, nowMs))}</dd>
            <dt>last poll</dt>
            <dd className="text-kumo-default">
              {`${formatPollSeconds(lastPollAgoMs(view.polledAtMs, nowMs))} ago`}
            </dd>
            <dt>next poll</dt>
            <dd className="text-kumo-default">
              {countdown === undefined || overdue ? "—" : formatPollSeconds(countdown)}
            </dd>
          </dl>
        )}

        <div className="flex items-center gap-2 pt-3 border-t border-kumo-line">
          <span className="min-w-0 truncate font-mono">
            <Text size="xs" variant="secondary">
              {serverName !== undefined && serverUrl !== undefined
                ? `${serverName} · ${serverUrl}`
                : "no server"}
            </Text>
          </span>
          <span className="ml-auto">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Disconnect server"
              icon={<TrashIcon size={14} />}
              onClick={onDisconnect}
            />
          </span>
        </div>
      </Surface>
    </>
  );
}
