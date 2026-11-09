import type { MessagesSessionFactory } from "./controller.js";
import { anthropicAccount, readAnthropicKey } from "./anthropic-key.js";
import {
  hostCredentialVault,
  type CredentialVault,
} from "./credential-vault.js";
import {
  MessagesGateway,
  messagesLimits,
  type MessagesProvider,
} from "./messages-gateway.js";
import type { SessionGateway } from "./session-relay.js";

/** ADR 0008: the metered Claude Code turns for the owner's Anthropic key in
 * the private auth `directory`. Each turn gets its own `MessagesGateway` on
 * the host, whose only authority is the delivery's spend budget; the key
 * never leaves the host. The account record is read now; the vault is opened
 * and read only at a model request, so a replaced key is seen. */
export function meteredMessagesSessions(
  directory: string,
  options: {
    vault?: Pick<CredentialVault, "read">;
    provider?: MessagesProvider;
  } = {},
): MessagesSessionFactory {
  const record = anthropicAccount(directory);
  if (!record) throw Error("No Anthropic key is stored");
  let vault = options.vault;
  const apiKey = () =>
    readAnthropicKey((vault ??= hostCredentialVault(directory, true)), record)
      .apiKey;
  return (turn, budget) =>
    messagesSession(
      new MessagesGateway(
        { ...turn, maxRequests: messagesLimits.maxRequests },
        apiKey,
        budget,
        ...(options.provider ? [options.provider] : []),
      ),
    );
}

/** A Messages gateway as the session relay holds it. The relay's own reasons
 * for ending a session all stop it; expiry and the response bound keep
 * theirs. */
export function messagesSession(gateway: MessagesGateway): SessionGateway {
  return {
    capability: gateway.capability,
    respond: (deliveryId, capability, raw) =>
      gateway.respond(deliveryId, capability, raw),
    revoke: (reason) =>
      gateway.revoke(
        reason === "expired" || reason === "response-bound"
          ? reason
          : "stopped",
      ),
  };
}
