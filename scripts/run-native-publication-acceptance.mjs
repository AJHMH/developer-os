#!/usr/bin/env node
// Owner-run acceptance of the native publisher (ticket 08, #267) against a
// disposable GitHub repository. It reads that repository's `main`, adds one
// acceptance file, and publishes the result as a delivery would:
//
// 1. the owner's key signs the exact tree through ssh-agent;
// 2. the owner's `gh` login pushes it to a new `aios/feature-acceptance-*`
//    branch, only if that branch is absent;
// 3. GitHub must report the commit Verified, signed and pushed by the owner;
// 4. the Software Factory App, with a token scoped to `pull_requests:write`,
//    opens the PR;
// 5. reconciling each step finds it again without another write, and a
//    repeated push or PR creation returns the same branch and PR.
//
// It writes nothing to `main`, approves nothing and merges nothing. It leaves
// its branch and PR open for the owner to inspect or close. The owner's
// record names only identities and key paths; no secret is copied anywhere.
// Run it through scripts/run-native-acceptance.mjs.
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, platform, release, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { freshBuild } from "./fresh-build.mjs";

const usage =
  "Usage: node scripts/run-native-publication-acceptance.mjs <owner-publication-identity.json> <new-report.json> --approve-native-publication";
export const passingOutcome = "observed-native-publication-acceptance";
export const stageNames = Object.freeze([
  "publication-authority",
  "base-revision",
  "sign",
  "push",
  "pull-request",
  "reconcile",
]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** The owner's publication identity record: identities and key paths. */
export function readIdentity(path) {
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) !== 0)
    throw Error("The owner publication record must be a private file");
  const bytes = readFileSync(path);
  const r = JSON.parse(bytes.toString("utf8"));
  const fields = [
    "repository",
    "login",
    "name",
    "email",
    "signingKey",
    "appId",
    "installationId",
    "botLogin",
    "appKeyPath",
    "approver",
  ];
  if (
    r?.scope !== "aios-publication-identity-v1" ||
    !fields.every((f) => typeof r[f] === "string" && r[f]) ||
    !r.signingKey.endsWith(".pub")
  )
    throw Error("Invalid owner publication record");
  return { ...r, sha256: sha256(bytes) };
}

/** Publishes one acceptance candidate through `adapter` (a native
 * SplitPublicationAdapter) and checks every observation. `github(path)`
 * reads the repository's API as the owner. */
export async function publicationAcceptance(
  { adapter, github, identity, runId = randomUUID() },
  options = {},
) {
  const persist = options.persist ?? (() => {});
  const report = {
    scope: "native-publication-acceptance",
    productionEnabled: false,
    repository: identity.repository,
    runId,
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
  const { publicationTree } = await import("../dist/publication.js");
  const effect = (kind) => ({
    id: randomUUID(),
    runId,
    kind,
    fence: 1,
    state: "dispatched",
    startedAt: new Date().toISOString(),
  });
  try {
    const authority = await stage("publication-authority", async () => {
      const a = await adapter.inspect();
      report.authority = {
        publicationLogin: a.publicationLogin,
        appLogin: a.appLogin,
        appPermissions: a.appPermissions,
        signingAvailable: a.signingAvailable,
        publicationAllowed: a.publicationAllowed,
        signingKeySha256: a.signingKeySha256,
        appKeySha256: a.appKeySha256,
      };
      check(
        a.publicationLogin === identity.login,
        `The gh login is ${a.publicationLogin || "unknown"}, not ${identity.login}`,
      );
      check(
        a.signingAvailable,
        "ssh-agent doesn't hold the signing key: run ssh-add --apple-use-keychain on its private key",
      );
      check(a.publicationAllowed, "The owner can't push to the repository");
      check(
        a.appLogin === identity.botLogin &&
          a.appPermissions.length === 1 &&
          a.appPermissions[0] === "pull_requests:write",
        "The App's PR authority is not exactly pull_requests:write",
      );
      check(
        a.signingKeySha256 !== a.appKeySha256,
        "The signing key is the App key",
      );
      return a;
    });
    const base = await stage("base-revision", async () => {
      const branch = await github(`repos/${identity.repository}/branches/main`);
      const head = branch.body?.commit?.sha;
      check(
        branch.status === 200 && /^[a-f0-9]{40}$/.test(head ?? ""),
        "main is unreadable",
      );
      const tree = await github(
        `repos/${identity.repository}/git/trees/${head}?recursive=1`,
      );
      check(
        tree.status === 200 && tree.body?.truncated === false,
        "main's tree is unreadable",
      );
      const blobs = tree.body.tree.filter((e) => e.type === "blob");
      check(
        blobs.length <= 50 &&
          tree.body.tree.every((e) => e.type === "blob" || e.type === "tree") &&
          blobs.every((e) => e.mode === "100644" || e.mode === "100755"),
        "main is not a small plain-file repository",
      );
      const files = [];
      for (const e of blobs) {
        const blob = await github(
          `repos/${identity.repository}/git/blobs/${e.sha}`,
        );
        check(
          blob.status === 200 && blob.body?.encoding === "base64",
          "A file is unreadable",
        );
        files.push({
          path: e.path,
          bytes: Buffer.from(blob.body.content, "base64"),
          executable: e.mode === "100755",
        });
      }
      check(
        publicationTree(files) === tree.body.sha,
        "main's files don't rebuild its tree",
      );
      files.push({
        path: `acceptance/${runId}.md`,
        bytes: Buffer.from(
          `# Native publication acceptance\n\nRun ${runId}, ${new Date().toISOString()}.\n`,
        ),
        executable: false,
      });
      report.base = head;
      return { head, files };
    });
    const publication = {
      id: randomUUID(),
      mode: "controlled",
      bindingSha256: adapter.bindingSha256,
      repository: identity.repository,
      defaultBranch: "main",
      branch: `aios/feature-acceptance-${runId}`,
      sourceRevision: base.head,
      candidateSha256: sha256(
        JSON.stringify(base.files.map((f) => [f.path, sha256(f.bytes)])),
      ),
      treeSha1: publicationTree(base.files),
      policySha256: identity.sha256,
      validationOperationId: randomUUID(),
      publicationLogin: authority.publicationLogin,
      appLogin: authority.appLogin,
      approver: identity.approver,
      outcome: "pending",
      effects: [],
    };
    report.branch = publication.branch;
    const sign = effect("sign");
    const signed = await stage("sign", async () => {
      const s = await adapter.sign({
        publication,
        effect: sign,
        files: base.files,
        mayDispatch: () => true,
      });
      report.commit = s.commit;
      check(
        s.localVerified && s.signer === identity.login,
        "The commit is not signed by the owner's key",
      );
      check(
        s.tree === publication.treeSha1 && s.parent === base.head,
        "The signed commit is not the admitted tree on main",
      );
      return s;
    });
    const signedPublication = {
      ...publication,
      commit: signed.commit,
      localSignature: signed,
    };
    const push = effect("push");
    const remote = await stage("push", async () => {
      const p = await adapter.push({
        publication: signedPublication,
        effect: push,
        files: base.files,
        mayDispatch: () => true,
      });
      report.remote = {
        commit: p.commit,
        githubVerified: p.githubVerified,
        signer: p.signer,
        publisher: p.publisher,
      };
      check(
        p.commit === signed.commit && p.tree === publication.treeSha1,
        "GitHub's branch head is not the signed commit",
      );
      check(p.githubVerified, "GitHub doesn't report the commit Verified");
      check(
        p.signer === identity.login && p.publisher === identity.login,
        "GitHub doesn't show the owner as signer and pusher",
      );
      return p;
    });
    const publishedPublication = {
      ...signedPublication,
      remoteSignature: remote,
    };
    const pr = effect("pr");
    const opened = await stage("pull-request", async () => {
      const p = await adapter.createPullRequest({
        publication: publishedPublication,
        effect: pr,
        files: base.files,
        mayDispatch: () => true,
      });
      report.pullRequest = {
        number: p.number,
        author: p.author,
        head: p.head,
        base: p.base,
      };
      check(p.author === identity.botLogin, "The PR's author is not the App");
      check(
        p.head === signed.commit &&
          p.base === "main" &&
          p.branch === publication.branch,
        "The PR is not the signed branch onto main",
      );
      return p;
    });
    await stage("reconcile", async () => {
      const found = {
        sign: await adapter.reconcile({
          publication: signedPublication,
          effect: sign,
        }),
        push: await adapter.reconcile({
          publication: publishedPublication,
          effect: push,
        }),
        pr: await adapter.reconcile({
          publication: { ...publishedPublication, pullRequest: opened },
          effect: pr,
        }),
      };
      check(
        found.sign.state === "found" &&
          found.sign.result.commit === signed.commit,
        "Reconciliation didn't find the signed commit",
      );
      check(
        found.push.state === "found" &&
          found.push.result.commit === signed.commit,
        "Reconciliation didn't find the pushed branch",
      );
      check(
        found.pr.state === "found" && found.pr.result.number === opened.number,
        "Reconciliation didn't find the PR",
      );
      // Repeating either write finds the existing branch and PR.
      const again = await adapter.push({
        publication: signedPublication,
        effect: effect("push"),
        files: base.files,
        mayDispatch: () => true,
      });
      const reopened = await adapter.createPullRequest({
        publication: publishedPublication,
        effect: effect("pr"),
        files: base.files,
        mayDispatch: () => true,
      });
      check(
        again.commit === signed.commit && reopened.number === opened.number,
        "A repeated write was not recognized as the same branch and PR",
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
    approval !== "--approve-native-publication" ||
    extra.length
  ) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  const root = fileURLToPath(new URL("..", import.meta.url));
  const build = freshBuild(root);
  const identity = readIdentity(record);
  const { nativeGitPublicationPort, ghApi } = await import(
    "../dist/native-publication.js"
  );
  const { nativeAppPullRequestPort } = await import("../dist/native-app-pr.js");
  const { SplitPublicationAdapter } = await import(
    "../dist/publication-adapter.js"
  );
  // Refuse overwriting retained evidence before any effect.
  closeSync(openSync(reportPath, "wx", 0o600));
  const work = realpathSync(
    mkdtempSync(join(tmpdir(), "aios-publication-acceptance-")),
  );
  const github = ghApi();
  const adapter = new SplitPublicationAdapter(
    identity.sha256,
    nativeGitPublicationPort({
      repository: identity.repository,
      login: identity.login,
      name: identity.name,
      email: identity.email,
      signingKey: identity.signingKey,
      metadata: join(work, "git"),
      github,
    }),
    nativeAppPullRequestPort({
      repository: identity.repository,
      appId: identity.appId,
      installationId: identity.installationId,
      botLogin: identity.botLogin,
      keyPath: identity.appKeyPath,
      approver: identity.approver,
      state: join(work, "app"),
    }),
  );
  const context = {
    host: { platform: platform(), arch: arch(), release: release() },
    ...build,
    identitySha256: identity.sha256,
  };
  const report = await publicationAcceptance(
    { adapter, github, identity },
    {
      persist: (r) =>
        writeFileSync(
          reportPath,
          JSON.stringify({ ...context, ...r }, null, 2),
        ),
    },
  );
  rmSync(work, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      outcome: report.outcome,
      reportPath,
      ...(report.pullRequest ? { pullRequest: report.pullRequest.number } : {}),
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
