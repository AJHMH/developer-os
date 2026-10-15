import { test } from "node:test";
import { publicationEvidence } from "./helpers/publication-evidence-fixture.mjs";

for (const [stage, patch] of [
  ["push", { githubVerified: false }],
  ["push", { publisher: "factory[bot]" }],
  ["push", { repository: "wrong/repo" }],
  ["push", { commit: "b".repeat(40) }],
  ["createPullRequest", { author: "aaron-howard" }],
  ["createPullRequest", { head: "b".repeat(40) }],
  ["createPullRequest", { base: "other" }],
  ["createPullRequest", { approver: "other" }],
])
  test(stage + " rejects mismatched evidence " + JSON.stringify(patch), (t) =>
    publicationEvidence(t, stage, patch),
  );
