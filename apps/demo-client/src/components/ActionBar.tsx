import { Button, Text } from "@cloudflare/kumo";
import { HandTapIcon } from "@phosphor-icons/react";
import { COPY } from "../lib/copy";
import type { ActionOption, ActionSet } from "../lib/story-wire";
import { Hint } from "./Hint";

/**
 * The ambient action bar: the latest standing, non-blocking offers the
 * story announced (each new set replaces the last). A press sends
 * tasks/update to the offered key; the key is consume-once, so the bar
 * locks until the story re-offers under a fresh key.
 */
export function ActionBar({
  actions,
  spent,
  disabled,
  busy,
  onPress,
}: {
  actions: ActionSet;
  /** This key was already pressed — wait for the next offer. */
  spent: boolean;
  /** A fork is open or the task is not running. */
  disabled: boolean;
  busy: boolean;
  onPress: (option: ActionOption) => void;
}) {
  const locked = spent || disabled || busy;
  return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      <Hint label="About these actions" content={COPY.hoverAction}>
        <HandTapIcon size={16} weight="bold" />
      </Hint>
      <Text size="xs" variant="secondary">
        {spent ? "the story is weighing your call…" : disabled ? "on hold" : "at any time:"}
      </Text>
      {actions.options.map((option) => (
        <Hint
          key={option.id}
          content={COPY.hoverAction}
          render={
            <Button
              variant="secondary"
              size="sm"
              disabled={locked}
              onClick={() => onPress(option)}
            />
          }
        >
          {option.label}
        </Hint>
      ))}
    </div>
  );
}
