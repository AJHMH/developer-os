// Browser E2E checks (#265): the owner's validation record may admit a
// Playwright image, and the runtime runs E2E checks in it where the contract
// declares a browser. Guest behavior is in zz-validation-browser-guest. The
// name sorts after every other test file, so no other file changes shard.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validationDigest } from "../dist/isolated-validation.js";
import {
  PinnedValidationRuntime,
  offlineValidationEnvironment,
  ownerValidationAdmission,
  validationBindingSha256,
  validationPinKeys,
} from "../dist/native-validation.js";
import {
  nativeValidationRuntime,
  ownerPolicyDeclaresBrowser,
} from "../dist/native-validation-runtime.js";

const image = "7".repeat(64);
const browser = "6".repeat(64);
const pins = Object.freeze({
  imageSha256: image,
  policySha256: "8".repeat(64),
  bindingSha256: "9".repeat(64),
  browserImageSha256: browser,
});
const { browserImageSha256: _browser, ...plainPins } = pins;
function controlled(answer = (request) => request.browser) {
  const runs = [];
  return {
    runs,
    transport: {
      mode: "controlled",
      async inspect() {
        return { ...pins };
      },
      async run(request) {
        runs.push(request);
        const echoed = answer(request);
        return {
          operationId: request.operationId,
          fence: request.fence,
          checkId: request.check.id,
          exitCode: 0,
          timedOut: false,
          pins: { ...pins },
          ...(echoed !== undefined ? { browser: echoed } : {}),
        };
      },
      async stop(attempt) {
        return {
          ...attempt,
          stopped: true,
          remainingProcesses: 0,
          treeSha256: "d".repeat(64),
        };
      },
    },
  };
}
function execute(runtime, check = {}) {
  return runtime.execute({
    operationId: "11111111-1111-4111-8111-111111111111",
    fence: 1,
    stage: "baseline",
    treeSha256: "d".repeat(64),
    environmentSha256: validationDigest(runtime.environment),
    bindingSha256: runtime.bindingSha256,
    check: {
      id: "e2e",
      kind: "e2e",
      scope: "local",
      stages: ["baseline"],
      command: ["true"],
      publisher: "isolated-checker",
      timeoutMs: 60000,
      ...check,
    },
    files: [],
    mayDispatch: () => true,
  });
}
const browserRuntime = (transport) =>
  new PinnedValidationRuntime(pins, transport, undefined, { browser: true });

test("a browser runtime declares a browser and needs the admitted image", async () => {
  const { transport } = controlled();
  assert.deepEqual((await browserRuntime(transport).inspect()).environment, {
    ...offlineValidationEnvironment(image),
    browser: true,
  });
  assert.throws(
    () =>
      new PinnedValidationRuntime(plainPins, transport, undefined, {
        browser: true,
      }),
    /Unqualified validation transport/,
  );
  assert.equal(
    new PinnedValidationRuntime(pins, transport).environment.browser,
    false,
  );
});

test("only E2E checks run in the browser image, and each names it", async () => {
  const { transport, runs } = controlled();
  const runtime = browserRuntime(transport);
  const e2e = await execute(runtime);
  const lint = await execute(runtime, { id: "lint", kind: "lint" });
  assert.deepEqual(
    runs.map((r) => r.browser),
    [true, undefined],
  );
  assert.equal(e2e.status, "success");
  assert.deepEqual(e2e.artifacts, [{ name: "browser-image", sha256: browser }]);
  assert.deepEqual(lint.artifacts, []);
});

for (const [name, answer, check] of [
  ["an E2E result without its browser", () => undefined, {}],
  ["a browser for a check that asked for none", () => true, { kind: "lint" }],
])
  test(`${name} is untrusted`, async () => {
    const { transport } = controlled(answer);
    await assert.rejects(
      execute(browserRuntime(transport), check),
      /Untrusted validation result/,
    );
  });

test("the browser image changes the validation binding only when admitted", () => {
  assert.notEqual(
    validationBindingSha256(pins),
    validationBindingSha256(plainPins),
  );
  assert.deepEqual(validationPinKeys(pins), [
    "imageSha256",
    "policySha256",
    "bindingSha256",
    "browserImageSha256",
  ]);
});

function ownerFile(t, name, value) {
  const directory = mkdtempSync(join(tmpdir(), "aios-browser-admission-"));
  t.after(() => rmSync(directory, { recursive: true }));
  chmodSync(directory, 0o700);
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  return path;
}
const validationRecord = (t, recordPins) =>
  ownerFile(t, "validation-admission.json", {
    scope: "aios-native-validation-admission-v1",
    approvedAt: "2026-11-11T00:00:00.000Z",
    pins: recordPins,
  });

test("the CLI's runtime gets the record's browser image only when the contract declares a browser", (t) => {
  const record = validationRecord(t, pins);
  assert.deepEqual(ownerValidationAdmission(record).pins(), pins);
  const runtime = nativeValidationRuntime("aios-test", record, {
    browser: true,
  });
  assert.equal(runtime.environment.browser, true);
  assert.equal(runtime.pins.browserImageSha256, browser);
  assert.throws(
    () =>
      nativeValidationRuntime("aios-test", validationRecord(t, plainPins), {
        browser: true,
      }),
    /Unqualified validation transport/,
  );
  const policy = (environment) =>
    ownerFile(t, "owner-policy.json", { validationContract: { environment } });
  assert.equal(ownerPolicyDeclaresBrowser(policy({ browser: true })), true);
  assert.equal(ownerPolicyDeclaresBrowser(policy({ browser: false })), false);
  assert.equal(ownerPolicyDeclaresBrowser(undefined), false);
});
