/**
 * The story resource URI scheme (story contract v3). The client is
 * story-agnostic: it finds stories by listing `story://{id}/manifest`
 * resources, and every scene or sprite the status meta names is a URI it
 * reads back through resources/read.
 */

export function manifestUri(storyId: string): string {
  return `story://${storyId}/manifest`;
}

export function sceneUri(storyId: string, sceneId: string): string {
  return `story://${storyId}/scenes/${sceneId}`;
}

export function spriteUri(storyId: string, spriteId: string): string {
  return `story://${storyId}/sprites/${spriteId}`;
}
