import { useAgent } from "agents/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Button, Surface, Text, TooltipProvider } from "@cloudflare/kumo";
import {
  ArrowCounterClockwiseIcon,
  CompassIcon,
  GearIcon,
  MoonIcon,
  PlugsConnectedIcon,
  SignInIcon,
  SunIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { MCPServersState } from "agents";
import { nanoid } from "nanoid";
import { z } from "zod";
import { Footer } from "./components/Footer";
import { PlaythroughView } from "./components/PlaythroughView";
import { RouteLink } from "./components/RouteLink";
import { type StartRequest, StoryPicker } from "./components/StoryPicker";
import { TaskList } from "./components/TaskList";
import { UTILITIES_DRAWER_ID, UtilitiesDrawer } from "./components/UtilitiesDrawer";
import { COPY } from "./lib/copy";
import type { LogEntry } from "./lib/playthrough";
import { HOME_PATH, parseRoute, type Route, routedTaskId, taskPath } from "./lib/route";
import {
  findManifestResources,
  parseManifest,
  resourceText,
  sanitizeSvg,
  type StoryManifest,
} from "./lib/story-resources";
import { type ActionOption, type ForkOption, resultText } from "./lib/story-wire";
import {
  forgetTask,
  type KnownTask,
  orderKnownTasks,
  parseKnownTasks,
  reconcileKnownTasks,
  rememberTask,
  serializeKnownTasks,
} from "./lib/task-list";
import type { MyAgentState, StartStoryRequest } from "./server";
import "./styles.css";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
// The demo is hardwired to its MCP server (the one running the Tasks
// extension): wrangler dev on :8787 locally,
// the deployed worker otherwise.
const SERVER_URL = LOCAL_HOSTS.has(window.location.hostname)
  ? "http://localhost:8787/mcp"
  : "https://task-server.mattzcarey.workers.dev/mcp";
const SERVER_NAME = "task-server";

const SESSION_KEY = "sessionId";
/** The page's pointer list of known tasks (see `lib/task-list.ts`). */
const KNOWN_TASKS_KEY = "knownTasks";

function ensureSessionId(): string {
  const stored = localStorage.getItem(SESSION_KEY);
  if (stored) return stored;
  const created = nanoid(8);
  localStorage.setItem(SESSION_KEY, created);
  return created;
}

const sessionId = ensureSessionId();

/** Clears the stored session (and its task list) and reloads, starting a fresh agent. */
function resetSession() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(KNOWN_TASKS_KEY);
  window.location.replace(HOME_PATH);
}

const loadKnownTasks = (): readonly KnownTask[] =>
  parseKnownTasks(localStorage.getItem(KNOWN_TASKS_KEY));

type ConnectionStatus = "connecting" | "connected" | "disconnected";

function openPopup(authUrl: string) {
  window.open(authUrl, "popupWindow", "width=600,height=800,resizable=yes,scrollbars=yes");
}

/**
 * The page's routing: `window.history` and `popstate`, nothing else. The
 * path is the one source of which task is on screen.
 */
function useRoute(): [Route, (path: string) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const navigate = useCallback((path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState(null, "", path);
    }
    setRoute(parseRoute(path));
  }, []);
  return [route, navigate];
}

function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const dot =
    status === "connected"
      ? "bg-green-500"
      : status === "connecting"
        ? "bg-yellow-500"
        : "bg-red-500";
  const text =
    status === "connected"
      ? "text-kumo-success"
      : status === "connecting"
        ? "text-kumo-warning"
        : "text-kumo-danger";
  const label =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting..."
        : "Disconnected";
  return (
    <output className="flex items-center gap-2">
      <span className={`size-2 rounded-full ${dot}`} />
      <span className={`text-xs ${text}`}>{label}</span>
    </output>
  );
}

function ModeToggle() {
  const [mode, setMode] = useState(() => localStorage.getItem("theme") || "light");

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [mode]);

  return (
    <Button
      variant="ghost"
      shape="square"
      aria-label="Toggle theme"
      onClick={() => setMode((m) => (m === "light" ? "dark" : "light"))}
      icon={mode === "light" ? <MoonIcon size={16} /> : <SunIcon size={16} />}
    />
  );
}

/** The `startStory` outcome, as the callable returns it. */
const StartOutcomeSchema = z.union([
  z.object({ kind: z.literal("task"), taskId: z.string() }),
  z.object({ kind: z.literal("result"), result: z.record(z.string(), z.unknown()) }),
]);

const errorText = (caught: unknown): string =>
  caught instanceof Error ? caught.message : String(caught);

/** One stable empty list, so a task with no local notes never re-merges the log per tick. */
const NO_NOTES: readonly LogEntry[] = [];

function NotFound({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <Surface className="p-5 rounded-xl ring ring-kumo-line">
      <Text size="sm" bold>
        No such task here
      </Text>
      <p className="mt-2 text-sm text-kumo-subtle leading-6">
        This session does not know that task: it was forgotten, or it belongs to another session.
      </p>
      <RouteLink
        href={HOME_PATH}
        onNavigate={onNavigate}
        className="mt-3 inline-block text-sm text-kumo-accent hover:underline"
      >
        Back to the start
      </RouteLink>
    </Surface>
  );
}

function App() {
  const [route, navigate] = useRoute();
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [mcpState, setMcpState] = useState<MCPServersState>({
    prompts: [],
    resources: [],
    servers: {},
    tools: [],
  });
  /** The agent's state, as pushed: the playthroughs are read from here, never rebuilt. */
  const [agentState, setAgentState] = useState<MyAgentState | undefined>(undefined);
  /** The page's pointer list of tasks (localStorage), reconciled against the agent. */
  const [knownTasks, setKnownTasks] = useState<readonly KnownTask[]>(loadKnownTasks);
  const [now, setNow] = useState(() => Date.now());
  /** Manifests by resource URI (null = unreadable). */
  const [manifests, setManifests] = useState<Record<string, StoryManifest | null>>({});
  /** Sanitized scene / sprite SVG by resource URI (null = unreadable). */
  const [art, setArt] = useState<Record<string, string | null>>({});
  const readsInFlight = useRef(new Set<string>());
  /** Page-local log lines per task (art that failed to load, …). */
  const [localNotes, setLocalNotes] = useState<Record<string, LogEntry[]>>({});
  const localNoteIds = useRef(0);
  /** One line for page-level trouble (a call that did not reach the agent, …). */
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | undefined>(undefined);
  const [pendingChoice, setPendingChoice] = useState<
    { taskId: string; key: string; label: string } | undefined
  >(undefined);
  const [answering, setAnswering] = useState(false);
  const [acting, setActing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  /** Mirror of the agent's poll-rate override (undefined = server hint). */
  const [pollOverrideMs, setPollOverrideMs] = useState<number | undefined>(undefined);
  const [utilitiesOpen, setUtilitiesOpen] = useState(false);
  const gearRef = useRef<HTMLButtonElement>(null);
  /** The story randomness seed for the next start (the drawer sets it). */
  const [seed, setSeed] = useState<number | undefined>(undefined);

  // The known-task list survives a reload: written whenever it changes.
  useEffect(() => {
    localStorage.setItem(KNOWN_TASKS_KEY, serializeKnownTasks(knownTasks));
  }, [knownTasks]);

  // Render tick: drives the crisis countdown, the poll clocks, and sprite expiry.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);

  // A route change clears page-level trouble and the cancel confirm
  // ("information from previous renders": adjusted during render, no effect).
  const [routeShown, setRouteShown] = useState(route);
  if (routeShown !== route) {
    setRouteShown(route);
    setNotice(undefined);
    setStartError(undefined);
    setConfirmCancel(false);
  }

  const agent = useAgent<MyAgentState>({
    agent: "my-agent",
    name: sessionId,
    onClose: useCallback(() => setConnectionStatus("disconnected"), []),
    onMcpUpdate: useCallback((mcpServers: MCPServersState) => {
      setMcpState(mcpServers);
    }, []),
    // The agent's state IS the playthroughs: every poll folds into the
    // task's own record agent-side and pushes the whole state here. The
    // page keeps it as-is and reconciles its pointer list against it.
    onStateUpdate: useCallback((state: MyAgentState) => {
      setAgentState(state);
      setPollOverrideMs(state.pollIntervalOverrideMs);
      setKnownTasks((current) => reconcileKnownTasks(current, state.playthroughs ?? {}));
    }, []),
    onOpen: useCallback(() => setConnectionStatus("connected"), []),
  });

  // Reconnect resync. On every socket open (first connect, tab wake, network
  // blip, agent redeploy under a live page) the agent pushes its state and an
  // MCP snapshot, but nothing re-fetches what changed while we were away:
  // task results keep flowing only if the watch chain is still polling, and
  // a restored MCP connection can be ready with stale capabilities. So ask
  // the agent to re-poll every watched task now (fresh results, chain
  // re-armed) and to re-run discovery for any ready server missing its
  // resources. Both are idempotent; both push back over the socket.
  useEffect(() => {
    if (connectionStatus !== "connected") return;
    agent.call("pollAllWatchedNow", []).catch(() => {
      /* the next scheduled poll still fires; nothing to surface */
    });
    agent.call("refreshDiscovery", []).catch(() => {
      /* the empty-shelf guard below retries once more */
    });
  }, [connectionStatus, agent]);

  const addLocalNote = useCallback((taskId: string, text: string) => {
    localNoteIds.current -= 1;
    const entry: LogEntry = { kind: "note", id: localNoteIds.current, text, atMs: Date.now() };
    setLocalNotes((current) => ({ ...current, [taskId]: [...(current[taskId] ?? []), entry] }));
  }, []);

  const serverEntries = Object.entries(mcpState.servers);
  const readyEntry = serverEntries.find(([, server]) => server.state === "ready");
  const activeEntry = readyEntry ?? serverEntries.at(0);
  const serverId = activeEntry?.[0];
  const serverReady = readyEntry !== undefined;

  /* The routed playthrough: exactly the task in the URL, read from agent state. */

  const taskId = routedTaskId(route);
  const playthroughs = agentState?.playthroughs ?? {};
  const playthrough = taskId === undefined ? undefined : playthroughs[taskId];

  /* Story resources: the manifests build the picker, scenes and sprites
     feed the stage. Every read goes through the agent's readResource
     callable; results are cached by URI for the page's life. */

  const manifestResources = useMemo(
    () =>
      findManifestResources(
        mcpState.resources.filter((resource) => resource.serverId === serverId),
      ),
    [mcpState.resources, serverId],
  );

  useEffect(() => {
    if (!serverReady) return;
    for (const { serverId: owner, uri } of manifestResources) {
      if (uri in manifests || readsInFlight.current.has(uri)) continue;
      readsInFlight.current.add(uri);
      agent
        .call("readResource", [owner, uri])
        .then((result) => {
          const manifest = parseManifest(resourceText(result));
          setManifests((current) => ({ ...current, [uri]: manifest ?? null }));
        })
        .catch(() => setManifests((current) => ({ ...current, [uri]: null })))
        .finally(() => readsInFlight.current.delete(uri));
    }
  }, [agent, serverReady, manifestResources, manifests]);

  const visual = playthrough?.visual;
  const endingScene = playthrough?.ending?.scene;
  const neededArt = useMemo(() => {
    const uris = new Set<string>();
    if (visual !== undefined) {
      if (visual.scene !== undefined) uris.add(visual.scene);
      // Every sprite on record, expired or not: a read is cached by URI.
      for (const sprite of visual.sprites) uris.add(sprite.uri);
    }
    if (endingScene !== undefined) uris.add(endingScene);
    return [...uris];
  }, [visual, endingScene]);

  useEffect(() => {
    if (serverId === undefined || taskId === undefined) return;
    for (const uri of neededArt) {
      if (uri in art || readsInFlight.current.has(uri)) continue;
      readsInFlight.current.add(uri);
      agent
        .call("readResource", [serverId, uri])
        .then((result) => {
          const text = resourceText(result);
          const svg = text === undefined ? undefined : sanitizeSvg(text);
          setArt((current) => ({ ...current, [uri]: svg ?? null }));
          if (svg === undefined) addLocalNote(taskId, `art unreadable, the story goes on: ${uri}`);
        })
        .catch((caught: unknown) => {
          setArt((current) => ({ ...current, [uri]: null }));
          addLocalNote(taskId, `art missing, the story goes on: ${uri} (${errorText(caught)})`);
        })
        .finally(() => readsInFlight.current.delete(uri));
    }
  }, [agent, serverId, taskId, neededArt, art, addLocalNote]);

  const stories = useMemo(
    () =>
      manifestResources
        .map((resource) => manifests[resource.uri])
        .filter((manifest): manifest is StoryManifest => manifest != null),
    [manifestResources, manifests],
  );
  const manifestsLoading = manifestResources.some((resource) => !(resource.uri in manifests));

  // Connected-but-no-manifests: a restored connection can report ready with an
  // empty resource list (see MyAgent.refreshDiscovery). Ask the agent to
  // rediscover once, after a short grace period, and treat the wait as loading.
  // The flag is keyed to the server id, so a new connection resets it by
  // construction (no effect needed to clear it).
  const [discoveryRefreshedFor, setDiscoveryRefreshedFor] = useState<string | undefined>(undefined);
  const discoveryRefreshed = serverId !== undefined && discoveryRefreshedFor === serverId;
  const shelfEmpty = serverReady && manifestResources.length === 0;
  useEffect(() => {
    if (!shelfEmpty || discoveryRefreshed || serverId === undefined) return;
    const timer = setTimeout(() => {
      setDiscoveryRefreshedFor(serverId);
      agent.call("refreshDiscovery", []).catch((caught: unknown) => {
        setNotice(`could not refresh the story shelf: ${errorText(caught)}`);
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [shelfEmpty, discoveryRefreshed, serverId, agent]);
  const shelfLoading = manifestsLoading || (shelfEmpty && !discoveryRefreshed);

  /* Connection */

  const handleConnect = useCallback(() => {
    agent.call("addServer", [SERVER_NAME, SERVER_URL]).catch((caught: unknown) => {
      setNotice(`connect failed: ${errorText(caught)}`);
    });
  }, [agent]);

  // A connection can wedge in `connecting` (a restore that died mid-flight
  // stays that way forever, and discoverIfConnected refuses non-ready
  // connections). Re-adding the server is the proven heal, so if the active
  // connection sits non-ready past the grace window, re-add once per page
  // load; the card also offers a manual Reconnect.
  const stuck =
    activeEntry !== undefined &&
    !serverReady &&
    activeEntry[1].state !== "failed" &&
    activeEntry[1].state !== "authenticating";
  const [autoReconnected, setAutoReconnected] = useState(false);
  useEffect(() => {
    if (!stuck || autoReconnected) return;
    const timer = setTimeout(() => {
      setAutoReconnected(true);
      handleConnect();
    }, 12_000);
    return () => clearTimeout(timer);
  }, [stuck, autoReconnected, handleConnect]);

  const handleDisconnect = async (id: string) => {
    try {
      await agent.call("disconnectServer", [id]);
    } catch (caught) {
      setNotice(`disconnect failed: ${errorText(caught)}`);
    }
  };

  /* Starting a story: always a NEW task, then route to it. */

  const startStory = async (request: StartRequest, storyTitle?: string) => {
    if (serverId === undefined) {
      setStartError("not connected to the story server: connect from the start page first");
      return;
    }
    setStarting(true);
    setStartError(undefined);
    const title = storyTitle ?? stories.find((story) => story.id === request.storyId)?.title;
    try {
      const args: StartStoryRequest = { storyId: request.storyId };
      if (request.seed !== undefined) args.seed = request.seed;
      if (request.defaultScene) args.defaultScene = request.defaultScene;
      if (title !== undefined) args.storyTitle = title;
      const raw = await agent.call("startStory", [serverId, args]);
      const outcome = StartOutcomeSchema.safeParse(raw);
      if (!outcome.success) {
        setStartError("the server answered with an unexpected shape");
      } else if (outcome.data.kind === "task") {
        const started: KnownTask = {
          taskId: outcome.data.taskId,
          storyId: request.storyId,
          startedAt: Date.now(),
          status: "working",
        };
        if (title !== undefined) started.storyTitle = title;
        setKnownTasks((current) => rememberTask(current, started));
        navigate(taskPath(outcome.data.taskId));
      } else {
        setStartError(resultText(outcome.data.result) ?? "the server answered without a task");
      }
    } catch (caught) {
      setStartError(errorText(caught));
    } finally {
      setStarting(false);
    }
  };

  /* The routed playthrough's manifest and actions. */

  const manifestUri = manifestResources.find(
    (resource) => resource.storyId === playthrough?.storyId,
  )?.uri;
  const manifest = manifestUri === undefined ? undefined : (manifests[manifestUri] ?? undefined);

  /** Restart: the same story again, as a NEW task (this one stays), routed to. */
  const restart = () => {
    if (playthrough === undefined) return;
    const request: StartRequest = { storyId: playthrough.storyId };
    if (seed !== undefined) request.seed = seed;
    if (manifest?.defaultScene) request.defaultScene = manifest.defaultScene;
    void startStory(request, manifest?.title ?? playthrough.storyTitle);
  };

  /** A fork answer: the agent marks the choice, sends tasks/update, re-polls. */
  const answerFork = async (option: ForkOption) => {
    if (playthrough?.openFork === undefined) return;
    const { taskId: id } = playthrough;
    const { key } = playthrough.openFork;
    setPendingChoice({ taskId: id, key, label: option.label });
    setAnswering(true);
    try {
      await agent.call("answerFork", [id, key, option.id, option.label]);
    } catch (caught) {
      setNotice(`your answer did not reach the story: ${errorText(caught)}`);
    } finally {
      setAnswering(false);
      setPendingChoice(undefined);
    }
  };

  /** An ambient press: the agent marks the action, sends tasks/update, re-polls. */
  const pressAction = async (option: ActionOption) => {
    const actions = playthrough?.visual.actions;
    if (playthrough === undefined || actions === undefined) return;
    setActing(true);
    try {
      await agent.call("pressAction", [playthrough.taskId, actions.key, option.id, option.label]);
    } catch (caught) {
      setNotice(`the story did not take "${option.label}": ${errorText(caught)}`);
    } finally {
      setActing(false);
    }
  };

  /** tasks/cancel — always legal while running; a cancelled story is an ending. */
  const abandon = async () => {
    if (playthrough === undefined) return;
    setCancelling(true);
    try {
      await agent.call("abandonStory", [playthrough.taskId]);
    } catch (caught) {
      setNotice(`cancel failed, the story goes on: ${errorText(caught)}`);
    } finally {
      setCancelling(false);
      setConfirmCancel(false);
    }
  };

  /** Forget a task: off the list, out of the agent; a running one is no longer followed. */
  const forget = async (id: string) => {
    setKnownTasks((current) => forgetTask(current, id));
    if (taskId === id) navigate(HOME_PATH);
    try {
      await agent.call("forgetPlaythrough", [id]);
    } catch (caught) {
      setNotice(`could not forget the task: ${errorText(caught)}`);
    }
  };

  /* Utilities */

  // The drawer only makes sense against a ready server: if the server drops
  // while it is open, it closes for good rather than springing back on
  // reconnect ("information from previous renders", no effect involved).
  if (utilitiesOpen && !serverReady) setUtilitiesOpen(false);
  const utilitiesShown = utilitiesOpen && serverReady;
  const closeUtilities = useCallback(() => setUtilitiesOpen(false), []);
  // Focus returns to the gear once the drawer has gone — after commit, when
  // the page is no longer inert, or the focus call would be a no-op.
  const utilitiesWereShown = useRef(false);
  useEffect(() => {
    if (utilitiesWereShown.current && !utilitiesShown) gearRef.current?.focus();
    utilitiesWereShown.current = utilitiesShown;
  }, [utilitiesShown]);

  const pollNow = async () => {
    if (playthrough === undefined) return;
    try {
      await agent.call("pollTaskNow", [playthrough.serverId, playthrough.taskId]);
    } catch (caught) {
      setNotice(`poll failed: ${errorText(caught)}`);
    }
  };

  /** Poll-rate override (null = back to the server's hint). Applies live. */
  const setPollRate = async (overrideMs: number | null) => {
    setPollOverrideMs(overrideMs ?? undefined); // optimistic; agent state confirms
    try {
      await agent.call("setPollIntervalOverride", [overrideMs]);
    } catch (caught) {
      setNotice(`poll rate not applied: ${errorText(caught)}`);
    }
  };

  const accentStyle =
    manifest?.accent !== undefined
      ? ({ ["--story-accent" as string]: manifest.accent } as React.CSSProperties)
      : undefined;

  const orderedTasks = orderKnownTasks(knownTasks);

  return (
    <TooltipProvider>
      {/* The page goes inert behind the open drawer: nothing behind the
          backdrop takes focus or clicks until it closes. */}
      <div className="h-full flex flex-col bg-kumo-base" inert={utilitiesShown}>
        <header className="px-5 py-4 border-b border-kumo-line">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            {/* The title is the way home. */}
            <RouteLink
              href={HOME_PATH}
              onNavigate={navigate}
              className="flex items-center gap-3 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand"
              ariaLabel="MCP Task Adventure — home"
            >
              <CompassIcon size={22} className="text-kumo-accent" weight="bold" />
              <h1 className="text-lg font-semibold text-kumo-default">MCP Task Adventure</h1>
            </RouteLink>
            <div className="flex items-center gap-3">
              <ConnectionIndicator status={connectionStatus} />
              <Button
                variant="ghost"
                shape="square"
                aria-label="Reset session"
                onClick={resetSession}
                icon={<ArrowCounterClockwiseIcon size={16} />}
              />
              <Button
                ref={gearRef}
                variant="ghost"
                shape="square"
                aria-label="Utilities"
                aria-expanded={utilitiesShown}
                aria-controls={utilitiesShown ? UTILITIES_DRAWER_ID : undefined}
                disabled={!serverReady}
                onClick={() => setUtilitiesOpen(true)}
                icon={<GearIcon size={16} />}
              />
              <ModeToggle />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-5">
          <div className="max-w-5xl mx-auto space-y-5" style={accentStyle}>
            {notice !== undefined && (
              <span className="block text-red-500">
                <Text size="xs">{notice}</Text>
              </span>
            )}

            {route.kind === "home" && (
              <>
                {/* Pre-connect: the connect affordance and one plain line. */}
                {activeEntry === undefined && (
                  <Surface className="p-5 rounded-xl ring ring-kumo-line">
                    <p className="text-sm text-kumo-subtle leading-6">{COPY.connectExplainer}</p>
                    <p className="mt-1 text-sm text-kumo-subtle leading-6 font-mono">
                      {SERVER_URL}
                    </p>
                    <div className="mt-4">
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        icon={<PlugsConnectedIcon size={14} />}
                        onClick={handleConnect}
                      >
                        Connect
                      </Button>
                    </div>
                  </Surface>
                )}

                {/* Connecting / authorizing / failed: the server line until it is ready. */}
                {activeEntry !== undefined && !serverReady && (
                  <Surface className="p-4 rounded-xl ring ring-kumo-line">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <PlugsConnectedIcon
                          size={16}
                          weight="bold"
                          className="text-kumo-subtle shrink-0"
                        />
                        <Text size="sm" bold>
                          {activeEntry[1].name}
                        </Text>
                        <Badge variant={activeEntry[1].state === "failed" ? "error" : "secondary"}>
                          {activeEntry[1].state}
                        </Badge>
                        <span className="font-mono truncate">
                          <Text size="xs" variant="secondary">
                            {activeEntry[1].server_url}
                          </Text>
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {activeEntry[1].state === "authenticating" && activeEntry[1].auth_url && (
                          <Button
                            variant="primary"
                            size="sm"
                            icon={<SignInIcon size={14} />}
                            onClick={() => openPopup(activeEntry[1].auth_url as string)}
                          >
                            Authorize
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Disconnect server"
                          icon={<TrashIcon size={14} />}
                          onClick={() => handleDisconnect(activeEntry[0])}
                        />
                      </div>
                    </div>
                    {/* A restored connection reconnects and rediscovers in the background
                        (the agent's restore is fire-and-forget, and a stateless server always
                        rediscovers from scratch), so this state is usually transient. Say so,
                        and give failed a way out. */}
                    {(activeEntry[1].state === "connecting" ||
                      activeEntry[1].state === "discovering" ||
                      activeEntry[1].state === "connected") && (
                      <span className="mt-2 flex items-center gap-2">
                        <span
                          className="size-1.5 rounded-full bg-kumo-accent animate-pulse"
                          aria-hidden="true"
                        />
                        <Text size="xs" variant="secondary">
                          reconnecting to the MCP server and rediscovering its tools, usually a few
                          seconds
                        </Text>
                        <Button variant="ghost" size="sm" onClick={handleConnect}>
                          Reconnect
                        </Button>
                      </span>
                    )}
                    {activeEntry[1].state === "failed" && (
                      <span className="mt-2 flex items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={handleConnect}>
                          Retry
                        </Button>
                      </span>
                    )}
                    {activeEntry[1].state === "failed" && activeEntry[1].error && (
                      <span className="text-red-500 mt-2 block">
                        <Text size="xs">{activeEntry[1].error}</Text>
                      </span>
                    )}
                  </Surface>
                )}

                {/* Connected: the singular start() card, built from the manifests. */}
                {serverReady && (
                  <StoryPicker
                    stories={stories}
                    loading={shelfLoading}
                    error={startError}
                    starting={starting}
                    seed={seed}
                    onStart={startStory}
                  />
                )}

                {/* Your tasks: instant from localStorage, reconciled against the agent. */}
                {orderedTasks.length > 0 && (
                  <TaskList tasks={orderedTasks} onNavigate={navigate} onForget={forget} />
                )}
              </>
            )}

            {route.kind === "task" && agentState === undefined && (
              <Text size="xs" variant="secondary">
                {connectionStatus === "disconnected"
                  ? "disconnected from your agent — reconnecting…"
                  : "reading your agent's state…"}
              </Text>
            )}

            {route.kind === "task" && agentState !== undefined && playthrough === undefined && (
              <NotFound onNavigate={navigate} />
            )}

            {/* Running / ended: the stage is the centerpiece, the log alongside. */}
            {playthrough !== undefined && (
              <>
                {activeEntry === undefined && (
                  <Text size="xs" variant="secondary">
                    not connected to the story server: you can read this story; connect from the
                    start page to play on.
                  </Text>
                )}
                {startError !== undefined && (
                  <span className="block text-red-500">
                    <Text size="xs">{startError}</Text>
                  </span>
                )}
                <PlaythroughView
                  playthrough={playthrough}
                  nowMs={now}
                  manifest={manifest}
                  art={art}
                  localNotes={localNotes[playthrough.taskId] ?? NO_NOTES}
                  pendingChoice={
                    pendingChoice?.taskId === playthrough.taskId ? pendingChoice : undefined
                  }
                  answering={answering}
                  acting={acting}
                  cancelling={cancelling}
                  confirmingCancel={confirmCancel}
                  restarting={starting}
                  onAnswer={answerFork}
                  onPress={pressAction}
                  onConfirmCancel={() => setConfirmCancel(true)}
                  onAbandon={abandon}
                  onKeepGoing={() => setConfirmCancel(false)}
                  onRestart={restart}
                />
              </>
            )}

            {route.kind === "unknown" && <NotFound onNavigate={navigate} />}
          </div>
        </main>

        <Footer />
      </div>

      {/* Fixed over the page, outside the inert subtree. */}
      {activeEntry !== undefined && (
        <UtilitiesDrawer
          open={utilitiesShown}
          onClose={closeUtilities}
          view={playthrough?.view}
          nowMs={now}
          pollOverrideMs={pollOverrideMs}
          serverName={activeEntry[1].name}
          serverUrl={activeEntry[1].server_url}
          onSetPollRate={setPollRate}
          onPollNow={pollNow}
          seed={seed}
          onSetSeed={setSeed}
          onDisconnect={() => {
            closeUtilities();
            handleDisconnect(activeEntry[0]);
          }}
        />
      )}
    </TooltipProvider>
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root element");
}
createRoot(container).render(<App />);
