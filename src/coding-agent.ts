import { gatewayModel } from "./inference-contract.js";
import type { CodingResult, ModelRoute } from "./feature-candidate.js";

/** The coding CLI a session runs (ADR 0003). A session recorded without one
 * ran Codex, the only provider admitted today. */
export type CodingProvider = "codex";
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
export const modelRouteVariable = "AIOS_MODEL_ROUTE";
const threadPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** The locked Codex argv before the prompt. Offline turns keep Codex's own
 * workspace-write sandbox. A routed turn runs with full access inside the
 * hardened container, the only sandbox that can start there (ADR 0002
 * amendment), and fixed provider overrides with no config file. */
export function lockedCodingArgv(
  threadId: string | undefined,
  route?: ModelRoute,
): string[] {
  const sandbox = route ? "danger-full-access" : "workspace-write";
  const provider = "model_providers.aios.";
  const overrides = route
    ? [
        'model_provider="aios"',
        `${provider}name="AIOS session relay"`,
        `${provider}base_url="http://127.0.0.1:${modelRoutePort}/v1"`,
        `${provider}env_key="${modelRouteVariable}"`,
        `${provider}wire_api="responses"`,
        `${provider}requires_openai_auth=false`,
        `${provider}supports_websockets=false`,
        `${provider}http_headers.X-AIOS-Delivery="${route.deliveryId}"`,
        `model="${gatewayModel}"`,
      ].flatMap((value) => ["-c", value])
    : [];
  // `exec resume` has no --sandbox flag; pin the same mode by explicit override.
  return threadId
    ? [
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        "-c",
        `sandbox_mode="${sandbox}"`,
        ...overrides,
        threadId,
      ]
    : [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--sandbox",
        sandbox,
        ...overrides,
      ];
}

export function codingTurn(
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
    started = false,
    terminal = false,
    completed = false;
  for (const item of result.events) {
    if (!item || typeof item !== "object" || terminal)
      throw Error("Invalid coding ordering");
    const event = item as Record<string, unknown>;
    if (event.type === "thread.started") {
      if (
        thread ||
        started ||
        typeof event.thread_id !== "string" ||
        !threadPattern.test(event.thread_id) ||
        (expectedThread && expectedThread !== event.thread_id)
      )
        throw Error("Invalid coding session");
      thread = event.thread_id;
    } else if (event.type === "turn.started") {
      if (!thread || started) throw Error("Invalid coding turn");
      started = true;
    } else if (
      event.type === "turn.completed" ||
      event.type === "turn.failed"
    ) {
      if (!started) throw Error("Invalid coding completion");
      terminal = true;
      completed = event.type === "turn.completed" && result.exitCode === 0;
    } else if (
      ["item.started", "item.updated", "item.completed"].includes(
        String(event.type),
      )
    ) {
      const value = event.item as Record<string, unknown> | undefined;
      if (
        !started ||
        !value ||
        ![
          "agent_message",
          "reasoning",
          "command_execution",
          "file_change",
          "todo_list",
        ].includes(String(value.type))
      )
        throw Error("Unsupported coding item");
    } else throw Error("Unsupported coding event");
  }
  if (!thread) throw Error("Missing coding session");
  return { threadId: thread, completed };
}

export const codexAgent: CodingAgent = Object.freeze({
  provider: "codex" as const,
  argv: lockedCodingArgv,
  turn: codingTurn,
  bindsThread(event: unknown): boolean {
    return (
      !!event &&
      typeof event === "object" &&
      (event as Record<string, unknown>).type === "thread.started"
    );
  },
  boundThread(event: unknown): string | undefined {
    if (!codexAgent.bindsThread(event)) return undefined;
    const item = event as Record<string, unknown>;
    return typeof item.thread_id === "string" &&
      threadPattern.test(item.thread_id)
      ? item.thread_id
      : undefined;
  },
});
