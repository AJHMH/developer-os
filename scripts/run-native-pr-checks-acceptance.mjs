#!/usr/bin/env node
// Owner-run acceptance of the native PR check monitor (ticket 09, #268)
// against the disposable repository, whose `main` carries the acceptance CI
// workflow: one job, `pr-ci`, that passes unless the PR adds
// `acceptance/fail`. Through the native publisher it opens two PRs, then
// observes them through the owner's `gh` login:
//
// 1. a PR without the switch: `pr-ci` must pass, by the controller's rules;
// 2. a PR with it: `pr-ci` must fail;
// 3. one rerun of the failed run: the new attempt must be recorded as the
//    rerun's receipt, with the first failure still in the history.
//
// It writes only to the disposable repository: two signed branches, two App
// PRs and one rerun. It leaves them open. Run it through
// scripts/run-native-acceptance.mjs, with the signing key in ssh-agent.
import { randomUUID } from "node:crypto";
import {
  closeSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, platform, release, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { freshBuild } from "./fresh-build.mjs";
import {
  passingOutcome as publishedOutcome,
  publicationAcceptance,
  readIdentity,
} from "./run-native-publication-acceptance.mjs";

const usage =
  "Usage: node scripts/run-native-pr-checks-acceptance.mjs <owner-publication-identity.json> <new-report.json> --approve-native-pr-checks";
export const passingOutcome = "observed-native-pr-checks-acceptance";
export const workflow = ".github/workflows/ci.yml";
export const checkId = "pr-ci";
export const stageNames = Object.freeze([
  "publish-passing",
  "observe-pass",
  "publish-failing",
  "observe-failure",
  "rerun",
  "observe-rerun",
]);

/** Observes `pr` with `runtime` until `done(observation, verdict)` holds or
 * `limitMs` passes; returns the last observation and the controller's
 * verdict for the `pr-ci` check. */
async function until(runtime, pr, done, { limitMs, intervalMs, sleep, now }) {
  const { hostedCheckOutcome, recordCheckAttempts } = await import(
    "../dist/pr-checks.js"
  );
  const { actionsPublisher, workflowIdentity } = await import(
    "../dist/native-pr-checks.js"
  );
  const start = now();
  for (;;) {
    const observation = await runtime.observe(pr);
    const at = now();
    const run = {
      checks: [
        {
          id: checkId,
          kind: "build",
          scope: "pr",
          stages: ["candidate"],
          command: ["workflow", "ci"],
          publisher: actionsPublisher,
          workflow: workflowIdentity(workflow, "main"),
          timeoutMs: limitMs,
        },
      ],
      attempts: [],
      head: pr.head,
      rejected: 0,
      startedAt: start,
      findings: [],
      canRepair: false,
    };
    recordCheckAttempts(
      run,
      observation.complete ? observation.checks : [],
      at,
    );
    const verdict = observation.complete
      ? hostedCheckOutcome(run, at)
      : "unavailable";
    if (done(observation, verdict)) return { observation, verdict, run };
    if (at - start > limitMs)
      return { observation, verdict, run, timedOut: true };
    await sleep(intervalMs);
  }
}

/** The acceptance through `publisher` (the native publication runtime),
 * `monitor` (the native PR check monitor) and `github` (the owner's API). */
export async function prChecksAcceptance(
  { publisher, monitor, github, identity },
  options = {},
) {
  const persist = options.persist ?? (() => {});
  const wait = {
    limitMs: options.limitMs ?? 15 * 60000,
    intervalMs: options.intervalMs ?? 15000,
    sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    now: options.now ?? Date.now,
  };
  const report = {
    scope: "native-pr-checks-acceptance",
    productionEnabled: false,
    repository: identity.repository,
    outcome: "running",
    stages: [],
  };
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  async function stage(name, action) {
    const entry = {
      name,
      outcome: "running",
      startedAt: new Date().toISOString(),
    };
    report.stages.push(entry);
    persist(report);
    try {
      const result = await action();
      entry.outcome = "passed";
      return result;
    } catch (error) {
      entry.outcome = "blocked";
      entry.error = String(error?.message).slice(0, 300);
      throw error;
    } finally {
      entry.finishedAt = new Date().toISOString();
      persist(report);
    }
  }
  const summary = (o) =>
    o.checks.map((c) => ({
      runId: c.runId,
      attempt: c.attempt,
      checkId: c.checkId,
      status: c.status,
      publisher: c.publisher,
      workflow: c.workflow,
    }));
  // Tests may stand in for the native publication.
  const publish =
    options.publish ??
    (async (extraFiles) => {
      const r = await publicationAcceptance({
        adapter: publisher,
        github,
        identity,
        extraFiles,
      });
      check(
        r.outcome === publishedOutcome,
        "Publication failed: " + (r.error ?? r.outcome),
      );
      return {
        repository: identity.repository,
        number: r.pullRequest.number,
        head: r.commit,
      };
    });
  const finished = (o) =>
    o.complete &&
    o.checks.some((c) => c.checkId === checkId && c.status !== "pending");
  try {
    const passing = await stage("publish-passing", async () => {
      const pr = await publish([]);
      report.passing = { number: pr.number, head: pr.head };
      return pr;
    });
    await stage("observe-pass", async () => {
      const r = await until(monitor, passing, finished, wait);
      report.passing.checks = summary(r.observation);
      report.passing.verdict = r.verdict;
      check(!r.timedOut, "pr-ci didn't finish on the passing PR");
      check(r.verdict === "passed", `The passing PR's verdict is ${r.verdict}`);
      check(
        r.observation.checks.every(
          (c) =>
            c.publisher === "github-actions" &&
            c.workflow === `${workflow}@main`,
        ),
        "A check isn't the trusted workflow's",
      );
    });
    const failing = await stage("publish-failing", async () => {
      const pr = await publish([
        {
          path: "acceptance/fail",
          bytes: Buffer.from("This PR's pr-ci check fails.\n"),
          executable: false,
        },
      ]);
      report.failing = { number: pr.number, head: pr.head };
      return pr;
    });
    const failed = await stage("observe-failure", async () => {
      const r = await until(monitor, failing, finished, wait);
      report.failing.checks = summary(r.observation);
      report.failing.verdict = r.verdict;
      check(!r.timedOut, "pr-ci didn't finish on the failing PR");
      check(r.verdict === "failed", `The failing PR's verdict is ${r.verdict}`);
      return r.observation.checks.find(
        (c) => c.checkId === checkId && c.status === "failure",
      );
    });
    const operationId = randomUUID();
    await stage("rerun", async () => {
      const r = await monitor.rerun({
        ...failing,
        operationId,
        checkId,
        runId: failed.runId,
        attempt: failed.attempt,
        state: "dispatched",
        mayDispatch: () => true,
      });
      report.rerun = {
        operationId,
        runId: failed.runId,
        attempt: failed.attempt,
        accepted: r.accepted,
      };
      check(r.accepted, "GitHub didn't accept the rerun");
    });
    await stage("observe-rerun", async () => {
      const r = await until(
        monitor,
        failing,
        (o) =>
          o.reruns.some(
            (x) => x.operationId === operationId && x.state === "accepted",
          ) &&
          o.checks.some(
            (c) =>
              c.runId === failed.runId &&
              c.attempt > failed.attempt &&
              c.status !== "pending",
          ),
        wait,
      );
      report.rerun.checks = summary(r.observation);
      report.rerun.receipt =
        r.observation.reruns.find((x) => x.operationId === operationId) ?? null;
      report.rerun.verdict = r.verdict;
      check(!r.timedOut, "The rerun's new attempt didn't finish");
      check(
        report.rerun.receipt?.state === "accepted",
        "The rerun has no receipt",
      );
      check(
        r.observation.checks.some(
          (c) =>
            c.runId === failed.runId &&
            c.attempt === failed.attempt &&
            c.status === "failure",
        ),
        "The first failure left the history",
      );
      check(
        r.verdict === "failed",
        `After the rerun the verdict is ${r.verdict}`,
      );
    });
    report.outcome = passingOutcome;
  } catch (error) {
    report.error = String(error?.message).slice(0, 300);
    report.outcome = "blocked";
  }
  persist(report);
  return report;
}

async function main() {
  const [record, reportPath, approval, ...extra] = process.argv.slice(2);
  if (
    !record ||
    !reportPath ||
    approval !== "--approve-native-pr-checks" ||
    extra.length
  ) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  const build = freshBuild(fileURLToPath(new URL("..", import.meta.url)));
  const identity = await readIdentity(record);
  const { ghApi } = await import("../dist/native-publication.js");
  const { nativePublicationRuntime } = await import(
    "../dist/publication-identity.js"
  );
  const { nativePRChecksRuntime } = await import("../dist/native-pr-checks.js");
  closeSync(openSync(reportPath, "wx", 0o600));
  const work = realpathSync(
    mkdtempSync(join(tmpdir(), "aios-pr-checks-acceptance-")),
  );
  const github = ghApi();
  const report = await prChecksAcceptance(
    {
      publisher: nativePublicationRuntime(record, work),
      monitor: nativePRChecksRuntime({
        repository: identity.repository,
        workflows: [workflow],
        state: join(work, "pr-checks"),
        github,
      }),
      github,
      identity,
    },
    {
      persist: (r) =>
        writeFileSync(
          reportPath,
          JSON.stringify(
            {
              host: { platform: platform(), arch: arch(), release: release() },
              ...build,
              identitySha256: identity.sha256,
              ...r,
            },
            null,
            2,
          ),
        ),
    },
  );
  rmSync(work, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      outcome: report.outcome,
      reportPath,
      ...(report.passing ? { passing: report.passing.number } : {}),
      ...(report.failing ? { failing: report.failing.number } : {}),
      ...(report.error ? { error: report.error } : {}),
    }),
  );
  if (report.outcome !== passingOutcome) process.exitCode = 1;
}

const invoked = process.argv[1] && realpathSync(process.argv[1]);
if (invoked && import.meta.url === pathToFileURL(invoked).href)
  main().catch((error) => {
    console.error(String(error?.message).slice(0, 300));
    process.exitCode = 1;
  });
