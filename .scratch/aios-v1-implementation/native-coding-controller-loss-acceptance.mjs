// Explicit offline native acceptance. Never invoked by CI or production admission.
// node <script> <machine> <new-report.json> <lease|deadline> --approve-offline-native-run
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fork, spawnSync } from "node:child_process";
import {
  openSync,
  closeSync,
  writeSync,
  ftruncateSync,
  fsyncSync,
  readFileSync,
} from "node:fs";
import { platform, arch, release } from "node:os";
import { fileURLToPath } from "node:url";
import { NativePodmanCodingTransport } from "../../dist/podman-coding.js";
import { observeNativeControllerLoss } from "../../dist/native-coding-qualification.js";
import { podmanPlatform } from "../../dist/podman-platform.js";

const [machine, reportPath, timer, approval, childId, ...extra] =
  process.argv.slice(2);
assert.match(machine ?? "", /^aios-[a-z0-9-]+$/);
assert.ok(reportPath);
assert.ok(["lease", "deadline"].includes(timer));
assert.equal(approval, "--approve-offline-native-run");
assert.equal(extra.length, 0);
assert.ok(["darwin", "win32"].includes(platform()));
assert.match(process.version, /^v24\./);
const childMode = reportPath === "--controller-child";
if (childMode) {
  assert.equal(typeof process.send, "function");
  assert.equal(process.connected, true);
  assert.match(childId ?? "", /^[a-f0-9-]{36}$/);
} else assert.equal(childId, undefined);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const root = fileURLToPath(new URL("../../", import.meta.url));
const childEnv = podmanPlatform().env;
const git = (...argv) => {
  const result = spawnSync(
    "git",
    ["-c", "core.fsmonitor=false", "-C", root, ...argv],
    {
      encoding: "utf8",
      timeout: 5000,
      env: childEnv,
    },
  );
  assert.equal(
    result.status,
    0,
    "Require a clean, revision-bound runtime source",
  );
  return result.stdout.trim();
};
const revision = git("rev-parse", "HEAD");
assert.match(revision, /^[a-f0-9]{40}$/);
git("diff", "--quiet", "--no-ext-diff", "--no-textconv", "HEAD", "--", "src");
const runner =
  ".scratch/aios-v1-implementation/native-coding-controller-loss-acceptance.mjs";
git(
  "ls-files",
  "--error-unmatch",
  "src/native-coding-qualification.ts",
  runner,
);
git("diff", "--quiet", "--no-ext-diff", "--no-textconv", "HEAD", "--", runner);
assert.equal(
  git("ls-files", "--others", "--exclude-standard", "--", "src"),
  "",
  "Untracked runtime source cannot qualify",
);
const authority = hash("issue04-native-offline-lifecycle-v1:" + machine);
const transport = new NativePodmanCodingTransport(machine, authority);
assert.equal(transport.productionEnabled, false);
const session = {
  operationId: childId ?? randomUUID(),
  fence: 1,
  state: "running",
  intent: "start",
};
const bytes = Buffer.from("AIOS native controller-loss offline input\n");

if (childMode) {
  const pins = await transport.inspect(session);
  let announced = false;
  let childInterrupted = false;
  const childInterrupt = () => {
    childInterrupted = true;
  };
  process.on("SIGINT", childInterrupt);
  process.on("SIGTERM", childInterrupt);
  try {
    await transport.run(
      {
        ...session,
        pins,
        sourceRevision: revision,
        branch: "codex/issue04-native-lifecycle-qualification",
        inputSha256: hash(
          JSON.stringify([
            { path: "canary.txt", sha256: hash(bytes), executable: false },
          ]),
        ),
        files: [{ path: "canary.txt", bytes, executable: false }],
        argv: [
          "exec",
          "--json",
          "--skip-git-repo-check",
          "--sandbox",
          "workspace-write",
          "Offline acceptance only. Do not call tools or change any file.",
        ],
        allowanceMs: 90000,
        mayDispatch: () => !childInterrupted,
        checkpoint: () => {
          if (childInterrupted) return false;
          if (!announced) {
            announced = true;
            process.send({ kind: "running" });
          }
          return true;
        },
        onEvent: () => !childInterrupted,
      },
      () => {},
    );
  } finally {
    process.off("SIGINT", childInterrupt);
    process.off("SIGTERM", childInterrupt);
    process.disconnect();
  }
} else {
  const fd = openSync(reportPath, "wx", 0o600);
  const report = {
    scope: "native-coding-offline-controller-loss",
    qualified: false,
    productionEnabled: false,
    inferenceAuthorized: false,
    outcome: "not-run",
    sourceRevision: revision,
    timer,
    authority,
    session,
    host: { platform: platform(), arch: arch(), release: release(), machine },
    runnerSha256: hash(readFileSync(new URL(import.meta.url))),
    transportSourceSha256: hash(
      readFileSync(new URL("../../src/podman-coding.ts", import.meta.url)),
    ),
    transportModuleSha256: hash(
      readFileSync(new URL("../../dist/podman-coding.js", import.meta.url)),
    ),
    procedureModuleSha256: hash(
      readFileSync(
        new URL("../../dist/native-coding-qualification.js", import.meta.url),
      ),
    ),
    evidence: [],
  };
  const persist = () => {
    const text = JSON.stringify(report, null, 2);
    ftruncateSync(fd, 0);
    assert.equal(
      writeSync(fd, text, 0, "utf8"),
      Buffer.byteLength(text),
      "Report write incomplete",
    );
    fsyncSync(fd);
  };
  let controllerError = false;
  let child,
    closed,
    terminated = false,
    closedResult;
  const controller = {
    async start() {
      child = fork(
        fileURLToPath(import.meta.url),
        [machine, "--controller-child", timer, approval, session.operationId],
        {
          detached: platform() !== "win32",
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          env: childEnv,
          execArgv: [],
        },
      );
      child.on("error", () => {
        controllerError = true;
      });
      closed = new Promise((resolve) =>
        child.once("close", (code, signal) => {
          closedResult = { code, signal };
          resolve(closedResult);
        }),
      );
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(Error("Controller startup observation timed out")),
          60000,
        );
        const finish = (error) => {
          clearTimeout(timeout);
          child.off("message", message);
          child.off("error", failed);
          error ? reject(error) : resolve();
        };
        const failed = () => finish(Error("Controller start unavailable"));
        const message = (value) => {
          if (value?.kind === "running") finish();
        };
        child.on("message", message);
        child.once("error", failed);
        closed.then(() =>
          finish(Error("Controller returned before positive running control")),
        );
      });
    },
    async terminate() {
      if (!child || terminated) return;
      if (closedResult)
        throw Error("Controller exited before intentional loss");
      assert.ok(
        Number.isSafeInteger(child.pid) && child.pid > 0,
        "Owned controller PID unavailable",
      );
      if (platform() === "win32") {
        const result = spawnSync(
          "taskkill.exe",
          ["/pid", String(child.pid), "/t", "/f"],
          { timeout: 5000, windowsHide: true, stdio: "ignore" },
        );
        assert.equal(
          result.status,
          0,
          "Controller tree termination unavailable",
        );
      } else process.kill(-child.pid, "SIGKILL");
      let timeout;
      try {
        const result = await Promise.race([
          closed,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(Error("Controller termination uncertain")),
              5000,
            );
          }),
        ]);
        if (platform() !== "win32") assert.equal(result.signal, "SIGKILL");
        terminated = true;
        assert.equal(
          controllerError,
          false,
          "Controller process error observed",
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    if (child && !closedResult && !terminated) child.kill("SIGTERM");
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    persist();
    const pins = await transport.inspect(session);
    report.pins = pins;
    report.outcome = "running";
    persist();
    const result = await observeNativeControllerLoss({
      transport,
      controller,
      session,
      pins,
      timer,
      clock: {
        now: () => {
          assert.equal(interrupted, false, "Acceptance interrupted");
          return performance.now();
        },
        async wait(ms) {
          const until = performance.now() + ms;
          while (performance.now() < until) {
            assert.equal(interrupted, false, "Acceptance interrupted");
            await new Promise((resolve) =>
              setTimeout(resolve, Math.min(1000, until - performance.now())),
            );
          }
        },
      },
      onEvidence(stage, value) {
        assert.ok(report.evidence.length < 200);
        report.evidence.push({ stage, value });
        persist();
      },
    });
    assert.equal(result.collection.files.length, 1);
    assert.equal(result.collection.files[0].path, "canary.txt");
    assert.deepEqual(result.collection.files[0].bytes, bytes);
    report.outcome = "observed-independent-controller-loss-stop";
    report.collection = { inputPreserved: true, files: 1 };
  } catch (error) {
    const recovered = report.evidence.some(
      (entry) => entry.stage === "explicit-recovery",
    );
    report.outcome =
      child && (!(terminated || closedResult) || !recovered)
        ? "uncertain"
        : "blocked";
    report.error = String(error.message).slice(0, 300);
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    try {
      persist();
    } finally {
      closeSync(fd);
    }
    console.log(
      JSON.stringify({
        outcome: report.outcome,
        reportPath,
        qualified: false,
        productionEnabled: false,
      }),
    );
  }
}
