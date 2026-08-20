import { Badge, Button, Surface, Text } from "@cloudflare/kumo";
import { ListBulletsIcon, TrashIcon } from "@phosphor-icons/react";
import { taskPath } from "../lib/route";
import { isKnownRunning, type KnownTask } from "../lib/task-list";
import { RouteLink } from "./RouteLink";

/**
 * Your tasks, on the home: every playthrough this session knows, running
 * ones first (with their status), finished ones below. Each row links to
 * its task page and has a forget control. Presentation only — the list
 * itself is the page's, reconciled against the agent.
 */
export function TaskList({
  tasks,
  onNavigate,
  onForget,
}: {
  /** Already in display order (`orderKnownTasks`). */
  tasks: readonly KnownTask[];
  onNavigate: (path: string) => void;
  onForget: (taskId: string) => void;
}) {
  return (
    <Surface className="p-5 rounded-xl ring ring-kumo-line">
      <div className="flex items-center gap-2">
        <ListBulletsIcon size={16} weight="bold" className="text-kumo-subtle" />
        <Text size="sm" bold>
          Your tasks
        </Text>
        <Text size="xs" variant="secondary">
          each story is its own task; running ones keep going while you are away
        </Text>
      </div>
      <ul className="mt-3 divide-y divide-kumo-line">
        {tasks.map((task) => (
          <li key={task.taskId} className="flex items-center gap-3 py-2">
            <RouteLink
              href={taskPath(task.taskId)}
              onNavigate={onNavigate}
              className="flex min-w-0 flex-1 flex-col rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand hover:underline"
            >
              <span className="text-base font-semibold text-kumo-default">
                {task.storyTitle ?? task.storyId}
              </span>
              <span className="truncate font-mono text-xs text-kumo-subtle">
                {`${task.taskId} · started ${new Date(task.startedAt).toLocaleString()}`}
              </span>
            </RouteLink>
            <Badge variant={badgeVariant(task)}>{task.status ?? "starting"}</Badge>
            {isKnownRunning(task) && (
              <span className="size-2 rounded-full bg-green-500 animate-pulse" aria-hidden="true" />
            )}
            <Button
              variant="ghost"
              shape="square"
              size="sm"
              aria-label={`Forget task ${task.taskId}`}
              icon={<TrashIcon size={14} />}
              onClick={() => onForget(task.taskId)}
            />
          </li>
        ))}
      </ul>
    </Surface>
  );
}

function badgeVariant(task: KnownTask): "success" | "warning" | "error" | "secondary" | "info" {
  switch (task.status) {
    case "completed":
      return "success";
    case "input_required":
      return "warning";
    case "failed":
      return "error";
    case "cancelled":
      return "secondary";
    case "working":
    case undefined:
      return "info";
  }
}
