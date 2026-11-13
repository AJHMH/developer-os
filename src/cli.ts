#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { storeAnthropicKey } from "./anthropic-key.js";
import { meteredMessagesSessions } from "./messages-sessions.js";
import { hostCredentialVault } from "./credential-vault.js";
import { readSecret } from "./secret-input.js";
import { cliOptions, validateCliCommand } from "./cli-commands.js";
import { DeliveryController, DeliveryError } from "./controller.js";
import { ownerHostRefusal, supportsOwnerHost } from "./host-target.js";
import { inspectLocalRepository } from "./onboarding.js";
import { prepareHostRegistration } from "./host-registration.js";
import { nativeCodingRuntime } from "./native-coding-runtime.js";
import {
  nativeValidationRuntime,
  ownerPolicyDeclaresBrowser,
  ownerPolicyDeclaresDatabase,
  ownerPolicyDeclaresPreparedNpm,
} from "./native-validation-runtime.js";
import { httpsRegistryReader } from "./dependency-cache.js";
import { ownerCriteriaPlanner } from "./feature-criteria.js";
import { ownerProductionAdmission } from "./production-admission.js";
import { nativePublicationRuntime } from "./publication-identity.js";
import { ownerPolicyPRChecksRuntime } from "./native-pr-checks.js";
import { ownerPolicyMergeRuntime } from "./native-merge.js";
import { ownerPolicyReviewRuntime } from "./native-review.js";

const usage =
  "Use start --repo <absolute-directory> --request <text>, status [--id <delivery-id>], or pause/resume/cancel/recover/release --id <delivery-id>. Options: --state-dir <absolute-directory>, --owner-policy <external-file> for start, validate-baseline, validate-candidate, code-feature and repair-feature, with optional --onboarding-attestation <owner-record> for the onboarding facts the CLI cannot observe (attested, never live verification; ADR 0004). Add --podman-machine <aios-name> with --coding-admission <owner-record> to pause/cancel/recover to stop or recover the exact native coding session through the owner-admitted pins. Add --validation-admission <owner-record> with --podman-machine to validate-baseline/validate-candidate to run checks offline on the owner-admitted native validation runtime, or to pause/cancel/recover to also stop the exact native validation attempt. Prepare the non-secret host registration with prepare-auth --repo <absolute-directory> --auth-directory <external-directory> [--state-dir <absolute-directory>]; the auth directory must sit outside the repository and the state directory. Check the owner's production admission record with check-production --production-admission <owner-record>: it verifies the record against the passing worker qualification report it names and prints the coding pins and validation binding it admits; publication, and so every later stage, needs a delivery whose coding and validation ran under exactly those (ticket 04). Store the owner's Anthropic API key for metered model access with store-anthropic-key --auth-directory <external-directory> [--replace]: it prompts with hidden input (or reads standard input), verifies the key with one free model-list request and keeps it only in the protected macOS Keychain (ADR 0006). Use --coding-minutes <1..1440> on start for the initial coding allowance (default 120). Use --budget-dollars <amount> on start for the delivery's spend budget for metered model access (default 10, whole cents up to 1000; ADR 0008), and extend-budget --id <id> --dollars <amount> to add to it after a budget interruption. plan-feature/code-feature address an explicit --id. plan-feature and clarify-feature take --feature-criteria <owner-file>: the owner's private criteria for this delivery's exact request and clarifications (ADR 0004); without it planning refuses. code-feature --id <id> takes --owner-policy (with optional --onboarding-attestation), --podman-machine with the owner's Claude Code --coding-admission and --validation-admission, --auth-directory <external-directory> holding the owner's stored Anthropic key, and optional --coding-minutes <1..1440>: it runs one Claude Code turn on the owner-admitted native runtimes to a candidate (ADR 0004). The turn is metered through the key, and the delivery's spend budget is its only model authority (ADR 0008); a budget interruption stops it until extend-budget. Production delivery stays disabled. clarify-feature --id <id> --clarification <text> retains an explicit owner answer to material planning ambiguity. extend-coding --id <id> --minutes <1..1440> records an owner extension for stopped exhausted work. validate-baseline/validate-candidate --id <id> require an owner validation contract and, from the CLI, --validation-admission. When the owner contract declares the prepared npm cache, the host fetches and verifies exactly the tarballs the candidate's lockfile pins from registry.npmjs.org, and each attempt installs them offline in its own container. When it declares a database, each E2E check gets a fresh PostgreSQL from the validation record's database image, reachable only on its own loopback; when it declares a browser, each E2E check runs in the validation record's Playwright image. repair-feature --id <id> repairs a failed candidate within the repair allowance, including local revalidation: three cycles or 60 active minutes, unless start set --repair-cycles <1..100> or --repair-minutes <1..1440>. It takes code-feature's options except --coding-minutes, on the same owner-admitted native runtimes; without them it refuses without recording a repair. extend-repair --id <id> [--cycles <0..100>] [--minutes <0..1440>] records an explicit owner extension for stopped exhausted repairs. publish-feature/reconcile-publication --id <id> take the owner policy and --podman-machine with --validation-admission (publication re-checks validation), --production-admission <owner-record> (the delivery's coding and validation must have run under the pins it admits) and --publication-identity <owner-record>: the owner's key signs the exact validated tree through ssh-agent, the owner's gh login pushes it to the feature branch only when absent or from its exact previous head, GitHub must verify the signature, and the Software Factory App opens the PR with a token limited to pull requests (#267). reconcile-publication only observes. monitor-pr-checks/repair-pr-checks --id <id> and rerun-pr-check --id <id> --check-id <id> take the owner policy and, since they re-check the publication's validation, --podman-machine with --validation-admission: they observe, through the owner's gh login, the GitHub Actions runs of the policy's PR checks declared with publisher github-actions and workflow <path>@<default branch>, for the PR's exact head, counting a run only while its workflow file matches the default branch's (#268). rerun-pr-check reruns that run's failed jobs once; repair-pr-checks also takes code-feature's options and --production-admission and --publication-identity, to repair and republish. monitor-review/repair-review --id <id> and resolve-review-thread --id <id> --thread-id <id> take the owner policy and --podman-machine with --validation-admission, for the PR check monitor and the native review adapter (#269): through the owner's gh login they read the PR's reviews, conversations, eligible approvers and complete diff, never submitting a review. A conversation is a straightforward fix only when the owner started it and reacted thumbs-up to its first comment, with no one else's words in it. resolve-review-thread resolves one verified conversation; repair-review also takes code-feature's options and --production-admission and --publication-identity, to repair and republish. merge-feature/reconcile-merge/refresh-merge-base --id <id> take the owner policy (#270): merge-feature re-checks the PR checks, the review and the production admission, so it also takes --podman-machine, --validation-admission and --production-admission, then the owner's gh login fast-forwards the default branch to the PR's exact head with a lease on main's expected revision, under GitHub's own branch rules. reconcile-merge only observes. refresh-merge-base also takes code-feature's options and --production-admission and --publication-identity, to repair and republish onto advanced main. monitor-main-checks --id <id> observes trusted checks for the confirmed merged/main revision; no native main observer is installed. sync-main/reconcile-main-sync --id <id> require fresh trusted main checks and a controlled conditional Git adapter; no native synchronization adapter is installed. cleanup-branches/reconcile-cleanup --id <id> require synchronized verified main and controlled conditional branch authority; no native cleanup adapter is installed. Production delivery remains disabled.";

function argumentsForCommand() {
  try {
    return parseArgs({
      allowPositionals: true,
      tokens: true,
      options: cliOptions,
    });
  } catch {
    throw new DeliveryError(usage);
  }
}
try {
  // Linux CI stands in for the owner's Mac by naming it here; nothing else does.
  if (
    !supportsOwnerHost(process.env.AIOS_TEST_HOST_PLATFORM ?? process.platform)
  )
    throw new DeliveryError(ownerHostRefusal);
  const { values, positionals, tokens } = argumentsForCommand();
  const invocation = validateCliCommand(
    positionals,
    values,
    tokens
      .filter((token) => token.kind === "option")
      .map((token) => token.name),
  );
  if ("error" in invocation) throw new DeliveryError(usage);
  const { command } = invocation,
    stateDirectory = values["state-dir"] ?? join(homedir(), ".developer-os");
  let result;
  if (command.kind === "auth") {
    const actions = {
      "store-anthropic-key": async () =>
        storeAnthropicKey({
          directory: values["auth-directory"]!,
          apiKey: await readSecret("Anthropic API key (input hidden): "),
          vault: () => hostCredentialVault(values["auth-directory"]!),
          replace: values.replace === true,
        }),
      "check-production": () => {
        try {
          return ownerProductionAdmission(
            values["production-admission"]!,
          ).admitted();
        } catch {
          throw new DeliveryError(
            "The owner production admission record is missing or invalid, or its qualification report doesn't pass at those pins. Production remains disabled.",
          );
        }
      },
      prepare: () =>
        prepareHostRegistration(
          values["auth-directory"]!,
          values.repo!,
          stateDirectory,
        ),
    };
    result = await actions[command.authAction!]();
  } else {
    let featureRuntime;
    if (values["coding-admission"])
      try {
        featureRuntime = nativeCodingRuntime(
          values["podman-machine"]!,
          values["coding-admission"],
        );
      } catch {
        throw new DeliveryError(
          "The owner coding admission record is missing or invalid, or does not admit valid coding pins. Production remains disabled.",
        );
      }
    let validationRuntime;
    if (values["validation-admission"])
      try {
        validationRuntime = nativeValidationRuntime(
          values["podman-machine"]!,
          values["validation-admission"],
          // #265: offline installs from the prepared cache, and a database
          // and browser for each E2E check, only when the owner contract
          // declares them.
          {
            ...(ownerPolicyDeclaresPreparedNpm(values["owner-policy"])
              ? { reader: httpsRegistryReader() }
              : {}),
            database: ownerPolicyDeclaresDatabase(values["owner-policy"]),
            browser: ownerPolicyDeclaresBrowser(values["owner-policy"]),
          },
        );
      } catch {
        throw new DeliveryError(
          "The owner validation admission record is missing or invalid, or does not admit valid validation pins. Production remains disabled.",
        );
      }
    let productionAdmission;
    if (values["production-admission"])
      try {
        productionAdmission = ownerProductionAdmission(
          values["production-admission"],
        );
      } catch {
        throw new DeliveryError(
          "The owner production admission record is missing or invalid. Production remains disabled.",
        );
      }
    let publicationRuntime;
    if (values["publication-identity"])
      try {
        publicationRuntime = nativePublicationRuntime(
          values["publication-identity"],
          stateDirectory,
        );
      } catch {
        throw new DeliveryError(
          "The owner publication record is missing or invalid. Nothing was published.",
        );
      }
    // #268: the native PR check monitor, for the owner policy's GitHub
    // Actions PR checks. Review re-checks them, so it installs it too.
    const mergeCommand = [
      "merge-feature",
      "reconcile-merge",
      "refresh-merge-base",
    ].includes(invocation.name);
    const reviewCommand =
      mergeCommand ||
      ["monitor-review", "repair-review", "resolve-review-thread"].includes(
        invocation.name,
      );
    const prChecksRuntime =
      (reviewCommand ||
        ["monitor-pr-checks", "rerun-pr-check", "repair-pr-checks"].includes(
          invocation.name,
        )) &&
      values["owner-policy"]
        ? ownerPolicyPRChecksRuntime(values["owner-policy"], stateDirectory)
        : undefined;
    // #270: the native fast-forward merge, for the owner policy's repository.
    const mergeRuntime =
      mergeCommand && values["owner-policy"]
        ? ownerPolicyMergeRuntime(values["owner-policy"], stateDirectory)
        : undefined;
    // #269: the native review adapter, for the owner policy's repository.
    const reviewRuntime =
      reviewCommand && values["owner-policy"]
        ? ownerPolicyReviewRuntime(values["owner-policy"], stateDirectory)
        : undefined;
    let messagesSessions;
    if (values["auth-directory"])
      try {
        messagesSessions = meteredMessagesSessions(values["auth-directory"]);
      } catch {
        throw new DeliveryError(
          "The owner's Anthropic key is missing or invalid. Store it with store-anthropic-key --auth-directory. Production remains disabled.",
        );
      }
    const controller = new DeliveryController(
      stateDirectory,
      {
        inspect: inspectLocalRepository,
        ...(values["owner-policy"] === undefined
          ? {}
          : { policyPath: values["owner-policy"] }),
        ...(values["onboarding-attestation"] === undefined
          ? {}
          : { attestationPath: values["onboarding-attestation"] }),
      },
      {
        ...(featureRuntime ? { featureRuntime } : {}),
        ...(validationRuntime ? { validationRuntime } : {}),
        ...(messagesSessions ? { messagesSessions } : {}),
        ...(productionAdmission ? { productionAdmission } : {}),
        ...(publicationRuntime ? { publicationRuntime } : {}),
        ...(prChecksRuntime ? { prChecksRuntime } : {}),
        ...(reviewRuntime ? { reviewRuntime } : {}),
        ...(mergeRuntime ? { mergeRuntime } : {}),
        ...(values["feature-criteria"]
          ? {
              featurePlanner: ownerCriteriaPlanner(
                values["feature-criteria"],
                values.id!,
              ),
            }
          : {}),
      },
    );
    if (!command.invoke) throw new DeliveryError(usage);
    result = await command.invoke(controller, values);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ error: error instanceof DeliveryError ? error.message : "Unable to access the repository or delivery state. Check local paths and permissions." })}\n`,
  );
  process.exitCode = 1;
}
