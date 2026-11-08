import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hostCredentialVault } from "../dist/credential-vault.js";

test("a read-only host vault with no deployed helper refuses, creating nothing", (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "aios-credential-vault-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // Off the owner's Mac the Keychain store refuses outright; on it, read-only
  // access never builds the helper. Neither reaches the Keychain.
  assert.throws(() => hostCredentialVault(directory, true));
  assert.deepEqual(readdirSync(directory), []);
});
