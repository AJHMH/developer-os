import { pinnedModelPrices } from "./spend-budget.js";
import type { CodingResult, ModelRoute } from "./feature-candidate.js";

/** The coding CLI a session runs (ADR 0003): Claude Code, the only coding
 * agent since ADR 0008. A session recorded without a provider ran Codex. */
export type CodingProvider = "claude";
/** One provider's locked command line and observed-turn contract. The
 * transport, admission, dispatch and collection stay provider-neutral; only
 * what a provider's CLI accepts and prints crosses this seam. `threadId` is
 * the provider's own conversation id, which a resume continues. */
export interface CodingAgent {
  readonly provider: CodingProvider;
  /** The locked argv before the prompt. */
  argv(threadId: string | undefined, route?: ModelRoute): string[];
  /** Validate a full observed transcript and name its conversation. */
  turn(
    result: CodingResult,
    expectedThread?: string,
  ): { threadId: string; completed: boolean };
  /** Whether a streamed event claims to bind the turn's conversation. */
  bindsThread(event: unknown): boolean;
  /** The valid conversation id a binding event names, if it names one. */
  boundThread(event: unknown): string | undefined;
}

export const modelRoutePort = 18091;
const threadPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** ADR 0008: delivered feature branches. */
export const featureBranchName = (id: string) => `aios/feature-${id}`;
export const featureBranchPattern = /^aios\/feature-[a-f0-9-]+$/;

/** The only built-in tools a Claude Code turn has. Each runs inside the
 * worker; none reaches the web, other agents or MCP servers. */
export const claudeCodeTools = Object.freeze([
  "Bash",
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
]);

/** The locked Claude Code argv before the prompt. A headless turn streams
 * its transcript, runs the fixed tool set without prompting and refuses any
 * other tool, starts no MCP server and reads settings only from its own
 * session home, never from the workspace. The model route comes from the
 * environment, so a routed turn's argv is the same. */
export function claudeCodeArgv(sessionId: string | undefined): string[] {
  if (sessionId !== undefined && !threadPattern.test(sessionId))
    throw Error("Invalid coding session");
  const tools = claudeCodeTools.join(",");
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    pinnedModelPrices.model,
    "--permission-mode",
    "dontAsk",
    "--tools",
    tools,
    "--allowedTools",
    tools,
    "--strict-mcp-config",
    "--setting-sources",
    "user",
    ...(sessionId ? ["--resume", sessionId] : []),
  ];
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
// Claude Code 2.1.311 also reports each tool task's start and end (seen on the
// real CLI); anything else is refused until it has been seen.
const claudeSystemSubtypes = new Set([
  "init",
  "api_retry",
  "compact_boundary",
  "task_started",
  "task_notification",
]);
const claudeResultSubtypes = new Set([
  "success",
  "error_max_turns",
  "error_during_execution",
  "error_max_budget_usd",
]);
const claudeBlocks: Record<"assistant" | "user", Set<string>> = {
  assistant: new Set(["text", "thinking", "redacted_thinking", "tool_use"]),
  user: new Set(["text", "tool_result", "image"]),
};

/** What a coding turn keeps of one stream-json event: its structure, never
 * its text, tool inputs or tool output. The guest records these, so a long
 * turn's transcript stays bounded. */
export function claudeEventSummary(event: unknown): Record<string, unknown> {
  if (!object(event)) throw Error("Invalid coding frame");
  const type = event.type,
    session = { session_id: event.session_id };
  if (type === "system") return { type, subtype: event.subtype, ...session };
  if (type === "result")
    return {
      type,
      subtype: event.subtype,
      is_error: event.is_error,
      num_turns: event.num_turns,
      ...session,
    };
  if (type === "assistant" || type === "user") {
    const message = object(event.message) ? event.message : {},
      content = message.content;
    return {
      type,
      ...session,
      parent_tool_use_id: event.parent_tool_use_id ?? null,
      message: {
        role: message.role,
        content:
          typeof content === "string"
            ? [{ type: "text" }]
            : Array.isArray(content)
              ? content.map((block) => ({
                  type: object(block) ? block.type : null,
                }))
              : null,
      },
    };
  }
  return { type, ...session };
}

/** Validates a Claude Code turn's summarized transcript strictly: the init
 * event first and naming the session,
 * every event in that session, only the fixed message kinds, and at most one
 * result, last. */
export function claudeCodeTurn(
  result: CodingResult,
  expectedThread?: string,
): { threadId: string; completed: boolean } {
  if (
    !Array.isArray(result.events) ||
    result.events.length > 4096 ||
    Buffer.byteLength(JSON.stringify(result.events)) > 65536
  )
    throw Error("Invalid coding events");
  let thread: string | undefined,
    terminal = false,
    completed = false;
  for (const event of result.events) {
    if (!object(event) || terminal) throw Error("Invalid coding ordering");
    if (!thread) {
      if (
        event.type !== "system" ||
        event.subtype !== "init" ||
        typeof event.session_id !== "string" ||
        !threadPattern.test(event.session_id) ||
        (expectedThread && expectedThread !== event.session_id)
      )
        throw Error("Invalid coding session");
      thread = event.session_id;
      continue;
    }
    if (event.session_id !== thread) throw Error("Invalid coding session");
    if (event.type === "system") {
      if (
        event.subtype === "init" ||
        !claudeSystemSubtypes.has(String(event.subtype))
      )
        throw Error("Unsupported coding event");
    } else if (event.type === "assistant" || event.type === "user") {
      const message = event.message,
        allowed = claudeBlocks[event.type];
      if (
        event.parent_tool_use_id !== null ||
        !object(message) ||
        message.role !== event.type ||
        !Array.isArray(message.content) ||
        message.content.some(
          (block) => !object(block) || !allowed.has(String(block.type)),
        )
      )
        throw Error("Unsupported coding item");
    } else if (event.type === "result") {
      if (
        !claudeResultSubtypes.has(String(event.subtype)) ||
        typeof event.is_error !== "boolean"
      )
        throw Error("Invalid coding completion");
      terminal = true;
      completed =
        event.subtype === "success" &&
        event.is_error === false &&
        result.exitCode === 0;
    } else throw Error("Unsupported coding event");
  }
  if (!thread) throw Error("Missing coding session");
  return { threadId: thread, completed };
}

export const claudeAgent: CodingAgent = Object.freeze({
  provider: "claude" as const,
  argv: (threadId: string | undefined) => claudeCodeArgv(threadId),
  turn: claudeCodeTurn,
  bindsThread(event: unknown): boolean {
    return object(event) && event.type === "system" && event.subtype === "init";
  },
  boundThread(event: unknown): string | undefined {
    if (!claudeAgent.bindsThread(event)) return undefined;
    const id = (event as Record<string, unknown>).session_id;
    return typeof id === "string" && threadPattern.test(id) ? id : undefined;
  },
});
