/**
 * Pure handling of the story resources a server publishes (story contract
 * v3): `story://{id}/manifest` (application/json), `story://{id}/scenes/*`
 * and `story://{id}/sprites/*` (image/svg+xml). The client knows no story —
 * the picker, the phase checklist, and every piece of art come from here.
 * Resource reads are untrusted third-party content: manifests are parsed
 * with a schema and SVG markup is sanitized before it is ever inlined.
 */
import { z } from "zod";

export type StoryPhase = { id: string; label: string };

export type StoryManifest = {
  id: string;
  title: string;
  blurb: string;
  phases: StoryPhase[];
  defaultScene: string;
  /** A CSS color for the story's accent, when the manifest declares a safe one. */
  accent?: string;
};

const MANIFEST_URI_RE = /^story:\/\/([^/]+)\/manifest$/;

/** The story id a manifest URI names, or undefined for any other URI. */
export function storyIdFromManifestUri(uri: string): string | undefined {
  return MANIFEST_URI_RE.exec(uri)?.[1];
}

export type ManifestResource = { serverId: string; uri: string; storyId: string };

/**
 * Every manifest among a resources/list (one per story), deduped by URI and
 * sorted by story id so the picker order is stable across reconnects.
 */
export function findManifestResources(
  resources: readonly { uri: string; serverId: string }[],
): ManifestResource[] {
  const seen = new Set<string>();
  const sorted: ManifestResource[] = [];
  for (const resource of resources) {
    const storyId = storyIdFromManifestUri(resource.uri);
    if (storyId === undefined || seen.has(resource.uri)) {
      continue;
    }
    seen.add(resource.uri);
    const manifest = { serverId: resource.serverId, uri: resource.uri, storyId };
    // Ordered insertion (a handful of stories): stable, and no in-place sort.
    const at = sorted.findIndex((other) => storyId.localeCompare(other.storyId) < 0);
    sorted.splice(at === -1 ? sorted.length : at, 0, manifest);
  }
  return sorted;
}

/** Only plain color forms pass: no url(), no var(), nothing that can escape a style. */
const SAFE_COLOR_RE =
  /^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,24}|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([0-9.,%\s/deg-]+\))$/;

const ManifestSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string().min(1),
  blurb: z.string().optional(),
  phases: z.array(z.looseObject({ id: z.string().min(1), label: z.string().min(1) })).optional(),
  defaultScene: z.string().min(1).optional(),
  accent: z.string().optional(),
});

/**
 * Parses a manifest resource body (JSON text or an already-parsed value).
 * Missing optional fields degrade (no blurb, no phases, no default scene);
 * an unsafe accent is dropped, never passed through to a style.
 */
export function parseManifest(body: unknown): StoryManifest | undefined {
  let value: unknown = body;
  if (typeof body === "string") {
    try {
      value = JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  const parsed = ManifestSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  const { id, title, blurb, phases, defaultScene, accent } = parsed.data;
  const manifest: StoryManifest = {
    id,
    title,
    blurb: blurb ?? "",
    phases: (phases ?? []).map((phase) => ({ id: phase.id, label: phase.label })),
    defaultScene: defaultScene ?? "",
  };
  if (accent !== undefined && SAFE_COLOR_RE.test(accent.trim())) {
    manifest.accent = accent.trim();
  }
  return manifest;
}

/* Plain objects (unknown keys stripped), so the union narrows on `text` / `blob`. */
const ContentsSchema = z.looseObject({
  contents: z.array(
    z.union([
      z.object({ uri: z.string(), text: z.string() }),
      z.object({ uri: z.string(), blob: z.string() }),
    ]),
  ),
});

function decodeBase64(blob: string): string | undefined {
  try {
    const binary = atob(blob);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * The text of a `resources/read` result: the first content's `text`, or its
 * base64 `blob` decoded as UTF-8. Undefined for anything else.
 */
export function resourceText(result: unknown): string | undefined {
  const parsed = ContentsSchema.safeParse(result);
  const first = parsed.success ? parsed.data.contents.at(0) : undefined;
  if (first === undefined) {
    return undefined;
  }
  if ("text" in first) {
    return first.text;
  }
  return decodeBase64(first.blob);
}

/* SVG sanitizing */

const SVG_OPEN_RE = /<svg[\s>]/i;
const SCRIPT_RE = /<script\b[\s\S]*?<\/script\s*>/gi;
const DANGEROUS_ELEMENT_RE =
  /<(script|foreignObject|iframe|embed|object|link|meta|base|form|input|textarea|button|audio|video)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>|>)/gi;
const EVENT_ATTR_RE = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const EXTERNAL_REF_ATTR_RE =
  /\s+(?:href|xlink:href|src|data)\s*=\s*(?:"(?:https?:|\/\/|javascript:|data:text\/html)[^"]*"|'(?:https?:|\/\/|javascript:|data:text\/html)[^']*'|(?:https?:|\/\/|javascript:)[^\s>]+)/gi;
const STYLE_URL_RE = /url\(\s*['"]?\s*(?:https?:|\/\/|javascript:)[^)]*\)/gi;
const STYLE_IMPORT_RE = /@import[^;]*;?/gi;
/** Any attribute whose value is a javascript: URL, whatever the attribute (SMIL `to`, `values`, …). */
const SCRIPT_URL_ATTR_RE =
  /\s+[a-zA-Z_:][\w:.-]*\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi;
/** SMIL animation elements retargeting a link or an event handler. */
const ANIMATED_HANDLER_RE =
  /<(?:set|animate|animateTransform|animateMotion)\b[^>]*\battributeName\s*=\s*["']?\s*(?:on[a-z]+|href|xlink:href)\b[^>]*>/gi;

/**
 * Strips scripts, event handlers, external references, and embedded
 * documents from an SVG body so it can be inlined. Regex-based on purpose —
 * it runs identically in the browser and in node tests — and conservative:
 * when the body holds no `<svg` root at all the result is undefined.
 */
export function sanitizeSvg(markup: string): string | undefined {
  if (!SVG_OPEN_RE.test(markup)) {
    return undefined;
  }
  let clean = markup.replace(SCRIPT_RE, "");
  clean = clean.replace(DANGEROUS_ELEMENT_RE, "");
  clean = clean.replace(ANIMATED_HANDLER_RE, "");
  clean = clean.replace(EVENT_ATTR_RE, "");
  clean = clean.replace(EXTERNAL_REF_ATTR_RE, "");
  clean = clean.replace(SCRIPT_URL_ATTR_RE, "");
  clean = clean.replace(STYLE_URL_RE, "none");
  clean = clean.replace(STYLE_IMPORT_RE, "");
  const start = clean.search(SVG_OPEN_RE);
  return start > 0 ? clean.slice(start) : clean;
}
