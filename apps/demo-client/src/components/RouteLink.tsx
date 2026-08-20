import type { MouseEvent, ReactNode } from "react";

/**
 * An in-page link: a real `href` (so middle-click, cmd-click, and copy
 * link work) whose plain left click routes in place through the page's
 * `navigate` instead of reloading. The page owns the history; this only
 * tells it where the reader clicked.
 */
export function RouteLink({
  href,
  onNavigate,
  className,
  ariaLabel,
  children,
}: {
  href: string;
  onNavigate: (path: string) => void;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onNavigate(href);
  };
  return (
    <a href={href} onClick={onClick} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  );
}
