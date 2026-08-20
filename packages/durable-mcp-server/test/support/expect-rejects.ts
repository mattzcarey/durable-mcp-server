/**
 * Rejection assertion for DO RPC promises. `expect(promise).rejects` attaches
 * its handler a tick too late for the workers pool: workerd flags the RPC
 * promise as an unhandled rejection inside the Durable Object and vitest
 * counts it as a test-run error. Awaiting inside try/catch in the same
 * microtask (exactly what the vendored tryWhile does) keeps the rejection
 * handled.
 */

import { expect } from "vitest";

export async function expectRejects(promise: Promise<unknown>, matcher: RegExp): Promise<void> {
  let message: string | undefined;
  try {
    await promise;
  } catch (error) {
    message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  if (message === undefined) {
    throw new Error(`expected rejection matching ${matcher}, but the promise resolved`);
  }
  expect(message).toMatch(matcher);
}
