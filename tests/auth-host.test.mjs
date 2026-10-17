import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorizeSubscriptionAuth } from "../dist/auth-host.js";
import { prepareSubscriptionAuth } from "../dist/subscription-auth.js";
import { windowsAuthStore } from "../dist/windows-auth-store.js";

const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

for (const [platform, arch] of [
  ["darwin", "arm64"],
  ["win32", "x64"],
]) {
  test(`separate ${platform} authorization completes a local callback with a verified synthetic account and stores only through its host adapter`, async (t) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-auth-host-")));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const repository = join(root, "repo");
    const authority = join(root, "state");
    const authDirectory = join(root, "auth");
    mkdirSync(repository);
    mkdirSync(authority);

    const originalArch = Object.getOwnPropertyDescriptor(process, "arch");
    Object.defineProperty(process, "arch", { ...originalArch, value: "x64" });
    t.after(() => Object.defineProperty(process, "arch", originalArch));

    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const clientId = "oaiapp_synthetic_fixture";
    let exchangeCount = 0;
    let stored;
    const transport = {
      async exchange(parameters) {
        exchangeCount++;
        assert.equal(parameters.client_id, clientId);
        assert.equal(parameters.code, "synthetic-code");
        const state = new URLSearchParams(parameters.redirect_uri).get("state");
        assert.equal(state, null);
        const authorization = new URL(authorizationUrl);
        const header = encode({ alg: "RS256", kid: "fixture-key" });
        const claims = encode({
          iss: "https://auth.openai.com",
          aud: clientId,
          sub: "synthetic-account",
          nonce: authorization.searchParams.get("nonce"),
          exp: Math.floor(Date.now() / 1000) + 300,
        });
        const input = `${header}.${claims}`;
        const signature = sign(
          "RSA-SHA256",
          Buffer.from(input),
          privateKey,
        ).toString("base64url");
        return {
          id_token: `${input}.${signature}`,
          access_token: "synthetic-access-token",
          refresh_token: "synthetic-refresh-token",
          token_type: "Bearer",
          expires_in: 600,
          scope:
            "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
        };
      },
      async signingKeys() {
        return [
          {
            ...publicKey.export({ format: "jwk" }),
            kid: "fixture-key",
            alg: "RS256",
            use: "sig",
          },
        ];
      },
    };
    let authorizationUrl;
    const credentialVault = (directory) => {
      assert.equal(directory, authDirectory);
      const nativeVault =
        platform === "win32" && process.platform === "win32"
          ? windowsAuthStore(directory)
          : undefined;
      return {
        read: (id) => {
          if (stored === undefined)
            throw Error("No account is selected during first authorization");
          return nativeVault ? nativeVault.read(id) : stored;
        },
        write: (accountId, value, replace) => {
          assert.equal(replace, stored !== undefined);
          if (nativeVault) {
            nativeVault.write(accountId, value, replace);
            assert.equal(nativeVault.read(accountId), value);
            assert.equal(
              readFileSync(join(directory, accountId + ".dpapi")).includes(
                Buffer.from(value),
              ),
              false,
            );
            assert.throws(() => nativeVault.read("0".repeat(64)));
            if (!replace)
              assert.throws(() => nativeVault.write(accountId, value, false));
          }
          stored = value;
        },
      };
    };
    const adapters = {
      platform,
      arch,
      transport,
      credentialVault,
    };

    if (process.platform === "win32") {
      const nativeSpawn = cp.spawnSync;
      t.mock.method(cp, "spawnSync", (executable, args, options) => {
        const started = performance.now();
        const observedArgs = [...args];
        if (
          String(executable).toLowerCase().endsWith("powershell.exe") &&
          !String(options.input).includes("\n")
        ) {
          const index = observedArgs.indexOf("-EncodedCommand") + 1;
          let source = Buffer.from(observedArgs[index], "base64").toString(
            "utf16le",
          );
          const mark = (label) =>
            `[Console]::Error.WriteLine('storage-init-phase: ${label}');\n`;
          source = mark("entered") + source;
          for (const [statement, label] of [
            ["$wire=[Console]::In.ReadToEnd()", "stdin-read"],
            [
              "$path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($wire))",
              "path-decoded",
            ],
            ["$attributes=[IO.File]::GetAttributes($path)", "attributes-read"],
            [
              "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User",
              "identity-read",
            ],
            [
              "$acl=[Security.AccessControl.DirectorySecurity]::new()",
              "acl-created",
            ],
            ["$acl.SetOwner($sid)", "owner-set"],
            ["$acl.SetAccessRuleProtection($true,$false)", "inheritance-set"],
            ["[IO.Directory]::SetAccessControl($path,$acl)", "acl-written"],
          ])
            source = source.replace(statement, statement + "\n" + mark(label));
          observedArgs[index] = Buffer.from(source, "utf16le").toString(
            "base64",
          );
        }
        const result = nativeSpawn(executable, observedArgs, options);
        if (String(executable).toLowerCase().endsWith("powershell.exe")) {
          let stage = "initialize";
          try {
            const fields = options.input.split("\n");
            if (fields.length > 1) stage = fields[0];
          } catch {
            stage = "unknown";
          }
          const allowed = [
            "initialize",
            "check",
            "create",
            "protect",
            "unprotect",
          ];
          t.diagnostic(
            JSON.stringify({
              probe: "windows-storage",
              milestones: String(result.stderr ?? "")
                .split(/\r?\n/)
                .filter((line) => /^storage-init-phase: [a-z-]+$/.test(line))
                .slice(0, 16),
              stage: allowed.includes(stage) ? stage : "unknown",
              elapsedMs: Math.round(performance.now() - started),
              exitCode: result.status,
              timedOut: result.error?.code === "ETIMEDOUT",
              signaled: result.signal !== null && result.signal !== undefined,
            }),
          );
        }
        return result;
      });
      syncBuiltinESMExports();
      t.after(() => {
        t.mock.restoreAll();
        syncBuiltinESMExports();
      });
    }

    const result = await authorizeSubscriptionAuth(
      authDirectory,
      repository,
      authority,
      async (url) => {
        authorizationUrl = url;
        const authorization = new URL(url);
        const callback = new URL(
          authorization.searchParams.get("redirect_uri"),
        );
        assert.equal(
          (await fetch(new URL("/not-the-callback", callback))).status,
          400,
        );
        assert.equal(
          await new Promise((resolve, reject) => {
            const request = http.request(
              callback,
              { headers: { host: "unexpected.local" } },
              (response) => {
                response.resume();
                response.on("end", () => resolve(response.statusCode));
              },
            );
            request.on("error", reject);
            request.end();
          }),
          400,
        );
        callback.searchParams.set(
          "state",
          authorization.searchParams.get("state"),
        );
        callback.searchParams.set("client_id", clientId);
        callback.searchParams.set("code", "synthetic-code");
        const response = await fetch(callback);
        assert.equal(response.status, 200);
      },
      undefined,
      adapters,
    );

    assert.equal(result.status, "authorized");
    assert.equal(result.credentialsStored, true);
    assert.equal(
      result.storage,
      platform === "win32" ? "Windows CurrentUser DPAPI" : "macOS Keychain",
    );
    assert.equal(result.deliveryEnabled, false);
    assert.equal(result.planUsageAuthorized, true);
    assert.equal(exchangeCount, 1);
    assert.equal(stored !== undefined, true);
    const account = JSON.parse(Buffer.from(stored, "base64").toString("utf8"));
    assert.equal(account.subject, "synthetic-account");
    assert.equal(account.accessToken, "synthetic-access-token");
    assert.equal(account.refreshToken, "synthetic-refresh-token");

    const selectedResult = await authorizeSubscriptionAuth(
      authDirectory,
      repository,
      authority,
      async (url) => {
        authorizationUrl = url;
        const authorization = new URL(url);
        const callback = new URL(
          authorization.searchParams.get("redirect_uri"),
        );
        callback.searchParams.set(
          "state",
          authorization.searchParams.get("state"),
        );
        callback.searchParams.set("client_id", clientId);
        callback.searchParams.set("code", "synthetic-code");
        assert.equal((await fetch(callback)).status, 200);
      },
      result.accountId,
      adapters,
    );
    assert.equal(selectedResult.status, "authorized");
    assert.equal(selectedResult.accountId, result.accountId);
    assert.equal(exchangeCount, 2);
  });
}

test("separate authorization refuses unsupported hosts before opening storage or browser", async (t) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "aios-auth-host-refusal-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repo");
  const authority = join(root, "state");
  const authDirectory = join(root, "auth");
  mkdirSync(repository);
  mkdirSync(authority);

  await assert.rejects(
    authorizeSubscriptionAuth(
      authDirectory,
      repository,
      authority,
      () => assert.fail("unsupported host must not open a browser"),
      undefined,
      {
        platform: "win32",
        arch: "arm64",
        transport: assert.fail,
        credentialVault: () =>
          assert.fail("unsupported host must not open Keychain"),
      },
    ),
    /Separate subscription authorization did not complete at setup/,
  );
});

test("separate authorization refuses a selected host account that is absent from the fixture vault", async (t) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "aios-auth-host-selected-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repo");
  const authority = join(root, "state");
  const authDirectory = join(root, "auth");
  mkdirSync(repository);
  mkdirSync(authority);
  const adapters = {
    platform: "darwin",
    arch: "arm64",
    transport: {
      exchange: async () => assert.fail("missing selection cannot exchange"),
      signingKeys: async () =>
        assert.fail("missing selection cannot fetch keys"),
    },
    credentialVault: () => ({
      read: () => {
        throw Error("synthetic selection is absent");
      },
      write: () => assert.fail("missing selection cannot be replaced"),
    }),
  };
  await assert.rejects(
    authorizeSubscriptionAuth(
      authDirectory,
      repository,
      authority,
      () => assert.fail("missing selection must not open a browser"),
      "a".repeat(64),
      adapters,
    ),
    /Separate subscription authorization did not complete at setup/,
  );
});

test("separate authorization refuses malformed selected IDs and mismatched stored identities", async (t) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "aios-auth-host-invalid-selected-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repo");
  const authority = join(root, "state");
  const authDirectory = join(root, "auth");
  mkdirSync(repository);
  mkdirSync(authority);

  const baseAdapters = {
    platform: "darwin",
    arch: "arm64",
    transport: {
      exchange: async () => assert.fail("invalid selection cannot exchange"),
      signingKeys: async () =>
        assert.fail("invalid selection cannot fetch keys"),
    },
    credentialVault: () => ({
      read: () => assert.fail("malformed ID must be refused before Keychain"),
      write: () => assert.fail("invalid selection cannot be replaced"),
    }),
  };
  await assert.rejects(
    authorizeSubscriptionAuth(
      authDirectory,
      repository,
      authority,
      () => assert.fail("malformed ID must not open a browser"),
      "not-a-digest",
      baseAdapters,
    ),
    /Separate subscription authorization did not complete at setup/,
  );

  const registration = prepareSubscriptionAuth(
    authDirectory,
    repository,
    authority,
  );
  const malformedAccount = {
    issuer: "https://other.invalid",
    clientId: "synthetic-client",
    subject: "synthetic-subject",
    hostId: registration.hostId,
  };
  const selectedId = createHash("sha256")
    .update(
      JSON.stringify([
        malformedAccount.issuer,
        malformedAccount.clientId,
        malformedAccount.subject,
        malformedAccount.hostId,
      ]),
    )
    .digest("hex");
  const encoded = Buffer.from(JSON.stringify(malformedAccount)).toString(
    "base64",
  );
  const storedAdapters = {
    ...baseAdapters,
    credentialVault: () => ({
      read: () => encoded,
      write: () => assert.fail("mismatched identity cannot be replaced"),
    }),
  };
  await assert.rejects(
    authorizeSubscriptionAuth(
      authDirectory,
      repository,
      authority,
      () => assert.fail("mismatched identity must not open a browser"),
      selectedId,
      storedAdapters,
    ),
    /Separate subscription authorization did not complete at setup/,
  );
});

test("separate authorization closes its local listener when browser launch is refused", async (t) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "aios-auth-host-browser-refusal-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repo");
  const authority = join(root, "state");
  const authDirectory = join(root, "auth");
  mkdirSync(repository);
  mkdirSync(authority);
  const adapters = {
    platform: "darwin",
    arch: "arm64",
    transport: {
      exchange: async () => assert.fail("browser refusal cannot exchange"),
      signingKeys: async () => assert.fail("browser refusal cannot fetch keys"),
    },
    credentialVault: () => ({
      read: () => assert.fail("first authorization has no selected account"),
      write: () => assert.fail("browser refusal cannot store credentials"),
    }),
  };
  await assert.rejects(
    authorizeSubscriptionAuth(
      authDirectory,
      repository,
      authority,
      () => {
        throw Error("synthetic browser launch refusal");
      },
      undefined,
      adapters,
    ),
    /Separate subscription authorization did not complete at callback-listener/,
  );
});
