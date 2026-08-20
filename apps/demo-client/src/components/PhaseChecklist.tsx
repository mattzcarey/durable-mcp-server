import { Surface, Text } from "@cloudflare/kumo";
import { ListChecksIcon } from "@phosphor-icons/react";
import type { StoryPhase } from "../lib/story-resources";

/**
 * The manifest's phase checklist, lit from the phases seen in the status
 * meta (first-sighting order), the current one pulsing, plus the build
 * meter. Story-agnostic: phases and labels come from the manifest; a phase
 * the meta names that the manifest does not list still shows, by id.
 */
export function PhaseChecklist({
  phases,
  seen,
  current,
  build,
  ended,
}: {
  phases: StoryPhase[];
  seen: string[];
  current?: string;
  build: number;
  ended: boolean;
}) {
  const listed = new Set(phases.map((phase) => phase.id));
  const extras = seen.filter((id) => !listed.has(id)).map((id) => ({ id, label: id }));
  const rows = [...phases, ...extras];
  const percent = Math.round(build * 100);

  return (
    <Surface className="p-4 rounded-xl ring ring-kumo-line">
      <div className="flex items-center gap-2">
        <ListChecksIcon size={16} weight="bold" className="text-kumo-subtle" />
        <Text size="sm" bold>
          Phases
        </Text>
      </div>
      <ol className="mt-3 space-y-1.5">
        {rows.map((phase) => {
          const lit = seen.includes(phase.id);
          const active = !ended && phase.id === current;
          return (
            <li key={phase.id} className="flex items-center gap-2">
              <span
                className={`size-2.5 rounded-full shrink-0 ${
                  lit
                    ? "bg-(--story-accent,var(--color-kumo-accent))"
                    : "ring ring-inset ring-kumo-line"
                } ${active ? "animate-pulse" : ""}`}
              />
              <span
                className={`text-sm ${
                  active
                    ? "font-semibold text-kumo-default"
                    : lit
                      ? "text-kumo-default"
                      : "text-kumo-subtle"
                }`}
              >
                {phase.label}
              </span>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li>
            <Text size="xs" variant="secondary">
              no phases declared
            </Text>
          </li>
        )}
      </ol>
      <div className="mt-4 flex items-center justify-between">
        <Text size="xs" variant="secondary">
          build
        </Text>
        <span className="font-mono text-xs tabular-nums text-kumo-subtle">{`${percent}%`}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-kumo-fill overflow-hidden">
        <span
          className="block h-1.5 rounded-full bg-(--story-accent,var(--color-kumo-accent)) transition-[width] duration-700"
          style={{ width: `${percent}%` }}
        />
      </div>
    </Surface>
  );
}
