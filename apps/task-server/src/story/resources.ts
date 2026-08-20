/**
 * Story visuals and metadata as MCP resources (story contract v3). The
 * client is story-agnostic: it builds its picker from every
 * `story://{id}/manifest` in resources/list and reads every scene or sprite
 * URI the status meta names. Everything here is served by the SDK's
 * `registerResource` — static URIs, one per manifest, scene, and sprite —
 * so resources/list and resources/read work over the wire for every URI.
 */

import type { McpServer } from "durable-mcp-server";
import type { Story } from "./format";
import { manifestUri, sceneUri, spriteUri } from "./uris";

/** The manifest body: what the picker card and the phase checklist need. */
export interface StoryManifest {
  id: string;
  title: string;
  blurb: string;
  phases: { id: string; label: string }[];
  defaultScene: string;
  accent?: string;
}

export function storyManifest(story: Story): StoryManifest {
  const manifest: StoryManifest = {
    id: story.id,
    title: story.title,
    blurb: story.blurb,
    phases: story.phases.map((phase) => ({ id: phase.id, label: phase.label })),
    defaultScene: sceneUri(story.id, story.defaultScene),
  };
  if (story.accent !== undefined) {
    manifest.accent = story.accent;
  }
  return manifest;
}

/** Every resource URI a story publishes: its manifest, scenes, and sprites. */
export function storyResourceUris(story: Story): string[] {
  return [
    manifestUri(story.id),
    ...Object.keys(story.scenes).map((sceneId) => sceneUri(story.id, sceneId)),
    ...Object.keys(story.sprites).map((spriteId) => spriteUri(story.id, spriteId)),
  ];
}

const SVG_MIME = "image/svg+xml";

/** Registers every story's manifest, scenes, and sprites as static resources. */
export function registerStoryResources(server: McpServer, stories: readonly Story[]): void {
  for (const story of stories) {
    const manifest = manifestUri(story.id);
    server.registerResource(
      `${story.id}/manifest`,
      manifest,
      {
        title: story.title,
        description: `Story manifest: ${story.blurb}`,
        mimeType: "application/json",
      },
      () => ({
        contents: [
          {
            uri: manifest,
            mimeType: "application/json",
            text: JSON.stringify(storyManifest(story)),
          },
        ],
      }),
    );
    for (const [sceneId, svg] of Object.entries(story.scenes)) {
      const uri = sceneUri(story.id, sceneId);
      server.registerResource(
        `${story.id}/scenes/${sceneId}`,
        uri,
        { title: `${story.title} — scene: ${sceneId}`, mimeType: SVG_MIME },
        () => ({ contents: [{ uri, mimeType: SVG_MIME, text: svg }] }),
      );
    }
    for (const [spriteId, svg] of Object.entries(story.sprites)) {
      const uri = spriteUri(story.id, spriteId);
      server.registerResource(
        `${story.id}/sprites/${spriteId}`,
        uri,
        { title: `${story.title} — sprite: ${spriteId}`, mimeType: SVG_MIME },
        () => ({ contents: [{ uri, mimeType: SVG_MIME, text: svg }] }),
      );
    }
  }
}
