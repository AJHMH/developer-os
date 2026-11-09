import { prepareHostRegistration } from "./host-registration.js";
export {
  assertOwnerControlledStorage,
  assertPrivateAuthStorage,
} from "./private-storage.js";

/** Separate owner setup, not worker qualification. This prepares only non-secret
 * host registration metadata. It neither opens a browser nor obtains tokens. */
export function prepareSubscriptionAuth(
  directory: string,
  repository: string,
  authority: string,
) {
  return {
    ...prepareHostRegistration(directory, repository, authority),
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
}
