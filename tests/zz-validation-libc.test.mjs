// #275: an owner contract may name its install image's C library, so the
// prepared npm cache keeps only that platform's optional packages.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

test("an owner contract may name its install image's libc, and nothing else there (#275)", async (t) => {
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { validationContract } = await import("../dist/isolated-validation.js");
  const { ownerValidationContract } = await import(
    "./helpers/validation-fixture.mjs"
  );
  const { ownerPolicyDeclaredLibc } = await import(
    "../dist/native-validation-runtime.js"
  );
  const root = mkdtempSync(join(tmpdir(), "aios-libc-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "policy.json");
  const write = (libc) => {
    const contract = ownerValidationContract();
    if (libc !== undefined) contract.environment.libc = libc;
    const text = JSON.stringify({
      requiredChecks: ["pr-ci"],
      validationContract: contract,
    });
    writeFileSync(path, text);
    return createHash("sha256").update(text).digest("hex");
  };
  assert.equal(
    validationContract(path, write("glibc")).environment.libc,
    "glibc",
  );
  assert.equal(ownerPolicyDeclaredLibc(path), "glibc");
  assert.equal(
    validationContract(path, write("musl")).environment.libc,
    "musl",
  );
  assert.equal(
    Object.hasOwn(
      validationContract(path, write(undefined)).environment,
      "libc",
    ),
    false,
  );
  assert.equal(ownerPolicyDeclaredLibc(path), undefined);
  assert.throws(
    () => validationContract(path, write("bionic")),
    /Invalid validation environment/,
  );
  assert.equal(ownerPolicyDeclaredLibc(path), undefined);
});
