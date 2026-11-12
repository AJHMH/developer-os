#!/usr/bin/env node
// Owner-run acceptance of the native review adapter (ticket 10, #269)
// against the disposable repository. Through the native publisher it opens
// two PRs, then reads them through the owner's `gh` login:
//
// 1. a small PR: the change gate must classify it ungated, so it is
//    authorized without any review;
// 2. a PR that also adds a file under `.github/`: it must be gated, with no
//    authorization;
// 3. the owner, in GitHub, comments on a line of that PR, reacts 👍 to the
//    comment, and approves the PR. The comment must read as a straightforward
//    finding, and the approval must not count while it is open;
// 4. the adapter resolves the conversation: the receipt must be the
//    conversation observed resolved, and the owner's approval must then
//    authorize exactly that head.
//
// It writes only to the disposable repository: two signed branches, two App
// PRs and one resolved conversation. It never submits a review. Run it
// through scripts/run-native-acceptance.mjs, with the signing key in
// ssh-agent.
import { createHash, randomUUID } from "node:crypto";
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
  "Usage: node scripts/run-native-review-acceptance.mjs <owner-publication-identity.json> <new-report.json> --approve-native-review";
export const passingOutcome = "observed-native-review-acceptance";
export const gatedFile = ".github/aios-review-acceptance.txt";
export const criteriaSha256 = createHash("sha256")
  .update("aios-native-review-acceptance-v1")
  .digest("hex");
export const stageNames = Object.freeze([
  "publish-ungated",
  "observe-ungated",
  "publish-gated",
  "observe-gated",
  "owner-review",
  "resolve",
  "observe-approved",
]);

/** The owner-run acceptance through `publisher` (the native publication
 * runtime), `review` (the native review adapter) and `github` (the owner's
 * API). `say` tells the owner what to do in GitHub. */
export async function reviewAcceptance(
  { publisher, review, github, identity },
  options = {},
) {
  const { defaultChangeGateContract } = await import("../dist/change-gate.js");
  const { projectReview } = await import("../dist/review.js");
  const persist = options.persist ?? (() => {});
  const say = options.say ?? ((line) => console.error(line));
  const limitMs = options.limitMs ?? 30 * 60000,
    intervalMs = options.intervalMs ?? 15000,
    sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    now = options.now ?? Date.now;
  const report = {
    scope: "native-review-acceptance",
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
      return { number: r.pullRequest.number, head: r.commit };
    });
  /** One observation of `pr` and the controller's reading of it. */
  async function read(pr) {
    const observation = await review.observe({
      repository: identity.repository,
      number: pr.number,
      head: pr.head,
      criteriaSha256,
    });
    check(observation.complete, `PR ${pr.number}'s review is incomplete`);
    check(observation.head === pr.head, `PR ${pr.number} has a new head`);
    const decision = projectReview(
      observation,
      {
        repository: identity.repository,
        pullRequest: { number: pr.number },
        commit: pr.head,
        defaultBranch: "main",
        appLogin: identity.botLogin,
        approver: identity.approver,
      },
      criteriaSha256,
      now(),
      defaultChangeGateContract(),
    );
    return { observation, decision };
  }
  const summary = ({ observation, decision }) => ({
    gated: decision.gate?.gated ?? null,
    reasons: decision.gate
      ? [...decision.gate.destructive, ...decision.gate.wideImpact]
      : [],
    approval: decision.approval ?? null,
    reviews: decision.reviews.map((r) => ({
      id: r.id,
      author: r.author,
      state: r.state,
      head: r.head,
    })),
    threads: decision.threads.map((t) => ({
      id: t.id,
      resolved: t.resolved,
      disposition: t.assessment?.disposition ?? null,
    })),
    lastPusher: observation.lastPusher,
  });
  try {
    const ungated = await stage("publish-ungated", async () => {
      const pr = await publish([]);
      report.ungated = { number: pr.number, head: pr.head };
      return pr;
    });
    await stage("observe-ungated", async () => {
      const r = await read(ungated);
      Object.assign(report.ungated, summary(r));
      check(r.decision.gate && !r.decision.gate.gated, "The small PR is gated");
      check(
        r.decision.approval?.kind === "ungated" &&
          r.decision.approval.head === ungated.head,
        "The small PR isn't authorized as ungated",
      );
    });
    const gated = await stage("publish-gated", async () => {
      const pr = await publish([
        {
          path: gatedFile,
          bytes: Buffer.from(
            "A wide-impact change for the review acceptance.\n",
          ),
          executable: false,
        },
      ]);
      report.gated = { number: pr.number, head: pr.head };
      return pr;
    });
    await stage("observe-gated", async () => {
      const r = await read(gated);
      Object.assign(report.gated, summary(r));
      check(
        r.decision.gate?.gated === true,
        "The workflow-area PR isn't gated",
      );
      check(!r.decision.approval, "The gated PR is authorized without review");
    });
    const finding = await stage("owner-review", async () => {
      const url = `https://github.com/${identity.repository}/pull/${gated.number}/files`;
      say(
        [
          `Now, in GitHub, on ${url}:`,
          `  1. Comment on any line ("Add single comment"), for example: Add a closing line.`,
          `  2. React 👍 to that comment.`,
          `  3. Review changes → Approve → Submit review.`,
          `Waiting up to ${Math.round(limitMs / 60000)} minutes; checking every ${Math.round(intervalMs / 1000)} seconds.`,
        ].join("\n"),
      );
      const start = now();
      for (;;) {
        const r = await read(gated);
        const thread = r.decision.threads.find(
          (t) => !t.resolved && t.assessment?.disposition === "straightforward",
        );
        const approved = r.decision.reviews.some(
          (x) =>
            x.author === identity.approver &&
            x.state === "APPROVED" &&
            x.head === gated.head,
        );
        if (thread && approved) {
          report.gated.beforeResolve = summary(r);
          check(
            !r.decision.approval,
            "The approval counted while a conversation was open",
          );
          return thread;
        }
        if (now() - start > limitMs)
          throw Error(
            "No straightforward comment and approval from the owner in time",
          );
        await sleep(intervalMs);
      }
    });
    const operationId = randomUUID();
    await stage("resolve", async () => {
      const r = await review.resolve({
        repository: identity.repository,
        number: gated.number,
        head: gated.head,
        operationId,
        threadId: finding.id,
        digest: finding.digest,
        state: "dispatched",
        mayDispatch: () => true,
      });
      report.resolve = {
        operationId,
        threadId: finding.id,
        finding: finding.assessment.finding,
        accepted: r.accepted,
      };
      check(r.accepted, "GitHub didn't resolve the conversation");
    });
    await stage("observe-approved", async () => {
      const r = await read(gated);
      report.gated.after = summary(r);
      report.resolve.receipt =
        r.observation.resolutions.find((x) => x.operationId === operationId) ??
        null;
      check(
        report.resolve.receipt?.state === "accepted",
        "The resolution has no receipt",
      );
      check(
        r.decision.threads.find((t) => t.id === finding.id)?.resolved === true,
        "The conversation isn't resolved",
      );
      check(
        r.decision.approval?.kind !== "ungated" &&
          r.decision.approval?.owner === identity.approver &&
          r.decision.approval.head === gated.head,
        "The owner's approval doesn't authorize the gated head",
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
    approval !== "--approve-native-review" ||
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
  const { nativeReviewRuntime } = await import("../dist/native-review.js");
  closeSync(openSync(reportPath, "wx", 0o600));
  const work = realpathSync(
    mkdtempSync(join(tmpdir(), "aios-review-acceptance-")),
  );
  const github = ghApi();
  const report = await reviewAcceptance(
    {
      publisher: nativePublicationRuntime(record, work),
      review: nativeReviewRuntime({
        repository: identity.repository,
        state: join(work, "review"),
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
      ...(report.ungated ? { ungated: report.ungated.number } : {}),
      ...(report.gated ? { gated: report.gated.number } : {}),
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
