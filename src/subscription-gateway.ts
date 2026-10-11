import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

export const subscriptionGatewayVersion = createHash("sha256")
  .update(readFileSync(new URL(import.meta.url)))
  .digest("hex");
export const gatewayMarker = "AIOS model-only inference complete";
export const gatewayRequest = JSON.stringify({
  model: "gpt-6.1-sol",
  input: [{ role: "user", content: `Say exactly: ${gatewayMarker}` }],
  store: false,
  stream: true,
});

export interface GatewayApproval {
  readonly runId: string;
  readonly deliveryId: string;
  readonly accountId: string;
  readonly hostId: string;
  readonly requestSha256: string;
  readonly expiresAt: number;
  readonly unknownUsageApproved: true;
}
export interface GatewayAccount {
  issuer: string;
  clientId: string;
  subject: string;
  hostId: string;
  planUsageAuthorized: boolean;
  scopes: string[];
  expiresAt: number;
  accessToken: string;
}
// The external provider adapter sees only the canonical host request and host token.
export type SubscriptionProvider = (
  token: string,
  body: string,
  signal: AbortSignal,
) => Promise<Uint8Array>;
const hash = (body: string) => createHash("sha256").update(body).digest("hex");

/** One delivery, one host-selected account, one fixed request. Never forwards
 * worker headers, URLs, tools, system instructions or extra context upstream. */
export class HostSubscriptionGateway {
  readonly capability = randomBytes(32).toString("hex");
  private readonly cancellation = new AbortController();
  private readonly approval: GatewayApproval;
  private used = false;
  private phase = "not-started";
  private providerAttempts = 0;
  private providerStatus: number | undefined;
  private readonly stream = {
    bytes: 0,
    records: 0,
    deltas: 0,
    completed: false,
    failed: false,
    deltaMatches: false,
    completedOutputPresent: false,
    completedOutputAllowed: false,
    completedTextMatches: false,
    format: "unobserved",
    errorCode: "none",
    // Temporary ticket 21 diagnostics: fixed labels/counts only, never content.
    eventTypes: [] as string[],
    eventTypesTruncated: false,
    deltaTextLength: 0,
    textDoneSeen: false,
    textDoneLength: 0,
    textDoneMatches: false,
    completedMessageCount: 0,
    completedTextPartCount: 0,
    completedTextLength: 0,
    completedTextTrimMatches: false,
  };
  get observation() {
    return {
      phase: this.phase,
      providerAttempts: this.providerAttempts,
      providerStatus: this.providerStatus,
      stream: { ...this.stream, eventTypes: [...this.stream.eventTypes] },
    };
  }
  constructor(
    approval: GatewayApproval,
    private readonly account: () => GatewayAccount,
    private readonly provider: SubscriptionProvider = subscriptionResponses(),
  ) {
    this.approval = Object.freeze({ ...approval });
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        approval.runId,
      ) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        approval.deliveryId,
      ) ||
      !/^[a-f0-9]{64}$/.test(approval.accountId) ||
      !/^urn:uuid:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        approval.hostId,
      ) ||
      approval.requestSha256 !== hash(gatewayRequest) ||
      approval.unknownUsageApproved !== true ||
      !Number.isSafeInteger(approval.expiresAt) ||
      approval.expiresAt <= Date.now() ||
      approval.expiresAt > Date.now() + 30_000
    )
      throw Error("Invalid host inference approval");
  }
  revoke() {
    this.cancellation.abort();
  }
  async respond(
    deliveryId: string,
    capability: string,
    raw: string,
  ): Promise<Buffer> {
    const a = this.approval;
    const signal = AbortSignal.any([
      this.cancellation.signal,
      AbortSignal.timeout(Math.max(1, a.expiresAt - Date.now())),
    ]);
    const expected = Buffer.from(this.capability),
      supplied = Buffer.from(capability);
    if (
      signal.aborted ||
      Date.now() >= a.expiresAt ||
      this.used ||
      deliveryId !== a.deliveryId ||
      supplied.length !== expected.length ||
      !timingSafeEqual(expected, supplied) ||
      Buffer.byteLength(raw) > 65536
    )
      throw Error("Gateway refused");
    let value: any;
    try {
      value = JSON.parse(raw);
    } catch {
      throw Error("Gateway refused");
    }
    if (
      value.model !== "gpt-6.1-sol" ||
      value.stream !== true ||
      value.store !== false ||
      !Array.isArray(value.input) ||
      !Array.isArray(value.tools ?? [])
    )
      throw Error("Gateway refused");
    const users = value.input.filter((item: any) => item?.role === "user");
    const text = (item: any) =>
      typeof item.content === "string"
        ? item.content
        : Array.isArray(item.content) &&
            item.content.length === 1 &&
            item.content[0]?.type === "input_text"
          ? item.content[0].text
          : undefined;
    // Codex may send environment/user context before the turn. None is forwarded.
    if (
      users.length < 1 ||
      text(users.at(-1)) !== `Say exactly: ${gatewayMarker}` ||
      value.input.some(
        (item: any) =>
          !["message", "additional_tools", undefined].includes(item?.type) ||
          !["user", "developer", "system"].includes(item?.role),
      ) ||
      (value.tools ?? []).some(
        (tool: any) =>
          tool?.type !== "function" ||
          typeof tool.name !== "string" ||
          tool.name.startsWith("mcp__"),
      )
    )
      throw Error("Gateway refused");
    // Reserve before credential access: failures cannot retry or refresh.
    this.used = true;
    this.phase = "account-validation";
    const account = this.account();
    if (
      hash(
        JSON.stringify([
          account.issuer,
          account.clientId,
          account.subject,
          account.hostId,
        ]),
      ) !== a.accountId ||
      account.issuer !== "https://auth.openai.com" ||
      account.hostId !== a.hostId ||
      account.planUsageAuthorized !== true ||
      !account.scopes.includes("resource.invoke") ||
      !account.scopes.includes("chatgpt.tokens.use.direct") ||
      !Number.isSafeInteger(account.expiresAt) ||
      account.expiresAt <= a.expiresAt ||
      typeof account.accessToken !== "string" ||
      !account.accessToken
    )
      throw Error("Gateway refused");
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(Error("Gateway revoked"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    let data: Uint8Array;
    this.phase = "provider-request";
    this.providerAttempts++;
    try {
      data = await Promise.race([
        this.provider(account.accessToken, gatewayRequest, signal),
        cancelled,
      ]);
    } catch (error) {
      if (error instanceof SubscriptionProviderRefusal)
        this.providerStatus = error.status;
      throw Error("Gateway refused");
    } finally {
      signal.removeEventListener("abort", abort);
    }
    if (signal.aborted || Date.now() >= a.expiresAt || data.byteLength > 65536)
      throw Error("Gateway refused");
    this.phase = "response-validation";
    this.stream.bytes = data.byteLength;
    this.stream.format = Buffer.from(data)
      .toString("utf8")
      .trimStart()
      .startsWith("{")
      ? "non-stream-json"
      : "event-stream-or-invalid";
    // Buffer until completion; never deliver partial output after revocation.
    let output = "",
      completed = false;
    let responseId: string | undefined;
    let messageId: string | undefined;
    let messageIndex = -1;
    let messageStage:
      | "awaiting-part"
      | "reading-text"
      | "text-finalized"
      | "part-finalized"
      | "item-finalized" = "awaiting-part";
    const items = new Map<
      number,
      { id: string; type: string; done: boolean }
    >();
    const validId = (id: unknown): id is string =>
      typeof id === "string" && id.length > 0 && id.length <= 256;
    const linked = (event: any) =>
      event.item_id === messageId &&
      event.output_index === messageIndex &&
      event.content_index === 0;
    const finalMessage = (item: any) =>
      item?.type === "message" &&
      item.id === messageId &&
      item.role === "assistant" &&
      item.status === "completed" &&
      Array.isArray(item.content) &&
      item.content.length === 1 &&
      item.content[0]?.type === "output_text" &&
      item.content[0].text === gatewayMarker;
    for (const record of Buffer.from(data)
      .toString("utf8")
      .replace(/\r\n/g, "\n")
      .split("\n\n")) {
      const line = record
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!line || line === "[DONE]") continue;
      const event = JSON.parse(line);
      if (completed) throw Error("Gateway refused");
      this.stream.records++;
      const knownType = [
        "response.created",
        "response.in_progress",
        "response.output_item.added",
        "response.content_part.added",
        "response.output_text.delta",
        "response.output_text.done",
        "response.content_part.done",
        "response.output_item.done",
        "response.completed",
        "response.failed",
        "response.incomplete",
        "error",
      ].includes(event.type)
        ? event.type
        : "other";
      if (this.stream.eventTypes.length < 32)
        this.stream.eventTypes.push(knownType);
      else this.stream.eventTypesTruncated = true;
      if (event.type === "response.output_text.done") {
        this.stream.textDoneSeen = true;
        this.stream.textDoneLength =
          typeof event.text === "string" ? event.text.length : 0;
        this.stream.textDoneMatches = event.text === gatewayMarker;
      }
      if (
        ["error", "response.failed", "response.incomplete"].includes(event.type)
      ) {
        this.stream.failed = true;
        const code =
          event.response?.error?.code ?? event.error?.code ?? event.code;
        this.stream.errorCode = [
          "subscription_sharing_usage_limit_exceeded",
          "subscription_sharing_usage_unavailable",
          "model_not_found",
          "invalid_api_key",
          "insufficient_quota",
        ].includes(code)
          ? code
          : "unrecognized";
        throw Error("Gateway refused");
      }
      if (event.type === "response.created") {
        if (
          responseId ||
          !validId(event.response?.id) ||
          event.response.status !== "in_progress"
        )
          throw Error("Gateway refused");
        responseId = event.response.id;
      } else if (!responseId) throw Error("Gateway refused");
      if (
        event.type === "response.in_progress" &&
        event.response?.id !== responseId
      )
        throw Error("Gateway refused");
      if (event.type === "response.output_item.added") {
        const item = event.item,
          index = event.output_index;
        if (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= 64 ||
          items.has(index) ||
          !validId(item?.id) ||
          [...items.values()].some((i) => i.id === item.id) ||
          !["message", "reasoning"].includes(item.type)
        )
          throw Error("Gateway refused");
        items.set(index, { id: item.id, type: item.type, done: false });
        if (item.type === "message") {
          if (
            messageId ||
            item.role !== "assistant" ||
            item.status !== "in_progress" ||
            !Array.isArray(item.content) ||
            item.content.length !== 0
          )
            throw Error("Gateway refused");
          messageId = item.id;
          messageIndex = index;
        }
      }
      if (event.type === "response.content_part.added") {
        if (
          !messageId ||
          !linked(event) ||
          messageStage !== "awaiting-part" ||
          event.part?.type !== "output_text" ||
          event.part.text !== ""
        )
          throw Error("Gateway refused");
        messageStage = "reading-text";
      }
      if (event.type === "response.output_text.done") {
        if (
          !linked(event) ||
          messageStage !== "reading-text" ||
          output !== gatewayMarker ||
          event.text !== output
        )
          throw Error("Gateway refused");
        messageStage = "text-finalized";
      }
      if (event.type === "response.content_part.done") {
        if (
          !linked(event) ||
          messageStage !== "text-finalized" ||
          event.part?.type !== "output_text" ||
          event.part.text !== output
        )
          throw Error("Gateway refused");
        messageStage = "part-finalized";
      }
      if (event.type === "response.output_item.done") {
        const item = items.get(event.output_index);
        if (
          !item ||
          item.done ||
          item.id !== event.item?.id ||
          item.type !== event.item?.type
        )
          throw Error("Gateway refused");
        if (item.type === "message") {
          if (messageStage !== "part-finalized" || !finalMessage(event.item))
            throw Error("Gateway refused");
          messageStage = "item-finalized";
        }
        item.done = true;
      }
      if (
        knownType === "other" &&
        !/^response\.reasoning_(summary_)?(text|part)\.(added|delta|done)$/.test(
          event.type ?? "",
        )
      )
        throw Error("Gateway refused");
      if (event.type === "response.output_text.delta") {
        if (
          !linked(event) ||
          messageStage !== "reading-text" ||
          typeof event.delta !== "string"
        )
          throw Error("Gateway refused");
        output += event.delta;
        if (!gatewayMarker.startsWith(output)) throw Error("Gateway refused");
        this.stream.deltas++;
        this.stream.deltaTextLength = output.length;
        this.stream.deltaMatches = output === gatewayMarker;
      }
      if (event.type === "response.completed") {
        this.stream.completed = true;
        this.stream.completedOutputPresent = Array.isArray(
          event.response?.output,
        );
        this.stream.completedOutputAllowed =
          Array.isArray(event.response?.output) &&
          event.response.output.every(
            (i: any) =>
              i.type === "reasoning" ||
              (i.type === "message" &&
                i.role === "assistant" &&
                Array.isArray(i.content) &&
                i.content.every((p: any) => p.type === "output_text")),
          );
        if (
          event.response?.status !== "completed" ||
          event.response.id !== responseId ||
          event.response.error != null ||
          event.response.incomplete_details != null ||
          messageStage !== "item-finalized" ||
          [...items.values()].some((i) => !i.done) ||
          !this.stream.completedOutputAllowed
        )
          throw Error("Gateway refused");
        const messages = event.response.output.filter(
          (i: any) => i.type === "message",
        );
        const textParts = messages.flatMap((i: any) => i.content);
        const finalText = textParts.map((p: any) => p.text).join("");
        this.stream.completedMessageCount = messages.length;
        this.stream.completedTextPartCount = textParts.length;
        this.stream.completedTextLength = finalText.length;
        this.stream.completedTextTrimMatches =
          finalText.trim() === gatewayMarker;
        this.stream.completedTextMatches = finalText === gatewayMarker;
        if (
          messages.length > 1 ||
          (messages.length === 1 &&
            (!finalMessage(messages[0]) || finalText !== gatewayMarker))
        )
          throw Error("Gateway refused");
        completed = true;
      }
    }
    if (!completed || output !== gatewayMarker) throw Error("Gateway refused");
    this.phase = "completed";
    // Return a minimal canonical stream; provider metadata never enters the VM.
    return syntheticGatewayResponse();
  }
}

class SubscriptionProviderRefusal extends Error {
  constructor(readonly status: number) {
    super("Subscription provider refused");
  }
}

/** Fixed subscription origin. No redirects, refresh, retries or paid fallback. */
export function subscriptionResponses(
  fetchResponse: typeof fetch = fetch,
): SubscriptionProvider {
  return async (token, body, signal) => {
    const response = await fetchResponse(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body,
      },
    );
    if (!response.ok || !response.body)
      throw new SubscriptionProviderRefusal(response.status);
    const reader = response.body.getReader();
    let bytes = 0;
    const chunks: Buffer[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 65536) throw Error("Subscription response unavailable");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks);
  };
}

export function syntheticGatewayResponse(): Buffer {
  const item = {
    id: "msg_aios_fixture",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: gatewayMarker, annotations: [] }],
  };
  const response = {
    id: "resp_aios_fixture",
    object: "response",
    status: "completed",
    model: "gpt-6.1-sol",
    output: [item],
  };
  const events = [
    {
      type: "response.created",
      response: { ...response, status: "in_progress", output: [] },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, status: "in_progress", content: [] },
    },
    {
      type: "response.content_part.added",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    },
    {
      type: "response.output_text.delta",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: gatewayMarker,
    },
    {
      type: "response.output_text.done",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      text: gatewayMarker,
    },
    {
      type: "response.content_part.done",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: item.content[0],
    },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response },
  ];
  return Buffer.from(
    events
      .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join(""),
  );
}

export function syntheticGatewayAccount(): GatewayAccount {
  return {
    issuer: "https://auth.openai.com",
    clientId: "synthetic-client",
    subject: "synthetic-subject",
    hostId: "urn:uuid:00000000-0000-4000-8000-000000000021",
    planUsageAuthorized: true,
    scopes: ["resource.invoke", "chatgpt.tokens.use.direct"],
    expiresAt: Date.now() + 60000,
    accessToken: randomBytes(32).toString("hex"),
  };
}
export function syntheticGatewayApproval(
  deliveryId: string,
  account: GatewayAccount,
): GatewayApproval {
  return {
    runId: deliveryId,
    deliveryId,
    accountId: hash(
      JSON.stringify([
        account.issuer,
        account.clientId,
        account.subject,
        account.hostId,
      ]),
    ),
    hostId: account.hostId,
    requestSha256: hash(gatewayRequest),
    expiresAt: Date.now() + 30000,
    unknownUsageApproved: true,
  };
}

export async function hostGatewayCanary(): Promise<"passed" | "not-run"> {
  const account = syntheticGatewayAccount(),
    delivery = "00000000-0000-4000-8000-000000000021";
  let calls = 0,
    reads = 0;
  const gateway = new HostSubscriptionGateway(
    syntheticGatewayApproval(delivery, account),
    () => {
      reads++;
      return account;
    },
    subscriptionResponses(async (url, options) => {
      if (
        url !== "https://api.openai.com/v1/responses" ||
        options?.method !== "POST" ||
        options.redirect !== "error" ||
        (options.headers as Record<string, string>).authorization !==
          `Bearer ${account.accessToken}` ||
        options.body !== gatewayRequest ||
        options.signal?.aborted
      )
        throw Error();
      calls++;
      return new Response(
        syntheticGatewayResponse()
          .toString()
          .split("\n")
          .map((line) => {
            if (!line.startsWith("data: ")) return line;
            const event = JSON.parse(line.slice(6));
            if (event.type === "response.completed") event.response.output = [];
            return "data: " + JSON.stringify(event);
          })
          .join("\n"),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  );
  const deny = async (id: string, cap: string, body: string) => {
    try {
      await gateway.respond(id, cap, body);
      return false;
    } catch {
      return true;
    }
  };
  try {
    if (
      !(await deny(
        "00000000-0000-4000-8000-000000000022",
        gateway.capability,
        gatewayRequest,
      )) ||
      !(await deny(delivery, "0".repeat(64), gatewayRequest)) ||
      !(await deny(
        delivery,
        gateway.capability,
        JSON.stringify({
          ...JSON.parse(gatewayRequest),
          tools: [{ type: "function", name: "mcp__owner" }],
        }),
      )) ||
      calls !== 0 ||
      reads !== 0
    )
      throw Error();
    // Ignored developer context/tools cannot alter the independently fixed upstream body.
    const contextual = JSON.parse(gatewayRequest);
    contextual.input.unshift({
      role: "developer",
      type: "additional_tools",
      tools: [{ type: "function", name: "shell" }],
    });
    contextual.input.unshift({
      role: "developer",
      content: "Synthetic context must be discarded",
    });
    const returned = await gateway.respond(
      delivery,
      gateway.capability,
      JSON.stringify(contextual),
    );
    if (!returned.equals(syntheticGatewayResponse())) throw Error();
    // Controlled protocol mutations run through the same public qualification canary.
    const events = syntheticGatewayResponse()
      .toString()
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    const variants: { events: any[]; accepted: boolean }[] = [
      { events, accepted: true },
      {
        events: events.map((e) =>
          e.type === "response.completed"
            ? {
                ...e,
                response: {
                  ...e.response,
                  output: [{ type: "reasoning", summary: [] }],
                },
              }
            : e,
        ),
        accepted: true,
      },
    ];
    for (const type of [
      "response.created",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.completed",
    ])
      variants.push({
        events: events.filter((e) => e.type !== type),
        accepted: false,
      });
    for (const field of ["item_id", "output_index", "content_index"])
      variants.push({
        events: events.map((e) =>
          e.type === "response.output_text.done"
            ? { ...e, [field]: field === "item_id" ? "wrong-item" : 1 }
            : e,
        ),
        accepted: false,
      });
    for (const type of [
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.completed",
    ]) {
      const changed = structuredClone(events);
      const e = changed.find((e) => e.type === type);
      if (type === "response.output_text.done") e.text = "wrong";
      if (type === "response.content_part.done") e.part.text = "wrong";
      if (type === "response.output_item.done")
        e.item.content[0].text = "wrong";
      if (type === "response.completed")
        e.response.output[0].content[0].text = "wrong";
      variants.push({ events: changed, accepted: false });
      variants.push({
        events: events.flatMap((e) => (e.type === type ? [e, e] : [e])),
        accepted: false,
      });
    }
    variants.push({
      events: [
        ...events,
        events.find((e) => e.type === "response.output_text.delta"),
      ],
      accepted: false,
    });
    variants.push({
      events: events.map((e) =>
        e.type === "response.output_item.added"
          ? { ...e, item: { ...e.item, type: "function_call" } }
          : e,
      ),
      accepted: false,
    });
    variants.push({
      events: events.map((e) =>
        e.type === "response.completed"
          ? { ...e, response: { ...e.response, status: "incomplete" } }
          : e,
      ),
      accepted: false,
    });
    variants.push({
      events: events.map((e) =>
        e.type === "response.completed"
          ? { ...e, response: { ...e.response, error: { code: "synthetic" } } }
          : e,
      ),
      accepted: false,
    });
    for (const variant of variants) {
      const probe = new HostSubscriptionGateway(
        syntheticGatewayApproval(delivery, account),
        () => account,
        async () =>
          Buffer.from(
            variant.events
              .map((e) => "data: " + JSON.stringify(e) + "\n\n")
              .join(""),
          ),
      );
      let accepted = false;
      try {
        accepted = (
          await probe.respond(delivery, probe.capability, gatewayRequest)
        ).equals(syntheticGatewayResponse());
      } catch {
        /* Fixed refusal is the expected negative verdict. */
      } finally {
        probe.revoke();
      }
      if (accepted !== variant.accepted) throw Error();
    }

    if (
      Number(calls) !== 1 ||
      Number(reads) !== 1 ||
      !(await deny(delivery, gateway.capability, gatewayRequest))
    )
      throw Error();
    for (const changed of [
      { ...account, subject: "another-owner" },
      { ...account, expiresAt: Date.now() - 1 },
      { ...account, scopes: ["openid"] },
    ]) {
      let leaked = false;
      const deniedAccount = new HostSubscriptionGateway(
        syntheticGatewayApproval(delivery, account),
        () => changed,
        async () => {
          leaked = true;
          return syntheticGatewayResponse();
        },
      );
      let refused = false;
      try {
        await deniedAccount.respond(
          delivery,
          deniedAccount.capability,
          gatewayRequest,
        );
      } catch {
        refused = true;
      } finally {
        deniedAccount.revoke();
      }
      if (!refused || leaked) throw Error();
    }
    const malformed = new HostSubscriptionGateway(
      syntheticGatewayApproval(delivery, account),
      () => account,
      subscriptionResponses(
        async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    let malformedRefused = false;
    try {
      await malformed.respond(delivery, malformed.capability, gatewayRequest);
    } catch {
      malformedRefused = true;
    } finally {
      malformed.revoke();
    }
    if (
      !malformedRefused ||
      malformed.observation.providerAttempts !== 1 ||
      malformed.observation.phase !== "response-validation"
    )
      throw Error();
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    const inflight = new HostSubscriptionGateway(
      syntheticGatewayApproval(delivery, account),
      () => account,
      async (_token, _body, signal) => {
        started();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        return syntheticGatewayResponse();
      },
    );
    const response = inflight
      .respond(delivery, inflight.capability, gatewayRequest)
      .then(
        () => false,
        () => true,
      );
    await pending;
    inflight.revoke();
    if (!(await response)) throw Error();
    return "passed";
  } catch {
    return "not-run";
  } finally {
    gateway.revoke();
  }
}
