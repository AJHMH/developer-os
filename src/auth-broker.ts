import {
  createHash,
  createPublicKey,
  randomBytes,
  verify,
  type JsonWebKey,
} from "node:crypto";
import { DeliveryError } from "./controller.js";

export interface SelectedAccount {
  clientId: string;
  subject: string;
  idToken: string;
}
interface Registration {
  hostId: string;
  agentName: string;
}
interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}
interface SigningKey extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}
export interface AuthorizationTransport {
  exchange(parameters: Record<string, string>): Promise<TokenResponse>;
  signingKeys(): Promise<SigningKey[]>;
}
export interface ValidatedAccount {
  issuer: "https://auth.openai.com";
  subject: string;
  clientId: string;
  hostId: string;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  scopes: string[];
  expiresAt: number;
  planUsageAuthorized: boolean;
}
const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const scopes =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const failure = () =>
  new DeliveryError(
    "Authentication could not be verified; start a fresh authorization. Existing account credentials remain unchanged and delivery remains disabled.",
  );

/** Trusted host-only authorization boundary. No credentials or pending secrets
 * are persisted, logged or supplied to a worker by this broker. */
export class SubscriptionAuthBroker {
  private pending?: {
    state: string;
    nonce: string;
    verifier: string;
    callback: string;
    deadline: number;
    account?: SelectedAccount;
  };
  constructor(
    private registration: Registration,
    private transport: AuthorizationTransport,
  ) {}
  begin(callbackUri: string, account?: SelectedAccount) {
    const url = new URL(callbackUri);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !url.port ||
      url.pathname !== "/auth/callback" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      !/^urn:uuid:[a-f0-9-]{36}$/.test(this.registration.hostId) ||
      this.registration.agentName !== "Developer OS"
    )
      throw failure();
    if (
      account &&
      (!/^oaiapp_[A-Za-z0-9_-]{1,200}$/.test(account.clientId) ||
        !account.subject ||
        !account.idToken)
    )
      throw failure();
    const fresh = () => randomBytes(32).toString("base64url");
    this.pending = {
      state: fresh(),
      nonce: fresh(),
      verifier: fresh(),
      callback: url.href,
      deadline: Date.now() + 300_000,
      ...(account ? { account: { ...account } } : {}),
    };
    const auth = new URL(issuer + "/api/accounts/authorize");
    auth.search = new URLSearchParams({
      client_id: account?.clientId ?? "dynamic_agent_client",
      ...(account ? {} : { agent_name_hint: this.registration.agentName }),
      ext_agent_host_id: this.registration.hostId,
      response_type: "code",
      redirect_uri: url.href,
      scope: scopes,
      resource,
      state: this.pending.state,
      nonce: this.pending.nonce,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256")
        .update(this.pending.verifier)
        .digest("base64url"),
    }).toString();
    return {
      authorizationUrl: auth.href,
      callbackUri: url.href,
      deliveryEnabled: false,
    };
  }
  async complete(callbackUri: string): Promise<ValidatedAccount> {
    const pending = this.pending;
    // Every completion attempt consumes the pending exchange, including refusal.
    delete this.pending;
    try {
      if (!pending || Date.now() >= pending.deadline) throw Error();
      const callback = new URL(callbackUri),
        expected = new URL(pending.callback);
      if (
        callback.origin !== expected.origin ||
        callback.pathname !== expected.pathname ||
        callback.hash ||
        callback.username ||
        callback.password
      )
        throw Error();
      const params = callback.searchParams;
      for (const name of params.keys())
        if (params.getAll(name).length !== 1) throw Error();
      if (params.get("state") !== pending.state || params.has("error"))
        throw Error();
      const clientId = params.get("client_id") ?? pending.account?.clientId,
        code = params.get("code");
      if (pending.account && clientId !== pending.account.clientId)
        throw Error();
      if (
        !clientId ||
        !/^oaiapp_[A-Za-z0-9_-]{1,200}$/.test(clientId) ||
        !code ||
        code.length > 4096
      )
        throw Error();
      const tokens = await this.transport.exchange({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: pending.verifier,
        redirect_uri: pending.callback,
        resource,
      });
      if (
        tokens.token_type !== "Bearer" ||
        !Number.isSafeInteger(tokens.expires_in) ||
        tokens.expires_in <= 0 ||
        tokens.expires_in > 86400 ||
        ![
          tokens.id_token,
          tokens.access_token,
          tokens.refresh_token,
          tokens.scope,
        ].every(
          (x) => typeof x === "string" && x.length > 0 && x.length <= 32768,
        )
      )
        throw Error();
      const parts = tokens.id_token.split(".");
      if (parts.length !== 3 || parts.some((x) => !/^[A-Za-z0-9_-]+$/.test(x)))
        throw Error();
      const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString());
      if (
        header.alg !== "RS256" ||
        typeof header.kid !== "string" ||
        header.crit ||
        header.jku ||
        header.jwk ||
        header.x5u
      )
        throw Error();
      const keys = (await this.transport.signingKeys()).filter(
        (key) =>
          key.kid === header.kid &&
          key.kty === "RSA" &&
          (!key.alg || key.alg === "RS256") &&
          (!key.use || key.use === "sig"),
      );
      if (
        keys.length !== 1 ||
        !verify(
          "RSA-SHA256",
          Buffer.from(parts[0] + "." + parts[1]),
          createPublicKey({ key: keys[0]!, format: "jwk" }),
          Buffer.from(parts[2]!, "base64url"),
        )
      )
        throw Error();
      const claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
      const now = Math.floor(Date.now() / 1000);
      if (
        claims.iss !== issuer ||
        claims.aud !== clientId ||
        claims.nonce !== pending.nonce ||
        typeof claims.sub !== "string" ||
        !claims.sub ||
        claims.sub.length > 256 ||
        !Number.isSafeInteger(claims.exp) ||
        claims.exp <= now ||
        (claims.nbf !== undefined &&
          (!Number.isSafeInteger(claims.nbf) || claims.nbf > now))
      )
        throw Error();
      if (pending.account && claims.sub !== pending.account.subject)
        throw Error();
      const granted = tokens.scope.split(/\s+/);
      return {
        issuer,
        subject: claims.sub,
        clientId,
        hostId: this.registration.hostId,
        idToken: tokens.id_token,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        scopes: granted,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        planUsageAuthorized:
          granted.includes("chatgpt.tokens.use.direct") &&
          granted.includes("resource.invoke"),
      };
    } catch {
      throw failure();
    }
  }
}
