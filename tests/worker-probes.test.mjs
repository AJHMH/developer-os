import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  boundaryProbe,
  boundaryProbeNames,
  boundaryProbeOutcomes,
} from "../dist/worker-probes.js";

const posix = {
  skip: process.platform === "win32" ? "The probe is a POSIX script" : false,
};

function run(t, { admitted = true, privateReadable = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "aios-worker-probe-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const admittedPath = join(root, "index.html");
  const privatePath = join(root, "authority.json");
  if (admitted) writeFileSync(admittedPath, "<h1>Contact</h1>\n");
  if (privateReadable) writeFileSync(privatePath, "{}\n");
  const result = spawnSync(
    "/bin/sh",
    ["-c", boundaryProbe, "--", admittedPath, privatePath],
    { encoding: "utf8", timeout: 30000, env: { PATH: process.env.PATH } },
  );
  assert.equal(result.status, 0, result.stderr);
  return Object.fromEntries(
    boundaryProbeOutcomes(result.stdout).map((p) => [p.name, p.outcome]),
  );
}

test("the probe prints exactly one verdict per probe, in order", posix, (t) => {
  const outcomes = run(t);
  assert.deepEqual(Object.keys(outcomes), [...boundaryProbeNames]);
});

test("the probe's own controls detect what they look for", posix, (t) => {
  // The admitted file is the positive control: it must be seen when present.
  assert.equal(run(t)["admitted-visible"], "passed");
  assert.equal(run(t, { admitted: false })["admitted-visible"], "failed");
  // A readable guest-private file is a failure, not a pass.
  assert.equal(run(t)["guest-private"], "passed");
  assert.equal(run(t, { privateReadable: true })["guest-private"], "failed");
});

test("a credential in the environment fails the probe", posix, (t) => {
  const root = mkdtempSync(join(tmpdir(), "aios-worker-probe-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ["SSH_AUTH_SOCK", "GITHUB_TOKEN", "OPENAI_API_KEY"]) {
    const result = spawnSync(
      "/bin/sh",
      ["-c", boundaryProbe, "--", "/nonexistent", "/nonexistent"],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH, [name]: "synthetic" },
      },
    );
    const outcomes = boundaryProbeOutcomes(result.stdout);
    assert.equal(
      outcomes.find((p) => p.name === "credential-env").outcome,
      "failed",
      name,
    );
  }
});

test("output that is not exactly the probe's verdicts is refused", () => {
  const passing = boundaryProbeNames.map((n) => `passed-${n}`);
  assert.equal(
    boundaryProbeOutcomes(passing.join("\n") + "\n").every(
      (p) => p.outcome === "passed",
    ),
    true,
  );
  for (const output of [
    "",
    passing.slice(1).join("\n"),
    [...passing, "passed-extra"].join("\n"),
    [passing[1], passing[0], ...passing.slice(2)].join("\n"),
    passing.join("\n").replace("passed-tools", "skipped-tools"),
  ])
    assert.throws(() => boundaryProbeOutcomes(output), /malformed/);
});

test("the probe fits a validation check's argument bounds", () => {
  assert.ok(boundaryProbe.length <= 2000);
  assert.equal(/[\u0000-\u001f\u007f]/.test(boundaryProbe), false);
});

test("each probe is one shell word, so no probe body can break out of it", () => {
  for (const name of boundaryProbeNames)
    assert.match(boundaryProbe, new RegExp(`; r ${name} '[^']*'(;|$)`));
});

test(
  "the worker's home may hold only Codex's own bundled skills",
  posix,
  (t) => {
    const outcomes = (layout) => {
      const home = mkdtempSync(join(tmpdir(), "aios-worker-probe-home-"));
      t.after(() => rmSync(home, { recursive: true, force: true }));
      for (const [path, text] of Object.entries(layout)) {
        mkdirSync(join(home, path, ".."), { recursive: true });
        if (text === null) mkdirSync(join(home, path), { recursive: true });
        else writeFileSync(join(home, path), text);
      }
      const result = spawnSync(
        "/bin/sh",
        ["-c", boundaryProbe, "--", "/nonexistent", "/nonexistent"],
        { encoding: "utf8", env: { PATH: process.env.PATH, HOME: home } },
      );
      return Object.fromEntries(
        boundaryProbeOutcomes(result.stdout).map((p) => [p.name, p.outcome]),
      );
    };
    const empty = outcomes({});
    assert.equal(empty["codex-skills"], "passed");
    assert.equal(empty["mcp-config"], "passed");
    assert.equal(empty["hooks-rules-agents"], "passed");
    // What Codex regenerates on every start.
    assert.equal(
      outcomes({ "skills/.system": null })["codex-skills"],
      "passed",
    );
    assert.equal(
      outcomes({ "skills/.system": null, "skills/extra": null })[
        "codex-skills"
      ],
      "failed",
    );
    assert.equal(outcomes({ "skills/owner": null })["codex-skills"], "failed");
    assert.equal(
      outcomes({ "config.toml": "[mcp_servers.x]\n" })["mcp-config"],
      "failed",
    );
    assert.equal(
      outcomes({ "config.toml": "model = 'x'\n" })["mcp-config"],
      "passed",
    );
    for (const file of [
      "hooks.json",
      "rules",
      "AGENTS.md",
      "AGENTS.override.md",
    ])
      assert.equal(
        outcomes({ [file]: "x" })["hooks-rules-agents"],
        "failed",
        file,
      );
  },
);

const { codingBoundaryProbe, codingBoundaryProbeNames } = await import(
  "../dist/worker-probes.js"
);
const codingOnly = [
  "relay-listener",
  "relay-answers",
  "read-only-binaries",
  "hardened-process",
  "writable-only-work",
];

test("the shared probe also refuses the npm registry, and stays within a check's bounds", () => {
  assert.ok(boundaryProbeNames.includes("npm-registry"));
  assert.match(boundaryProbe, /registry\.npmjs\.org/);
  // A missing TLS client must not make the denial pass for free.
  assert.doesNotMatch(boundaryProbe, /https:\/\/registry/);
  assert.ok(boundaryProbe.length <= 2000);
});

test("the coding probe is the shared probe plus the coding worker's own controls", () => {
  assert.deepEqual(codingBoundaryProbeNames, [
    ...boundaryProbeNames,
    ...codingOnly,
  ]);
  assert.equal(/[\u0000-\u001f\u007f]/.test(codingBoundaryProbe), false);
  for (const name of codingBoundaryProbeNames)
    assert.match(codingBoundaryProbe, new RegExp(`; r ${name} '[^']*'(;|$)`));
  // The mode is the guest's third argument, never caller text.
  assert.match(codingBoundaryProbe, /mode="\$\{3-\}"/);
  const passing = codingBoundaryProbeNames.map((n) => `passed-${n}`);
  assert.equal(
    boundaryProbeOutcomes(passing.join("\n"), codingBoundaryProbeNames).length,
    codingBoundaryProbeNames.length,
  );
  // The shared list alone is not a coding result.
  assert.throws(
    () =>
      boundaryProbeOutcomes(
        boundaryProbeNames.map((n) => `passed-${n}`).join("\n"),
        codingBoundaryProbeNames,
      ),
    /malformed/,
  );
});

/** Runs the coding probe with its fixed container paths moved into `root`,
 * and the relay port onto `port`: only the paths change, never the checks. */
function coding(
  t,
  mode,
  {
    tcp = "",
    tcp6 = "",
    port = 9,
    writable = true,
    binaries = 0o444,
    deniedWritable = false,
    hostsWritable = false,
    binaryMounts = "ro",
    readOnly = writable ? [] : ["workspace", "session"],
    status = "CapEff:\t0000000000000000\nNoNewPrivs:\t1\nSeccomp:\t2\n",
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "aios-coding-probe-"));
  t.after(() => {
    spawnSync("chmod", ["-R", "u+w", root]);
    rmSync(root, { recursive: true, force: true });
  });
  const header =
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n";
  writeFileSync(join(root, "tcp"), header + tcp);
  writeFileSync(join(root, "tcp6"), header + tcp6);
  for (const dir of ["workspace", "session"]) {
    mkdirSync(join(root, dir));
    if (readOnly.includes(dir)) spawnSync("chmod", ["0555", join(root, dir)]);
  }
  // The places that must refuse writes, as read-only fixtures.
  for (const dir of ["denied-a", "denied-b"]) {
    mkdirSync(join(root, dir));
    if (!deniedWritable || dir === "denied-a")
      spawnSync("chmod", ["0555", join(root, dir)]);
  }
  writeFileSync(join(root, "hosts"), "127.0.0.1 localhost\n");
  if (!hostsWritable) spawnSync("chmod", ["0444", join(root, "hosts")]);
  for (const file of ["codex", "codex-code-mode-host"]) {
    writeFileSync(join(root, file), "binary");
    spawnSync("chmod", [binaries.toString(8), join(root, file)]);
  }
  // The container's mount table and process status, as the kernel writes them.
  writeFileSync(
    join(root, "mountinfo"),
    ["codex", "codex-code-mode-host"]
      .map(
        (file, i) =>
          `${40 + i} 30 0:${50 + i} /${file} ${join(root, file)} ${binaryMounts},relatime - ext4 /dev/vda4 rw\n`,
      )
      .join(""),
  );
  writeFileSync(join(root, "status"), "Name:\tsh\n" + status);
  const script = codingBoundaryProbe
    .replaceAll("/proc/self/mountinfo", join(root, "mountinfo"))
    .replaceAll("/proc/self/status", join(root, "status"))
    .replaceAll("/proc/net/tcp6", join(root, "tcp6"))
    .replaceAll("/proc/net/tcp", join(root, "tcp"))
    .replaceAll("/codex-code-mode-host", join(root, "codex-code-mode-host"))
    .replaceAll("/codex ", join(root, "codex") + " ")
    .replaceAll("/workspace", join(root, "workspace"))
    .replaceAll("/session", join(root, "session"))
    .replaceAll("127.0.0.1:18091", `127.0.0.1:${port}`)
    .replace(
      "for p in / /etc /usr /bin /lib /root /home /opt /var /srv;",
      `for p in ${join(root, "denied-a")} ${join(root, "denied-b")};`,
    )
    .replace(
      "/etc/hosts /etc/hostname /etc/resolv.conf",
      `${join(root, "hosts")} ${join(root, "absent")}`,
    );
  const result = spawnSync(
    "/bin/sh",
    ["-c", script, "--", "/nonexistent", "/nonexistent", mode],
    { encoding: "utf8", timeout: 30000, env: { PATH: process.env.PATH } },
  );
  assert.equal(result.status, 0, result.stderr);
  const outcomes = Object.fromEntries(
    boundaryProbeOutcomes(result.stdout, codingBoundaryProbeNames).map((p) => [
      p.name,
      p.outcome,
    ]),
  );
  return { outcomes, root };
}
// Listening sockets as /proc/net/tcp shows them: 127.0.0.1:18091 is 0100007F:46AB.
const relayListener =
  "   0: 0100007F:46AB 00000000:0000 0A 00000000:00000000 00:00000000 00000000 65534 0 1 1 0000000000000000 100 0 0 10 0\n";
const otherListener =
  "   1: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000 65534 0 2 1 0000000000000000 100 0 0 10 0\n";
const connected =
  "   2: 0100007F:46AB 0100007F:D431 01 00000000:00000000 00:00000000 00000000 65534 0 3 1 0000000000000000 20 4 30 10 -1\n";

test(
  "a routed worker has exactly the relay listening, and an offline one nothing",
  posix,
  (t) => {
    assert.equal(
      coding(t, "routed", { tcp: relayListener }).outcomes["relay-listener"],
      "passed",
    );
    // An established connection to the relay is not a listener.
    assert.equal(
      coding(t, "routed", { tcp: relayListener + connected }).outcomes[
        "relay-listener"
      ],
      "passed",
    );
    for (const [tcp, tcp6] of [
      ["", ""],
      [relayListener + otherListener, ""],
      [otherListener, ""],
      [relayListener, relayListener],
    ])
      assert.equal(
        coding(t, "routed", { tcp, tcp6 }).outcomes["relay-listener"],
        "failed",
        tcp + tcp6,
      );
    assert.equal(coding(t, "offline").outcomes["relay-listener"], "passed");
    assert.equal(
      coding(t, "offline", { tcp: relayListener }).outcomes["relay-listener"],
      "failed",
    );
    assert.equal(
      coding(t, "offline", { tcp6: otherListener }).outcomes["relay-listener"],
      "failed",
    );
    // Any other mode is never a pass, whatever is listening.
    for (const mode of ["", "Routed", "none"])
      for (const tcp of ["", relayListener])
        assert.equal(
          coding(t, mode, { tcp }).outcomes["relay-listener"],
          "failed",
          `${mode} ${tcp ? "with" : "without"} the relay`,
        );
  },
);

test(
  "the binaries are read-only, and only the workspace and session take writes",
  posix,
  (t) => {
    const passing = coding(t, "offline");
    assert.equal(passing.outcomes["read-only-binaries"], "passed");
    assert.equal(passing.outcomes["writable-only-work"], "passed");
    // The write test leaves nothing behind.
    assert.deepEqual(readdirSync(join(passing.root, "workspace")), []);
    assert.deepEqual(readdirSync(join(passing.root, "session")), []);
    assert.equal(
      coding(t, "offline", { binaries: 0o644 }).outcomes["read-only-binaries"],
      "failed",
    );
    assert.equal(
      coding(t, "offline", { writable: false }).outcomes["writable-only-work"],
      "failed",
    );
    for (const dir of ["workspace", "session"])
      assert.equal(
        coding(t, "offline", { readOnly: [dir] }).outcomes[
          "writable-only-work"
        ],
        "failed",
        dir,
      );
    // A writable mount fails even when the file itself refuses writes.
    assert.equal(
      coding(t, "offline", { binaryMounts: "rw" }).outcomes[
        "read-only-binaries"
      ],
      "failed",
    );
    const denied = coding(t, "offline", { deniedWritable: true });
    assert.equal(denied.outcomes["writable-only-work"], "failed");
    // A write that unexpectedly succeeds is not left behind.
    assert.deepEqual(readdirSync(join(denied.root, "denied-b")), []);
    assert.equal(
      coding(t, "offline", { hostsWritable: true }).outcomes[
        "writable-only-work"
      ],
      "failed",
    );
  },
);

test(
  "the coding worker's process has no capabilities, no new privileges and a seccomp filter",
  posix,
  (t) => {
    assert.equal(coding(t, "offline").outcomes["hardened-process"], "passed");
    for (const status of [
      "CapEff:\t0000000000000400\nNoNewPrivs:\t1\nSeccomp:\t2\n",
      "CapEff:\t0000000000000000\nNoNewPrivs:\t0\nSeccomp:\t2\n",
      "CapEff:\t0000000000000000\nNoNewPrivs:\t1\nSeccomp:\t0\n",
      "CapEff:\t0000000000000000\nNoNewPrivs:\t1\n",
    ])
      assert.equal(
        coding(t, "offline", { status }).outcomes["hardened-process"],
        "failed",
        status,
      );
  },
);

const wget = spawnSync("/bin/sh", ["-c", "command -v wget"]).status === 0;
test(
  "a routed worker reaches the relay and gets its refusal; an offline one reaches nothing",
  {
    skip:
      process.platform === "win32" || !wget
        ? "Needs a POSIX shell and wget"
        : false,
  },
  async (t) => {
    // The servers run in their own process: the probe blocks this one.
    const serve = (status) =>
      new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "-e",
            `require("node:http").createServer((q, r) => { r.writeHead(${status}, { "Content-Length": "0", Connection: "close" }); r.end(); }).listen(0, "127.0.0.1", function () { console.log(this.address().port); });`,
          ],
          { stdio: ["ignore", "pipe", "ignore"] },
        );
        t.after(() => child.kill());
        child.on("error", reject);
        child.stdout.once("data", (bytes) => resolve(Number(String(bytes))));
      });
    const refusing = await serve(403);
    const answering = await serve(200);
    const answers = (mode, port) =>
      coding(t, mode, { port }).outcomes["relay-answers"];
    assert.equal(answers("routed", refusing), "passed");
    // Anything but the relay's refusal is not the relay.
    assert.equal(answers("routed", answering), "failed");
    assert.equal(answers("routed", 9), "failed");
    assert.equal(answers("offline", 9), "passed");
    assert.equal(answers("offline", refusing), "failed");
    assert.equal(answers("", 9), "failed");
    assert.equal(answers("", refusing), "failed");
  },
);
