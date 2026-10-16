import assert from "node:assert/strict";
import { test } from "node:test";
import { SplitPublicationAdapter } from "../dist/publication-adapter.js";

function fixture() {
  const publication = {
    repository: "AJHMH/profile-page",
    branch: "feature",
    defaultBranch: "main",
    commit: "a".repeat(40),
    treeSha1: "b".repeat(40),
    sourceRevision: "c".repeat(40),
    publicationLogin: "publisher",
    approver: "reviewer",
    localSignature: { localVerified: true },
    remoteSignature: { githubVerified: true },
  };
  const signed = {
    commit: publication.commit,
    tree: publication.treeSha1,
    parent: publication.sourceRevision,
    signer: "publisher",
    localVerified: true,
  };
  const remote = {
    ...signed,
    repository: publication.repository,
    branch: publication.branch,
    githubVerified: true,
    publisher: "publisher",
  };
  const calls = [];
  const git = {
    inspect: async () => ({ repository: publication.repository }),
    sign: async () => {
      calls.push("sign");
      return { commit: publication.commit };
    },
    verifyLocal: async () => signed,
    observeRemote: async () => ({ state: "found", result: remote }),
    push: async () => {
      calls.push("push");
    },
  };
  const app = {
    inspect: async () => ({ repository: "other/repository" }),
    observe: async () => ({ state: "absent", quiescent: true }),
    create: async () => {
      calls.push("pr");
    },
  };
  return {
    publication,
    signed,
    remote,
    calls,
    git,
    app,
    adapter: new SplitPublicationAdapter("f".repeat(64), git, app),
    request: {
      publication,
      effect: { id: "operation" },
      mayDispatch: () => true,
    },
  };
}

test("split identity ports refuse mismatched repositories and revoked dispatch before writes", async () => {
  const f = fixture();
  await assert.rejects(f.adapter.inspect(), /repository mismatch/);
  const fenced = { ...f.request, mayDispatch: () => false };
  await assert.rejects(f.adapter.sign(fenced), /Fenced signing/);
  await assert.rejects(f.adapter.push(fenced), /Fenced or unsigned/);
  await assert.rejects(
    f.adapter.createPullRequest(fenced),
    /Unverified PR source/,
  );
  f.publication.localSignature.localVerified = false;
  await assert.rejects(f.adapter.push(f.request), /Fenced or unsigned/);
  f.publication.remoteSignature.githubVerified = false;
  await assert.rejects(
    f.adapter.createPullRequest(f.request),
    /Unverified PR source/,
  );
  assert.deepEqual(f.calls, []);
});

test("split Git port rechecks signing and reuses an already accepted exact remote commit", async () => {
  const f = fixture();
  f.signed.tree = "d".repeat(40);
  await assert.rejects(
    f.adapter.push(f.request),
    /Local signing evidence changed/,
  );
  assert.deepEqual(f.calls, []);
  f.signed.tree = f.publication.treeSha1;
  assert.deepEqual(await f.adapter.push(f.request), f.remote);
  assert.deepEqual(f.calls, []);
  let observations = 0;
  f.git.observeRemote = async () =>
    ++observations === 1
      ? { state: "absent", quiescent: true }
      : { state: "unknown" };
  await assert.rejects(
    f.adapter.push(f.request),
    /Published commit is unobserved/,
  );
  assert.deepEqual(f.calls, ["push"]);
});

test("split PR port refuses changed remote evidence and unproven absence without creation", async () => {
  const f = fixture();
  f.remote.tree = "d".repeat(40);
  await assert.rejects(
    f.adapter.createPullRequest(f.request),
    /Published branch changed/,
  );
  f.remote.tree = f.publication.treeSha1;
  f.publication.previous = { commit: "e".repeat(40) };
  await assert.rejects(
    f.adapter.createPullRequest(f.request),
    /Existing PR is unobserved/,
  );
  delete f.publication.previous;
  for (const observation of [
    { state: "unknown" },
    { state: "absent", quiescent: false },
  ]) {
    f.app.observe = async () => observation;
    await assert.rejects(
      f.adapter.createPullRequest(f.request),
      /PR absence is unverified/,
    );
  }
  assert.deepEqual(f.calls, []);
});

test("split PR port preserves uncertainty after a creation whose acceptance cannot be observed", async () => {
  const f = fixture();
  let observations = 0;
  f.app.observe = async () =>
    ++observations === 1
      ? { state: "absent", quiescent: true }
      : { state: "unknown" };
  await assert.rejects(
    f.adapter.createPullRequest(f.request),
    /PR acceptance is unobserved/,
  );
  assert.deepEqual(f.calls, ["pr"]);
});
