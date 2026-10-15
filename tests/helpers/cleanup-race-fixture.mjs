import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { cleanupFixture } from "./cleanup-fixture.mjs";

export async function cleanupRace(t, race) {
  const f = await cleanupFixture(t),
    location = race === "remote-tip" ? "remote" : "local";
  if (location === "local") f.local("victim");
  else f.remoteBranch("victim");
  const newer = f.newCommit();
  f.beforeDelete = async (r) => {
    if (r.name !== "victim") return;
    if (race === "local-tip")
      f.g("update-ref", "refs/heads/victim", newer, r.expectedTip);
    if (race === "remote-tip") f.remoteBranch("victim", newer);
    if (race === "protection") f.protected.add(`${location}:victim`);
    if (race === "worktree") {
      f.g("config", "extensions.worktreeConfig", "true");
      f.g("config", "--worktree", "fixture.safe", "true");
      f.g("worktree", "add", join(f.root, "raced-worktree"), "victim");
    }
    if (race === "policy") writeFileSync(f.options.policyPath, "{}");
    if (race === "pause") await f.controller.pause(f.delivery.id);
    if (race === "binding") f.cleanupRuntime.bindingSha256 = "3".repeat(64);
  };
  let d;
  try {
    d = await f.controller.cleanupBranches(f.delivery.id);
  } catch {
    d = f.controller.status(f.delivery.id);
  }
  assert.notEqual(d.phase, "completed");
  assert.equal(
    f.deletions.some((x) => x.name === "victim"),
    false,
  );
  if (location === "local")
    assert.equal(
      f.g("rev-parse", "victim"),
      race === "local-tip" ? newer : f.old,
    );
  else
    assert.match(
      f.g("ls-remote", "--heads", "origin", "refs/heads/victim"),
      new RegExp(newer),
    );
}
