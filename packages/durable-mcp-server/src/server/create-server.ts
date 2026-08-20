/**
 * The user-supplied server factory shape (docs/how-it-works.md §2 (the three layers) and §7 (wire contract), as amended
 * 2026-08-21): `createServer` takes NO arguments. Code that needs bindings
 * imports `env` from `cloudflare:workers` (available everywhere at
 * compatibility date 2026-08-20); an `ExecutionContext` captured at
 * server-construction time would be dead in later invocations, and
 * `waitUntil` must not be exposed to task handlers.
 */

import type { McpServer } from "./mcp-server";

/**
 * Builds a fresh {@link McpServer} for one serving unit. Construction is
 * per-request under `createMcpHandler` and per-invocation in the executor —
 * the factory must be cheap and side-effect free.
 */
export type CreateServer = () => McpServer;
