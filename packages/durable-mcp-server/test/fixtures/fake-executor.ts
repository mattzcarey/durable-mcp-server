/**
 * Stage-2 test seam: a module-level switchable fake executor. The fixture's
 * TaskRunner subclass resolves it instead of the real entrypoint, so the DO
 * state machine is testable before stage 3 lands `runTask`. Tests share the
 * main worker's isolate (design/002 §2b), so flipping the module-level
 * behavior from a test is visible inside the DO.
 */

import type {
  DurableStepStub,
  RunOutcome,
  TaskExecutorLike,
  TaskInvocation,
} from "../../src/do/protocol";

export type FakeBehaviorName = "complete" | "throw" | "suspend" | "hang";

export type FakeBehavior =
  | FakeBehaviorName
  | ((desc: TaskInvocation, step: DurableStepStub) => Promise<RunOutcome>);

const DEFAULT_HANDOFF_MS = 14 * 60_000;

let behavior: FakeBehavior = "complete";
let handoffMs = DEFAULT_HANDOFF_MS;

/** Every invocation the fake received, in order. */
export const invocations: TaskInvocation[] = [];

/** The lease passed with each invocation (index-aligned with invocations). */
export const leases: DurableStepStub[] = [];

export function setFakeBehavior(next: FakeBehavior): void {
  behavior = next;
}

/** Overrides the fixture TaskRunner's alarm handoff deadline. */
export function setHandoffMs(ms: number): void {
  handoffMs = ms;
}

export function currentHandoffMs(): number {
  return handoffMs;
}

export function resetFakeExecutor(): void {
  behavior = "complete";
  handoffMs = DEFAULT_HANDOFF_MS;
  invocations.length = 0;
  leases.length = 0;
}

export function completedResult(text: string): RunOutcome {
  return { outcome: "completed", result: { content: [{ type: "text", text }] } };
}

export const fakeExecutor: TaskExecutorLike = {
  async runTask(desc: TaskInvocation, step: DurableStepStub): Promise<RunOutcome> {
    invocations.push(desc);
    leases.push(step);
    if (typeof behavior === "function") {
      return behavior(desc, step);
    }
    switch (behavior) {
      case "complete":
        return completedResult(`done:${desc.toolName}:${desc.attempt}`);
      case "throw":
        throw new Error("fake executor exploded");
      case "suspend":
        return { outcome: "suspended" };
      case "hang":
        return new Promise<never>(() => {
          // never settles; only eviction clears it
        });
    }
  },
};
