import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DeliveryController } from "../../dist/controller.js";
import { mainSyncControls } from "../../dist/main-sync.js";
import { mergeFixture } from "./merge-fixture.mjs";

export async function syncFixture(t) {
  const f = await mergeFixture(t);
  await f.controller.mergeFeature(f.delivery.id);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.toUpperCase().startsWith("GIT_"),
    ),
  );
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ATTR_NOSYSTEM: "1",
  });
  f.run = (args, cwd = f.repository, input) => {
    const started = performance.now();
    const result = spawnSync(
      "git",
      [
        "-c",
        "core.hooksPath=/nonexistent",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.attributesFile=/nonexistent",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-C",
        cwd,
        ...args,
      ],
      { env, encoding: "utf8", timeout: 5000, input },
    );
    if (args[0] === "push" || result.status !== 0) {
      const operation = [
        "push",
        "init",
        "rev-parse",
        "remote",
        "hash-object",
        "mktree",
        "commit-tree",
        "switch",
        "config",
        "add",
      ].includes(args[0])
        ? args[0]
        : "other";
      const errorCode = result.error?.code;
      console.error(
        "[main-sync-git] " +
          JSON.stringify({
            operation,
            elapsedMs: Math.round(performance.now() - started),
            timeoutMs: 5000,
            status: result.status,
            signal: result.signal,
            errorCode:
              errorCode === undefined
                ? null
                : [
                      "ETIMEDOUT",
                      "ENOENT",
                      "EACCES",
                      "EPERM",
                      "EAGAIN",
                      "ENOMEM",
                      "ENOBUFS",
                      "UNKNOWN",
                    ].includes(errorCode)
                  ? errorCode
                  : "unclassified",
            stderrBytes: Buffer.byteLength(result.stderr ?? ""),
          }),
      );
    }
    return result;
  };
  f.g = (...args) => {
    const r = f.run(args);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  f.old = f.g("rev-parse", "main");
  f.remote = join(f.root, "remote.git");
  mkdirSync(f.remote);
  assert.equal(f.run(["init", "--bare"], f.remote).status, 0);
  f.g("remote", "add", "origin", f.remote);
  f.g("push", "origin", "main");
  const blob = f.run(
    ["hash-object", "-w", "--stdin"],
    f.repository,
    "<h1>Verified main</h1>\n",
  );
  assert.equal(blob.status, 0, blob.stderr);
  const targetTree = f.run(
    ["mktree"],
    f.repository,
    `100644 blob ${blob.stdout.trim()}\tindex.html\n`,
  );
  assert.equal(targetTree.status, 0, targetTree.stderr);
  const tree = targetTree.stdout.trim();
  f.target = f.g("commit-tree", tree, "-p", f.old, "-m", "merged target");
  f.g("push", "origin", `${f.target}:refs/heads/main`);
  f.mainSnapshot = () => {
    const a = f.controller.status(f.delivery.id).merge.attempts.at(-1);
    return {
      repository: a.repository,
      number: a.number,
      head: a.head,
      base: a.base,
      mergeCommit: a.mergeCommit,
      mainRevision: f.target,
      reachable: true,
      complete: true,
      checks: [
        {
          checkId: "main-e2e",
          publisher: "trusted-ci",
          workflow: ".github/workflows/ci.yml@trusted",
          head: f.target,
          runId: 2,
          attempt: 1,
          status: "success",
          startedAt: f.time,
          completedAt: f.time,
        },
      ],
    };
  };
  f.mainRuntime = {
    mode: "controlled",
    bindingSha256: "6".repeat(64),
    async observe() {
      return f.mainSnapshot();
    },
  };
  f.writes = [];
  const observe = () => {
    for (const scope of ["--local", "--worktree"]) {
      const config = f.g("config", scope, "--no-includes", "--null", "--list");
      if (
        /(?:^|\0)(?:filter\..+\.(?:clean|smudge|process)|include(?:if\..+)?\.path)\n/i.test(
          config,
        )
      )
        throw Error("Unreviewed helpers");
    }
    assert.equal(f.g("config", "--local", "remote.origin.url"), f.remote);
    f.g(
      "fetch",
      "--no-tags",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    );
    const local = f.g("rev-parse", "refs/heads/main"),
      remote = f.g("rev-parse", "refs/remotes/origin/main");
    return {
      repository: "AJHMH/profile-page",
      checkout: f.repository,
      branch: "main",
      remoteMain: remote,
      localMain: local,
      currentBranch: f.g("symbolic-ref", "--short", "HEAD"),
      head: f.g("rev-parse", "HEAD"),
      clean: !f.g(
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignored=matching",
      ),
      fastForward:
        f.run(["merge-base", "--is-ancestor", local, remote]).status === 0,
      mainCheckedOutElsewhere: false,
      complete: true,
      quiescent: !f.inflight,
    };
  };
  f.syncRuntime = {
    mode: "controlled",
    bindingSha256: "5".repeat(64),
    async observe(request) {
      await f.beforeObserve?.(request);
      return f.observation?.(observe()) ?? observe();
    },
    async synchronize(r) {
      assert.deepEqual(r.controls, mainSyncControls);
      const intent = f.controller
        .status(f.delivery.id)
        .mainSync.attempts.at(-1);
      assert.equal(intent.operationId, r.operationId);
      assert.equal(intent.state, "dispatched");
      await f.beforeWrite?.(r);
      const current = observe();
      if (
        !r.mayDispatch() ||
        JSON.stringify(current) !== JSON.stringify(r.expected)
      )
        return;
      f.writes.push(r.operationId);
      f.g("switch", r.branch);
      f.g("merge", "--ff-only", r.revision);
      await f.afterWrite?.(r);
    },
  };
  f.reopen = () =>
    new DeliveryController(f.state, f.options, {
      mainChecksRuntime: f.mainRuntime,
      mainSyncRuntime: f.syncRuntime,
      clock: () => f.time,
      observationTimeoutMs: 100,
    });
  f.controller = f.reopen();
  return f;
}
