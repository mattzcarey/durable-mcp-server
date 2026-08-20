/**
 * Inlines an already-sanitized SVG body (see `sanitizeSvg`) so its CSS and
 * SMIL animation run natively and it inherits the page's `currentColor` and
 * CSS variables (`--build-progress`). Never hand this raw resource text.
 */
export function InlineSvg({
  svg,
  className,
  label,
}: {
  svg: string;
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={className}
      role="img"
      aria-label={label}
      // Sanitized upstream: scripts, handlers, and external refs are gone.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
