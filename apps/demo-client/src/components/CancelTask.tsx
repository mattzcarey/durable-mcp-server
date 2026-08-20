import { Button, Surface, Text } from "@cloudflare/kumo";
import { XIcon } from "@phosphor-icons/react";
import { COPY } from "../lib/copy";
import { Hint } from "./Hint";

/**
 * Cancel, visible the whole time the task runs: one button, one confirm.
 * A cancelled story is an ending, not an error.
 */
export function CancelTask({
  confirming,
  cancelling,
  requested,
  onConfirm,
  onAbandon,
  onKeep,
}: {
  /** The confirm step is open. */
  confirming: boolean;
  /** The tasks/cancel call is in flight. */
  cancelling: boolean;
  /** Cancel was sent; the next poll will show the story stopped. */
  requested: boolean;
  onConfirm: () => void;
  onAbandon: () => void;
  onKeep: () => void;
}) {
  if (confirming) {
    return (
      <Surface className="p-3 rounded-xl ring ring-kumo-line space-y-2">
        <Text size="xs" variant="secondary">
          Abandon the story?
        </Text>
        <div className="flex gap-2">
          <Button variant="destructive" size="sm" disabled={cancelling} onClick={onAbandon}>
            {cancelling ? "Cancelling…" : "Yes, abandon"}
          </Button>
          <Button variant="ghost" size="sm" disabled={cancelling} onClick={onKeep}>
            Keep going
          </Button>
        </div>
      </Surface>
    );
  }
  return (
    <Hint
      content={COPY.hoverCancel}
      render={
        <Button
          variant="secondary-destructive"
          size="sm"
          icon={<XIcon size={14} />}
          disabled={requested}
          onClick={onConfirm}
        />
      }
    >
      {requested ? "Cancelling…" : "Cancel the task"}
    </Hint>
  );
}
