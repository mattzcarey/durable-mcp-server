/**
 * Structural validation for story graphs, beyond the zod shape: every route
 * target resolves, every reference (phase, resource, scene, sprite) is
 * declared, every node is reachable, no node is a dead end, the graph is
 * acyclic (a playthrough must terminate, and decision elicit keys — node ids
 * — must stay lifetime-unique per task), ambient-action sub-stories are
 * scoped (disjoint from the main line, no decisions, ending in a return or
 * an ending), decisions and endings are well-formed. The registry validates
 * at registration, so a broken story fails at load time, never
 * mid-playthrough.
 *
 * Every problem string starts with a stable "rule:" tag the tests match on:
 *   node-id, reserved-id, missing-start, unresolved-target, continuation,
 *   decision-question, duplicate-option, crisis-timeout, no-ending,
 *   duplicate-ending, duplicate-phase, unknown-phase, unknown-resource,
 *   unknown-scene, unknown-sprite, visual-needs-beat, duplicate-action,
 *   action-scope, return-scope, unreachable, dead-end, cycle
 */

import { KEBAB_CASE, type ActionSet, type Story, type StoryNode } from "./format";

/** Node ids that would collide with the interpreter's "actions-{n}" offer keys. */
const RESERVED_NODE_ID = /^actions-\d+$/;

interface Edge {
  from: string;
  to: string;
  via: string;
  /** An ambient-action edge (into a sub-story) rather than a main-line route. */
  action: boolean;
}

function actionEdges(from: string, actions: ActionSet | undefined, via: string): Edge[] {
  return (actions ?? []).map((action) => ({
    from,
    to: action.goto,
    via: `${via} "${action.id}"`,
    action: true,
  }));
}

function edgesOf(id: string, node: StoryNode): Edge[] {
  const edges: Edge[] = [];
  if (node.gate !== undefined) {
    edges.push({ from: id, to: node.gate.elseGoto, via: "gate.elseGoto", action: false });
  }
  if (node.next !== undefined) {
    edges.push({ from: id, to: node.next, via: "next", action: false });
  }
  if (node.decision !== undefined) {
    for (const option of node.decision.options) {
      edges.push({ from: id, to: option.goto, via: `option "${option.id}"`, action: false });
    }
    if (node.decision.fateGoto !== undefined) {
      edges.push({ from: id, to: node.decision.fateGoto, via: "decision.fateGoto", action: false });
    }
  }
  if (node.roll !== undefined) {
    for (const [index, branch] of node.roll.branches.entries()) {
      edges.push({ from: id, to: branch.goto, via: `roll branch ${index}`, action: false });
    }
  }
  edges.push(...actionEdges(id, node.actions, "action"));
  return edges;
}

/** Forward closure over `outgoing` from the given roots. */
function reach(roots: Iterable<string>, outgoing: Map<string, string[]>): Set<string> {
  const reached = new Set<string>(roots);
  const frontier = [...reached];
  for (;;) {
    const current = frontier.pop();
    if (current === undefined) {
      return reached;
    }
    for (const to of outgoing.get(current) ?? []) {
      if (!reached.has(to)) {
        reached.add(to);
        frontier.push(to);
      }
    }
  }
}

function checkActionSet(
  problems: string[],
  actions: ActionSet | undefined,
  owner: string,
  nodes: Record<string, StoryNode>,
): void {
  if (actions === undefined) {
    return;
  }
  const seen = new Set<string>();
  for (const action of actions) {
    if (seen.has(action.id)) {
      problems.push(`duplicate-action: ${owner} repeats action id "${action.id}"`);
    }
    seen.add(action.id);
    if (!(action.goto in nodes)) {
      problems.push(
        `unresolved-target: ${owner} action "${action.id}" points to unknown node "${action.goto}"`,
      );
    }
  }
}

/** Returns every problem in the story graph; an empty array means valid. */
export function validateStory(story: Story): string[] {
  const problems: string[] = [];
  const nodes = story.nodes;
  const ids = Object.keys(nodes);
  const phaseIds = new Set<string>();
  for (const phase of story.phases) {
    if (phaseIds.has(phase.id)) {
      problems.push(`duplicate-phase: phase id "${phase.id}" is declared twice`);
    }
    phaseIds.add(phase.id);
  }
  const resourceNames = new Set(Object.keys(story.resources));
  const sceneIds = new Set(Object.keys(story.scenes));
  const spriteIds = new Set(Object.keys(story.sprites));

  for (const id of ids) {
    if (!KEBAB_CASE.test(id)) {
      problems.push(`node-id: node id "${id}" must be kebab-case`);
    }
    if (RESERVED_NODE_ID.test(id)) {
      problems.push(`reserved-id: node id "${id}" collides with the ambient-action offer keys`);
    }
  }

  if (!(story.start in nodes)) {
    problems.push(`missing-start: start node "${story.start}" does not exist`);
  }
  if (!sceneIds.has(story.defaultScene)) {
    problems.push(`unknown-scene: defaultScene "${story.defaultScene}" is not a declared scene`);
  }
  checkActionSet(problems, story.actions, "the story", nodes);

  const edges: Edge[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    edges.push(...edgesOf(id, node));
  }
  for (const edge of edges) {
    if (!edge.action && !(edge.to in nodes)) {
      problems.push(
        `unresolved-target: node "${edge.from}" ${edge.via} points to unknown node "${edge.to}"`,
      );
    }
  }

  const checkEffects = (effects: Record<string, number> | undefined, owner: string): void => {
    for (const resource of Object.keys(effects ?? {})) {
      if (!resourceNames.has(resource)) {
        problems.push(`unknown-resource: ${owner} changes undeclared resource "${resource}"`);
      }
    }
  };

  const endingIds = new Map<string, string>();
  for (const [id, node] of Object.entries(nodes)) {
    const continuations = [node.ending, node.decision, node.roll, node.next, node.return].filter(
      (continuation) => continuation !== undefined,
    ).length;
    if (continuations !== 1) {
      problems.push(
        `continuation: node "${id}" must have exactly one of ending, decision, roll, next, ` +
          `or return (found ${continuations})`,
      );
    }

    if (node.phase !== undefined && !phaseIds.has(node.phase)) {
      problems.push(`unknown-phase: node "${id}" phase "${node.phase}" is not declared`);
    }
    checkEffects(node.effects, `node "${id}"`);
    if (node.gate !== undefined && !resourceNames.has(node.gate.resource)) {
      problems.push(
        `unknown-resource: node "${id}" gate reads undeclared resource "${node.gate.resource}"`,
      );
    }
    if (node.scene !== undefined && !sceneIds.has(node.scene)) {
      problems.push(`unknown-scene: node "${id}" scene "${node.scene}" is not declared`);
    }
    if (node.sprite !== undefined && !spriteIds.has(node.sprite.id)) {
      problems.push(`unknown-sprite: node "${id}" sprite "${node.sprite.id}" is not declared`);
    }
    if ((node.scene !== undefined || node.sprite !== undefined) && node.beats.length === 0) {
      problems.push(
        `visual-needs-beat: node "${id}" declares a scene or sprite but has no beat to carry it`,
      );
    }
    checkActionSet(problems, node.actions, `node "${id}"`, nodes);

    if (node.decision !== undefined) {
      if (!node.decision.scene.trimEnd().endsWith("?")) {
        problems.push(`decision-question: node "${id}" scene must end with its question ("?")`);
      }
      const seen = new Set<string>();
      for (const option of node.decision.options) {
        if (seen.has(option.id)) {
          problems.push(`duplicate-option: node "${id}" repeats option id "${option.id}"`);
        }
        seen.add(option.id);
        checkEffects(option.effects, `node "${id}" option "${option.id}"`);
      }
      const timed = node.decision.timeoutMs !== undefined;
      const fated = node.decision.fateGoto !== undefined;
      if (timed !== fated) {
        problems.push(`crisis-timeout: node "${id}" must declare timeoutMs and fateGoto together`);
      }
    }

    if (node.roll !== undefined) {
      for (const [index, branch] of node.roll.branches.entries()) {
        checkEffects(branch.effects, `node "${id}" roll branch ${index}`);
        if (branch.sprite !== undefined) {
          if (!spriteIds.has(branch.sprite.id)) {
            problems.push(
              `unknown-sprite: node "${id}" roll branch ${index} sprite "${branch.sprite.id}" is not declared`,
            );
          }
          if (branch.beat === undefined) {
            problems.push(
              `visual-needs-beat: node "${id}" roll branch ${index} fires a sprite without a beat`,
            );
          }
        }
      }
    }

    if (node.ending !== undefined) {
      const holder = endingIds.get(node.ending.id);
      if (holder !== undefined) {
        problems.push(
          `duplicate-ending: ending id "${node.ending.id}" appears on nodes "${holder}" and "${id}"`,
        );
      } else {
        endingIds.set(node.ending.id, id);
      }
    }
  }

  if (endingIds.size === 0) {
    problems.push("no-ending: the story has no ending node");
  }

  // Adjacency over resolvable targets: every edge, and main-line (non-action)
  // edges only. Story-level actions attach to the start node.
  const resolved = edges.filter((edge) => edge.to in nodes);
  const storyActions = actionEdges(story.start, story.actions, "story action").filter(
    (edge) => edge.to in nodes,
  );
  const allEdges = [...resolved, ...storyActions];
  const outgoing = new Map<string, string[]>(ids.map((id) => [id, []]));
  const mainOutgoing = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of allEdges) {
    outgoing.get(edge.from)?.push(edge.to);
    if (!edge.action) {
      mainOutgoing.get(edge.from)?.push(edge.to);
    }
  }

  // Scopes: the main line is what start reaches without pressing an action;
  // sub-stories are what action gotos reach. The two must be disjoint, and
  // sub-story nodes carry no decisions (elicit keys could repeat) and no
  // nested action sets.
  const mainLine = story.start in nodes ? reach([story.start], mainOutgoing) : new Set<string>();
  const subStory = reach(
    allEdges.filter((edge) => edge.action).map((edge) => edge.to),
    mainOutgoing,
  );
  for (const id of subStory) {
    const node = nodes[id];
    if (node === undefined) {
      continue;
    }
    if (mainLine.has(id)) {
      problems.push(
        `action-scope: node "${id}" is on the main line and inside an action sub-story`,
      );
    }
    if (node.decision !== undefined) {
      problems.push(`action-scope: sub-story node "${id}" must not carry a decision`);
    }
    if (node.actions !== undefined) {
      problems.push(`action-scope: sub-story node "${id}" must not declare an action set`);
    }
  }
  for (const id of mainLine) {
    if (nodes[id]?.return !== undefined) {
      problems.push(`return-scope: main-line node "${id}" has nowhere to return to`);
    }
  }

  // Forward reachability from start, over every edge kind.
  if (story.start in nodes) {
    const reached = reach([story.start], outgoing);
    for (const id of ids) {
      if (!reached.has(id)) {
        problems.push(`unreachable: node "${id}" cannot be reached from start`);
      }
    }
  }

  // Reverse reachability from terminal nodes (endings; returns count for
  // sub-story nodes): no dead ends anywhere, so every decision branch can
  // still reach an ending and every sub-story can hand control back.
  const incoming = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of allEdges) {
    if (!edge.action) {
      incoming.get(edge.to)?.push(edge.from);
    }
  }
  const reverseFrom = (roots: string[]): Set<string> => reach(roots, incoming);
  const endingNodes = ids.filter((id) => nodes[id]?.ending !== undefined);
  const returnNodes = ids.filter((id) => nodes[id]?.return !== undefined);
  const reachesEnding = reverseFrom(endingNodes);
  const reachesTerminal = reverseFrom([...endingNodes, ...returnNodes]);
  for (const id of ids) {
    if (subStory.has(id) && !mainLine.has(id)) {
      if (!reachesTerminal.has(id)) {
        problems.push(`dead-end: sub-story node "${id}" cannot reach a return or an ending`);
      }
    } else if (!reachesEnding.has(id)) {
      problems.push(`dead-end: node "${id}" cannot reach any ending`);
    }
  }

  // Cycle detection (iterative DFS, three colors) over every edge kind.
  // Acyclic graphs terminate and visit each main-line node at most once per
  // playthrough, which keeps decision elicit keys lifetime-unique.
  const color = new Map<string, "active" | "done">();
  for (const rootId of ids) {
    if (color.has(rootId)) {
      continue;
    }
    const stack: { id: string; nextIndex: number }[] = [{ id: rootId, nextIndex: 0 }];
    const path: string[] = [rootId];
    color.set(rootId, "active");
    while (stack.length > 0) {
      const frame = stack.at(-1);
      if (frame === undefined) {
        break;
      }
      const targets = outgoing.get(frame.id) ?? [];
      const target = targets[frame.nextIndex];
      if (target === undefined) {
        color.set(frame.id, "done");
        stack.pop();
        path.pop();
        continue;
      }
      frame.nextIndex += 1;
      const state = color.get(target);
      if (state === "active") {
        const loopStart = path.indexOf(target);
        const loop = [...path.slice(loopStart), target];
        problems.push(`cycle: ${loop.map((id) => `"${id}"`).join(" -> ")}`);
      } else if (state === undefined) {
        color.set(target, "active");
        stack.push({ id: target, nextIndex: 0 });
        path.push(target);
      }
    }
  }

  return problems;
}

/** Throws with every problem listed when the story graph is invalid. */
export function assertValidStory(story: Story): void {
  const problems = validateStory(story);
  if (problems.length > 0) {
    throw new Error(`invalid story "${story.id}":\n- ${problems.join("\n- ")}`);
  }
}
