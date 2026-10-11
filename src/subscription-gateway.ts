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
  constructor(
    approval: GatewayApproval,
    private readonly account: () => GatewayAccount,
    private readonly provider: SubscriptionProvider = subscriptionResponses,
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
    const value = JSON.parse(raw);
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
    try {
      data = await Promise.race([
        this.provider(account.accessToken, gatewayRequest, signal),
        cancelled,
      ]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
    if (signal.aborted || Date.now() >= a.expiresAt || data.byteLength > 65536)
      throw Error("Gateway refused");
    // Buffer until completion; never deliver partial output after revocation.
    let output = "",
      completed = false;
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
      if (
        ["error", "response.failed", "response.incomplete"].includes(event.type)
      )
        throw Error("Gateway refused");
      if (event.type === "response.output_text.delta") output += event.delta;
      if (event.type === "response.completed") {
        if (
          event.response?.status !== "completed" ||
          !Array.isArray(event.response.output) ||
          event.response.output.some(
            (i: any) =>
              i.type !== "message" ||
              i.role !== "assistant" ||
              i.content?.some((p: any) => p.type !== "output_text"),
          )
        )
          throw Error("Gateway refused");
        completed = true;
      }
    }
    if (!completed || output !== gatewayMarker) throw Error("Gateway refused");
    // Return a minimal canonical stream; provider metadata never enters the VM.
    return syntheticGatewayResponse();
  }
}

/** Fixed subscription origin. No redirects, refresh, retries or paid fallback. */
async function subscriptionResponses(
  token: string,
  body: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    redirect: "error",
    signal,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body,
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.startsWith("text/event-stream") ||
    !response.body
  )
    throw Error("Subscription response unavailable");
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
    async (token, body, signal) => {
      if (
        token !== account.accessToken ||
        body !== gatewayRequest ||
        signal.aborted
      )
        throw Error();
      calls++;
      return syntheticGatewayResponse();
    },
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
    await gateway.respond(
      delivery,
      gateway.capability,
      JSON.stringify(contextual),
    );
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
