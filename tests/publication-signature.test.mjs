import { test } from "node:test";
import { publicationEvidence } from "./helpers/publication-evidence-fixture.mjs";

for (const [stage, patch] of [
  ["sign", { localVerified: false }],
  ["sign", { tree: "b".repeat(40) }],
  ["sign", { signer: "factory[bot]" }],
  ["sign", { parent: "b".repeat(40) }],
])
  test(stage + " rejects mismatched evidence " + JSON.stringify(patch), (t) =>
    publicationEvidence(t, stage, patch),
  );
