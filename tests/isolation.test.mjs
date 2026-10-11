import assert from "node:assert/strict";
import { test } from "node:test";
import { realpathSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeliveryController } from "../dist/controller.js";

test("qualification records explicit not-run evidence and blocks launch when no runtime or policy is configured", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-isolation-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repository");
  mkdirSync(repository);
  const controller = new DeliveryController(join(root, "state"));
  const delivery = controller.start({
    repository,
    request: "Safe worker feature",
  });
  const report = await controller.qualify(delivery.id);
  assert.equal(report.qualification.ready, false);
  assert.equal(report.qualification.liveReady, false);
  assert.ok(
    report.qualification.probes.some((probe) => probe.outcome === "not-run"),
  );
  assert.equal(report.phase, "blocked");
  assert.deepEqual(
    new DeliveryController(join(root, "state")).status(delivery.id)
      .qualification,
    report.qualification,
  );
});

import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { SandboxWorkerAdapter } from "../dist/sandbox-worker.js";
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-sandbox-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repository");
  mkdirSync(repository);
  const state = join(root, "state");
  mkdirSync(state);
  const workspaces = join(root, "workspaces");
  mkdirSync(workspaces);
  writeFileSync(join(repository, "feature.txt"), "Safe feature source");
  const binding = {
    platform: "win32",
    arch: "x64",
    osVersion: "10.0.26100",
    hypervisor: true,
    sbxVersion: "0.45.0",
    codexVersion: "1.0.0",
    template: "docker.io/docker/sandbox-templates@sha256:" + "a".repeat(64),
    hostId: "b".repeat(64),
  };
  const policy = {
    schema: 1,
    authorityDirectory: state,
    workspaceDirectory: workspaces,
    binding,
    revision: "c".repeat(40),
    files: [
      {
        path: "feature.txt",
        sha256: createHash("sha256")
          .update("Safe feature source")
          .digest("hex"),
      },
    ],
    proxy: {
      binding: "dedicated-model-only",
      endpoints: ["https://api.openai.com/v1/responses"],
      spendingLimitUsd: 5,
    },
    dependencies: ["https://registry.npmjs.org/"],
  };
  const policyPath = join(root, "worker-policy.json");
  writeFileSync(policyPath, JSON.stringify(policy));
  const onboardingPath = join(root, "onboarding.json");
  writeFileSync(
    onboardingPath,
    JSON.stringify({
      repository: "AJHMH/profile-page",
      defaultBranch: "main",
      factoryCommit: "d".repeat(40),
      approver: "aaron-howard",
      appLogin: "factory[bot]",
      publicationLogin: "aaron-howard",
      requiredChecks: ["lint"],
      validation: ["isolated-node"],
    }),
  );
  const signature = {
    commit: "e".repeat(40),
    valid: true,
    login: "aaron-howard",
  };
  const options = {
    policyPath: onboardingPath,
    inspect: () => ({
      localRepository: "AJHMH/profile-page",
      localDefaultBranch: "main",
      repository: "AJHMH/profile-page",
      defaultBranch: "main",
      factoryCommit: "d".repeat(40),
      appLogin: "factory[bot]",
      appRepositoryAccess: true,
      eligibleApprovers: ["aaron-howard"],
      protectionsEnforced: true,
      requiredChecks: ["lint"],
      trustedCheckPublishers: true,
      publicationLogin: "aaron-howard",
      publicationAccess: true,
      localSignature: signature,
      githubSignature: signature,
      validation: ["isolated-node"],
    }),
  };
  const runtime = {
    mode: "controlled",
    inspect: () => ({ ...binding }),
    probe: async (challenge) => ({
      ...challenge,
      outcome: "passed",
      observed: true,
      evidenceSha256: "f".repeat(64),
    }),
  };
  const adapter = new SandboxWorkerAdapter(policyPath, runtime);
  const controller = new DeliveryController(state, options, {
    worker: adapter,
    subscription: async () => ({
      observedAt: new Date().toISOString(),
      accountId: "controlled-owner",
      authMode: "chatgpt",
      exhausted: false,
      windows: [
        {
          id: "weekly",
          usedPercent: 4,
          resetsAt: Math.floor(Date.now() / 1000) + 86400,
        },
      ],
    }),
  });
  const delivery = controller.start({
    repository,
    request: "Safe isolated feature",
  });
  return {
    root,
    repository,
    state,
    workspaces,
    binding,
    policy,
    policyPath,
    runtime,
    adapter,
    controller,
    delivery,
    options,
  };
}
test("controlled canary evidence binds qualification to exact host/runtime/policy but cannot establish live readiness", async (t) => {
  const f = fixture(t);
  const qualified = await f.controller.qualify(f.delivery.id);
  assert.equal(qualified.qualification.ready, true);
  assert.equal(qualified.qualification.liveReady, false);
  assert.equal(qualified.qualification.mode, "controlled");
  assert.ok(
    qualified.qualification.probes.every((probe) => probe.outcome === "passed"),
  );
  assert.match(qualified.qualification.policySha256, /^[a-f0-9]{64}$/);
  assert.equal(f.adapter.qualified(qualified, f.state), true);
  f.binding.sbxVersion = "0.46.0";
  assert.equal(f.adapter.qualified(qualified, f.state), false);
});

test("qualified launch sends only fresh admitted files and effective mountless microVM policy to the runtime", async (t) => {
  const f = fixture(t);
  const creates = [];
  let effective;
  f.runtime.create = async (request) => {
    creates.push(request);
    effective = {
      ...request,
      hostMounts: [],
      sharedSkills: false,
      hostMcp: false,
      sshForwarding: false,
      hostHooks: false,
      githubBindings: [],
      rawModelCredential: false,
      networkPolicySha256: request.policySha256,
      modelBinding: request.proxy.binding,
      spendingLimitUsd: request.proxy.spendingLimitUsd,
      copiedManifestSha256: request.manifestSha256,
    };
    return effective;
  };
  f.runtime.inspectSandbox = async () => effective;
  f.runtime.launch = async (request) => ({
    ...request.session,
    status: "running",
  });
  f.runtime.revokeAndStop = async (session) => ({
    ...session,
    revoked: true,
    descendantsStopped: true,
  });
  await f.controller.qualify(f.delivery.id);
  const running = await f.controller.run(f.delivery.id);
  assert.equal(running.phase, "implementing");
  assert.equal(creates.length, 1);
  assert.equal(creates[0].kind, "docker-sandboxes-microvm");
  assert.notEqual(creates[0].workspace, f.repository);
  assert.equal(
    readFileSync(join(creates[0].workspace, "feature.txt"), "utf8"),
    "Safe feature source",
  );
  assert.deepEqual(creates[0].environment, {});
  assert.deepEqual(creates[0].hostMounts, []);
  assert.equal(creates[0].skills, "off");
  assert.equal(creates[0].template, f.binding.template);
  const paused = await f.controller.pause(f.delivery.id);
  assert.equal(paused.phase, "paused");
  assert.equal(paused.execution.state, "stopped");
});

test("unsafe effective policy or client-only termination cannot qualify agent launch or shutdown", async (t) => {
  const f = fixture(t);
  let launches = 0;
  f.runtime.create = async (request) => ({
    ...request,
    hostMounts: [f.repository],
    sharedSkills: true,
    hostMcp: false,
    sshForwarding: false,
    hostHooks: false,
    githubBindings: [],
    rawModelCredential: false,
    networkPolicySha256: request.policySha256,
    modelBinding: request.proxy.binding,
    spendingLimitUsd: request.proxy.spendingLimitUsd,
    copiedManifestSha256: request.manifestSha256,
  });
  f.runtime.launch = async (request) => {
    launches++;
    return { ...request.session, status: "running" };
  };
  f.runtime.revokeAndStop = async (session) => ({
    ...session,
    revoked: true,
    descendantsStopped: false,
  });
  await f.controller.qualify(f.delivery.id);
  const refused = await f.controller.run(f.delivery.id);
  assert.equal(refused.phase, "blocked");
  assert.equal(launches, 0);
  assert.equal(refused.execution.state, "uncertain");
  const cancelled = await f.controller.cancel(f.delivery.id);
  assert.equal(cancelled.execution.state, "uncertain");
  assert.throws(() => f.controller.release(f.delivery.id), /reconcil/i);
});

test("candidate authority files, credential-looking input and linked source files are not admitted", async (t) => {
  for (const [path, content] of [
    [".env", "synthetic-env-canary"],
    [".git/config", "synthetic-git-canary"],
    ["owner.pem", "synthetic-pem-canary"],
    ["feature.txt", "password=synthetic-content-canary"],
  ]) {
    const f = fixture(t);
    mkdirSync(join(f.repository, ...path.split("/").slice(0, -1)), {
      recursive: true,
    });
    writeFileSync(join(f.repository, ...path.split("/")), content);
    f.policy.files = [
      { path, sha256: createHash("sha256").update(content).digest("hex") },
    ];
    writeFileSync(f.policyPath, JSON.stringify(f.policy));
    const blocked = await f.controller.qualify(f.delivery.id);
    assert.equal(blocked.qualification.ready, false, path);
    assert.ok(
      blocked.qualification.probes.every(
        (probe) => probe.outcome === "not-run",
      ),
    );
    assert.equal(JSON.stringify(blocked).includes(content), false);
  }
});

test("missing and stale canary observations remain not-run and policy changes invalidate readiness", async (t) => {
  const f = fixture(t);
  f.runtime.probe = async (challenge) => ({
    ...challenge,
    challengeId: "old-probe",
    observed: true,
    outcome: "passed",
    evidenceSha256: "f".repeat(64),
  });
  const unknown = await f.controller.qualify(f.delivery.id);
  assert.equal(unknown.qualification.ready, false);
  assert.ok(
    unknown.qualification.probes.every((probe) => probe.outcome === "not-run"),
  );
  f.runtime.probe = async (challenge) => ({
    ...challenge,
    observed: true,
    outcome: "passed",
    evidenceSha256: "f".repeat(64),
  });
  const qualified = await f.controller.qualify(f.delivery.id);
  assert.equal(qualified.qualification.ready, true);
  f.policy.proxy.spendingLimitUsd = 100;
  writeFileSync(f.policyPath, JSON.stringify(f.policy));
  assert.equal(f.adapter.qualified(qualified, f.state), false);
});

import { linkSync, symlinkSync, unlinkSync } from "node:fs";
test("hard links and directory links cannot introduce external files into the workspace", async (t) => {
  const hard = fixture(t);
  const outside = join(hard.root, "outside.txt");
  writeFileSync(outside, "Safe feature source");
  unlinkSync(join(hard.repository, "feature.txt"));
  linkSync(outside, join(hard.repository, "feature.txt"));
  assert.equal(
    (await hard.controller.qualify(hard.delivery.id)).qualification.ready,
    false,
  );
  const linked = fixture(t);
  symlinkSync(
    linked.root,
    join(linked.repository, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  linked.policy.files = [
    {
      path: "linked/worker-policy.json",
      sha256: createHash("sha256")
        .update(readFileSync(linked.policyPath))
        .digest("hex"),
    },
  ];
  writeFileSync(linked.policyPath, JSON.stringify(linked.policy));
  assert.equal(
    (await linked.controller.qualify(linked.delivery.id)).qualification.ready,
    false,
  );
});

test("raw proxy credentials and publication endpoints cannot enter a model-only policy", async (t) => {
  const f = fixture(t);
  f.policy.proxy.apiKey = "synthetic-proxy-secret";
  writeFileSync(f.policyPath, JSON.stringify(f.policy));
  const blocked = await f.controller.qualify(f.delivery.id);
  assert.equal(blocked.qualification.ready, false);
  assert.equal(
    JSON.stringify(blocked).includes("synthetic-proxy-secret"),
    false,
  );
});

test("publication and host-local destinations cannot be declared as inference or dependency endpoints", async (t) => {
  for (const endpoint of [
    "https://api.github.com/",
    "https://github.com/",
    "https://host.docker.internal/",
    "https://127.0.0.1/",
    "https://localhost/",
  ]) {
    const f = fixture(t);
    f.policy.proxy.endpoints = [endpoint];
    writeFileSync(f.policyPath, JSON.stringify(f.policy));
    assert.equal(
      (await f.controller.qualify(f.delivery.id)).qualification.ready,
      false,
      endpoint,
    );
  }
});

test("a runtime cannot substitute the admitted workspace or initial manifest before launch", async (t) => {
  for (const field of ["workspace", "manifestSha256"]) {
    const f = fixture(t);
    let launches = 0;
    f.runtime.create = async (request) => ({
      ...request,
      sharedSkills: false,
      hostMcp: false,
      sshForwarding: false,
      hostHooks: false,
      githubBindings: [],
      rawModelCredential: false,
      networkPolicySha256: request.policySha256,
      modelBinding: request.proxy.binding,
      spendingLimitUsd: request.proxy.spendingLimitUsd,
      copiedManifestSha256: request.manifestSha256,
      [field]: field === "workspace" ? f.repository : "0".repeat(64),
    });
    f.runtime.launch = async (request) => {
      launches++;
      return { ...request.session, status: "running" };
    };
    await f.controller.qualify(f.delivery.id);
    const refused = await f.controller.run(f.delivery.id);
    assert.equal(refused.phase, "blocked", field);
    assert.equal(launches, 0, field);
  }
});
