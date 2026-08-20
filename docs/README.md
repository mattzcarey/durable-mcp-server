# docs/

The documentation for `durable-mcp-server` and the apps in this repository.

| Document | What it covers |
| --- | --- |
| [how-it-works.md](how-it-works.md) | The library: the three layers, the SQLite data model, the data flow for every request and alarm tick as pseudo callstacks over the real function names, replay and at-least-once semantics, reliability, the wire contract, limits and defaults, and an API reference. |
| [demo.md](demo.md) | The demo: the `task-server` story engine on the step API, the `demo-client` agent and its raw tasks lane, the per-task watch loop and materialized playthroughs, and the `examples/report-task` integration driven by hand. |
| [testing.md](testing.md) | The test harness: the rules, the four-layer matrix, what each suite drives as callstacks, deterministic alarm idioms, fixtures, and how to run everything. |

Start with how-it-works.md. The package README (`packages/durable-mcp-server/README.md`) is the quickstart.
