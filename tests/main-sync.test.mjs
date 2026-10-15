import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { syncFixture } from "./helpers/main-sync-fixture.mjs";

test("verified main synchronizes a clean feature checkout and retains evidence across restart without completing delivery", async (t) => {
  const f = await syncFixture(t);
  f.g("switch", "-c", "feature-view");
  const d = await f.controller.syncMain(f.delivery.id);
  assert.equal(d.phase, "main-synchronized");
  assert.equal(
    readFileSync(join(f.repository, "index.html"), "utf8"),
    "<h1>Verified main</h1>\n",
  );
  assert.equal(f.g("rev-parse", "main"), f.target);
  assert.equal(f.g("symbolic-ref", "--short", "HEAD"), "main");
  assert.equal(d.mainSync.attempts[0].from, f.old);
  f.controller = f.reopen();
  const recovered = await f.controller.recover(f.delivery.id);
  assert.equal(recovered.phase, "main-synchronized");
  assert.equal(f.writes.length, 1);
  assert.match(recovered.blocker.nextAction, /ticket 14/);
});

test("dirty tracked, untracked, ignored and staged work prevents synchronization without changing bytes", async (t) => {
  const f = await syncFixture(t),
    path = join(f.repository, "index.html"),
    original = readFileSync(path);
  for (const kind of ["tracked", "staged", "untracked", "ignored"]) {
    const extra = join(f.repository, "keep.txt");
    if (kind === "tracked" || kind === "staged") {
      writeFileSync(path, "owner work\n");
      if (kind === "staged") f.g("add", "index.html");
    } else {
      writeFileSync(extra, "owner work\n");
      if (kind === "ignored")
        (f.g("config", "core.excludesFile", join(f.root, "ignore")),
          writeFileSync(join(f.root, "ignore"), "keep.txt\n"));
    }
    const d = await f.controller.syncMain(f.delivery.id);
    assert.equal(d.phase, "blocked");
    assert.equal(f.g("rev-parse", "main"), f.old);
    assert.equal(f.writes.length, 0);
    if (kind === "tracked" || kind === "staged") {
      assert.equal(readFileSync(path, "utf8"), "owner work\n");
      writeFileSync(path, original);
      f.g("add", "index.html");
    } else {
      assert.equal(readFileSync(extra, "utf8"), "owner work\n");
      const { unlinkSync } = await import("node:fs");
      unlinkSync(extra);
    }
  }
});

test("ahead and divergent local history is preserved rather than rewritten", async (t) => {
  const f = await syncFixture(t),
    tree = f.g("rev-parse", "main^{tree}");
  const local = f.g("commit-tree", tree, "-p", f.target, "-m", "local only");
  f.g("update-ref", "refs/heads/main", local, f.old);
  let d = await f.controller.syncMain(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.equal(f.g("rev-parse", "main"), local);
  const divergent = f.g(
    "commit-tree",
    tree,
    "-p",
    f.old,
    "-m",
    "divergent work",
  );
  f.g("update-ref", "refs/heads/main", divergent, local);
  d = await f.controller.syncMain(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.equal(f.g("rev-parse", "main"), divergent);
  assert.equal(f.writes.length, 0);
});

test("unsafe identity, checkout, incomplete observations and active other worktrees refuse effects", async (t) => {
  const f = await syncFixture(t);
  for (const mutate of [
    (o) => ({ ...o, repository: "other/repo" }),
    (o) => ({ ...o, checkout: f.root }),
    (o) => ({ ...o, branch: "other" }),
    (o) => ({ ...o, complete: false }),
    (o) => ({ ...o, mainCheckedOutElsewhere: true }),
    (o) => ({ ...o, quiescent: false }),
    (o) => ({ ...o, remoteMain: "invalid" }),
  ]) {
    f.observation = mutate;
    const d = await f.controller.syncMain(f.delivery.id);
    assert.equal(d.phase, "blocked");
    assert.equal(f.writes.length, 0);
  }
});

test("remote advancement invalidates green checks and requires newly verified main", async (t) => {
  const f = await syncFixture(t),
    tree = f.g("rev-parse", "main^{tree}");
  const next = f.g(
    "commit-tree",
    tree,
    "-p",
    f.target,
    "-m",
    "advanced remote",
  );
  f.g("push", "origin", `${next}:refs/heads/main`);
  let d = await f.controller.syncMain(f.delivery.id);
  assert.equal(d.mainChecks.outcome, "unavailable");
  assert.equal(f.writes.length, 0);
  f.time += 5000;
  f.target = next;
  d = await f.controller.syncMain(f.delivery.id);
  assert.equal(d.phase, "main-synchronized");
  assert.equal(f.g("rev-parse", "main"), next);
});

test("CLI synchronization refuses without native adapters", async (t) => {
  const f = await syncFixture(t);
  const r = spawnSync(
    process.execPath,
    ["dist/cli.js", "sync-main", "--id", f.delivery.id, "--state-dir", f.state],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /native synchronization remains disabled/);
  assert.equal(f.writes.length, 0);
});
