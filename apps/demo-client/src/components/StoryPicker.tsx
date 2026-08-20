import { useState } from "react";
import { Button, Surface, Text } from "@cloudflare/kumo";
import { InfoIcon, PlayIcon } from "@phosphor-icons/react";
import { COPY } from "../lib/copy";
import type { StoryManifest } from "../lib/story-resources";
import { Hint } from "./Hint";

const INPUT_CLASSES =
  "px-3 py-1.5 text-sm rounded-lg border border-kumo-line bg-kumo-base text-kumo-default placeholder:text-kumo-inactive focus:outline-none focus:ring-1 focus:ring-kumo-accent";

export type StartRequest = {
  storyId: string;
  seed?: number;
  defaultScene?: string;
};

/**
 * The start card: the ONE tool, `start()`, one line on what it does (the
 * wire detail sits behind the info icon), and the stories the server
 * publishes as `story://{id}/manifest` resources — one tile per manifest,
 * title + blurb + accent. Pick one, optionally seed it, and one button
 * starts the story.
 */
export function StoryPicker({
  stories,
  loading,
  error,
  starting,
  seed,
  onStart,
}: {
  stories: StoryManifest[];
  /** Manifests are still being read. */
  loading: boolean;
  error?: string;
  starting: boolean;
  /** The story randomness seed, set in the utilities drawer; blank = random. */
  seed?: number;
  onStart: (request: StartRequest) => void;
}) {
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [typedStory, setTypedStory] = useState("");

  const selectedId =
    picked !== undefined && stories.some((story) => story.id === picked)
      ? picked
      : stories.at(0)?.id;
  const selected = stories.find((story) => story.id === selectedId);
  const storyId = selected?.id ?? typedStory.trim();
  const canStart = storyId !== "" && !starting;

  const start = () => {
    if (!canStart) return;
    const request: StartRequest = { storyId };
    if (seed !== undefined) {
      request.seed = seed;
    }
    if (selected?.defaultScene) {
      request.defaultScene = selected.defaultScene;
    }
    onStart(request);
  };

  return (
    <Surface className="p-5 rounded-xl ring ring-kumo-line">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-lg font-semibold text-kumo-default">start()</span>
        <Hint label="About start()" content={COPY.startTooltip} className="self-center">
          <InfoIcon size={14} />
        </Hint>
        <Text size="xs" variant="secondary">
          the server&apos;s one tool
        </Text>
      </div>
      <p className="mt-2 text-sm text-kumo-subtle leading-6">{COPY.startCardBody}</p>

      <div className="mt-4">
        {loading && stories.length === 0 && (
          <Text size="xs" variant="secondary">
            reading the story shelf…
          </Text>
        )}
        {!loading && stories.length === 0 && (
          <div className="space-y-2">
            <Text size="xs" variant="secondary">
              This server lists no story manifests (story://*/manifest). Type a story id to try
              anyway.
            </Text>
            <input
              type="text"
              value={typedStory}
              placeholder="story id"
              onChange={(event) => setTypedStory(event.target.value)}
              className={`${INPUT_CLASSES} w-full`}
            />
          </div>
        )}
        {stories.length > 0 && (
          <div
            className="grid gap-2 sm:grid-cols-2 items-start"
            role="radiogroup"
            aria-label="Story"
          >
            {stories.map((story) => {
              const active = story.id === selectedId;
              return (
                <button
                  key={story.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPicked(story.id)}
                  className={`self-start text-left rounded-lg p-3 ring transition-shadow ${
                    active
                      ? "ring-2 ring-(--story-accent,var(--color-kumo-accent)) bg-kumo-tint"
                      : "ring-kumo-line hover:ring-kumo-focus/40"
                  }`}
                  style={
                    story.accent !== undefined
                      ? { ["--story-accent" as string]: story.accent }
                      : undefined
                  }
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full shrink-0 bg-(--story-accent,var(--color-kumo-accent))"
                      aria-hidden="true"
                    />
                    <span className="text-base font-semibold text-kumo-default">{story.title}</span>
                  </span>
                  {story.blurb !== "" && (
                    <span className="mt-1 block text-xs leading-5 text-kumo-subtle">
                      {story.blurb}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-4">
        <Button
          variant="primary"
          size="sm"
          icon={<PlayIcon size={14} weight="fill" />}
          disabled={!canStart}
          onClick={start}
        >
          {starting ? "Starting…" : "Start the story"}
        </Button>
      </div>
      {error !== undefined && (
        <span className="mt-2 block text-red-500">
          <Text size="xs">{error}</Text>
        </span>
      )}
    </Surface>
  );
}
