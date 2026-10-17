import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DeliveryError } from "./errors.js";
import { assertPrivateAuthStorage } from "./private-storage.js";

const source = `import Foundation
import Security
let args = CommandLine.arguments
if args.count != 3 || !["read", "add", "replace"].contains(args[1]) { exit(1) }
let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "Developer OS subscription authorization", kSecAttrAccount as String: args[2]]
if args[1] == "read" {
    var result: CFTypeRef?
    var read = query
    read[kSecReturnData as String] = true
    read[kSecMatchLimit as String] = kSecMatchLimitOne
    let status = SecItemCopyMatching(read as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else { exit(1) }
    FileHandle.standardOutput.write(data)
} else {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    if data.isEmpty || data.count > 262144 { exit(1) }
    let status: OSStatus
    if args[1] == "replace" {
        status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    } else {
        var add = query
        add[kSecValueData as String] = data
        status = SecItemAdd(add as CFDictionary, nil)
    }
    if status != errSecSuccess { exit(1) }
    var result: CFTypeRef?
    var read = query
    read[kSecReturnData as String] = true
    read[kSecMatchLimit as String] = kSecMatchLimitOne
    guard SecItemCopyMatching(read as CFDictionary, &result) == errSecSuccess, let retained = result as? Data, retained == data else { exit(1) }
}
`;
const digest = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
const fail = () =>
  new DeliveryError(
    "The protected macOS Keychain adapter is unavailable or changed; preserve existing credentials and inspect separate authentication storage before retrying.",
  );
/** Deploys an integrity-pinned, stable native Security-framework helper in the
 * already validated external host registration directory. No shell, candidate
 * script, password argument, credential file or weakened Keychain ACL is used. */
export function macKeychainStore(directory: string, readOnly = false) {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw fail();
  const binary = join(directory, "keychain-helper"),
    manifest = join(directory, "keychain-helper.json");
  const verifyDeployment = () => {
    assertPrivateAuthStorage(directory, "directory");
    assertPrivateAuthStorage(binary, "file", 16777216);
    assertPrivateAuthStorage(manifest, "file");
    const pin = JSON.parse(readFileSync(manifest, "utf8"));
    if (
      pin.source !== digest(source) ||
      pin.binary !== digest(readFileSync(binary))
    )
      throw fail();
  };
  try {
    assertPrivateAuthStorage(directory, "directory");
    if (!existsSync(binary) && !existsSync(manifest)) {
      if (readOnly) throw fail();
      const staging = mkdtempSync(join(directory, ".keychain-build-"));
      try {
        const input = join(staging, "main.swift"),
          output = join(staging, "helper");
        writeFileSync(input, source, { mode: 0o600, flag: "wx" });
        const compiled = spawnSync("/usr/bin/swiftc", [input, "-o", output], {
          encoding: "utf8",
          timeout: 60000,
          maxBuffer: 262144,
          env: { PATH: "/usr/bin:/bin" },
        });
        if (compiled.status !== 0) throw fail();
        // swiftc output is executable; remove group/other access before retention.
        chmodSync(output, 0o700);
        const pin = {
          source: digest(source),
          binary: digest(readFileSync(output)),
        };
        // Refuse partially retained deployment on later calls; never overwrite it.
        if (existsSync(binary) || existsSync(manifest)) throw fail();
        linkSync(output, binary);
        writeFileSync(manifest, JSON.stringify(pin) + "\n", {
          mode: 0o600,
          flag: "wx",
          flush: true,
        });
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
    }
    verifyDeployment();
  } catch {
    throw fail();
  }
  const invoke = (
    action: "read" | "add" | "replace",
    account: string,
    value?: string,
  ) => {
    if (!/^[a-f0-9]{64}$/.test(account)) throw fail();
    try {
      verifyDeployment();
    } catch {
      throw fail();
    }
    const result = spawnSync(binary, [action, account], {
      ...(value === undefined ? {} : { input: value }),
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 262144,
      env: { PATH: "/usr/bin:/bin" },
    });
    if (result.status !== 0) throw fail();
    return result.stdout;
  };
  return {
    read: (account: string) => invoke("read", account),
    write: (account: string, value: string, replace: boolean) => {
      if (readOnly) throw fail();
      invoke(replace ? "replace" : "add", account, value);
    },
  };
}
