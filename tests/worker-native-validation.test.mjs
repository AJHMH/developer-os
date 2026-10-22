import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, statSync } from "node:fs";
import { NativePodmanValidationTransport } from "../dist/podman-validation.js";
import {
  posixGuest,
  realReadFileSync,
} from "./helpers/native-coding-fixture.mjs";
import {
  attemptFiles,
  image,
  runRequest,
  validationGuest,
} from "./helpers/native-validation-fixture.mjs";

const stateRoot = (root) => `${root}/.local/state/aios-validation-v1`;
// The host fixture mocks some fs calls; these read the real guest state.
const workspaces = (root) => {
  try {
    return readdirSync(stateRoot(root)).filter((n) => !n.includes("."));
  } catch {
    return [];
  }
};
const present = (path) => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
};

test("the native validation transport stays outside production", () => {
  const transport = new NativePodmanValidationTransport(
    "aios-test",
    "a".repeat(64),
    image,
  );
  assert.equal(transport.mode, "live");
  assert.equal(transport.productionEnabled, false);
  assert.throws(() => {
    transport.mode = "controlled";
  }, TypeError);
  for (const args of [
    ["shared", "a".repeat(64), image],
    ["aios-test", "short", image],
    ["aios-test", "a".repeat(64), "IMAGE"],
  ])
    assert.throws(
      () => new NativePodmanValidationTransport(...args),
      /Invalid native validation authority/,
    );
});

test(
  "inspection binds the owner-loaded image, the VM and the management program",
  posixGuest,
  async (t) => {
    const g = validationGuest(t);
    const first = await g.transport.inspect();
    assert.equal(first.imageSha256, image);
    assert.match(first.policySha256, /^[a-f0-9]{64}$/);
    assert.match(first.bindingSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(await g.transport.inspect(), first);
    assert.equal(g.requests[0].action, "inspect");
    assert.equal(g.requests[0].imageSha256, image);
    // The image is measured by its own ID, never resolved by a tag.
    assert.deepEqual(g.commands("podman", "image").at(-1).slice(1), [
      "image",
      "inspect",
      image,
    ]);
  },
);

for (const [name, engine] of [
  ["a missing image", { imageMissing: true }],
  ["an engine answering for another image", { imageIdDrift: true }],
  [
    "an image of another architecture",
    { image: { Id: "7".repeat(64), Architecture: "amd64" } },
  ],
  ["a running container outside the attempt", { foreignRunning: true }],
])
  test(`inspection refuses ${name}`, posixGuest, async (t) => {
    const g = validationGuest(t, engine);
    await assert.rejects(g.transport.inspect());
  });

test(
  "a check runs in a fresh offline container over exactly the transferred tree",
  posixGuest,
  async (t) => {
    const g = validationGuest(t);
    const request = runRequest();
    const result = await g.transport.run(request);
    assert.deepEqual(
      { ...result, pins: undefined },
      {
        operationId: request.operationId,
        fence: 1,
        checkId: "format",
        exitCode: 0,
        timedOut: false,
        pins: undefined,
      },
    );
    assert.deepEqual(result.pins, await g.transport.inspect());
    const create = g.commands("podman", "create").at(-1);
    for (const flag of [
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--user=65534:65534",
      "--pull=never",
      "--entrypoint=/bin/sh",
      "--unsetenv-all",
    ])
      assert.ok(create.includes(flag), flag);
    // The image by ID, then the argv as inert data after `exec "$@"`.
    const at = create.indexOf(image);
    assert.deepEqual(create.slice(at), [
      image,
      "-c",
      'exec "$@"',
      "--",
      "true",
    ]);
    // Exactly one bind mount: the attempt's workspace.
    assert.equal(create.filter((a) => a === "--volume").length, 1);
    // A guest deadline timer bounds the check at its timeout.
    const timer = g.commands("systemd-run").at(-1);
    assert.ok(timer.includes("--on-active=1.0s"));
    assert.deepEqual(timer.slice(-4), [
      "kill",
      "--signal",
      "KILL",
      create[create.indexOf("--name") + 1],
    ]);
    // The pristine input holds the transferred file, privately, and is
    // never mounted; the check's own copy is measured and removed.
    const [operation] = workspaces(g.root);
    const file = `${stateRoot(g.root)}/${operation}/input/index.html`;
    assert.equal(realReadFileSync(file, "utf8"), "<h1>Contact</h1>\n");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.ok(!create.some((a) => a.includes("/input:")));
    assert.ok(!present(`${stateRoot(g.root)}/${operation}/check-0`));
    // The finished check container is removed.
    assert.deepEqual(g.read().containers, {});
  },
);

test(
  "each check starts from exactly the transferred tree, which is never replaced",
  posixGuest,
  async (t) => {
    const g = validationGuest(t);
    const request = runRequest({}, { command: ["write", "notes.txt", "x"] });
    await g.transport.run(request);
    // The first check's write is not visible to the next check.
    const second = await g.transport.run({
      ...request,
      check: { id: "lint", command: ["absent", "notes.txt"], timeoutMs: 1000 },
    });
    assert.equal(second.exitCode, 0);
    // And every later check still gets the transferred files.
    const third = await g.transport.run({
      ...request,
      check: {
        id: "type",
        command: ["present", "index.html"],
        timeoutMs: 1000,
      },
    });
    assert.equal(third.exitCode, 0);
    // Another tree for the same attempt is refused before any check.
    const other = attemptFiles({ "index.html": "<h1>Other</h1>\n" });
    await assert.rejects(
      g.transport.run({
        ...request,
        ...other,
        check: { id: "coverage", command: ["true"], timeoutMs: 1000 },
      }),
    );
    // The prepare step itself refuses; nothing reaches start.
    assert.equal(g.requests.at(-1).action, "prepare");
    assert.equal(g.commands("podman", "create").length, 3);
    // A later clean check never hides the earlier change at stop.
    const stopped = await g.transport.stop(request);
    assert.notEqual(stopped.treeSha256, request.treeSha256);
  },
);

test(
  "only the guest deadline's own kill is a timeout",
  posixGuest,
  async (t) => {
    const g = validationGuest(t);
    const natural = await g.transport.run(
      runRequest({}, { command: ["exit", "137"] }),
    );
    assert.equal(natural.exitCode, 137);
    assert.equal(natural.timedOut, false);
  },
);

for (const [name, command, engine] of [
  ["an unreadable workspace", ["lock", "."], {}],
  ["folders nested past the path limit", ["deep", "2100"], {}],
  ["a full disk at its first write", ["true"], { diskFullOnce: true }],
])
  test(`a check cannot wedge stop with ${name}`, posixGuest, async (t) => {
    const g = validationGuest(t, engine);
    const request = runRequest({}, { command });
    // Stop interrupts the check, so it still owns its workspace.
    let permits = 0;
    await g.transport
      .run({ ...request, mayDispatch: () => ++permits <= 2 })
      .catch(() => {});
    const stopped = await g.transport.stop(request);
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.remainingProcesses, 0);
    assert.deepEqual(workspaces(g.root), []);
  });

test(
  "a nonzero exit is reported and a guest deadline is a timeout",
  posixGuest,
  async (t) => {
    const g = validationGuest(t);
    assert.equal(
      (await g.transport.run(runRequest({}, { command: ["exit", "3"] })))
        .exitCode,
      3,
    );
    // The guest clock passes the deadline while the check hangs.
    g.write({ expireAfterStart: 5 });
    const hung = await g.transport.run(runRequest({}, { command: ["hang"] }));
    assert.equal(hung.exitCode, 137);
    assert.equal(hung.timedOut, true);
  },
);

test(
  "files that do not hash to the declared manifest are never materialized",
  posixGuest,
  async (t) => {
    const g = validationGuest(t, { transferredInputDrift: true });
    await assert.rejects(g.transport.run(runRequest()));
    assert.deepEqual(workspaces(g.root), []);
    assert.equal(g.commands("podman", "create").length, 0);
  },
);

test(
  "an engine that ignores an isolation flag refuses before the check starts",
  posixGuest,
  async (t) => {
    for (const drift of [
      { NetworkMode: "bridge" },
      { ReadonlyRootfs: false },
      { PidsLimit: 0 },
      { CapAdd: ["NET_RAW"] },
    ]) {
      const g = validationGuest(t, { inspectDrift: drift });
      await assert.rejects(g.transport.run(runRequest()));
      assert.equal(
        g.commands("podman", "start").length,
        0,
        JSON.stringify(drift),
      );
    }
  },
);

test(
  "revoked authority stops dispatch before prepare, start or the next poll",
  posixGuest,
  async (t) => {
    const g = validationGuest(t);
    await assert.rejects(
      g.transport.run(runRequest({ mayDispatch: () => false })),
      /Native validation authority changed/,
    );
    assert.equal(g.commands("podman", "create").length, 0);
    // Revoked after start: polling stops, the check is left for stop to end.
    let permits = 0;
    const request = runRequest(
      { mayDispatch: () => ++permits <= 2 },
      { command: ["hang"] },
    );
    await assert.rejects(
      g.transport.run(request),
      /Native validation authority changed/,
    );
    const stopped = await g.transport.stop(request);
    assert.equal(stopped.remainingProcesses, 0);
    assert.equal(stopped.treeSha256, request.treeSha256);
    assert.deepEqual(g.read().containers, {});
    assert.equal(g.commands("podman", "kill").length, 1);
  },
);

test(
  "stop measures an unchanged tree as the tested tree and removes the workspace",
  posixGuest,
  async (t) => {
    const g = validationGuest(t);
    const request = runRequest();
    await g.transport.run(request);
    const stopped = await g.transport.stop(request);
    assert.deepEqual(stopped, {
      operationId: request.operationId,
      fence: 1,
      stopped: true,
      remainingProcesses: 0,
      treeSha256: request.treeSha256,
    });
    assert.deepEqual(workspaces(g.root), []);
    // Stop is idempotent; a stopped attempt never prepares again.
    assert.deepEqual(await g.transport.stop(request), stopped);
    await assert.rejects(g.transport.run(request));
  },
);

for (const [name, command] of [
  ["a new file", ["write", "coverage/report.txt", "1"]],
  ["changed bytes", ["write", "index.html", "<h1>Changed</h1>"]],
  ["an executable bit", ["chmod", "index.html"]],
  ["a symbolic link", ["link", "escape"]],
])
  test(
    `stop reports ${name} as a different tree, never a failure`,
    posixGuest,
    async (t) => {
      const g = validationGuest(t);
      const request = runRequest({}, { command });
      assert.equal((await g.transport.run(request)).exitCode, 0);
      const stopped = await g.transport.stop(request);
      assert.equal(stopped.stopped, true);
      assert.match(stopped.treeSha256, /^[a-f0-9]{64}$/);
      assert.notEqual(stopped.treeSha256, request.treeSha256);
      assert.deepEqual(workspaces(g.root), []);
    },
  );

test(
  "stop before any check fences the attempt against a late prepare",
  posixGuest,
  async (t) => {
    const g = validationGuest(t);
    const request = runRequest();
    const stopped = await g.transport.stop(request);
    assert.equal(stopped.stopped, true);
    assert.notEqual(stopped.treeSha256, request.treeSha256);
    await assert.rejects(g.transport.run(request));
    assert.equal(g.commands("podman", "create").length, 0);
  },
);

test(
  "malformed requests refuse before any VM effect",
  posixGuest,
  async (t) => {
    const g = validationGuest(t);
    for (const [overrides, check] of [
      [{ operationId: "nope" }, {}],
      [{ fence: 0 }, {}],
      [{ treeSha256: "short" }, {}],
      [
        {
          files: [
            { path: "../escape", bytes: Buffer.from("x"), executable: false },
          ],
        },
        {},
      ],
      [
        {
          files: [
            { path: "big", bytes: Buffer.alloc(262145), executable: false },
          ],
        },
        {},
      ],
      [{}, { timeoutMs: 0 }],
      [{}, { timeoutMs: 120001 }],
    ])
      await assert.rejects(
        g.transport.run(runRequest(overrides, check)),
        /Unsupported native validation request/,
      );
    await assert.rejects(
      g.transport.stop({ operationId: "nope", fence: 1 }),
      /Invalid native validation attempt/,
    );
    assert.equal(g.requests.length, 0);
  },
);

test(
  "an argv carrying control characters is refused on the host and in the guest",
  posixGuest,
  async (t) => {
    const g = validationGuest(t);
    await assert.rejects(
      g.transport.run(runRequest({}, { command: ["sh", "-c", "true\nfalse"] })),
      /Unsupported native validation request/,
    );
    assert.equal(g.requests.length, 0);
    // Bypass the host's bounds: the guest's start step refuses on its own.
    const request = runRequest();
    await g.transport.run(request);
    const attempt = { operationId: request.operationId, fence: 1 };
    const { result } = await g.transport["invoke"]("inspect", attempt);
    await assert.rejects(
      g.transport["invoke"]("start", attempt, {
        expectedBinding: result.binding,
        treeSha256: request.treeSha256,
        check: {
          id: "lint",
          command: ["sh", "-c", "true\nfalse"],
          timeoutMs: 1000,
        },
      }),
    );
    assert.equal(g.commands("podman", "create").length, 1);
  },
);

for (const [name, engine] of [
  ["a refused", { timerRefused: true }],
  ["an unarmed", { timerInactive: true }],
])
  test(
    `a check never starts with ${name} guest deadline, and stop still cleans up`,
    posixGuest,
    async (t) => {
      const g = validationGuest(t, engine);
      const request = runRequest();
      await assert.rejects(g.transport.run(request));
      assert.equal(g.commands("podman", "start").length, 0);
      const stopped = await g.transport.stop(request);
      assert.equal(stopped.remainingProcesses, 0);
      assert.deepEqual(g.read().containers, {});
      assert.deepEqual(workspaces(g.root), []);
    },
  );

test(
  "the guest's start step refuses a tree other than the prepared one",
  posixGuest,
  async (t) => {
    const g = validationGuest(t);
    const request = runRequest();
    await g.transport.run(request);
    // Bypass the host's prepare step: start alone must still bind the tree.
    const attempt = { operationId: request.operationId, fence: 1 };
    const { result } = await g.transport["invoke"]("inspect", attempt);
    await assert.rejects(
      g.transport["invoke"]("start", attempt, {
        expectedBinding: result.binding,
        treeSha256: "f".repeat(64),
        check: { id: "lint", command: ["true"], timeoutMs: 1000 },
      }),
    );
    assert.equal(g.commands("podman", "create").length, 1);
  },
);
