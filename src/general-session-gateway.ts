import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { gatewayModel } from "./inference-contract.js";
import {
  accountEligibility,
  subscriptionAccountId,
} from "./subscription-account.js";
import type { GatewayAccount } from "./subscription-gateway.js";

/** ADR 0002: the host side of a mediated general coding session. Separate from
 * `HostSubscriptionGateway`, which stays one fixed request on one-shot
 * approvals. This one carries a coding session's Responses requests for the
 * pinned model, and nothing else, within a session grant and only while fresh
 * authority permits each request. It never forwards worker headers, URLs or
 * redirects, never refreshes, retries or falls back to paid access, and never
 * lets the credential reach the VM. */
export const generalSessionGatewayVersion = createHash("sha256")
  .update(readFileSync(new URL(import.meta.url)))
  .update(readFileSync(new URL("./inference-contract.js", import.meta.url)))
  .update(readFileSync(new URL("./subscription-account.js", import.meta.url)))
  .digest("hex");

/** Bounds. A coding turn's requests carry its whole context, so they are
 * larger than the fixed request, but each is still finite. */
export const generalSessionLimits = Object.freeze({
  requestBytes: 4 * 1024 * 1024,
  responseBytes: 16 * 1024 * 1024,
  requestMs: 5 * 60_000,
  sessionMs: 30 * 60_000,
  maxRequests: 512,
});

/** Request fields a Codex Responses turn may carry. Anything else, including
 * stored-response references, background runs, output limits or paid-tier
 * controls, is refused by name. */
const allowedFields = new Set([
  "model",
  "instructions",
  "input",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "reasoning",
  "store",
  "stream",
  "include",
  "prompt_cache_key",
  "text",
]);
/** Only tools the worker runs itself. Hosted tools would let the provider
 * reach the web, files or services on the worker's behalf. */
const allowedToolTypes = new Set(["function", "custom", "local_shell"]);
/** Conversation items a coding turn replays. Item references, files and
 * hosted-tool calls are not among them. */
const allowedItemTypes = new Set([
  "message",
  "reasoning",
  "function_call",
  "function_call_output",
  "custom_tool_call",
  "custom_tool_call_output",
  "local_shell_call",
]);
const allowedEfforts = new Set(["minimal", "low", "medium", "high"]);

export interface GeneralSessionGrant {
  readonly deliveryId: string;
  readonly sessionId: string;
  readonly accountId: string;
  readonly hostId: string;
  readonly expiresAt: number;
  readonly maxRequests: number;
}
/** Fresh authority for one provider request: usage observed now through
 * `UsageApprovalGate`, the mediation decision still standing, the same
 * account. Anything but "permitted" ends the session's grant. */
export type GeneralSessionAuthority =
  | "permitted"
  | "approval-required"
  | "unknown"
  | "exhausted"
  | "withdrawn";
/** Why a grant ended: fresh authority, the gateway's own limits, or the
 * caller stopping, pausing or seeing a changed pin. */
export type GeneralSessionRevocation =
  | Exclude<GeneralSessionAuthority, "permitted">
  | "expired"
  | "account"
  | "response-bound"
  | "stopped"
  | "paused"
  | "pin-changed";
export type GeneralSessionProvider = (
  token: string,
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
  | "item"
  | "authority"
  | "account"
  | "provider"
  | "response-bound";

/** Every refusal the gateway makes; never a provider or worker message. */
export class GeneralSessionRefusal extends Error {
  constructor(readonly reason: Refusal) {
    super("General session gateway refused");
  }
}
export class GeneralSessionProviderRefusal extends Error {
  constructor(readonly status: number) {
    super("General session provider refused");
  }
}

const uuidBody = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const uuid = new RegExp(`^${uuidBody}$`);
const urnUuid = new RegExp(`^urn:uuid:${uuidBody}$`);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export class GeneralSessionGateway {
  readonly capability = randomBytes(32).toString("hex");
  private readonly grant: GeneralSessionGrant;
  private readonly cancellation = new AbortController();
  private revokedFor: GeneralSessionRevocation | undefined;
  private inFlight = false;
  private readonly counts = {
    requests: 0,
    providerRequests: 0,
    completed: 0,
    requestBytes: 0,
    responseBytes: 0,
  };
  private readonly refusals: Partial<Record<Refusal, number>> = {};
  /** Names of refused fields, tools and items, never their values. */
  private readonly refusedNames = {
    fields: new Set<string>(),
    tools: new Set<string>(),
    items: new Set<string>(),
  };
  private readonly providerStatuses: number[] = [];

  constructor(
    grant: GeneralSessionGrant,
    private readonly account: () => GatewayAccount,
    private readonly authority: () => Promise<GeneralSessionAuthority>,
    private readonly provider: GeneralSessionProvider = generalSessionResponses(),
    private readonly clock: () => number = Date.now,
  ) {
    this.grant = Object.freeze({ ...grant });
    const now = clock();
    if (
      !uuid.test(grant.deliveryId) ||
      !uuid.test(grant.sessionId) ||
      !/^[a-f0-9]{64}$/.test(grant.accountId) ||
      !urnUuid.test(grant.hostId) ||
      !Number.isSafeInteger(grant.expiresAt) ||
      grant.expiresAt <= now ||
      grant.expiresAt > now + generalSessionLimits.sessionMs ||
      !Number.isSafeInteger(grant.maxRequests) ||
      grant.maxRequests < 1 ||
      grant.maxRequests > generalSessionLimits.maxRequests
    )
      throw Error("Invalid general session grant");
  }

  /** Irreversible. An in-flight provider request is aborted. */
  revoke(reason: GeneralSessionRevocation) {
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
      refusedItemTypes: names(this.refusedNames.items),
      providerStatuses: this.providerStatuses.slice(0, 16),
    };
  }

  private refuse(reason: Refusal): never {
    this.refusals[reason] = (this.refusals[reason] ?? 0) + 1;
    throw new GeneralSessionRefusal(reason);
  }
  private expireIfDue() {
    if (this.clock() >= this.grant.expiresAt) {
      this.revoke("expired");
      this.refuse("expired");
    }
  }

  /** One Responses request from the session's relay. Refuses before any
   * credential access unless the request and session are in order, then
   * starts the provider request at once, under the authority it just took,
   * and resolves when the first bytes arrive. The returned stream holds the
   * session's only request slot until it is drained, fails or is closed. */
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
    this.inspect(raw);
    // Reserve before authority and credential access: one request at a time.
    this.inFlight = true;
    let iterator: AsyncIterator<Uint8Array> | undefined;
    try {
      const authority = await this.authority();
      if (this.revokedFor !== undefined) this.refuse("revoked");
      if (authority !== "permitted") {
        this.revoke(authority);
        this.refuse("authority");
      }
      this.expireIfDue();
      const now = this.clock();
      const deadline = Math.min(
        g.expiresAt,
        now + generalSessionLimits.requestMs,
      );
      const account = this.account();
      if (
        subscriptionAccountId(account) !== g.accountId ||
        account.hostId !== g.hostId ||
        !accountEligibility(account, now, deadline).eligible
      ) {
        this.revoke("account");
        this.refuse("account");
      }
      const timeout = AbortSignal.timeout(Math.max(1, deadline - now));
      const signal = AbortSignal.any([this.cancellation.signal, timeout]);
      this.counts.providerRequests++;
      this.counts.requestBytes += Buffer.byteLength(raw);
      iterator = this.provider(account.accessToken, raw, signal)[
        Symbol.asyncIterator
      ]();
      const first = await this.step(iterator, signal, timeout, 0);
      return this.stream(iterator, signal, timeout, first);
    } catch (error) {
      this.inFlight = false;
      await iterator?.return?.().catch(() => {});
      throw error;
    }
  }

  /** One provider chunk, bounded and attributed. */
  private async step(
    iterator: AsyncIterator<Uint8Array>,
    signal: AbortSignal,
    timeout: AbortSignal,
    bytes: number,
  ): Promise<IteratorResult<Uint8Array>> {
    let next: IteratorResult<Uint8Array>;
    try {
      next = await iterator.next();
    } catch (error) {
      if (error instanceof GeneralSessionProviderRefusal) {
        if (this.providerStatuses.length < 16)
          this.providerStatuses.push(error.status);
        this.refuse("provider");
      }
      this.refuse(
        timeout.aborted ? "timeout" : signal.aborted ? "revoked" : "provider",
      );
    }
    if (timeout.aborted) this.refuse("timeout");
    if (signal.aborted) this.refuse("revoked");
    if (!next.done) {
      this.counts.responseBytes += next.value.byteLength;
      if (bytes + next.value.byteLength > generalSessionLimits.responseBytes) {
        this.revoke("response-bound");
        this.refuse("response-bound");
      }
    }
    return next;
  }

  /** The bounded stream. Closing it early, failing or finishing all release
   * the request slot and close the provider request. */
  private stream(
    iterator: AsyncIterator<Uint8Array>,
    signal: AbortSignal,
    timeout: AbortSignal,
    first: IteratorResult<Uint8Array>,
  ): AsyncIterable<Uint8Array> {
    let pending: IteratorResult<Uint8Array> | undefined = first,
      bytes = first.done ? 0 : first.value.byteLength,
      open = true;
    const close = async () => {
      if (!open) return;
      open = false;
      this.inFlight = false;
      await iterator.return?.().catch(() => {});
    };
    if (first.done) {
      this.counts.completed++;
      void close();
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
          const result = await self.step(iterator, signal, timeout, bytes);
          if (result.done) {
            self.counts.completed++;
            await close();
          } else bytes += result.value.byteLength;
          return result;
        } catch (error) {
          await close();
          throw error;
        }
      },
      async return() {
        pending = undefined;
        await close();
        return { done: true, value: undefined };
      },
    };
    return stream;
  }

  private inspect(raw: string) {
    if (
      typeof raw !== "string" ||
      Buffer.byteLength(raw) > generalSessionLimits.requestBytes
    )
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
    if (body.model !== gatewayModel) this.refuse("model");
    if (body.stream !== true) this.refuse("request-shape");
    // The provider keeps nothing between requests: no stored responses.
    if (body.store !== false) this.refuse("value");
    if (
      body.include !== undefined &&
      (!Array.isArray(body.include) ||
        body.include.some((value) => value !== "reasoning.encrypted_content"))
    )
      this.refuse("value");
    if (body.reasoning !== undefined) {
      const reasoning = body.reasoning;
      if (
        !object(reasoning) ||
        Object.keys(reasoning).some(
          (k) => !["effort", "summary"].includes(k),
        ) ||
        (reasoning.effort !== undefined &&
          !allowedEfforts.has(String(reasoning.effort)))
      )
        this.refuse("value");
    }
    this.inspectTools(body.tools, body.tool_choice);
    this.inspectInput(body.input);
  }

  private inspectTools(tools: unknown, choice: unknown) {
    if (tools !== undefined) {
      if (!Array.isArray(tools)) this.refuse("request-shape");
      const hosted = tools.filter(
        (tool) => !object(tool) || !allowedToolTypes.has(String(tool.type)),
      );
      if (hosted.length) {
        for (const tool of hosted)
          this.refusedNames.tools.add(
            String(object(tool) ? tool.type : tool).slice(0, 64),
          );
        this.refuse("tool");
      }
    }
    // A tool choice may not name a hosted tool absent from `tools`.
    if (
      choice !== undefined &&
      !["auto", "none", "required"].includes(choice as string) &&
      !(
        object(choice) &&
        allowedToolTypes.has(String(choice.type)) &&
        typeof choice.name === "string"
      )
    )
      this.refuse("tool");
  }

  /** Replayed items must be of known kinds, and nothing anywhere in them may
   * point the provider at a remote URL, a file or another stored item. */
  private inspectInput(input: unknown) {
    if (input === undefined || typeof input === "string") return;
    if (!Array.isArray(input)) this.refuse("request-shape");
    for (const item of input) {
      if (
        !object(item) ||
        !allowedItemTypes.has(String(item.type ?? "message"))
      ) {
        this.refusedNames.items.add(
          String(object(item) ? item.type : item).slice(0, 64),
        );
        this.refuse("item");
      }
    }
    const visit = (value: unknown, depth: number): void => {
      if (depth > 64) this.refuse("request-shape");
      if (Array.isArray(value)) {
        for (const entry of value) visit(entry, depth + 1);
        return;
      }
      if (!object(value)) return;
      for (const [key, entry] of Object.entries(value)) {
        if (
          ["file_id", "file_url", "file_data", "previous_response_id"].includes(
            key,
          ) ||
          (key === "type" &&
            ["item_reference", "input_file", "input_audio"].includes(
              String(entry),
            )) ||
          (key === "image_url" &&
            !(typeof entry === "string" && entry.startsWith("data:image/")))
        ) {
          this.refusedNames.items.add(
            (key === "type" ? String(entry) : key).slice(0, 64),
          );
          this.refuse("item");
        }
        visit(entry, depth + 1);
      }
    };
    visit(input, 0);
  }
}

/** The fixed subscription origin, streamed. No redirects, refresh, retries or
 * paid fallback; the body is exactly what the gateway inspected. */
export function generalSessionResponses(
  fetchResponse: typeof fetch = fetch,
): GeneralSessionProvider {
  return async function* (token, body, signal) {
    const response = await fetchResponse(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body,
      },
    );
    if (!response.ok || !response.body)
      throw new GeneralSessionProviderRefusal(response.status);
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
