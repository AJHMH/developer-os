// Native validation transport fixture: the real management program runs in a
// local Linux/Podman simulator. No real VM, image or credentials are used.
import { createHash } from "node:crypto";
import { NativePodmanValidationTransport } from "../../dist/podman-validation.js";
import {
  nativeHost,
  realMkdtempSync,
  realReadFileSync,
  realRmSync,
  realSpawnSync,
  realTemporaryDirectory,
  realWriteFileSync,
} from "./native-coding-fixture.mjs";

export const image = "7".repeat(64);
const guest = new URL("./native-validation-guest.py", import.meta.url);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function validationGuest(t, engine = {}) {
  const root = realMkdtempSync(
    `${realTemporaryDirectory}/aios-native-validation-`,
  );
  t.after(() => realRmSync(root, { recursive: true, force: true }));
  const statePath = `${root}/engine.json`;
  realWriteFileSync(statePath, JSON.stringify(engine));
  const host = nativeHost(t, (_request, program) => {
    const result = realSpawnSync(
      process.env.AIOS_TEST_PYTHON || "python3",
      // The guest runs `python3 -I`; -S also skips the site module, which the
      // stdlib-only program never needs, to save start-up time per request.
      ["-I", "-S", guest.pathname, root],
      { input: program, encoding: "utf8" },
    );
    return result.status === 0
      ? JSON.parse(result.stdout)
      : { processFailure: true };
  });
  const read = () => JSON.parse(realReadFileSync(statePath, "utf8"));
  return {
    root,
    requests: host.requests,
    machineConfig: host.machineConfig,
    transport: new NativePodmanValidationTransport(
      "aios-test",
      "a".repeat(64),
      image,
      {
        pollMs: 1,
      },
    ),
    read,
    write: (changes) =>
      realWriteFileSync(statePath, JSON.stringify({ ...read(), ...changes })),
    /** Engine commands of one kind, e.g. "podman create". */
    commands: (name, sub) =>
      read().commands.filter((c) => c[0] === name && (!sub || c[1] === sub)),
  };
}

/** One attempt's files and the baseline-style tree digest over them. */
export function attemptFiles(entries = { "index.html": "<h1>Contact</h1>\n" }) {
  const files = Object.entries(entries).map(([path, text]) => ({
    path,
    bytes: Buffer.from(text),
    executable: false,
  }));
  const treeSha256 = sha(
    JSON.stringify(
      files.map((f) => ({
        path: f.path,
        sha256: sha(f.bytes),
        executable: f.executable,
      })),
    ),
  );
  return { files, treeSha256 };
}

let counter = 0;
export function runRequest(overrides = {}, check = {}) {
  const { files, treeSha256 } = attemptFiles();
  counter++;
  return {
    operationId: `12345678-1234-4234-8234-${String(counter).padStart(12, "0")}`,
    fence: 1,
    treeSha256,
    files,
    check: { id: "format", command: ["true"], timeoutMs: 1000, ...check },
    mayDispatch: () => true,
    ...overrides,
  };
}
