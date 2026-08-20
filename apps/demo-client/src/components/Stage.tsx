import { type CSSProperties, useState } from "react";
import { InlineSvg } from "./InlineSvg";

/** A piece of art the stage shows: loaded svg, failed (null), or still loading. */
export type StageArt = { uri: string; svg: string | null | undefined };

export type StageSprite = StageArt & { id: string; persist: boolean };

type ShownScene = { uri: string; svg: string };

/**
 * The centerpiece: the story's current scene inlined (server-served SVG,
 * sanitized), crossfading when the scene changes, with sprites overlaid on
 * top (non-persistent ones fade out on a CSS timer matched to
 * SPRITE_TTL_MS; pinned ones stay until the scene changes). The stage sets
 * `--build-progress` so scenes can animate their own fill, and
 * `--story-accent` from the manifest. Art that failed to load (or has not
 * arrived yet) never breaks play: the last scene that did load stays up,
 * and with nothing ever shown the stage goes dark with the title on it.
 */
export function Stage({
  title,
  accent,
  scene,
  sprites,
  nudges,
  build,
  phaseLabel,
  running,
}: {
  title: string;
  accent?: string;
  scene?: StageArt;
  sprites: StageSprite[];
  /** Sprite firings so far: each increment shakes the stage once. */
  nudges: number;
  build: number;
  phaseLabel?: string;
  running: boolean;
}) {
  const style = {
    "--build-progress": build.toFixed(3),
    "--story-accent": accent ?? "var(--color-kumo-accent, #f6821f)",
  } as CSSProperties;

  // The scene memory: the stage swaps only when the incoming scene's art is
  // in hand, keeping the outgoing one underneath for the crossfade — and
  // keeps the last good scene when the new one fails or is still loading.
  // "Information from previous renders": a render-phase state update, no
  // effect involved, so the swap and the first paint of the new art agree.
  const incoming: ShownScene | undefined =
    scene !== undefined && typeof scene.svg === "string"
      ? { uri: scene.uri, svg: scene.svg }
      : undefined;
  const [shown, setShown] = useState<{ current?: ShownScene; previous?: ShownScene }>({});
  if (incoming !== undefined && shown.current?.uri !== incoming.uri) {
    setShown(
      shown.current === undefined
        ? { current: incoming }
        : { current: incoming, previous: shown.current },
    );
  }
  const current =
    incoming !== undefined && shown.current?.uri !== incoming.uri ? incoming : shown.current;

  // Every new sprite nudges the stage: alternating animation names restart
  // the keyframes without remounting the scene (which would reset its SMIL).
  // Driven by the reducer's firing count, so a sprite fading out (or a
  // scene change clearing them) never shakes anything.
  const nudge = nudges === 0 ? "" : nudges % 2 === 0 ? " stage-nudge-even" : " stage-nudge-odd";

  return (
    <div
      className={`stage relative w-full overflow-hidden rounded-xl ring ring-kumo-line bg-kumo-recessed aspect-video select-none${nudge}`}
      style={style}
      aria-label={`Scene: ${title}`}
    >
      {/* Art is third-party markup: inert to the pointer, so nothing in it
          (a link, a hit target) can be clicked. */}
      {shown.previous !== undefined && shown.previous.uri !== current?.uri && (
        <InlineSvg
          key={`out:${shown.previous.uri}`}
          svg={shown.previous.svg}
          className="stage-layer scene-out pointer-events-none"
        />
      )}
      {current !== undefined ? (
        <InlineSvg
          key={`in:${current.uri}`}
          svg={current.svg}
          className="stage-layer scene-in pointer-events-none"
          label={phaseLabel === undefined ? title : `${title} — ${phaseLabel}`}
        />
      ) : (
        <div className="stage-layer stage-dark flex flex-col items-center justify-center gap-1 text-center px-6">
          <span className="text-lg font-semibold text-kumo-default">{title}</span>
          <span className="font-mono text-xs text-kumo-subtle">
            {scene === undefined
              ? "the stage is dark"
              : scene.svg === null
                ? "the scene art could not be read — the story goes on"
                : "setting the stage…"}
          </span>
        </div>
      )}
      {/* Sprites: keyed per firing so the same art can land twice. */}
      {sprites.map((sprite) =>
        sprite.svg ? (
          <InlineSvg
            key={sprite.id}
            svg={sprite.svg}
            className={`stage-layer stage-sprite pointer-events-none ${
              sprite.persist ? "sprite-pin" : "sprite-fade"
            }`}
          />
        ) : null,
      )}

      {/* Captions: phase and build, small and out of the way. */}
      {phaseLabel !== undefined && (
        <span className="absolute left-3 bottom-2 font-mono text-[11px] uppercase tracking-wider text-kumo-subtle bg-kumo-base/70 rounded px-1.5 py-0.5">
          {phaseLabel}
        </span>
      )}
      {build > 0 && (
        <span className="absolute right-3 bottom-2 font-mono text-[11px] tabular-nums text-kumo-subtle bg-kumo-base/70 rounded px-1.5 py-0.5">
          {`completion ${Math.round(build * 100)}%`}
        </span>
      )}
      {running && (
        <span
          className="absolute right-3 top-3 size-2 rounded-full bg-green-500 animate-pulse"
          aria-label="The task is running"
        />
      )}
    </div>
  );
}
