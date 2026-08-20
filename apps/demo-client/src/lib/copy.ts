/**
 * The UI's explanatory copy, verbatim as approved. Each fact about the MCP
 * Tasks wire — durable task, tasks/get polling, elicitation answered with
 * tasks/update, tasks/cancel — is said once across the whole UI, and lives
 * here so a repeat elsewhere is easy to spot.
 */

/** The MCP Tasks extension spec, linked from the footer. */
export const SPEC_URL = "https://modelcontextprotocol.io/extensions/tasks/overview";
export const REPO_URL = "https://github.com/mattzcarey/durable-mcp-server";

export const COPY = {
  /** The pre-connect card. */
  connectExplainer:
    "This page is an MCP client demoing an SDK for the MCP Tasks extension. Connect to the MCP server to try it out.",
  /** Under the start() name on the start card. */
  startCardBody: "Begin on an adventure. The adventure runs as a long running task.",
  /** The info icon beside start(). */
  startTooltip:
    "The story is a durable task execution. The page polls tasks/get for new text. At narrative forks the server sends an elicitation, answered with tasks/update. Ambient actions also use tasks/update. Cancel sends tasks/cancel.",
  /** The choice card's signpost icon. */
  hoverFork: "This question is an elicitation. Your answer goes out as tasks/update.",
  /** Each ambient action button, and the action bar's icon. */
  hoverAction: "Sends tasks/update. This action stays open for the whole story.",
  /** The cancel button. */
  hoverCancel: "Sends tasks/cancel. The story stops.",
  /** The log's book icon. */
  hoverLog: "Lines come from the task's statusMessage, fetched with tasks/get.",
  /** The footer sentence, split around its link. */
  footerBefore: "See the ",
  footerLink: "MCP Tasks extension",
  footerAfter: " spec. ",
  /** Second footer sentence: the repo link. */
  footerRepoLink: "See the code and try the durable tasks SDK",
  footerRepoAfter: ".",
} as const;
