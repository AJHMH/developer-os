import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { nativeAppPullRequestPort } from "./native-app-pr.js";
import { nativeGitPublicationPort } from "./native-publication.js";
import { SplitPublicationAdapter } from "./publication-adapter.js";

/** The owner's publication identity record (#267): identities and key paths,
 * never a secret. */
export interface PublicationIdentity {
  repository: string;
  login: string;
  name: string;
  email: string;
  /** The owner's public signing key (`.pub`); signing uses ssh-agent. */
  signingKey: string;
  appId: string;
  installationId: string;
  botLogin: string;
  /** The App's PEM, read only to sign the App's JWT. */
  appKeyPath: string;
  approver: string;
  /** The record's own digest: the publisher binding it installs. */
  sha256: string;
}
const fields = [
  "repository",
  "login",
  "name",
  "email",
  "signingKey",
  "appId",
  "installationId",
  "botLogin",
  "appKeyPath",
  "approver",
] as const;

/** Reads the owner's private publication record (mode 0600). */
export function readPublicationIdentity(path: string): PublicationIdentity {
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) !== 0)
    throw Error("The owner publication record must be a private file");
  const bytes = readFileSync(path);
  const r = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  if (
    r?.scope !== "aios-publication-identity-v1" ||
    !fields.every((f) => typeof r[f] === "string" && r[f]) ||
    !(r.signingKey as string).endsWith(".pub") ||
    !isAbsolute(r.signingKey as string) ||
    !isAbsolute(r.appKeyPath as string)
  )
    throw Error("Invalid owner publication record");
  return {
    ...(Object.fromEntries(fields.map((f) => [f, r[f]])) as Record<
      (typeof fields)[number],
      string
    >),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** The native publisher the owner's record names (#267): the owner's key
 * through ssh-agent and the owner's `gh` login for the signed push, and the
 * App for the PR. Its Git metadata and dispatch markers live in a private
 * folder under `stateDirectory`, one per repository. Its binding is the
 * record's digest, so a changed record never continues a publication. */
export function nativePublicationRuntime(
  identityPath: string,
  stateDirectory: string,
): SplitPublicationAdapter {
  const identity = readPublicationIdentity(identityPath);
  const folder = join(
    stateDirectory,
    "publication",
    createHash("sha256").update(identity.repository).digest("hex").slice(0, 32),
  );
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  return new SplitPublicationAdapter(
    identity.sha256,
    nativeGitPublicationPort({
      repository: identity.repository,
      login: identity.login,
      name: identity.name,
      email: identity.email,
      signingKey: identity.signingKey,
      metadata: join(folder, "git"),
    }),
    nativeAppPullRequestPort({
      repository: identity.repository,
      appId: identity.appId,
      installationId: identity.installationId,
      botLogin: identity.botLogin,
      keyPath: identity.appKeyPath,
      approver: identity.approver,
      state: join(folder, "app"),
    }),
  );
}
