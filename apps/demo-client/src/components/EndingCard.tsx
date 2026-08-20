import { Badge, Button, Surface, Text } from "@cloudflare/kumo";
import { ArrowCounterClockwiseIcon, FlagCheckeredIcon } from "@phosphor-icons/react";
import type { EndingCardModel } from "../lib/playthrough";
import { InlineSvg } from "./InlineSvg";

const TONE = {
  triumph: { ring: "ring-2 ring-emerald-500", icon: "text-emerald-500", title: "Triumph" },
  disaster: { ring: "ring-2 ring-red-500", icon: "text-red-500", title: "Disaster" },
  abandoned: { ring: "ring ring-kumo-line", icon: "text-kumo-subtle", title: "Abandoned" },
  neutral: { ring: "ring-2 ring-kumo-accent", icon: "text-kumo-accent", title: "The end" },
} as const;

/**
 * The ending card: id-toned, with the final scene's art when the last meta
 * named one, the ending prose, and Restart — the same story again as a NEW
 * task (this playthrough stays as it is). The full log stays above it.
 */
export function EndingCard({
  ending,
  art,
  restarting,
  onRestart,
}: {
  ending: EndingCardModel;
  /** Sanitized SVG for `ending.scene`, when loaded. */
  art?: string | null;
  restarting: boolean;
  onRestart: () => void;
}) {
  const tone = TONE[ending.tone];
  return (
    <Surface className={`p-4 rounded-xl ${tone.ring}`}>
      <div className="flex items-center gap-2">
        <FlagCheckeredIcon size={18} weight="bold" className={tone.icon} />
        <Text size="base" bold>
          {tone.title}
        </Text>
        <Badge variant="secondary">{ending.endingId}</Badge>
        <div className="ml-auto">
          <Button
            variant="primary"
            size="sm"
            disabled={restarting}
            icon={<ArrowCounterClockwiseIcon size={14} />}
            onClick={onRestart}
          >
            {restarting ? "Starting…" : "Restart"}
          </Button>
        </div>
      </div>
      {art && (
        // `.stage-layer` is absolutely positioned (inset 0), so the frame
        // must be the positioned ancestor or the art escapes the card.
        <div className="relative mt-3 overflow-hidden rounded-lg ring ring-kumo-line bg-kumo-recessed aspect-video max-h-56 w-full">
          <InlineSvg svg={art} className="stage-layer pointer-events-none" label="Ending scene" />
        </div>
      )}
      <p className="mt-3 font-serif text-[15px] leading-7 text-kumo-default whitespace-pre-line">
        {ending.text}
      </p>
    </Surface>
  );
}
