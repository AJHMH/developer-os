import { readFileSync } from "node:fs";
import {
  argumentsOf,
  OperatorRefusal,
  requireValue as check,
  stateDirectory,
} from "./operator/state.mjs";
import {
  GitHubPublisher,
  preparePublication,
  publishPublication,
} from "./operator/publisher.mjs";

const [command, ...argv] = process.argv.slice(2);
async function main() {
  const o = argumentsOf(argv, [
    "repo",
    "state-dir",
    "repository",
    "branch",
    "base",
    "title",
    "body-file",
    "bot",
    "app-id",
    "installation-id",
    "draft",
    "digest",
    "approve-digest",
    "private-key-path",
  ]);
  check(
    o.draft === undefined || ["true", "false"].includes(o.draft),
    "Explicit draft boolean required",
  );
  check(o.repo && o["state-dir"], "--repo and --state-dir required");
  const remote = new GitHubPublisher();
  remote.stateRoot = stateDirectory(o["state-dir"], o.repo);
  if (command === "prepare") {
    check(o["body-file"], "PR description file required");
    const result = await preparePublication(
      {
        repo: o.repo,
        directory: o["state-dir"],
        repository: o.repository,
        branch: o.branch,
        base: o.base ?? "main",
        title: o.title,
        body: readFileSync(o["body-file"], "utf8"),
        bot: o.bot,
        appId: o["app-id"],
        installationId: o["installation-id"],
        draft: o.draft === "true",
      },
      remote,
    );
    console.log(JSON.stringify(result, null, 2));
  } else {
    check(command === "publish", "Expected prepare or publish");
    console.log(
      JSON.stringify(
        await publishPublication(
          {
            repo: o.repo,
            directory: o["state-dir"],
            digest: o.digest,
            approvedDigest: o["approve-digest"],
            privateKeyPath: o["private-key-path"],
          },
          remote,
        ),
        null,
        2,
      ),
    );
  }
}
main().catch((error) => {
  console.error(
    error instanceof OperatorRefusal
      ? error.message
      : "Publication refused or incomplete. Reconcile the private proposal receipt before another write; approval and merge gates remain independent.",
  );
  process.exitCode = 1;
});
