/**
 * Tiny helpers for authoring the self-contained SVG scenes and sprites a
 * story serves (story contract v3): one 16:9 viewBox, no external
 * references, CSS/SMIL animation allowed. Scenes may read the CSS variable
 * `--build-progress` (0..1, set by the client on the stage) to animate
 * their own fill; sprites are transparent overlays on the same canvas.
 */

/** The stage canvas every scene and sprite is drawn on (16:9). */
export const CANVAS = { width: 640, height: 360 } as const;

/** Wraps a body (and optional stylesheet) in a full-bleed, self-contained SVG document. */
export function svgDocument(body: string, css = ""): string {
  const style = css === "" ? "" : `<style>${css}</style>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}" ` +
    `width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img">` +
    `${style}${body}</svg>`
  );
}

/** Joins SVG fragments, one per line (readability in the authored modules). */
export function fragments(...parts: string[]): string {
  return parts.join("\n");
}
