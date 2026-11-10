import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { anthropicApiVersion, anthropicOrigin } from "./anthropic-key.js";
import {
  type ModelUsage,
  pinnedModelPrices,
  requestReserve,
} from "./spend-budget.js";

/** ADR 0006 and 0008: the host side of metered model access. It carries a
 * coding session's Messages requests for the pinned model, and nothing else,
 * within a session grant, and only while the delivery's spend budget admits
 * each request's worst case. It never forwards worker headers, URLs or
 * redirects, never retries or falls back to another route, and never lets the
 * API key reach the worker. */
export const messagesGatewayVersion = createHash("sha256")
  .update(readFileSync(new URL(import.meta.url)))
  .update(readFileSync(new URL("./spend-budget.js", import.meta.url)))
  .digest("hex");

/** The worker-side routes Claude Code sends Messages requests to: the only
 * paths the Claude Code guest's session relay accepts. */
export const messagesRelayPaths = Object.freeze([
  "/v1/messages",
  "/v1/messages?beta=true",
]);

/** The output limit the coding guest sets for Claude Code. Each request's
 * worst case reserves its `max_tokens` from the spend budget before it is
 * sent, so this keeps one request's reservation near $0.64 at the pinned
 * output price, where the model's own limit would reserve $2.56. */
export const claudeCodeMaxOutputTokens = 32_000;

export const messagesLimits = Object.freeze({
  requestBytes: 4 * 1024 * 1024,
  responseBytes: 16 * 1024 * 1024,
  requestMs: 10 * 60_000,
  sessionMs: 120 * 60_000,
  maxRequests: 2048,
  /** The pinned model's context window and output limit, in tokens. */
  contextTokens: 1_000_000,
  maxOutputTokens: 128_000,
});

const allowedFields = new Set([
  "model",
  "system",
  "messages",
  "tools",
  "tool_choice",
  "thinking",
  "max_tokens",
  "stream",
  // Only its effort level (generally available): no output format.
  "output_config",
  // Admitted only to be removed: it never reaches the provider.
  "metadata",
]);
const toolKeys = new Set([
  "type",
  "name",
  "description",
  "input_schema",
  "cache_control",
  "eager_input_streaming",
  "strict",
]);
/** Content blocks a coding turn replays. Documents, files, server-tool
 * results and container uploads are not among them. */
const messageBlocks = new Set([
  "text",
  "image",
  "tool_use",
  "tool_result",
  "thinking",
  "redacted_thinking",
]);
const toolResultBlocks = new Set(["text", "image"]);
const systemMessageBlocks = new Set(["text"]);

export interface MessagesGrant {
  readonly deliveryId: string;
  readonly sessionId: string;
  readonly expiresAt: number;
  readonly maxRequests: number;
}

/** The delivery's spend budget, as the gateway sees it. `admit` reserves a
 * request's worst case; exactly one of the other three settles it. */
export interface MessagesBudget {
  admit(operationId: string, reserve: number): boolean;
  charge(operationId: string, usage: ModelUsage): void;
  chargeReservation(operationId: string): void;
  release(operationId: string): void;
}

export type MessagesRevocation =
  | "budget"
  | "credential"
  | "expired"
  | "response-bound"
  | "stopped";
export type MessagesProvider = (
  apiKey: string,
  body: string,
  signal: AbortSignal,
) => AsyncIterable<Uint8Array>;

type Refusal =
  | "capability"
  | "delivery"
  | "revoked"
  | "expired"
  | "timeout"
  | "request-budget"
  | "concurrent"
  | "request-shape"
  | "model"
  | "field"
  | "value"
  | "tool"
  | "block"
  | "budget"
  | "credential"
  | "provider"
  | "response-bound";

/** Every refusal the gateway makes; never a provider or worker message. */
export class MessagesRefusal extends Error {
  constructor(readonly reason: Refusal) {
    super("Messages gateway refused");
  }
}
/** The provider answered with an error status: no tokens were billed. */
export class MessagesProviderRefusal extends Error {
  constructor(readonly status: number) {
    super("Messages provider refused");
  }
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";

/** Reads a Messages event stream as it passes and keeps the usage it
 * reports: `message_start` carries the input side, and each `message_delta`
 * carries cumulative counts that replace it. */
export class MessagesUsageMeter {
  private line = "";
  private usage: Record<string, unknown> | undefined;
  private finished = false;
  private readonly decoder = new TextDecoder();

  write(bytes: Uint8Array) {
    this.line += this.decoder.decode(bytes, { stream: true });
    for (let index; (index = this.line.indexOf("\n")) >= 0; ) {
      this.read(this.line.slice(0, index).replace(/\r$/, ""));
      this.line = this.line.slice(index + 1);
    }
  }

  private read(line: string) {
    if (!line.startsWith("data:")) return;
    let event: unknown;
    try {
      event = JSON.parse(line.slice(5));
    } catch {
      return;
    }
    if (!object(event)) return;
    if (event.type === "message_start" && object(event.message)) {
      if (object(event.message.usage)) this.usage = { ...event.message.usage };
    } else if (event.type === "message_delta" && object(event.usage)) {
      if (!this.usage) return;
      for (const [key, value] of Object.entries(event.usage))
        if (value !== null && value !== undefined) this.usage[key] = value;
      this.finished = true;
    }
  }

  /** The final usage, once a `message_delta` has reported it. */
  get result(): ModelUsage | undefined {
    return this.finished ? (this.usage as unknown as ModelUsage) : undefined;
  }
}

export class MessagesGateway {
  readonly capability = randomBytes(32).toString("hex");
  private readonly grant: MessagesGrant;
  private readonly cancellation = new AbortController();
  private revokedFor: MessagesRevocation | undefined;
  private inFlight = false;
  private readonly counts = {
    requests: 0,
    admitted: 0,
    providerRequests: 0,
    completed: 0,
    charged: 0,
    reservationsCharged: 0,
    released: 0,
    requestBytes: 0,
    responseBytes: 0,
  };
  private readonly refusals: Partial<Record<Refusal, number>> = {};
  /** Names of refused fields, tools and blocks, never their values. */
  private readonly refusedNames = {
    fields: new Set<string>(),
    tools: new Set<string>(),
    blocks: new Set<string>(),
  };
  private readonly providerStatuses: number[] = [];

  constructor(
    grant: MessagesGrant,
    private readonly apiKey: () => string,
    private readonly budget: MessagesBudget,
    private readonly provider: MessagesProvider = anthropicMessages(),
    private readonly clock: () => number = Date.now,
  ) {
    this.grant = Object.freeze({ ...grant });
    const now = clock();
    if (
      !uuid.test(grant.deliveryId) ||
      !uuid.test(grant.sessionId) ||
      !Number.isSafeInteger(grant.expiresAt) ||
      grant.expiresAt <= now ||
      grant.expiresAt > now + messagesLimits.sessionMs ||
      !Number.isSafeInteger(grant.maxRequests) ||
      grant.maxRequests < 1 ||
      grant.maxRequests > messagesLimits.maxRequests
    )
      throw Error("Invalid Messages grant");
  }

  /** Irreversible. An in-flight provider request is aborted. */
  revoke(reason: MessagesRevocation) {
    this.revokedFor ??= reason;
    this.cancellation.abort();
  }

  /** Counts and fixed labels only, never request or response content. */
  get observation() {
    const names = (set: Set<string>) => [...set].slice(0, 16);
    return {
      revoked: this.revokedFor !== undefined,
      revokedFor: this.revokedFor ?? null,
      ...this.counts,
      refusals: { ...this.refusals },
      refusedFields: names(this.refusedNames.fields),
      refusedToolTypes: names(this.refusedNames.tools),
      refusedBlockTypes: names(this.refusedNames.blocks),
      providerStatuses: this.providerStatuses.slice(0, 16),
    };
  }

  private refuse(reason: Refusal): never {
    this.refusals[reason] = (this.refusals[reason] ?? 0) + 1;
    throw new MessagesRefusal(reason);
  }
  private expireIfDue() {
    if (this.clock() >= this.grant.expiresAt) {
      this.revoke("expired");
      this.refuse("expired");
    }
  }

  /** One Messages request from the session's relay. Refuses before any
   * budget or key access unless the request and session are in order, then
   * reserves the request's worst case, starts the provider request and
   * resolves when the first bytes arrive. The returned stream holds the
   * session's only request slot until it is drained, fails or is closed, and
   * settles the reservation exactly once. */
  async respond(
    deliveryId: string,
    capability: string,
    raw: string,
  ): Promise<AsyncIterable<Uint8Array>> {
    const g = this.grant;
    const expected = Buffer.from(this.capability),
      supplied = Buffer.from(String(capability));
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(expected, supplied)
    )
      this.refuse("capability");
    if (deliveryId !== g.deliveryId) this.refuse("delivery");
    if (this.revokedFor !== undefined) this.refuse("revoked");
    this.expireIfDue();
    if (this.counts.requests >= g.maxRequests) this.refuse("request-budget");
    if (this.inFlight) this.refuse("concurrent");
    this.counts.requests++;
    const { body, reserve } = this.inspect(raw);
    this.inFlight = true;
    const operationId = `${g.sessionId}-${this.counts.requests}`;
    let settled = false;
    const settle = (kind: "charge" | "reservation" | "release") => {
      if (settled) return;
      settled = true;
      if (kind === "release") {
        this.counts.released++;
        return this.budget.release(operationId);
      }
      const usage = kind === "charge" ? meter.result : undefined;
      if (usage)
        try {
          this.budget.charge(operationId, usage);
          this.counts.charged++;
          return;
        } catch {
          // Usage that cannot be verified is charged as the reservation.
        }
      this.counts.reservationsCharged++;
      this.budget.chargeReservation(operationId);
    };
    const meter = new MessagesUsageMeter();
    let iterator: AsyncIterator<Uint8Array> | undefined;
    let admitted = false;
    try {
      if (!this.budget.admit(operationId, reserve)) {
        this.revoke("budget");
        this.refuse("budget");
      }
      admitted = true;
      this.counts.admitted++;
      let apiKey: string;
      try {
        apiKey = this.apiKey();
      } catch {
        this.revoke("credential");
        this.refuse("credential");
      }
      if (this.revokedFor !== undefined) this.refuse("revoked");
      this.expireIfDue();
      const now = this.clock();
      const deadline = Math.min(g.expiresAt, now + messagesLimits.requestMs);
      const timeout = AbortSignal.timeout(Math.max(1, deadline - now));
      const signal = AbortSignal.any([this.cancellation.signal, timeout]);
      this.counts.providerRequests++;
      this.counts.requestBytes += Buffer.byteLength(body);
      iterator = this.provider(apiKey, body, signal)[Symbol.asyncIterator]();
      const first = await this.step(iterator, signal, timeout, 0, meter);
      return this.stream(iterator, signal, timeout, first, meter, settle);
    } catch (error) {
      this.inFlight = false;
      await iterator?.return?.().catch(() => {});
      if (admitted)
        settle(
          // Only an error status proves nothing was billed.
          !iterator || error instanceof MessagesProviderRefusal
            ? "release"
            : "reservation",
        );
      throw error instanceof MessagesProviderRefusal
        ? new MessagesRefusal("provider")
        : error;
    }
  }

  /** One provider chunk, bounded, metered and attributed. */
  private async step(
    iterator: AsyncIterator<Uint8Array>,
    signal: AbortSignal,
    timeout: AbortSignal,
    bytes: number,
    meter: MessagesUsageMeter,
  ): Promise<IteratorResult<Uint8Array>> {
    let next: IteratorResult<Uint8Array>;
    try {
      next = await iterator.next();
    } catch (error) {
      if (error instanceof MessagesProviderRefusal) {
        if (this.providerStatuses.length < 16)
          this.providerStatuses.push(error.status);
        this.refusals.provider = (this.refusals.provider ?? 0) + 1;
        throw error;
      }
      this.refuse(
        timeout.aborted ? "timeout" : signal.aborted ? "revoked" : "provider",
      );
    }
    if (timeout.aborted) this.refuse("timeout");
    if (signal.aborted) this.refuse("revoked");
    if (!next.done) {
      this.counts.responseBytes += next.value.byteLength;
      if (bytes + next.value.byteLength > messagesLimits.responseBytes) {
        this.revoke("response-bound");
        this.refuse("response-bound");
      }
      meter.write(next.value);
    }
    return next;
  }

  /** The bounded stream. Finishing charges the metered usage; closing it
   * early or failing charges the reservation. All release the slot. */
  private stream(
    iterator: AsyncIterator<Uint8Array>,
    signal: AbortSignal,
    timeout: AbortSignal,
    first: IteratorResult<Uint8Array>,
    meter: MessagesUsageMeter,
    settle: (kind: "charge" | "reservation") => void,
  ): AsyncIterable<Uint8Array> {
    let pending: IteratorResult<Uint8Array> | undefined = first,
      bytes = first.done ? 0 : first.value.byteLength,
      open = true;
    const close = async (kind: "charge" | "reservation") => {
      if (!open) return;
      open = false;
      this.inFlight = false;
      settle(kind);
      await iterator.return?.().catch(() => {});
    };
    if (first.done) {
      this.counts.completed++;
      void close("charge");
    }
    const self = this;
    const stream: AsyncIterableIterator<Uint8Array> = {
      [Symbol.asyncIterator]: () => stream,
      async next() {
        if (pending) {
          const result = pending;
          pending = undefined;
          return result;
        }
        if (!open) return { done: true, value: undefined };
        try {
          const result = await self.step(
            iterator,
            signal,
            timeout,
            bytes,
            meter,
          );
          if (result.done) {
            self.counts.completed++;
            await close("charge");
          } else bytes += result.value.byteLength;
          return result;
        } catch (error) {
          await close("reservation");
          throw error instanceof MessagesProviderRefusal
            ? new MessagesRefusal("provider")
            : error;
        }
      },
      async return() {
        pending = undefined;
        await close("reservation");
        return { done: true, value: undefined };
      },
    };
    return stream;
  }

  /** Returns the body to forward, re-serialized so the provider never reads
   * a duplicate key the gateway did not and without `metadata`, and the
   * request's worst-case cost. */
  private inspect(raw: string): { body: string; reserve: number } {
    if (!text(raw) || Buffer.byteLength(raw) > messagesLimits.requestBytes)
      this.refuse("request-shape");
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      this.refuse("request-shape");
    }
    if (!object(body)) this.refuse("request-shape");
    const unknown = Object.keys(body).filter((k) => !allowedFields.has(k));
    if (unknown.length) {
      for (const field of unknown)
        this.refusedNames.fields.add(field.slice(0, 64));
      this.refuse("field");
    }
    if (body.model !== pinnedModelPrices.model) this.refuse("model");
    if (body.stream !== true) this.refuse("request-shape");
    if (body.metadata !== undefined && !object(body.metadata))
      this.refuse("request-shape");
    const maxTokens = body.max_tokens;
    if (
      !Number.isSafeInteger(maxTokens) ||
      (maxTokens as number) < 1 ||
      (maxTokens as number) > messagesLimits.maxOutputTokens
    )
      this.refuse("value");
    if (body.thinking !== undefined) {
      const thinking = body.thinking;
      if (
        !object(thinking) ||
        !(
          (thinking.type === "adaptive" &&
            Object.keys(thinking).every((k) =>
              ["type", "display"].includes(k),
            ) &&
            (thinking.display === undefined ||
              ["summarized", "omitted"].includes(String(thinking.display)))) ||
          (thinking.type === "disabled" && Object.keys(thinking).length === 1)
        )
      )
        this.refuse("value");
    }
    if (body.output_config !== undefined) {
      const output = body.output_config;
      if (
        !object(output) ||
        Object.keys(output).some((k) => k !== "effort") ||
        !["low", "medium", "high", "xhigh", "max"].includes(
          String(output.effort),
        )
      )
        this.refuse("value");
    }
    let longCacheWrites = false;
    const cacheControl = (value: unknown) => {
      if (value === undefined) return;
      if (
        !object(value) ||
        value.type !== "ephemeral" ||
        Object.keys(value).some((k) => !["type", "ttl"].includes(k)) ||
        (value.ttl !== undefined && !["5m", "1h"].includes(String(value.ttl)))
      )
        this.refuse("value");
      if (value.ttl === "1h") longCacheWrites = true;
    };
    this.inspectSystem(body.system, cacheControl);
    this.inspectTools(body.tools, body.tool_choice, cacheControl);
    this.inspectMessages(body.messages, cacheControl);
    const { metadata: _, ...forwarded } = body;
    const forward = JSON.stringify(forwarded);
    // A token is at least one byte of the request, so its length bounds the
    // input tokens, as does the model's context window.
    const reserve = requestReserve({
      inputTokens: Math.min(
        Buffer.byteLength(forward),
        messagesLimits.contextTokens,
      ),
      maxOutputTokens: maxTokens as number,
      longCacheWrites,
    });
    return { body: forward, reserve };
  }

  private inspectSystem(system: unknown, cache: (value: unknown) => void) {
    if (system === undefined || text(system)) return;
    if (!Array.isArray(system)) this.refuse("request-shape");
    for (const block of system) {
      if (
        !object(block) ||
        block.type !== "text" ||
        !text(block.text) ||
        Object.keys(block).some(
          (k) => !["type", "text", "cache_control"].includes(k),
        )
      )
        this.refuseBlock(block);
      cache(block.cache_control);
    }
  }

  /** Client tools only: the worker runs every tool itself. A server tool
   * would let the provider reach the web, files or services on its behalf. */
  private inspectTools(
    tools: unknown,
    choice: unknown,
    cache: (value: unknown) => void,
  ) {
    if (tools !== undefined) {
      if (!Array.isArray(tools)) this.refuse("request-shape");
      const server = tools.filter(
        (tool) =>
          !object(tool) ||
          (tool.type !== undefined && tool.type !== "custom") ||
          Object.keys(tool).some((k) => !toolKeys.has(k)) ||
          !text(tool.name) ||
          !object(tool.input_schema),
      );
      if (server.length) {
        for (const tool of server)
          this.refusedNames.tools.add(
            String(object(tool) ? (tool.type ?? "custom") : tool).slice(0, 64),
          );
        this.refuse("tool");
      }
      for (const tool of tools) cache(tool.cache_control);
    }
    if (choice === undefined) return;
    if (
      !object(choice) ||
      !["auto", "any", "none", "tool"].includes(String(choice.type)) ||
      Object.keys(choice).some(
        (k) => !["type", "name", "disable_parallel_tool_use"].includes(k),
      ) ||
      (choice.type === "tool") !== text(choice.name)
    )
      this.refuse("tool");
  }

  private inspectMessages(messages: unknown, cache: (value: unknown) => void) {
    if (!Array.isArray(messages) || !messages.length)
      this.refuse("request-shape");
    for (const message of messages) {
      if (
        !object(message) ||
        !["user", "assistant", "system"].includes(String(message.role)) ||
        Object.keys(message).some((k) => !["role", "content"].includes(k))
      )
        this.refuse("request-shape");
      if (text(message.content)) continue;
      if (!Array.isArray(message.content)) this.refuse("request-shape");
      // Claude Code sends its environment as a system message: text only.
      for (const block of message.content)
        this.inspectBlock(
          block,
          message.role === "system" ? systemMessageBlocks : messageBlocks,
          cache,
        );
    }
  }

  /** A content block of a known kind. Images are inline only: nothing may
   * point the provider at a URL or a stored file. */
  private inspectBlock(
    block: unknown,
    allowed: Set<string>,
    cache: (value: unknown) => void,
  ) {
    if (!object(block) || !allowed.has(String(block.type)))
      this.refuseBlock(block);
    cache(block.cache_control);
    if (block.type === "image") {
      const source = block.source;
      if (
        !object(source) ||
        source.type !== "base64" ||
        !text(source.media_type) ||
        !source.media_type.startsWith("image/") ||
        !text(source.data)
      )
        this.refuseBlock({
          type: `image:${String(object(source) && source.type)}`,
        });
    }
    if (block.type === "tool_result" && Array.isArray(block.content))
      for (const inner of block.content)
        this.inspectBlock(inner, toolResultBlocks, cache);
    else if (
      block.type === "tool_result" &&
      block.content !== undefined &&
      !text(block.content)
    )
      this.refuse("request-shape");
  }

  private refuseBlock(block: unknown): never {
    this.refusedNames.blocks.add(
      String(object(block) ? block.type : block).slice(0, 64),
    );
    this.refuse("block");
  }
}

/** The fixed Anthropic origin, streamed. No redirects, retries or other
 * route; the body is exactly what the gateway forwards. */
export function anthropicMessages(
  fetchResponse: typeof fetch = fetch,
): MessagesProvider {
  return async function* (apiKey, body, signal) {
    const response = await fetchResponse(`${anthropicOrigin}/v1/messages`, {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": anthropicApiVersion,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body,
    });
    if (!response.ok || !response.body)
      throw new MessagesProviderRefusal(response.status);
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      await reader.cancel();
    }
  };
}

/** The environment Claude Code needs to reach the session relay on the
 * worker's loopback. It carries only the relay's revocable capability; the
 * API key stays on the host. */
export function claudeCodeRelayEnvironment(
  port: number,
  deliveryId: string,
  capability: string,
): Record<string, string> {
  if (
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !uuid.test(deliveryId) ||
    !/^[a-f0-9]{64}$/.test(capability)
  )
    throw Error("Invalid Messages relay route");
  return {
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    ANTHROPIC_AUTH_TOKEN: capability,
    ANTHROPIC_CUSTOM_HEADERS: `X-AIOS-Delivery: ${deliveryId}`,
    ANTHROPIC_MODEL: pinnedModelPrices.model,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    // Beta-only request fields (context management, thinking display,
    // deferred tools) need beta headers the gateway never sends.
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
    // The guest's own environment sets this too; see claudeCodeMaxOutputTokens.
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(claudeCodeMaxOutputTokens),
  };
}

/** The delivery controller's spend budget for one delivery. */
export function deliveryMessagesBudget(
  controller: {
    admitModelRequest(
      id: string,
      operationId: string,
      reserve: number,
    ): { admitted: boolean };
    chargeModelResponse(
      id: string,
      operationId: string,
      usage: ModelUsage,
    ): unknown;
    chargeModelReservation(id: string, operationId: string): unknown;
    releaseModelRequest(id: string, operationId: string): unknown;
  },
  deliveryId: string,
): MessagesBudget {
  return {
    admit: (operationId, reserve) =>
      controller.admitModelRequest(deliveryId, operationId, reserve).admitted,
    charge: (operationId, usage) =>
      void controller.chargeModelResponse(deliveryId, operationId, usage),
    chargeReservation: (operationId) =>
      void controller.chargeModelReservation(deliveryId, operationId),
    release: (operationId) =>
      void controller.releaseModelRequest(deliveryId, operationId),
  };
}
