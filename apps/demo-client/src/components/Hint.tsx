import { cn, Tooltip } from "@cloudflare/kumo";
import { cloneElement, type ReactElement, type ReactNode, useId } from "react";

const ICON_TRIGGER =
  "inline-flex shrink-0 rounded leading-none text-kumo-subtle cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand";

type Describable = { "aria-describedby"?: string };

type HintProps = { content: string; children: ReactNode } & (
  | {
      /** The trigger: a button or other focusable element the tooltip attaches to. */
      render: ReactElement<Describable>;
      label?: undefined;
      className?: undefined;
    }
  | {
      render?: undefined;
      /** Accessible name of the icon-button trigger (the tooltip is its description). */
      label: string;
      className?: string;
    }
);

/**
 * A tooltip naming the MCP Tasks call behind a control. Kumo's tooltip, so
 * it opens on hover and on keyboard focus. With `render` it attaches to the
 * given control; without, the children (an icon) become a focusable
 * icon-button trigger sized to the icon, so the surrounding layout does not
 * move.
 *
 * The popup itself carries no ARIA (Base UI mounts it only while open and
 * gives it no role), so the same text is also the trigger's accessible
 * description: a visually hidden span the trigger points at with
 * aria-describedby. Screen readers get the fact on focus; sighted users get
 * it on hover. Said once per modality.
 */
export function Hint({ content, render, label, className, children }: HintProps) {
  const descriptionId = useId();
  const trigger =
    render === undefined ? (
      <button type="button" aria-label={label} aria-describedby={descriptionId} />
    ) : (
      cloneElement(render, { "aria-describedby": descriptionId })
    );
  return (
    <>
      <Tooltip
        content={<span className="block max-w-xs">{content}</span>}
        // Kumo's trigger adds `cursor-default`; a real control keeps its pointer.
        className={render === undefined ? cn(ICON_TRIGGER, className) : "cursor-pointer"}
        render={trigger}
      >
        {children}
      </Tooltip>
      <span id={descriptionId} className="sr-only">
        {content}
      </span>
    </>
  );
}
