/** Fixed host-only qualification matrix; never grants production authority. */
import { createHash, randomBytes } from "node:crypto";
import {
  gatewayRequest,
  syntheticGatewayResponse,
} from "./inference-contract.js";
import { subscriptionAccountId } from "./subscription-account.js";
import {
  HostSubscriptionGateway,
  subscriptionResponses,
  type GatewayAccount,
  type GatewayApproval,
} from "./subscription-gateway.js";
const hash = (body: string) => createHash("sha256").update(body).digest("hex");
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
    accountId: subscriptionAccountId(account),
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
