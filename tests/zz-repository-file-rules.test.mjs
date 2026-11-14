// #275: a real repository's files. The owner may exclude paths that never
// reach coding or validation, and publication carries them unchanged; and
// repository file contents are refused only for unambiguous credentials.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  candidateOutput,
  candidateRevisionFiles,
  candidateSource,
  excludedRevisionFiles,
} from "../dist/feature-candidate.js";
import { ownerExcludedPaths } from "../dist/onboarding.js";
import { publicationTree } from "../dist/publication.js";
import { credentialLike, redact } from "../dist/redaction.js";
import { excludedPath, validExcludedPaths } from "../dist/workspace.js";
import { fixture } from "./helpers/publication-controller-fixture.mjs";

function repository(t, files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-files-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git("init", "-q", "-b", "main");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    if (typeof text === "object") symlinkSync(text.link, join(root, path));
    else writeFileSync(join(root, path), text);
  }
  git("add", "-A");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "base",
  );
  return { root, git, revision: git("rev-parse", "HEAD") };
}

const repositoryFiles = {
  "src/app.ts": "export const app = 1;\n",
  ".npmrc": "engine-strict=true\n",
  ".agents/skills/x/SKILL.md": "# skill\n",
  ".env.example": "DATABASE_URL=\n",
};
const excluded = [".npmrc", ".agents/", ".env.example"];

test("ordinary code passes the repository credential check, and real credentials don't", () => {
  for (const ordinary of [
    "const apiKey = env.RESEND_API_KEY;",
    "headers: { Authorization: `Bearer ${apiKey}` }",
    'DATABASE_URL="postgresql://user:password@localhost:5432/db"',
    "POSTGRES_PASSWORD: e2e",
    "import sklearn; x = 'sk-learn'",
  ]) {
    assert.equal(credentialLike(ordinary), false, ordinary);
    // Logs and reports keep the broader redaction.
    if (/apiKey =|password@|PASSWORD/.test(ordinary))
      assert.notEqual(redact(ordinary), ordinary, ordinary);
  }
  for (const credential of [
    [
      "-----BEGIN OPENSSH",
      "PRIVATE KEY-----\nabc\n-----END OPENSSH",
      "PRIVATE KEY-----",
    ].join(" "),
    "token: ghp_" + "a".repeat(36),
    "github_pat_" + "B".repeat(40),
    "key = sk-proj-" + "c".repeat(40),
    "sk-ant-api03-" + "d".repeat(40),
    // A JWT-shaped sample, built here so secret scanners see no token.
    ["eyJ" + "a".repeat(12), "eyJ" + "b".repeat(12), "c".repeat(12)].join("."),
  ])
    assert.equal(credentialLike(credential), true, credential);
});

test("excluded paths are exact files or directory prefixes, and never escape the root", () => {
  assert.equal(validExcludedPaths(excluded), true);
  assert.equal(validExcludedPaths([]), true);
  for (const bad of [
    ["/etc/passwd"],
    ["../outside"],
    ["a/../b"],
    ["a\\b"],
    ["./a"],
    [""],
    ["x", "x"],
    [1],
    "x",
    Array.from({ length: 65 }, (_, i) => `f${i}`),
  ])
    assert.equal(validExcludedPaths(bad), false, JSON.stringify(bad));
  assert.equal(excludedPath(".agents/skills/x/SKILL.md", excluded), true);
  assert.equal(excludedPath(".npmrc", excluded), true);
  assert.equal(excludedPath("docs/.npmrc", excluded), false);
  assert.equal(excludedPath(".agentsx/y", excluded), false);
});

test("a repository with refused paths is read without them once the owner excludes them", (t) => {
  const r = repository(t, repositoryFiles);
  assert.throws(() => candidateSource(r.root), /Unsafe source entry/);
  assert.throws(
    () => candidateRevisionFiles(r.root, r.revision),
    /Unsafe baseline entry/,
  );
  const source = candidateSource(r.root, r.revision, excluded);
  assert.deepEqual(
    source.files.map((f) => f.path),
    ["src/app.ts"],
  );
  assert.deepEqual(
    candidateRevisionFiles(r.root, r.revision, excluded).map((f) => f.path),
    ["src/app.ts"],
  );
  // Publication's share: the excluded files, byte for byte.
  const carried = excludedRevisionFiles(r.root, r.revision, excluded);
  assert.deepEqual(carried.map((f) => [f.path, f.bytes.toString()]).sort(), [
    [".agents/skills/x/SKILL.md", "# skill\n"],
    [".env.example", "DATABASE_URL=\n"],
    [".npmrc", "engine-strict=true\n"],
  ]);
  assert.deepEqual(excludedRevisionFiles(r.root, r.revision, []), []);
  assert.throws(
    () => excludedRevisionFiles(r.root, "nope", excluded),
    /Invalid baseline revision/,
  );
});

test("an excluded symbolic link is refused rather than carried", (t) => {
  const r = repository(t, {
    "src/app.ts": "x\n",
    ".npmrc": { link: "/etc/hosts" },
  });
  assert.throws(
    () => excludedRevisionFiles(r.root, r.revision, [".npmrc"]),
    /Unsafe excluded entry/,
  );
});

test("a candidate may not write an excluded path", () => {
  const bytes = Buffer.from("x\n"),
    hash = createHash("sha256").update(bytes).digest("hex");
  const receipt = (path) => ({
    operationId: "o",
    fence: 1,
    complete: true,
    files: [
      {
        path,
        bytes,
        executable: false,
        ordinary: true,
        links: 1,
        beforeSha256: hash,
        afterSha256: hash,
      },
    ],
  });
  assert.ok(candidateOutput(receipt("docs/notes.md"), ["docs/private/"]));
  assert.throws(
    () => candidateOutput(receipt("docs/private/notes.md"), ["docs/private/"]),
    /Unsafe output/,
  );
});

test("the owner's excluded paths are read at use, bound to the pinned policy digest", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-policy-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "policy.json");
  const write = (value) => {
    const text = JSON.stringify(value);
    writeFileSync(path, text);
    return createHash("sha256").update(text).digest("hex");
  };
  assert.deepEqual(ownerExcludedPaths(undefined, "x"), []);
  assert.deepEqual(ownerExcludedPaths(path, null), []);
  assert.deepEqual(ownerExcludedPaths(path, write({ a: 1 })), []);
  const pinned = write({ excludedPaths: excluded });
  assert.deepEqual(ownerExcludedPaths(path, pinned), excluded);
  write({ excludedPaths: [".npmrc"] });
  assert.throws(() => ownerExcludedPaths(path, pinned), /Changed owner policy/);
  assert.throws(
    () => ownerExcludedPaths(path, write({ excludedPaths: ["../x"] })),
    /Invalid excluded paths/,
  );
});

test("a delivery codes without the excluded files, and publication carries them unchanged", async (t) => {
  let codingFiles;
  const f = await fixture(
    t,
    (policy) => {
      policy.excludedPaths = excluded;
    },
    (f) => {
      for (const [path, text] of Object.entries({
        ".npmrc": "engine-strict=true\n",
        ".agents/skills/x/SKILL.md": "# skill\n",
      })) {
        mkdirSync(join(f.repository, path, ".."), { recursive: true });
        writeFileSync(join(f.repository, path), text);
      }
      f.git("add", "-A");
      f.git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        "owner files",
      );
      const execute = f.runtime.execute.bind(f.runtime);
      f.runtime.execute = async (request) => {
        codingFiles = request.files.map((file) => file.path);
        return execute(request);
      };
    },
  );
  assert.deepEqual(codingFiles, ["index.html"]);
  let signed;
  const sign = f.runtimePublication.sign.bind(f.runtimePublication);
  f.runtimePublication.sign = async (r) => {
    signed = r;
    return sign(r);
  };
  const d = await f.controller.publishFeature(f.delivery.id);
  assert.equal(d.publication.outcome, "published");
  const paths = signed.files.map((file) => file.path).sort();
  assert.deepEqual(paths, [
    ".agents/skills/x/SKILL.md",
    ".npmrc",
    "index.html",
  ]);
  assert.equal(signed.publication.treeSha1, publicationTree(signed.files));
  assert.equal(
    signed.files.find((file) => file.path === ".npmrc").bytes.toString(),
    "engine-strict=true\n",
  );
});

test("a policy with invalid excluded paths is not a valid policy, and a linked policy is unsafe", async (t) => {
  const { inspectOnboarding } = await import("../dist/onboarding.js");
  const r = repository(t, { "src/app.ts": "x\n" });
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-policy-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const policy = {
    repository: "AJHMH/profile-page",
    defaultBranch: "main",
    factoryCommit: "a".repeat(40),
    approver: "aaron-howard",
    appLogin: "factory[bot]",
    publicationLogin: "aaron-howard",
    requiredChecks: ["pr-ci"],
    validation: ["isolated-node"],
  };
  const path = join(root, "policy.json");
  writeFileSync(path, JSON.stringify({ ...policy, excludedPaths: [".npmrc"] }));
  assert.ok(inspectOnboarding(r.root, { policyPath: path }).policy);
  writeFileSync(path, JSON.stringify({ ...policy, excludedPaths: ["/etc"] }));
  assert.equal(
    inspectOnboarding(r.root, { policyPath: path }).policy,
    undefined,
  );
  const link = join(root, "link.json");
  symlinkSync(path, link);
  assert.throws(
    () => ownerExcludedPaths(link, "a".repeat(64)),
    /Unsafe owner policy/,
  );
});
