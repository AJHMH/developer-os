import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { initializeWindowsAuthDirectory } from "../dist/windows-auth-store.js";
import { ownWindowsFixturePaths } from "./helpers/windows-fixture-owner.mjs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  unlinkSync,
  symlinkSync,
  linkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DeliveryController } from "../dist/controller.js";
import {
  subscriptionGatewayVersion,
  gatewayRequest,
} from "../dist/subscription-gateway.js";
import { modelRelayVersion } from "../dist/model-relay.js";
const hash = (v) => createHash("sha256").update(v).digest("hex");
for (const target of ["macos", "windows"])
  test(`${target} qualification and status expose owner-state positive mediation without authorizing inference`, async (t) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-decision-")));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    // Filesystem protection follows the runner, not the simulated VM binding.
    if (process.platform === "win32") initializeWindowsAuthDirectory(root);
    const repo = join(root, "repo"),
      state = join(root, "state");
    mkdirSync(repo);
    let q;
    const c = new DeliveryController(
      state,
      {},
      { worker: { probe: async () => structuredClone(q) } },
    );
    const d = c.start({ repository: repo, request: "Mediation decision" });
    const policy = join(root, "pins.json"),
      registration = join(root, "registration.json");
    writeFileSync(policy, "synthetic independent pins", { mode: 0o600 });
    writeFileSync(registration, "synthetic registration", { mode: 0o600 });
    q = {
      ready: false,
      liveReady: false,
      mode: "controlled",
      checkedAt: new Date().toISOString(),
      probes: [],
      blockers: ["Production disabled"],
      policySha256: hash(readFileSync(policy)),
      bindingSha256: "a".repeat(64),
      offlineAdmission: {
        allowed: true,
        scope: "offline-probe-only",
        binding:
          target === "macos"
            ? { platform: "darwin", arch: "arm64", provider: "applehv" }
            : { platform: "win32", arch: "x64", provider: "hyperv" },
      },
      subscriptionMediation: {
        qualified: false,
        hostGateway: "passed",
        hostGatewayVersion: subscriptionGatewayVersion,
        gatewayIntegration: "passed",
        workerExecutableSha256:
          target === "macos"
            ? "0129f94f4f1197bd75f6c4265889061f386ed302bbc50c6e57e3e0660dfb28a7"
            : "9a820c17865fa825d04db416818679a9d63bd72e50835c396f496e5684626c9c",
        codexCredentialIsolation: "passed",
        endpointEnforcement: "passed",
        deliveryCapabilities: "passed",
        relayDeliveryId: d.id,
        subscriptionInference: "not-run",
        nextAction: "Synthetic only",
      },
    };
    const run = "00000000-0000-4000-8000-000000000021";
    const record = {
      schema: 1,
      deliveryId: d.id,
      repositorySha256: hash(realpathSync(repo)),
      runId: run,
      observedAt: new Date().toISOString(),
      accountId: "c".repeat(64),
      // The owner endorses which usage-reader account this credential is.
      usageAccountId: "b".repeat(64),
      policyPath: policy,
      policySha256: q.policySha256,
      bindingSha256: q.bindingSha256,
      registrationPath: registration,
      registrationSha256: hash(readFileSync(registration)),
      gatewayVersion: subscriptionGatewayVersion,
      relayVersion: modelRelayVersion,
      nativeVersion: hash(
        readFileSync(new URL("../dist/podman-native.js", import.meta.url)),
      ),
      workerExecutableSha256: q.subscriptionMediation.workerExecutableSha256,
      requestSha256: hash(gatewayRequest),
      subscriptionInference: "passed",
      gatewayRevoked: true,
      workerRemaining: 0,
      relayRemaining: 0,
    };
    const recordPath = join(state, "subscription-decision-" + d.id + ".json");
    writeFileSync(
      join(state, "inference-" + run + ".consumed"),
      "one-shot approval consumed\n",
      { mode: 0o600 },
    );
    // A repository copy is not authority.
    writeFileSync(
      join(repo, "subscription-decision-" + d.id + ".json"),
      JSON.stringify(record),
    );
    assert.equal(
      (await c.qualify(d.id)).qualification.subscriptionMediation
        .mechanismDecision,
      undefined,
    );
    // Without an endorsed usage-reader account the decision never qualifies.
    const { usageAccountId, ...unendorsed } = record;
    assert.ok(usageAccountId);
    writeFileSync(recordPath, JSON.stringify(unendorsed), { mode: 0o600 });
    ownWindowsFixturePaths([
      state,
      policy,
      registration,
      recordPath,
      join(state, "inference-" + run + ".consumed"),
    ]);
    assert.equal(
      (await c.qualify(d.id)).qualification.subscriptionMediation
        .mechanismDecision,
      undefined,
    );
    writeFileSync(recordPath, JSON.stringify(record), { mode: 0o600 });
    ownWindowsFixturePaths([
      state,
      policy,
      registration,
      recordPath,
      join(state, "inference-" + run + ".consumed"),
    ]);
    const result = await c.qualify(d.id);
    assert.equal(
      result.qualification.subscriptionMediation.mechanismDecision.qualified,
      true,
    );
    assert.equal(
      result.qualification.subscriptionMediation.mechanismDecision
        .usageAccountId,
      record.usageAccountId,
    );
    assert.equal(
      result.qualification.subscriptionMediation.mechanismDecision
        .inferenceAuthorized,
      false,
    );
    assert.equal(result.qualification.ready, false);
    assert.equal(result.qualification.liveReady, false);
    assert.deepEqual(
      new DeliveryController(state).status(d.id).qualification
        .subscriptionMediation.mechanismDecision,
      result.qualification.subscriptionMediation.mechanismDecision,
    );
    assert.deepEqual(
      c.list().deliveries[0].qualification.subscriptionMediation
        .mechanismDecision,
      result.qualification.subscriptionMediation.mechanismDecision,
    );
    const originalSpawn = cp.spawnSync;
    cp.spawnSync = () => {
      throw Error("Status/list must not launch credential or ACL observers");
    };
    syncBuiltinESMExports();
    try {
      assert.equal(
        c.status(d.id).qualification.subscriptionMediation.mechanismDecision
          .qualified,
        true,
      );
      assert.equal(
        c.list().deliveries[0].qualification.subscriptionMediation
          .mechanismDecision.qualified,
        true,
      );
    } finally {
      cp.spawnSync = originalSpawn;
      syncBuiltinESMExports();
    }
    // A separate owner-controlled readable policy directory is allowed.
    const readablePolicyParent = join(root, "readable-pins");
    mkdirSync(readablePolicyParent, { mode: 0o755 });
    const readablePolicy = join(readablePolicyParent, "pins.json");
    writeFileSync(readablePolicy, "synthetic independent pins", {
      mode: 0o600,
    });
    ownWindowsFixturePaths([readablePolicyParent, readablePolicy]);
    writeFileSync(
      recordPath,
      JSON.stringify({ ...record, policyPath: readablePolicy }),
    );
    await c.qualify(d.id);
    assert.equal(
      c.status(d.id).qualification.subscriptionMediation.mechanismDecision
        .qualified,
      true,
    );
    // POSIX modes do not change Windows ACLs; this is a macOS-only mechanism.
    if (process.platform !== "win32") {
      chmodSync(readablePolicyParent, 0o777);
      assert.equal(
        c.status(d.id).qualification.subscriptionMediation.mechanismDecision,
        undefined,
      );
      chmodSync(readablePolicyParent, 0o755);
    }
    writeFileSync(recordPath, JSON.stringify(record));
    // Source, independent policy, registration and fresh binding drift invalidate the decision.
    for (const field of [
      "gatewayVersion",
      "relayVersion",
      "nativeVersion",
      "bindingSha256",
      "workerExecutableSha256",
      "requestSha256",
      "accountId",
      "usageAccountId",
    ]) {
      writeFileSync(
        recordPath,
        JSON.stringify({ ...record, [field]: "invalid" }),
        { mode: 0o600 },
      );
      assert.equal(
        c.status(d.id).qualification.subscriptionMediation.mechanismDecision,
        undefined,
        field,
      );
    }
    for (const patch of [
      { usageAccountId: undefined },
      { deliveryId: run },
      { repositorySha256: "d".repeat(64) },
      { subscriptionInference: "unverified" },
      { gatewayRevoked: false },
      { workerRemaining: 1 },
      { relayRemaining: 1 },
      { observedAt: "2999-01-01T00:00:00Z" },
    ]) {
      writeFileSync(recordPath, JSON.stringify({ ...record, ...patch }));
      assert.equal(
        c.status(d.id).qualification.subscriptionMediation.mechanismDecision,
        undefined,
      );
    }
    writeFileSync(recordPath, JSON.stringify(record));
    const marker = join(state, "inference-" + run + ".consumed");
    unlinkSync(marker);
    assert.equal(
      c.status(d.id).qualification.subscriptionMediation.mechanismDecision,
      undefined,
    );
    writeFileSync(marker, "one-shot approval consumed\n", { mode: 0o600 });
    ownWindowsFixturePaths([marker]);
    if (process.platform !== "win32") {
      chmodSync(recordPath, 0o644);
      assert.equal(
        c.status(d.id).qualification.subscriptionMediation.mechanismDecision,
        undefined,
      );
      chmodSync(recordPath, 0o600);
    }
    linkSync(recordPath, join(root, "duplicate-evidence"));
    assert.equal(
      c.status(d.id).qualification.subscriptionMediation.mechanismDecision,
      undefined,
    );
    unlinkSync(join(root, "duplicate-evidence"));
    if (process.platform !== "win32") {
      unlinkSync(recordPath);
      symlinkSync(
        join(repo, "subscription-decision-" + d.id + ".json"),
        recordPath,
      );
      assert.equal(
        c.status(d.id).qualification.subscriptionMediation.mechanismDecision,
        undefined,
      );
      unlinkSync(recordPath);
    }
    writeFileSync(recordPath, JSON.stringify(record), { mode: 0o600 });
    q.offlineAdmission.allowed = false;
    assert.equal(
      (await c.qualify(d.id)).qualification.subscriptionMediation
        .mechanismDecision,
      undefined,
    );
    q.offlineAdmission.allowed = true;
    await c.qualify(d.id);
    if (target === "windows" && process.platform === "win32") {
      const icacls = join(process.env.SystemRoot, "System32", "icacls.exe");
      for (const path of [recordPath, state, marker, registration, policy]) {
        assert.equal(
          spawnSync(icacls, [path, "/grant", "*S-1-1-0:W"], {
            windowsHide: true,
          }).status,
          0,
        );
        assert.equal(
          (await c.qualify(d.id)).qualification.subscriptionMediation
            .mechanismDecision,
          undefined,
          "A writable Windows authority path must refuse: " + path,
        );
        assert.equal(
          spawnSync(icacls, [path, "/remove:g", "*S-1-1-0"], {
            windowsHide: true,
          }).status,
          0,
        );
        assert.equal(
          (await c.qualify(d.id)).qualification.subscriptionMediation
            .mechanismDecision.qualified,
          true,
        );
      }
    }
    if (process.platform === "darwin") {
      for (const path of [recordPath, state, marker, registration, policy]) {
        assert.equal(
          spawnSync("/bin/chmod", ["+a", "everyone allow write", path]).status,
          0,
        );
        assert.equal(
          (await c.qualify(d.id)).qualification.subscriptionMediation
            .mechanismDecision,
          undefined,
        );
        assert.equal(spawnSync("/bin/chmod", ["-N", path]).status, 0);
        await c.qualify(d.id);
      }
    }
    writeFileSync(registration, "changed registration");
    assert.equal(
      c.status(d.id).qualification.subscriptionMediation.mechanismDecision,
      undefined,
    );
    writeFileSync(registration, "synthetic registration");
    writeFileSync(policy, "changed policy");
    assert.equal(
      c.status(d.id).qualification.subscriptionMediation.mechanismDecision,
      undefined,
    );
    rmSync(repo, { recursive: true, force: true });
    assert.equal(c.status(d.id).id, d.id);
    assert.equal(
      c.status(d.id).qualification.subscriptionMediation.mechanismDecision,
      undefined,
    );
  });
