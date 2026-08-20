/**
 * The page's two routes, parsed from and built into a pathname. Pure: the
 * page owns `window.history` and `popstate`; this module only knows the
 * shape of the paths.
 *
 *   "/"              the home: connect, the start picker, your tasks
 *   "/task/<taskId>" one task's playthrough
 */

export type Route = { kind: "home" } | { kind: "task"; taskId: string } | { kind: "unknown" };

export const HOME_PATH = "/";

const TASK_PATH_RE = /^\/task\/([^/]+)\/?$/;

/** The route a pathname names; anything else is `unknown` (a not-found page). */
export function parseRoute(pathname: string): Route {
  if (pathname === "" || pathname === "/" || pathname === "/index.html") {
    return { kind: "home" };
  }
  const match = TASK_PATH_RE.exec(pathname);
  const encoded = match?.[1];
  if (encoded === undefined) {
    return { kind: "unknown" };
  }
  try {
    const taskId = decodeURIComponent(encoded);
    return taskId === "" ? { kind: "unknown" } : { kind: "task", taskId };
  } catch {
    return { kind: "unknown" };
  }
}

/** The path of one task's playthrough. */
export function taskPath(taskId: string): string {
  return `/task/${encodeURIComponent(taskId)}`;
}

/** The task id a route points at, if it is a task route. */
export function routedTaskId(route: Route): string | undefined {
  return route.kind === "task" ? route.taskId : undefined;
}
