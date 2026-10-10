import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { DeliveryError } from "./controller.js";
import { redact } from "./redaction.js";

function canonical(path: string): string {
  const missing: string[] = [];
  let parent = resolve(path);
  while (!existsSync(parent)) {
    missing.unshift(basename(parent));
    const next = dirname(parent);
    if (next === parent) throw Error();
    parent = next;
  }
  if (
    lstatSync(parent).isSymbolicLink() ||
    realpathSync(parent).toLowerCase() !== parent.toLowerCase()
  )
    throw Error();
  return join(realpathSync(parent), ...missing);
}
function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

/** Separate owner setup, not worker qualification. This prepares only non-secret
 * host registration metadata. It neither opens a browser nor obtains tokens. */
export function prepareSubscriptionAuth(
  directory: string,
  repository: string,
  authority: string,
) {
  try {
    if (
      ![directory, repository, authority].every(isAbsolute) ||
      redact(directory) !== directory
    )
      throw Error();
    const target = canonical(directory),
      repo = canonical(repository),
      state = canonical(authority);
    if (
      !lstatSync(repo).isDirectory() ||
      inside(repo, target) ||
      inside(target, repo) ||
      inside(state, target) ||
      inside(target, state)
    )
      throw Error();
    mkdirSync(target, { recursive: true, mode: 0o700 });
    if (
      lstatSync(target).isSymbolicLink() ||
      !lstatSync(target).isDirectory() ||
      canonical(target).toLowerCase() !== target.toLowerCase()
    )
      throw Error();
    const path = join(target, "registration.json");
    let registration: { schema: number; hostId: string; agentName: string };
    if (existsSync(path)) {
      const entry = lstatSync(path);
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        entry.nlink !== 1 ||
        entry.size > 4096
      )
        throw Error();
      registration = JSON.parse(readFileSync(path, "utf8"));
      if (
        registration.schema !== 1 ||
        registration.agentName !== "Developer OS" ||
        !/^urn:uuid:[a-f0-9-]{36}$/.test(registration.hostId) ||
        Object.keys(registration).some(
          (key) => !["schema", "hostId", "agentName"].includes(key),
        )
      )
        throw Error();
    } else {
      registration = {
        schema: 1,
        hostId: `urn:uuid:${randomUUID()}`,
        agentName: "Developer OS",
      };
      writeFileSync(path, JSON.stringify(registration, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
        flush: true,
      });
    }
    return {
      status: "prepared",
      hostId: registration.hostId,
      agentName: registration.agentName,
      registrationPath: path,
      credentialsStored: false,
      deliveryEnabled: false,
      authorizationEndpoint: "https://auth.openai.com/api/accounts/authorize",
      initialClientId: "dynamic_agent_client",
      resource: "https://api.openai.com/v1",
      scopes: [
        "openid",
        "profile",
        "email",
        "offline_access",
        "resource.invoke",
        "chatgpt.tokens.use.direct",
      ],
      nextAction:
        "Use the separate trusted ChatGPT authorization broker; owner browser consent, verified ID token, encrypted host credential storage and qualified VM mediation remain prerequisites. Preparation cannot enable delivery.",
    };
  } catch {
    throw new DeliveryError(
      "Authentication setup requires ordinary external storage separate from the candidate and controller ledger; preserve existing registration material and check paths before retrying.",
    );
  }
}
