/**
 * The client is story-agnostic: the same components render whatever the
 * server publishes. Two different manifests — the datacenter build-out and
 * the Odyssey — go through the picker, the phase checklist, the stage, and
 * the ending card here with nothing story-specific in the components.
 * Static render (no DOM), so hooks run their first pass only.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type DetailedTask, DetailedTaskSchema } from "../mcp-tasks/schema";
import { COPY } from "../lib/copy";
import { newPlaythrough, observePlaythrough, type Playthrough } from "../lib/playthrough";
import { parseRoute, routedTaskId, taskPath } from "../lib/route";
import { parseManifest, sanitizeSvg, type StoryManifest } from "../lib/story-resources";
import type { TaskObservation, TaskView } from "../lib/tasks";
import type { MyAgentState } from "../server";
import { ActionBar } from "./ActionBar";
import { AdventureLog } from "./AdventureLog";
import { CancelTask } from "./CancelTask";
import { ChoicePanel } from "./ChoicePanel";
import { EndingCard } from "./EndingCard";
import { Footer } from "./Footer";
import { PhaseChecklist } from "./PhaseChecklist";
import { mergeLog, PlaythroughView } from "./PlaythroughView";
import { Stage } from "./Stage";
import { StoryPicker } from "./StoryPicker";
import { TaskList } from "./TaskList";
import { UtilitiesDrawer } from "./UtilitiesDrawer";

/**
 * Kumo's tooltip (Base UI) mounts its popup in a portal only while open, so a
 * static render shows the trigger — marked `data-base-ui-tooltip-trigger` —
 * and never the popup. The tooltip text does reach the render once per
 * trigger, as the trigger's accessible description (an sr-only span named by
 * its aria-describedby); the approved strings themselves are pinned verbatim
 * in `../lib/copy.test.ts`.
 */
const TRIGGER = /data-base-ui-tooltip-trigger=""/g;

function triggers(html: string): number {
  return html.match(TRIGGER)?.length ?? 0;
}

function count(html: string, text: string): number {
  return html.split(text).length - 1;
}

/** What React's static markup makes of a copy string (it escapes quotes). */
const escapeHtml = (text: string): string => text.replaceAll("'", "&#x27;");

/** The accessible description of every described element, in DOM order. */
function descriptions(html: string): string[] {
  return [...html.matchAll(/aria-describedby="([^"]+)"/g)].map(([, id]) => {
    const open = `<span id="${id}" class="sr-only">`;
    const start = html.indexOf(open);
    if (start < 0) return "";
    const from = start + open.length;
    return html.slice(from, html.indexOf("</span>", from));
  });
}

const DATACENTER = parseManifest({
  id: "datacenter",
  title: "The Datacenter",
  blurb: "Break ground in the high desert. Keep the lights on.",
  phases: [
    { id: "site", label: "Site" },
    { id: "permits", label: "Permits" },
    { id: "power", label: "Power" },
    { id: "gpus", label: "GPUs" },
    { id: "online", label: "Online" },
  ],
  defaultScene: "story://datacenter/scenes/empty-site",
  accent: "#f6821f",
});

const ODYSSEY = parseManifest({
  id: "odyssey",
  title: "The Odyssey",
  blurb: "Ten years from Troy to Ithaca, if the gods allow it.",
  phases: [
    { id: "troy", label: "Troy" },
    { id: "polyphemus", label: "Polyphemus" },
    { id: "sirens", label: "The Sirens" },
    { id: "ithaca", label: "Ithaca" },
  ],
  defaultScene: "story://odyssey/scenes/boat",
  accent: "teal",
});

function must(manifest: StoryManifest | undefined): StoryManifest {
  if (manifest === undefined) {
    throw new Error("fixture manifest failed to parse");
  }
  return manifest;
}

const stories = [must(DATACENTER), must(ODYSSEY)];

describe("StoryPicker", () => {
  it("builds one tile per manifest with title, blurb, and accent, and one start button", () => {
    const html = renderToStaticMarkup(
      <StoryPicker stories={stories} loading={false} starting={false} onStart={() => undefined} />,
    );
    expect(html).toContain("start()");
    expect(html).toContain("The Datacenter");
    expect(html).toContain("Break ground in the high desert.");
    expect(html).toContain("The Odyssey");
    expect(html).toContain("Ten years from Troy to Ithaca");
    expect(html).toContain("--story-accent:#f6821f");
    expect(html).toContain("--story-accent:teal");
    expect(html.match(/Start the story/g)).toHaveLength(1);
    // The first manifest is selected by default.
    expect(html).toContain('aria-checked="true"');
  });

  it("says what start() does once, and keeps the wire detail behind the info icon", () => {
    const html = renderToStaticMarkup(
      <StoryPicker stories={stories} loading={false} starting={false} onStart={() => undefined} />,
    );
    expect(count(html, COPY.startCardBody)).toBe(1);
    // The old paragraph and the server's tool description are gone from the card.
    expect(html).not.toContain("Long-running");
    expect(html).not.toContain("survives restarts");
    expect(html).not.toContain("Cancel is always on the table");
    // One info-icon trigger beside the name; the wire detail is its
    // description, once, and nowhere else on the card.
    expect(html).toContain('aria-label="About start()"');
    expect(triggers(html)).toBe(1);
    expect(descriptions(html)).toEqual([COPY.startTooltip]);
    expect(count(html, COPY.startTooltip)).toBe(1);
  });

  it("explains an empty shelf and still offers a typed story id", () => {
    const html = renderToStaticMarkup(
      <StoryPicker stories={[]} loading={false} starting={false} onStart={() => undefined} />,
    );
    expect(html).toContain("lists no story manifests");
    expect(html).toContain('placeholder="story id"');
  });
});

describe("PhaseChecklist", () => {
  it("lights the seen phases of either manifest and shows the build meter", () => {
    for (const [manifest, seen, current] of [
      [must(DATACENTER), ["site", "permits"], "permits"],
      [must(ODYSSEY), ["troy", "polyphemus", "sirens"], "sirens"],
    ] as const) {
      const html = renderToStaticMarkup(
        <PhaseChecklist
          phases={manifest.phases}
          seen={[...seen]}
          current={current}
          build={0.42}
          ended={false}
        />,
      );
      for (const phase of manifest.phases) {
        expect(html).toContain(phase.label);
      }
      expect(html).toContain("42%");
      expect(html).toContain("animate-pulse");
    }
  });

  it("still lists a phase the meta names but the manifest does not", () => {
    const html = renderToStaticMarkup(
      <PhaseChecklist phases={[]} seen={["wildlife"]} current="wildlife" build={0} ended={false} />,
    );
    expect(html).toContain("wildlife");
  });
});

describe("Stage", () => {
  const scene = sanitizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="navy"/><script>alert(1)</script></svg>',
  );
  const sprite = sanitizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><circle cx="80" cy="45" r="10" fill="white"/></svg>',
  );

  it("inlines the sanitized scene and sprites with the build variable set", () => {
    const html = renderToStaticMarkup(
      <Stage
        title="The Odyssey"
        accent="teal"
        scene={{ uri: "story://odyssey/scenes/boat", svg: scene }}
        sprites={[
          { id: "s1", uri: "story://odyssey/sprites/cyclops", svg: sprite, persist: true },
          { id: "s2", uri: "story://odyssey/sprites/storm", svg: sprite, persist: false },
        ]}
        nudges={3}
        build={0.5}
        phaseLabel="Polyphemus"
        running
      />,
    );
    expect(html).toContain("--build-progress:0.500");
    expect(html).toContain("--story-accent:teal");
    expect(html).toContain('fill="navy"');
    expect(html).not.toContain("<script");
    expect(html).toContain("sprite-pin");
    expect(html).toContain("sprite-fade");
    expect(html).toContain("stage-nudge-odd");
    expect(html).toContain("Polyphemus");
    expect(html).toContain("completion 50%");
  });

  it("goes dark with the title when there is no scene art, and keeps playing on failure", () => {
    const dark = renderToStaticMarkup(
      <Stage title="The Datacenter" sprites={[]} nudges={0} build={0} running={false} />,
    );
    expect(dark).toContain("The Datacenter");
    expect(dark).toContain("the stage is dark");
    expect(dark).not.toContain("stage-nudge");
    const failed = renderToStaticMarkup(
      <Stage
        title="The Datacenter"
        scene={{ uri: "story://datacenter/scenes/x", svg: null }}
        sprites={[]}
        nudges={0}
        build={0}
        running
      />,
    );
    expect(failed).toContain("could not be read");
  });

  it("renders the scene whose art is in hand, and stays dark while it loads", () => {
    const loading = renderToStaticMarkup(
      <Stage
        title="The Odyssey"
        scene={{ uri: "story://odyssey/scenes/boat", svg: undefined }}
        sprites={[]}
        nudges={0}
        build={0}
        running
      />,
    );
    expect(loading).toContain("setting the stage…");
    expect(loading).not.toContain("scene-in");
    const ready = renderToStaticMarkup(
      <Stage
        title="The Odyssey"
        scene={{ uri: "story://odyssey/scenes/boat", svg: scene }}
        sprites={[]}
        nudges={0}
        build={0}
        running
      />,
    );
    expect(ready).toContain("scene-in");
    expect(ready).not.toContain("scene-out");
    expect(ready).toContain('fill="navy"');
  });
});

describe("AdventureLog", () => {
  it("renders every entry kind with the manifest's phase labels", () => {
    const html = renderToStaticMarkup(
      <AdventureLog
        entries={[
          { kind: "beat", id: 1, seq: 1, text: "We leave Troy burning.", phase: "troy", atMs: 0 },
          {
            kind: "fork",
            id: 2,
            key: "bag-of-winds",
            scene: "Stop them?",
            options: [{ id: "stop", label: "Stop them" }],
            atMs: 0,
          },
          { kind: "choice", id: 3, key: "bag-of-winds", label: "Stop them", atMs: 0 },
          { kind: "fate", id: 4, key: "other", atMs: 0 },
          { kind: "action", id: 5, key: "actions-1", label: "Consult the gods", atMs: 0 },
          { kind: "note", id: 6, text: "art missing: story://x", atMs: 0 },
          {
            kind: "ending",
            id: 7,
            endingId: "home-at-last",
            text: "Home.",
            tone: "triumph",
            atMs: 0,
          },
        ]}
        phaseLabels={{ troy: "Troy" }}
        waiting={false}
      />,
    );
    expect(html).toContain("Troy");
    expect(html).toContain("We leave Troy burning.");
    // A closed fork is a compact record of the question in the log.
    expect(html).toContain("asked");
    expect(html).toContain("Stop them?");
    expect(html).toContain("you chose: Stop them");
    // Newest first: the ending (last entry) renders before the first beat.
    expect(html.indexOf("ending: home-at-last")).toBeLessThan(
      html.indexOf("We leave Troy burning."),
    );
    expect(html).toContain("fate decided");
    expect(html).toContain("Consult the gods");
    expect(html).toContain("art missing");
    expect(html).toContain("ending: home-at-last");
  });

  it("makes the book icon the one hint about where lines come from", () => {
    const html = renderToStaticMarkup(
      <AdventureLog entries={[]} phaseLabels={{}} waiting={false} />,
    );
    expect(html).toContain('aria-label="About the log"');
    expect(triggers(html)).toBe(1);
    expect(descriptions(html)).toEqual([escapeHtml(COPY.hoverLog)]);
    expect(count(html, "statusMessage")).toBe(1);
  });
});

describe("ActionBar", () => {
  const actions = {
    key: "actions-1",
    options: [
      { id: "gods", label: "Consult the gods" },
      { id: "row", label: "Row harder" },
    ],
  };

  it("renders one tooltip-bearing button per option plus the bar's icon", () => {
    const html = renderToStaticMarkup(
      <ActionBar
        actions={actions}
        spent={false}
        disabled={false}
        busy={false}
        onPress={() => {}}
      />,
    );
    expect(html).toContain("at any time:");
    expect(html).toContain("Consult the gods");
    expect(html).toContain("Row harder");
    expect(html).toContain('aria-label="About these actions"');
    expect(triggers(html)).toBe(3);
    // One description per trigger (the icon and each button), same text.
    expect(descriptions(html)).toEqual([COPY.hoverAction, COPY.hoverAction, COPY.hoverAction]);
    expect(count(html, "tasks/update")).toBe(3);
    // A tooltip-bearing button is still a button: pointer cursor, not Kumo's
    // trigger default.
    expect(html).not.toContain("cursor-default");
    expect(html).toContain("cursor-pointer");
  });

  it("locks and relabels once the key is spent", () => {
    const html = renderToStaticMarkup(
      <ActionBar actions={actions} spent disabled={false} busy={false} onPress={() => {}} />,
    );
    expect(html).toContain("the story is weighing your call…");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});

describe("CancelTask", () => {
  it("offers cancel as a tooltip-bearing button, then a bare confirm", () => {
    const button = renderToStaticMarkup(
      <CancelTask
        confirming={false}
        cancelling={false}
        requested={false}
        onConfirm={() => {}}
        onAbandon={() => {}}
        onKeep={() => {}}
      />,
    );
    expect(button).toContain("Cancel the task");
    expect(triggers(button)).toBe(1);
    expect(descriptions(button)).toEqual([COPY.hoverCancel]);
    expect(button).not.toContain("cursor-default");
    const confirm = renderToStaticMarkup(
      <CancelTask
        confirming
        cancelling={false}
        requested={false}
        onConfirm={() => {}}
        onAbandon={() => {}}
        onKeep={() => {}}
      />,
    );
    expect(confirm).toContain("Abandon the story?");
    expect(confirm).toContain("Yes, abandon");
    expect(confirm).toContain("Keep going");
    // The wire fact lives with the cancel button, once — not repeated in the confirm.
    expect(confirm).not.toContain("tasks/cancel");
    expect(triggers(confirm)).toBe(0);
  });
});

describe("Footer", () => {
  it("links the MCP Tasks extension spec in a new tab", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain("See the ");
    expect(html).toContain(">MCP Tasks extension</a>");
    expect(html).toContain(" spec.");
    expect(html).toContain('href="https://modelcontextprotocol.io/extensions/tasks/overview"');
    expect(html).toContain('href="https://github.com/mattzcarey/durable-mcp-server"');
    expect(html).toContain("See the code and try the durable tasks SDK");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe("UtilitiesDrawer", () => {
  const view: TaskView = {
    serverId: "srv",
    taskId: "task-abc123",
    status: "working",
    seq: 3,
    updates: 3,
    createdAtMs: 0,
    lastUpdatedAtMs: 4_000,
    observedAtMs: 4_000,
    statusSinceMs: 4_000,
    polledAtMs: 4_500,
    nextPollAtMs: 5_500,
    terminal: false,
  };
  const props = {
    view,
    nowMs: 5_000,
    pollOverrideMs: 1000,
    serverName: "task-server",
    serverUrl: "http://localhost:8787/mcp",
    onClose: () => {},
    onSetPollRate: () => {},
    onPollNow: () => {},
    onDisconnect: () => {},
    seed: 7,
    onSetSeed: () => {},
  };

  it("is a labelled dialog carrying everything the utilities card had", () => {
    const html = renderToStaticMarkup(<UtilitiesDrawer open {...props} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Utilities"');
    expect(html).toContain('aria-label="Close utilities"');
    for (const label of ["auto", "0.5s", "1s", "2s"]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain("Poll now");
    expect(html).toContain("task-abc123");
    expect(html).toContain("working");
    expect(html).toContain("0.5s ago");
    expect(html).toContain("task-server · http://localhost:8787/mcp");
    expect(html).toContain('aria-label="Disconnect server"');
    expect(html).toContain("Story randomness seed");
    expect(html).toContain('value="7"');
  });

  it("renders nothing while closed", () => {
    expect(renderToStaticMarkup(<UtilitiesDrawer open={false} {...props} />)).toBe("");
  });
});

describe("AdventureLog header", () => {
  it("is titled Story", () => {
    const html = renderToStaticMarkup(
      <AdventureLog entries={[]} phaseLabels={{}} waiting={false} />,
    );
    expect(html).toContain(">Story<");
    expect(html).not.toContain("The log");
  });
});

describe("AdventureLog with an open fork", () => {
  it("renders the live choice panel in the fork entry's slot, at the top", () => {
    const html = renderToStaticMarkup(
      <AdventureLog
        entries={[
          { kind: "beat", id: 1, seq: 1, text: "We leave Troy burning.", phase: "troy", atMs: 0 },
          {
            kind: "fork",
            id: 2,
            key: "bag-of-winds",
            scene: "Open the bag?",
            options: [{ id: "open", label: "Open it" }],
            atMs: 0,
          },
        ]}
        phaseLabels={{}}
        waiting={false}
        openFork={{ key: "bag-of-winds", panel: <div data-testid="live-panel">PANEL</div> }}
      />,
    );
    expect(html).toContain("PANEL");
    expect(html).not.toContain(">asked<");
    expect(html.indexOf("PANEL")).toBeLessThan(html.indexOf("We leave Troy burning."));
  });
});

describe("ChoicePanel", () => {
  it("leads with the scene question and one button per option, no preamble", () => {
    const html = renderToStaticMarkup(
      <ChoicePanel
        fork={{
          key: "heat-reuse",
          scene: "Where does Nortada One's waste heat go?",
          options: [
            { id: "pool", label: "The municipal pool" },
            { id: "greenhouse", label: "A tomato greenhouse" },
          ],
        }}
        askSinceMs={0}
        nowMs={0}
        busy={false}
        onChoose={() => {}}
      />,
    );
    expect(html).toContain("Where does Nortada One&#x27;s waste heat go?");
    expect(html).toContain("The municipal pool");
    expect(html).toContain("A tomato greenhouse");
    expect(html).not.toContain("Your call");
    expect(html).not.toContain("The story waits for you");
    // The signpost icon is the one hint that this is an elicitation.
    expect(html).toContain('aria-label="About this question"');
    expect(triggers(html)).toBe(1);
    expect(descriptions(html)).toEqual([COPY.hoverFork]);
    expect(count(html, "elicitation")).toBe(1);
  });
});

describe("EndingCard", () => {
  it("tones the card by the ending, shows the final art, and offers Restart", () => {
    const art = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="gold"/></svg>');
    const triumph = renderToStaticMarkup(
      <EndingCard
        ending={{ endingId: "home-at-last", text: "Ithaca.", tone: "triumph" }}
        art={art}
        restarting={false}
        onRestart={() => undefined}
      />,
    );
    expect(triumph).toContain("Triumph");
    expect(triumph).toContain("home-at-last");
    expect(triumph).toContain('fill="gold"');
    expect(triumph).toContain("Restart");
    const disaster = renderToStaticMarkup(
      <EndingCard
        ending={{ endingId: "bankrupt", text: "Dust.", tone: "disaster" }}
        restarting={false}
        onRestart={() => undefined}
      />,
    );
    expect(disaster).toContain("Disaster");
    const abandoned = renderToStaticMarkup(
      <EndingCard
        ending={{ endingId: "abandoned", text: "You walked away.", tone: "abandoned" }}
        restarting
        onRestart={() => undefined}
      />,
    );
    expect(abandoned).toContain("Abandoned");
    expect(abandoned).toContain("Starting…");
  });
});

describe("TaskList", () => {
  it("lists each task as a link to its page with its status, and a forget control", () => {
    const html = renderToStaticMarkup(
      <TaskList
        tasks={[
          {
            taskId: "run-1",
            storyId: "odyssey",
            storyTitle: "The Odyssey",
            startedAt: 0,
            status: "input_required",
          },
          { taskId: "done-1", storyId: "datacenter", startedAt: 0, status: "completed" },
        ]}
        onNavigate={() => undefined}
        onForget={() => undefined}
      />,
    );
    expect(html).toContain("Your tasks");
    expect(html).toContain('href="/task/run-1"');
    expect(html).toContain('href="/task/done-1"');
    expect(html).toContain("The Odyssey");
    expect(html).toContain("datacenter"); // no title known: the id stands in
    expect(html).toContain("input_required");
    expect(html).toContain("completed");
    expect(html).toContain('aria-label="Forget task run-1"');
    expect(html).toContain('aria-label="Forget task done-1"');
  });
});

/* The routed playthrough: the page renders exactly the task in the URL. */

const T0 = Date.parse("2026-08-22T10:00:00Z");

const snapshot = (taskId: string, overrides: Record<string, unknown> = {}): DetailedTask =>
  DetailedTaskSchema.parse({
    taskId,
    status: "working",
    createdAt: "2026-08-22T10:00:00Z",
    lastUpdatedAt: "2026-08-22T10:00:01Z",
    ttlMs: null,
    ...overrides,
  });

const observed = (taskId: string, seq: number, statusMessage: string): TaskObservation => ({
  serverId: "srv",
  taskId,
  seq,
  observedAt: T0 + seq * 1000,
  task: snapshot(taskId, { statusMessage }),
});

/** A playthrough with the given beats, folded the way the agent folds them. */
function played(taskId: string, storyId: string, beats: string[]): Playthrough {
  let playthrough = newPlaythrough({
    taskId,
    serverId: "srv",
    storyId,
    status: "working",
    nowMs: T0,
  });
  beats.forEach((beat, index) => {
    const observation = observed(taskId, index + 1, beat);
    playthrough = observePlaythrough(playthrough, observation, observation.observedAt);
  });
  return playthrough;
}

const viewProps = {
  nowMs: T0 + 10_000,
  art: {},
  localNotes: [],
  answering: false,
  acting: false,
  cancelling: false,
  confirmingCancel: false,
  restarting: false,
  onAnswer: () => undefined,
  onPress: () => undefined,
  onConfirmCancel: () => undefined,
  onAbandon: () => undefined,
  onKeepGoing: () => undefined,
  onRestart: () => undefined,
};

describe("the routed playthrough (the bug this design removes)", () => {
  // Two stories running at once in ONE agent state: an older Odyssey still
  // going, and a Datacenter started later. The page at /task/<datacenter>
  // must show the datacenter's log and none of the Odyssey's lines.
  const older = played("task-older", "odyssey", [
    "We leave Troy burning.",
    "The Cicones fight back.",
    "We row for open sea.",
  ]);
  const newer = played("task-newer", "datacenter", ["Survey stakes go in at dawn."]);
  const state: MyAgentState = {
    taskWatches: {},
    playthroughs: { [older.taskId]: older, [newer.taskId]: newer },
  };

  it("renders only the routed task's log when the state holds two playthroughs", () => {
    const route = parseRoute(taskPath(newer.taskId));
    const taskId = routedTaskId(route);
    expect(taskId).toBe("task-newer");
    const routed = taskId === undefined ? undefined : state.playthroughs[taskId];
    expect(routed).toBeDefined();
    if (routed === undefined) return;
    const html = renderToStaticMarkup(
      <PlaythroughView playthrough={routed} manifest={must(DATACENTER)} {...viewProps} />,
    );
    expect(html).toContain("Survey stakes go in at dawn.");
    expect(html).not.toContain("We leave Troy burning.");
    expect(html).not.toContain("The Cicones fight back.");
    expect(html).not.toContain("We row for open sea.");
    expect(html).toContain("The Datacenter");
  });

  it("and the older task's page still shows the whole older log, untouched", () => {
    const route = parseRoute(taskPath(older.taskId));
    const taskId = routedTaskId(route);
    const routed = taskId === undefined ? undefined : state.playthroughs[taskId];
    expect(routed).toBeDefined();
    if (routed === undefined) return;
    const html = renderToStaticMarkup(
      <PlaythroughView playthrough={routed} manifest={must(ODYSSEY)} {...viewProps} />,
    );
    expect(html).toContain("We leave Troy burning.");
    expect(html).toContain("The Cicones fight back.");
    expect(html).toContain("We row for open sea.");
    expect(html).not.toContain("Survey stakes go in at dawn.");
  });

  it("shows the open ask in its slot, the ending card, and the first-poll wait", () => {
    const asking = observePlaythrough(
      older,
      {
        serverId: "srv",
        taskId: older.taskId,
        seq: 4,
        observedAt: T0 + 4000,
        task: snapshot(older.taskId, {
          status: "input_required",
          statusMessage: "The crew eyes the bag.",
          inputRequests: {
            "bag-of-winds": {
              method: "elicitation/create",
              params: {
                message: "Stop them?\n- stop: Stop them\n- sleep: Sleep on",
                requestedSchema: {
                  type: "object",
                  properties: { choice: { type: "string", enum: ["stop", "sleep"] } },
                },
              },
            },
          },
        }),
      },
      T0 + 4000,
    );
    const asked = renderToStaticMarkup(
      <PlaythroughView
        playthrough={asking}
        {...viewProps}
        pendingChoice={{ key: "bag-of-winds", label: "Stop them" }}
      />,
    );
    expect(asked).toContain("Stop them?");
    expect(asked).toContain("You chose: Stop them. The story is taking it in…");
    expect(asked).toContain("Cancel the task");

    const ended = observePlaythrough(
      asking,
      {
        serverId: "srv",
        taskId: older.taskId,
        seq: 5,
        observedAt: T0 + 5000,
        task: snapshot(older.taskId, {
          status: "completed",
          result: { content: [{ type: "text", text: "[ending:home-at-last] Ithaca." }] },
        }),
      },
      T0 + 5000,
    );
    const done = renderToStaticMarkup(<PlaythroughView playthrough={ended} {...viewProps} />);
    expect(done).toContain("Triumph");
    expect(done).toContain("Restart");
    expect(done).toContain("ending: home-at-last");
    expect(done).toContain("fate decided");
    expect(done).not.toContain("Cancel the task");

    const fresh = renderToStaticMarkup(
      <PlaythroughView
        playthrough={newPlaythrough({
          taskId: "t",
          serverId: "srv",
          storyId: "odyssey",
          storyTitle: "The Odyssey",
          defaultScene: "story://odyssey/scenes/boat",
          status: "working",
          nowMs: T0,
        })}
        {...viewProps}
      />,
    );
    expect(fresh).toContain("waiting for the first poll of the task…");
    expect(fresh).toContain("The Odyssey");
  });

  it("merges the page's own notes into the log by time, agent lines first on ties", () => {
    const merged = mergeLog(
      [
        { kind: "beat", id: 1, seq: 1, text: "a", atMs: 100 },
        { kind: "beat", id: 2, seq: 2, text: "b", atMs: 300 },
      ],
      [
        { kind: "note", id: -1, text: "n1", atMs: 100 },
        { kind: "note", id: -2, text: "n2", atMs: 200 },
        { kind: "note", id: -3, text: "n3", atMs: 400 },
      ],
    );
    expect(merged.map((entry) => entry.id)).toEqual([1, -1, -2, 2, -3]);
    const entries = [{ kind: "beat" as const, id: 1, seq: 1, text: "a", atMs: 100 }];
    expect(mergeLog(entries, [])).toEqual(entries);
  });
});

describe("Restart", () => {
  it("is a NEW task under a new id, routed to, with the old playthrough intact", () => {
    const ended = observePlaythrough(
      played("first-run", "odyssey", ["Ithaca on the horizon."]),
      {
        serverId: "srv",
        taskId: "first-run",
        seq: 2,
        observedAt: T0 + 2000,
        task: snapshot("first-run", {
          status: "completed",
          result: { content: [{ type: "text", text: "Fin." }] },
        }),
      },
      T0 + 2000,
    );
    // The agent creates the second run as its own playthrough…
    const again = newPlaythrough({
      taskId: "second-run",
      serverId: "srv",
      storyId: ended.storyId,
      defaultScene: must(ODYSSEY).defaultScene,
      status: "working",
      nowMs: T0 + 9000,
    });
    const playthroughs = { [ended.taskId]: ended, [again.taskId]: again };
    // …and the page routes to it: a different path, naming the new task.
    const path = taskPath(again.taskId);
    expect(path).not.toBe(taskPath(ended.taskId));
    expect(routedTaskId(parseRoute(path))).toBe("second-run");
    expect(playthroughs["second-run"]?.log).toEqual([]);
    expect(playthroughs["first-run"]?.ending).toBeDefined();
    expect(playthroughs["first-run"]?.log.map((entry) => entry.kind)).toEqual(["beat", "ending"]);
  });
});
