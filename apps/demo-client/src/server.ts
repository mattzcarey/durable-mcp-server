import { Agent, callable, routeAgentRequest } from "agents";
import type { ElicitRequest, ElicitResult } from "agents/mcp/client";
import {
  foldObservationInto,
  markAbandon,
  markAction,
  markChoice,
  newPlaythrough,
  noteInto,
  type Playthrough,
  prunePlaythroughs,
  unmarkAbandon,
  unmarkAction,
  unmarkChoice,
} from "./lib/playthrough";
import { choiceResponse } from "./lib/story-wire";
import { isStaleSnapshot, type TaskObservation } from "./lib/tasks";
import { type DetailedTask, type InputResponses, isTerminalStatus } from "./mcp-tasks/schema";
import * as taskLane from "./mcp-tasks/task-lane";

/**
 * An elicitation forwarded to the browser, awaiting a human response.
 * Shape of the `mcp-elicitation` broadcast message.
 */
export type PendingElicitation = {
  type: "mcp-elicitation";
  id: string;
  serverId: string;
  params: ElicitRequest["params"];
};

/** One watched upstream task, persisted in agent state so the watch and the
 * last observed snapshot survive hibernation (the poll itself rides
 * `Agent.schedule` alarms, never `setTimeout`). A watch lives while its
 * task runs; what it observed is folded into the task's playthrough. */
export type TaskWatch = {
  serverId: string;
  taskId: string;
  /** Tool-name label for the UI, when known. */
  toolName?: string;
  /** Last observation sequence number (0 = nothing observed yet). */
  seq: number;
  /** `taskChangeKey` of the last observed state, for change detection across polls. */
  changeKey?: string;
  /** Id of the pending `Agent.schedule` alarm, cancelled when the watch stops. */
  scheduleId?: string;
  /** Consecutive failed polls; the watch stops at WATCH_MAX_FAILURES. */
  failures: number;
  /** Total polls so far (for the record; the watch is bounded by age, not count). */
  polls: number;
  startedAt: number;
  /** Last observed snapshot. */
  task?: DetailedTask;
  /** Epoch ms when `task` was observed. */
  observedAt?: number;
  /** Epoch ms of the pending poll alarm. */
  nextPollAt?: number;
};

export type MyAgentState = {
  /** Live watches keyed by `${serverId}/${taskId}`. A watch ends with its task. */
  taskWatches: Record<string, TaskWatch>;
  /**
   * ONE materialized playthrough per task, keyed by taskId: the log, the
   * stage, the open ask, the ending — folded here from every snapshot the
   * task's watch observes, persisted, and pushed to the page as state. The
   * page renders exactly the one its URL names; nothing is replayed.
   * Finished playthroughs stay until the player forgets them (capped at
   * MAX_PLAYTHROUGHS, oldest finished first).
   */
  playthroughs: Record<string, Playthrough>;
  /**
   * UI poll-rate override in ms: when set, the watch loop schedules at this
   * cadence instead of the server's `pollIntervalMs` hint (still clamped by
   * the lane's bounds). Absent = follow the server hint.
   */
  pollIntervalOverrideMs?: number;
};

/** What the page hands the agent to start a story. */
export type StartStoryRequest = {
  storyId: string;
  storyTitle?: string;
  seed?: number;
  /** The manifest's default scene, shown until the first meta names one. */
  defaultScene?: string;
};

/** The start call's outcome: a task (its playthrough now exists) or a plain result. */
export type StartStoryOutcome =
  | { kind: "task"; taskId: string }
  | { kind: "result"; result: Record<string, unknown> };

const ELICITATION_TIMEOUT_MS = 5 * 60 * 1000;

/** The one tool the adventure runs. */
const START_TOOL = "start";

/**
 * How long one watch follows its task before giving up: stories are long
 * running (a fork can wait on the player for an hour), so the bound is an
 * age, not a poll count — a task that never finishes stops being polled
 * after a day, with a note in its playthrough.
 */
const WATCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Consecutive poll failures tolerated before a watch is dropped. */
const WATCH_MAX_FAILURES = 5;
/** Playthroughs kept in state; past this the oldest FINISHED ones go. */
const MAX_PLAYTHROUGHS = 24;

const watchKey = (serverId: string, taskId: string) => `${serverId}/${taskId}`;

const errorText = (caught: unknown): string =>
  caught instanceof Error ? caught.message : String(caught);

export class MyAgent extends Agent<Env, MyAgentState> {
  initialState: MyAgentState = { taskWatches: {}, playthroughs: {} };

  /**
   * Elicitations waiting on a human response, keyed by elicitation id.
   * In-memory only: a pending elicitation does not survive hibernation,
   * which is fine — the tool call awaiting it is a live request and would
   * not survive hibernation either.
   */
  private pendingElicitations = new Map<string, (result: ElicitResult) => void>();

  onStart() {
    this.mcp.configureElicitationHandlers({
      form: (request, serverId) => this.forwardElicitationToBrowser(request, serverId),
      url: (request, serverId) => this.forwardElicitationToBrowser(request, serverId),
    });

    this.mcp.configureOAuthCallback({
      customHandler: (result) => {
        if (result.authSuccess) {
          return new Response("<script>window.close();</script>", {
            headers: { "content-type": "text/html" },
            status: 200,
          });
        }
        const error = result.authError || "Unknown error";
        return new Response(`Authentication Failed: ${error}`, {
          headers: { "content-type": "text/plain" },
          status: 400,
        });
      },
    });

    // Heal a restored-but-undiscovered connection shortly after wake. The
    // restore itself runs after onStart, so this is a short one-shot alarm.
    void this.schedule(2, "refreshDiscovery");
  }

  /**
   * Forwards a connected MCP server's `elicitation/create` request to
   * browser clients and waits for one of them to answer via
   * `respondToElicitation`.
   */
  private async forwardElicitationToBrowser(
    request: ElicitRequest,
    serverId: string,
  ): Promise<ElicitResult> {
    const id = crypto.randomUUID();

    const result = new Promise<ElicitResult>((resolve) => {
      this.pendingElicitations.set(id, resolve);
      // Don't hold the tool call open forever if nobody answers.
      setTimeout(() => {
        if (this.pendingElicitations.delete(id)) {
          resolve({ action: "cancel", content: {} });
        }
      }, ELICITATION_TIMEOUT_MS);
    });

    this.broadcast(
      JSON.stringify({
        type: "mcp-elicitation",
        id,
        serverId,
        params: request.params,
      } satisfies PendingElicitation),
    );

    return result;
  }

  /** Called by the browser with the human's answer to an elicitation. */
  @callable()
  respondToElicitation(id: string, result: ElicitResult) {
    const resolve = this.pendingElicitations.get(id);
    if (resolve) {
      this.pendingElicitations.delete(id);
      resolve(result);
    }
  }

  /**
   * Re-runs capability discovery for any ready connection whose resource
   * list is empty. Why: the agent restores connections
   * from storage on a wake or redeploy, and a restored session can come back
   * `ready` seeded from a discovery snapshot that was saved before it
   * finished — ready, no resources, and nothing refills it, because the
   * state-changed rebroadcast only fires on transitions. The browser calls
   * this when it sees a ready server with no story manifests.
   */
  @callable()
  async refreshDiscovery(): Promise<void> {
    const { servers, resources } = this.getMcpServers();
    for (const [id, server] of Object.entries(servers)) {
      if (server.state !== "ready") continue;
      if (resources.some((resource) => resource.serverId === id)) continue;
      // discoverIfConnected fires the manager's state-changed event, and the
      // Agent base rebroadcasts the MCP snapshot on it — no manual push needed.
      await this.mcp.discoverIfConnected(id);
    }
  }

  /**
   * Connects to the story server. This app holds exactly one connection,
   * so anything else the agent remembers (a previous app's servers under a
   * reused sessionId, an earlier story server) is dropped first — otherwise
   * it would reconnect and surface in the UI as a ghost.
   */
  @callable()
  async addServer(name: string, url: string) {
    // Drop EVERY existing connection, same URL included: re-adding is the one
    // reliable way out of a connection wedged in `connecting` (a stuck restore
    // refuses discoverIfConnected, so only a fresh connection heals it), and
    // this app holds exactly one server anyway.
    for (const id of Object.keys(this.getMcpServers().servers)) {
      await this.disconnectServer(id);
    }
    await this.addMcpServer(name, url);
  }

  /**
   * `resources/read` on a connected server, through the SDK client (the
   * resource surface has no tasks-draft entanglement, so the ordinary
   * connection serves it). The browser reads story manifests and scene /
   * sprite art with this; the resources/list itself already rides the
   * `onMcpUpdate` state the agent pushes.
   */
  @callable()
  async readResource(serverId: string, uri: string) {
    return await this.mcp.readResource({ serverId, uri });
  }

  @callable()
  async disconnectServer(serverId: string) {
    // Stop this server's watches first: their lane session dies with the
    // connection, so leaving them would only orphan-poll into failures.
    // Their playthroughs stay readable.
    for (const watch of Object.values(this.state.taskWatches)) {
      if (watch.serverId === serverId) {
        await this.stopWatchingTask(watch.serverId, watch.taskId);
      }
    }
    await this.removeMcpServer(serverId);
  }

  /**
   * Builds the raw task-lane session from the live SDK connection: same
   * endpoint URL, negotiated protocol version, Streamable HTTP session id,
   * and OAuth token. The task lane must bypass the SDK client (its era gate
   * refuses tasks/* toward 2026-era peers and it cannot emit the required
   * Mcp-Name header), but it always rides the SDK's negotiated state.
   */
  private async taskLaneSession(serverId: string): Promise<taskLane.TaskLaneSession> {
    const conn = this.mcp.mcpConnections[serverId];
    if (!conn) {
      throw new Error(`Unknown MCP server: ${serverId}`);
    }
    const { protocolVersion } = conn;
    if (protocolVersion === undefined) {
      throw new Error(`MCP server ${serverId} has not completed protocol negotiation yet`);
    }
    const tokens = await conn.options.transport.authProvider?.tokens();
    const session: taskLane.TaskLaneSession = {
      url: conn.url.href,
      protocolVersion,
    };
    const { sessionId } = conn;
    if (sessionId !== undefined) {
      session.sessionId = sessionId;
    }
    if (tokens?.access_token !== undefined) {
      session.accessToken = tokens.access_token;
    }
    return session;
  }

  /* The adventure: one playthrough per task, materialized here. */

  /**
   * Starts a story: calls the server's `start` tool as a task, creates the
   * task's playthrough (so the watch's very first poll has somewhere to
   * fold), and starts the watch. Every start is a NEW task — older ones,
   * running or finished, keep their own playthroughs.
   */
  @callable()
  async startStory(serverId: string, request: StartStoryRequest): Promise<StartStoryOutcome> {
    const session = await this.taskLaneSession(serverId);
    const args: Record<string, unknown> = { story: request.storyId };
    if (request.seed !== undefined) args.seed = request.seed;
    const outcome = await taskLane.callToolAsTask(session, START_TOOL, args);
    if (outcome.kind === "result") {
      return outcome;
    }
    const { taskId } = outcome.task;
    const seed: Parameters<typeof newPlaythrough>[0] = {
      taskId,
      serverId,
      storyId: request.storyId,
      status: outcome.task.status,
      nowMs: Date.now(),
    };
    if (request.storyTitle !== undefined) seed.storyTitle = request.storyTitle;
    if (request.defaultScene !== undefined) seed.defaultScene = request.defaultScene;
    this.setState({
      ...this.state,
      playthroughs: prunePlaythroughs(
        { ...this.playthroughs(), [taskId]: newPlaythrough(seed) },
        MAX_PLAYTHROUGHS,
      ),
    });
    try {
      await this.startTaskWatch(serverId, taskId, START_TOOL);
    } catch {
      // The tool call itself succeeded; a failed first poll is retried by
      // the watch's failure alarm, so never fail the start over it.
    }
    return { kind: "task", taskId };
  }

  /**
   * A fork answer: marks the choice on the playthrough first (the log says
   * "you chose" at once, and the ask locks), then sends `tasks/update` to
   * the ask's exact key and re-polls so the move is observed promptly. A
   * send failure reopens the ask with a note, and rethrows.
   */
  @callable()
  async answerFork(taskId: string, key: string, optionId: string, label: string): Promise<void> {
    const playthrough = this.requirePlaythrough(taskId);
    this.updatePlaythrough(taskId, (current) => markChoice(current, key, label, Date.now()));
    try {
      const session = await this.taskLaneSession(playthrough.serverId);
      await taskLane.updateTask(session, taskId, choiceResponse(key, optionId));
    } catch (caught) {
      this.updatePlaythrough(taskId, (current) =>
        unmarkChoice(
          current,
          key,
          `your answer did not reach the story: ${errorText(caught)}`,
          Date.now(),
        ),
      );
      throw caught;
    }
    await this.pollNowIfWatched(playthrough.serverId, taskId);
  }

  /**
   * An ambient press: marks the action (the bar locks on its key), sends
   * `tasks/update` to the OFFERED key, re-polls. A send failure unlocks the
   * bar with a note, and rethrows.
   */
  @callable()
  async pressAction(taskId: string, key: string, optionId: string, label: string): Promise<void> {
    const playthrough = this.requirePlaythrough(taskId);
    this.updatePlaythrough(taskId, (current) => markAction(current, key, label, Date.now()));
    try {
      const session = await this.taskLaneSession(playthrough.serverId);
      await taskLane.updateTask(session, taskId, choiceResponse(key, optionId));
    } catch (caught) {
      this.updatePlaythrough(taskId, (current) =>
        unmarkAction(
          current,
          key,
          `the story did not take "${label}": ${errorText(caught)}`,
          Date.now(),
        ),
      );
      throw caught;
    }
    await this.pollNowIfWatched(playthrough.serverId, taskId);
  }

  /**
   * Walks away: marks the playthrough (cancel pending), sends
   * `tasks/cancel`, re-polls so the cancelled ending is observed promptly.
   * A send failure re-arms cancel with a note, and rethrows.
   */
  @callable()
  async abandonStory(taskId: string): Promise<void> {
    const playthrough = this.requirePlaythrough(taskId);
    this.updatePlaythrough(taskId, (current) => markAbandon(current, Date.now()));
    try {
      const session = await this.taskLaneSession(playthrough.serverId);
      await taskLane.cancelTask(session, taskId);
    } catch (caught) {
      this.updatePlaythrough(taskId, (current) =>
        unmarkAbandon(
          current,
          `cancel failed, the story goes on: ${errorText(caught)}`,
          Date.now(),
        ),
      );
      throw caught;
    }
    await this.pollNowIfWatched(playthrough.serverId, taskId);
  }

  /**
   * Forgets a playthrough: stops its watch (a running task keeps running
   * on the server; it is just no longer followed) and drops the record.
   */
  @callable()
  async forgetPlaythrough(taskId: string): Promise<boolean> {
    const playthrough = this.playthroughs()[taskId];
    if (playthrough === undefined) {
      return false;
    }
    await this.stopWatchingTask(playthrough.serverId, taskId);
    const { [taskId]: removed, ...playthroughs } = this.playthroughs();
    void removed;
    this.setState({ ...this.state, playthroughs });
    return true;
  }

  /* The generic MCP Tasks surface. */

  /**
   * Calls a tool with the tasks extension always declared (the server decides
   * task-vs-blocking per the spec). Returns either `{ kind: "task", task }`
   * or `{ kind: "result", result }`. When the server answers with a task, a
   * watch is started immediately so observations begin without another
   * round trip; `watchTask` stays idempotent on top of it. `label`, when
   * given, names the watch instead of the tool name — how a UI tells
   * concurrent runs of one tool apart. No playthrough is created here: that
   * is `startStory`.
   */
  @callable()
  async callToolAsTask(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    label?: string,
  ) {
    const session = await this.taskLaneSession(serverId);
    const outcome = await taskLane.callToolAsTask(session, toolName, args);
    if (outcome.kind === "task") {
      try {
        await this.startTaskWatch(serverId, outcome.task.taskId, label ?? toolName);
      } catch {
        // The tool call itself succeeded; a failed first poll is retried by
        // the watch's failure alarm, so never fail the call over it.
      }
    }
    return outcome;
  }

  /** One `tasks/get`: current task state, terminal result/error inlined. */
  @callable()
  async getTask(serverId: string, taskId: string) {
    const session = await this.taskLaneSession(serverId);
    return await taskLane.getTask(session, taskId);
  }

  /**
   * Fetches the final result of a completed task via `tasks/get` (the current
   * draft inlines it there; `tasks/result` no longer exists). Throws if the
   * task failed or has not finished.
   */
  @callable()
  async getTaskResult(serverId: string, taskId: string): Promise<Record<string, unknown>> {
    const session = await this.taskLaneSession(serverId);
    const task = await taskLane.getTask(session, taskId);
    if (task.status === "completed") {
      return task.result;
    }
    if (task.status === "failed") {
      throw new Error(`Task ${taskId} failed: ${JSON.stringify(task.error)}`);
    }
    throw new Error(`Task ${taskId} is ${task.status}; no result is available`);
  }

  /**
   * `tasks/update` — answers the outstanding inputRequests of an
   * `input_required` task (raw; the adventure's `answerFork` / `pressAction`
   * mark the playthrough on top of this). When the task is being watched,
   * re-polls immediately so the transition back to `working` is observed
   * without waiting out the poll interval.
   */
  @callable()
  async updateTask(serverId: string, taskId: string, inputResponses: InputResponses) {
    const session = await this.taskLaneSession(serverId);
    const ack = await taskLane.updateTask(session, taskId, inputResponses);
    await this.pollNowIfWatched(serverId, taskId);
    return ack;
  }

  /**
   * `tasks/cancel` — an ack only; cancellation is cooperative and eventual
   * (raw; the adventure's `abandonStory` marks the playthrough on top of
   * this). When the task is being watched, re-polls immediately so the
   * `cancelled` state (once the server reaches it) is observed promptly.
   */
  @callable()
  async cancelTask(serverId: string, taskId: string) {
    const session = await this.taskLaneSession(serverId);
    const ack = await taskLane.cancelTask(session, taskId);
    await this.pollNowIfWatched(serverId, taskId);
    return ack;
  }

  /**
   * Starts (or restarts) watching a task: polls `tasks/get` on
   * `Agent.schedule` alarms — surviving hibernation, unlike a `setTimeout`
   * loop — honoring the server's `pollIntervalMs` hint, and folds every
   * observed snapshot into the task's playthrough (when it has one).
   * Returns the first observed snapshot; terminal states end the watch.
   */
  @callable()
  async watchTask(serverId: string, taskId: string, toolName?: string): Promise<DetailedTask> {
    const task = await this.startTaskWatch(serverId, taskId, toolName);
    if (!task) {
      throw new Error(`Task ${taskId} is not watchable (watch was stopped mid-start)`);
    }
    return task;
  }

  /**
   * Manual out-of-band poll of one watched task — the same
   * pre-cancel-the-alarm immediate-poll path `updateTask` / `cancelTask`
   * ride, surfaced as its own control. Returns false when the task is not
   * being watched (terminal tasks already dropped their watch).
   */
  @callable()
  async pollTaskNow(serverId: string, taskId: string): Promise<boolean> {
    if (!this.state.taskWatches[watchKey(serverId, taskId)]) {
      return false;
    }
    await this.pollNowIfWatched(serverId, taskId);
    return true;
  }

  /** Manual out-of-band poll of every watched task. Returns how many polled. */
  @callable()
  async pollAllWatchedNow(): Promise<number> {
    const watches = Object.values(this.state.taskWatches);
    for (const watch of watches) {
      await this.pollNowIfWatched(watch.serverId, watch.taskId);
    }
    return watches.length;
  }

  /**
   * Sets (or clears, with null) the poll-rate override. Applies live: every
   * running watch is re-polled immediately, so its next alarm is scheduled
   * at the new cadence without waiting out the old interval.
   */
  @callable()
  async setPollIntervalOverride(overrideMs: number | null): Promise<void> {
    const effective = overrideMs === null ? undefined : taskLane.nextPollDelayMs({}, overrideMs);
    if (effective === this.state.pollIntervalOverrideMs) {
      return;
    }
    if (overrideMs === null) {
      const { pollIntervalOverrideMs: cleared, ...rest } = this.state;
      void cleared;
      this.setState(rest);
    } else if (effective !== undefined) {
      // Persist the effective (lane-clamped) value so the UI reflects it.
      this.setState({ ...this.state, pollIntervalOverrideMs: effective });
    }
    await this.pollAllWatchedNow();
  }

  /** Stops watching a task: cancels its poll alarm and forgets the watch. */
  @callable()
  async stopWatchingTask(serverId: string, taskId: string): Promise<boolean> {
    const key = watchKey(serverId, taskId);
    const watch = this.state.taskWatches[key];
    if (!watch) {
      return false;
    }
    if (watch.scheduleId !== undefined) {
      await this.cancelSchedule(watch.scheduleId);
    }
    this.deleteTaskWatch(key);
    return true;
  }

  /**
   * Alarm callback for the watch poll loop (public so `Agent.schedule` can
   * name it; not `@callable`). Swallows poll errors into the failure path —
   * a transient upstream error must not kill the alarm chain.
   */
  async pollWatchedTask(key: string) {
    try {
      await this.pollTaskWatchOnce(key);
    } catch {
      await this.recordWatchFailure(key);
    }
  }

  /** Registers/updates the watch record and runs the first poll inline. */
  private async startTaskWatch(
    serverId: string,
    taskId: string,
    toolName?: string,
  ): Promise<DetailedTask | undefined> {
    const key = watchKey(serverId, taskId);
    const base: TaskWatch = this.state.taskWatches[key] ?? {
      serverId,
      taskId,
      seq: 0,
      failures: 0,
      polls: 0,
      startedAt: Date.now(),
    };
    const watch: TaskWatch = toolName === undefined ? { ...base } : { ...base, toolName };
    this.setTaskWatch(key, watch);
    try {
      return await this.pollTaskWatchOnce(key);
    } catch (error) {
      await this.recordWatchFailure(key);
      throw error;
    }
  }

  /**
   * One poll step: `tasks/get`, schedule the next alarm (pre-cancelling any
   * pending one, so an out-of-band poll after `tasks/update` / `tasks/cancel`
   * never forks the alarm chain), fold the observation into the task's
   * playthrough, and persist both in ONE state write — the push of that
   * state to connected pages is the only path observations travel.
   * Terminal states end the watch; the playthrough keeps everything.
   */
  private async pollTaskWatchOnce(key: string): Promise<DetailedTask | undefined> {
    const watch = this.state.taskWatches[key];
    if (!watch) {
      return undefined; // Watch was stopped; a stale alarm may still fire once.
    }
    if (watch.scheduleId !== undefined) {
      await this.cancelSchedule(watch.scheduleId);
    }
    const session = await this.taskLaneSession(watch.serverId);
    const fetched = await taskLane.getTask(session, watch.taskId);

    // The fetch is the one place another event can interleave (storage
    // calls are input-gated; an outbound fetch is not): an alarm poll and
    // the re-poll after tasks/update can overlap and land in either order,
    // and the watch can be stopped meanwhile. So read the watch again, and
    // never let an older snapshot overwrite a newer one — the seq must
    // advance from what is persisted NOW, or the later snapshot's beat is
    // folded as a no-change poll and lost.
    const latest = this.state.taskWatches[key];
    if (!latest) {
      return undefined; // Stopped while the poll was in flight: do not resurrect it.
    }
    const task =
      latest.task !== undefined && isStaleSnapshot(fetched, latest.task) ? latest.task : fetched;

    const observedAt = Date.now();
    const terminal = isTerminalStatus(task.status);
    const changeKey = taskLane.taskChangeKey(task);
    const changed = changeKey !== latest.changeKey;
    const polls = latest.polls + 1;
    const seq = changed ? latest.seq + 1 : latest.seq;

    let nextPollAt: number | undefined;
    if (!terminal && observedAt - latest.startedAt < WATCH_MAX_AGE_MS) {
      nextPollAt = observedAt + taskLane.nextPollDelayMs(task, this.state.pollIntervalOverrideMs);
    }

    const observation: TaskObservation = {
      serverId: latest.serverId,
      taskId: latest.taskId,
      seq,
      observedAt,
      task,
    };
    if (latest.toolName !== undefined) observation.toolName = latest.toolName;
    if (nextPollAt !== undefined) observation.nextPollAt = nextPollAt;

    if (terminal || nextPollAt === undefined) {
      // The watch is done: drop it. The playthrough holds everything the
      // page reads, its ending included.
      let playthroughs = foldObservationInto(this.playthroughs(), observation);
      if (!terminal) {
        const hours = Math.round(WATCH_MAX_AGE_MS / 3_600_000);
        playthroughs = noteInto(
          playthroughs,
          latest.taskId,
          `stopped watching after ${hours} hours (${polls} polls); the task may still be running`,
          observedAt,
        );
      }
      const { [key]: done, ...taskWatches } = this.state.taskWatches;
      void done;
      this.setState({ ...this.state, taskWatches, playthroughs });
      return task;
    }

    const schedule = await this.schedule(new Date(nextPollAt), "pollWatchedTask", key);
    // schedule() is storage-only, so nothing interleaved; the re-read is belt and braces.
    const base = this.state.taskWatches[key] ?? latest;
    this.setState({
      ...this.state,
      taskWatches: {
        ...this.state.taskWatches,
        [key]: {
          ...base,
          seq,
          changeKey,
          scheduleId: schedule.id,
          failures: 0,
          polls,
          task,
          observedAt,
          nextPollAt,
        },
      },
      playthroughs: foldObservationInto(this.playthroughs(), observation),
    });
    return task;
  }

  /**
   * A poll failed. Keep the alarm chain alive at the default interval until
   * WATCH_MAX_FAILURES consecutive failures, then drop the watch and say so
   * in the playthrough's log.
   */
  private async recordWatchFailure(key: string): Promise<void> {
    const watch = this.state.taskWatches[key];
    if (!watch) {
      return;
    }
    const failures = watch.failures + 1;
    if (failures >= WATCH_MAX_FAILURES) {
      if (watch.scheduleId !== undefined) {
        await this.cancelSchedule(watch.scheduleId);
      }
      const { [key]: dropped, ...taskWatches } = this.state.taskWatches;
      void dropped;
      this.setState({
        ...this.state,
        taskWatches,
        playthroughs: noteInto(
          this.playthroughs(),
          watch.taskId,
          `stopped watching: ${failures} polls in a row failed; the task may still be running`,
          Date.now(),
        ),
      });
      return;
    }
    const nextPollAt = Date.now() + taskLane.nextPollDelayMs({}, this.state.pollIntervalOverrideMs);
    const schedule = await this.schedule(new Date(nextPollAt), "pollWatchedTask", key);
    this.setTaskWatch(key, { ...watch, failures, scheduleId: schedule.id, nextPollAt });
  }

  /** Immediate out-of-band poll after tasks/update or tasks/cancel. */
  private async pollNowIfWatched(serverId: string, taskId: string): Promise<void> {
    const key = watchKey(serverId, taskId);
    if (!this.state.taskWatches[key]) {
      return;
    }
    try {
      await this.pollTaskWatchOnce(key);
    } catch {
      await this.recordWatchFailure(key);
    }
  }

  /* State helpers */

  /** The playthrough map (an agent persisted before playthroughs existed has none). */
  private playthroughs(): Record<string, Playthrough> {
    return this.state.playthroughs ?? {};
  }

  private requirePlaythrough(taskId: string): Playthrough {
    const playthrough = this.playthroughs()[taskId];
    if (playthrough === undefined) {
      throw new Error(`Unknown playthrough: ${taskId}`);
    }
    return playthrough;
  }

  /** Applies a pure change to one playthrough and persists it (a no-op when it is gone). */
  private updatePlaythrough(taskId: string, change: (current: Playthrough) => Playthrough): void {
    const playthroughs = this.playthroughs();
    const playthrough = playthroughs[taskId];
    if (playthrough === undefined) {
      return;
    }
    this.setState({
      ...this.state,
      playthroughs: { ...playthroughs, [taskId]: change(playthrough) },
    });
  }

  private setTaskWatch(key: string, watch: TaskWatch): void {
    this.setState({
      ...this.state,
      taskWatches: { ...this.state.taskWatches, [key]: watch },
    });
  }

  private deleteTaskWatch(key: string): void {
    const { [key]: removed, ...taskWatches } = this.state.taskWatches;
    void removed;
    this.setState({ ...this.state, taskWatches });
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env, { cors: true })) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
