import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { DeliveryController } from "../../dist/controller.js";
import { branchCleanupControls } from "../../dist/branch-cleanup.js";
import { syncFixture } from "./main-sync-fixture.mjs";

export async function cleanupFixture(t) {
  const f = await syncFixture(t);
  await f.controller.syncMain(f.delivery.id);
  f.protected = new Set();
  f.replays = new Set();
  f.linkages = new Map();
  f.unsupported = new Set();
  f.unknown = new Set();
  f.deletions = [];
  f.local = (name, tip = f.old) => f.g("branch", name, tip);
  f.remoteBranch = (name, tip = f.old) =>
    f.g("push", "origin", `${tip}:refs/heads/${name}`);
  f.newCommit = (message = "unmerged") =>
    f.g(
      "commit-tree",
      f.g("rev-parse", "main^{tree}"),
      "-p",
      f.target,
      "-m",
      message,
    );
  const inventory = (target) => {
    assert.equal(f.g("config", "--local", "remote.origin.url"), f.remote);
    const remoteMain = f
      .g("ls-remote", "--heads", "origin", "refs/heads/main")
      .split(/\s/)[0];

    assert.equal(f.g("rev-parse", "main"), target.revision);
    assert.equal(f.g("symbolic-ref", "--short", "HEAD"), "main");
    assert.equal(f.g("status", "--porcelain=v1", "--untracked-files=all"), "");
    const worktrees = f.g("worktree", "list", "--porcelain");
    const local = f
      .g(
        "for-each-ref",
        "--format=%(refname:strip=2) %(objectname)",
        "refs/heads",
      )
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, tip] = line.split(" ");
        return { name, tip, location: "local" };
      });
    const remote = f
      .g("ls-remote", "--heads", "origin")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [tip, ref] = line.split(/\s+/);
        return {
          tip,
          name: ref.slice("refs/heads/".length),
          location: "remote",
        };
      });
    return {
      repository: target.repository,
      checkout: f.repository,
      branch: target.branch,
      revision: remoteMain,
      policySha256: createHash("sha256")
        .update(readFileSync(f.options.policyPath))
        .digest("hex"),
      complete: true,
      quiescent: !f.cleanupInflight,
      branches: [...local, ...remote].map((b) => {
        const key = `${b.location}:${b.name}`,
          linkage = f.linkages.get(key);
        return {
          ...b,
          protected: f.protected.has(key),
          replayRetained: f.replays.has(key),
          activeWorktree: worktrees
            .split(/\r?\n/)
            .includes(`branch refs/heads/${b.name}`),
          ancestry: f.unknown.has(key)
            ? "unknown"
            : f.run(["merge-base", "--is-ancestor", b.tip, target.revision])
                  .status === 0
              ? "merged"
              : "unmerged",
          conditionalDelete: !f.unsupported.has(key),
          ...(linkage ? { linkage } : {}),
        };
      }),
    };
  };
  f.cleanupRuntime = {
    mode: "controlled",
    bindingSha256: "4".repeat(64),
    async observe(target) {
      await f.beforeCleanupObserve?.(target);
      const o = inventory(target);
      return f.inventoryChange?.(o) ?? o;
    },
    async remove(r) {
      assert.deepEqual(r.controls, branchCleanupControls);
      const planned = f.controller
        .status(f.delivery.id)
        .cleanup.rounds.at(-1)
        .entries.find((e) => e.operationId === r.operationId);
      assert.equal(planned.state, "dispatched");
      assert.equal(planned.decision, "eligible");
      assert.match(planned.evidenceSha256, /^[a-f0-9]{64}$/);
      await f.beforeDelete?.(r);
      const current = inventory(r),
        fact = current.branches.find(
          (b) => b.location === r.location && b.name === r.name,
        );
      if (
        !r.mayDispatch() ||
        current.revision !== r.revision ||
        current.policySha256 !== r.policySha256 ||
        !fact ||
        fact.tip !== r.expectedTip ||
        fact.protected ||
        fact.replayRetained ||
        fact.activeWorktree ||
        !fact.conditionalDelete ||
        r.name === r.branch
      )
        return;
      // Trusted fixture rechecks integration at effect acceptance, independently of
      // controller dispatch. Native GitHub linkage remains a qualification gate.
      const p = fact.linkage;
      if (
        fact.ancestry !== "merged" &&
        !(
          p?.complete &&
          p.merged &&
          p.reachable &&
          p.head === fact.tip &&
          p.repository === r.repository &&
          p.base === r.branch
        )
      )
        return;
      if (r.location === "local")
        f.g("update-ref", "-d", `refs/heads/${r.name}`, r.expectedTip);
      else
        f.g(
          "push",
          `--force-with-lease=refs/heads/${r.name}:${r.expectedTip}`,
          "origin",
          `:refs/heads/${r.name}`,
        );
      f.deletions.push({
        name: r.name,
        location: r.location,
        operationId: r.operationId,
      });
      await f.afterDelete?.(r);
    },
  };
  f.reopenCleanup = () =>
    new DeliveryController(f.state, f.options, {
      mainChecksRuntime: f.mainRuntime,
      mainSyncRuntime: f.syncRuntime,
      branchCleanupRuntime: f.cleanupRuntime,
      clock: () => f.time,
      observationTimeoutMs: 100,
    });
  f.controller = f.reopenCleanup();
  return f;
}
