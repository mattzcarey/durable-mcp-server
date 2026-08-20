/**
 * The story registry. Content modules are plain data files that register
 * themselves at module load (see src/stories):
 *
 * ```ts
 * import { registerStory } from "../../story";
 * import type { StoryInput } from "../../story/format";
 *
 * const story: StoryInput = { id: "high-desert", title: "...", blurb: "...",
 *   defaultName: "...", phases: [...], resources: {...}, start: "...",
 *   defaultScene: "...", scenes: {...}, sprites: {...}, nodes: {...} };
 * registerStory(story);
 * ```
 *
 * Registration parses the data against the story schema and validates the
 * graph (./validate), so a broken story fails at load or test time, never
 * mid-playthrough. The `start` task plays the story its input names; the
 * server serves every registered story's manifest, scenes, and sprites as
 * MCP resources (./resources).
 */

import { storySchema, type Story } from "./format";
import { assertValidStory } from "./validate";

const stories = new Map<string, Story>();

/** Parses, validates, and registers a story; returns the parsed story. */
export function registerStory(input: unknown): Story {
  const story = storySchema.parse(input);
  assertValidStory(story);
  if (stories.has(story.id)) {
    throw new Error(`story "${story.id}" is already registered`);
  }
  stories.set(story.id, story);
  return story;
}

export function getStory(id: string): Story | undefined {
  return stories.get(id);
}

/** Every registered story, in registration order. */
export function listStories(): Story[] {
  return [...stories.values()];
}

/** The registered story ids, in registration order. */
export function storyIds(): string[] {
  return [...stories.keys()];
}
