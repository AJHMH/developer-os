// Browser E2E checks in the validation guest (#265): they run in the
// owner-admitted Playwright image, with a browser check's limits and the
// Playwright browsers path, and nothing else changes. The real management
// program runs in the local guest simulator, whose host mocks stay in this
// file. The name sorts after every other test file, so no other file changes
// shard.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  image,
  runRequest,
  validationGuest,
} from "./helpers/native-validation-fixture.mjs";

const browser = "6".repeat(64);
const database = "5".repeat(64);
const guestWith = (t, images, engine = {}) =>
  validationGuest(t, engine, { ...images, deadlineGraceMs: 0 });
const created = (guest) =>
  guest
    .commands("podman", "create")
    .map((c) => ({ name: c[c.indexOf("--name") + 1], args: c }));
const value = (args, flag) =>
  args.find((a) => a.startsWith(flag + "="))?.slice(flag.length + 1);
const envs = (args) =>
  args.map((a, i) => (a === "--env" ? args[i + 1] : null)).filter(Boolean);

test("a browser E2E check runs in the browser image with room for Chromium", async (t) => {
  const guest = guestWith(t, { browserImageSha256: browser });
  const request = runRequest(
    { browser: true },
    { id: "e2e", command: ["browser"] },
  );
  const result = await guest.transport.run(request);
  assert.equal(result.exitCode, 0, "the browser image and its path were set");
  assert.equal(result.browser, true);
  assert.equal(result.pins.browserImageSha256, browser);
  const [check] = created(guest);
  assert.ok(check.args.includes(browser));
  assert.ok(!check.args.includes(image));
  assert.equal(value(check.args, "--pids-limit"), "1024");
  assert.equal(value(check.args, "--memory"), "2048m");
  assert.equal(value(check.args, "--shm-size"), "256m");
  assert.match(value(check.args, "--tmpfs"), /size=536870912$/);
  // Every other control stays: offline, read-only, no capabilities.
  assert.equal(value(check.args, "--network"), "none");
  assert.ok(check.args.includes("--read-only"));
  assert.ok(check.args.includes("--cap-drop=ALL"));
  assert.ok(check.args.includes("--image-volume=ignore"));
  assert.ok(
    envs(check.args).includes("PLAYWRIGHT_BROWSERS_PATH=/ms-playwright"),
  );
  assert.equal(
    (await guest.transport.stop(request)).treeSha256,
    request.treeSha256,
  );
});

test("other checks keep the check image and its limits", async (t) => {
  const guest = guestWith(t, { browserImageSha256: browser });
  const result = await guest.transport.run(
    runRequest({}, { id: "lint", command: ["browser"] }),
  );
  assert.equal(result.exitCode, 1, "not in the browser image");
  assert.equal(result.browser, undefined);
  const [check] = created(guest);
  assert.ok(check.args.includes(image));
  assert.equal(value(check.args, "--pids-limit"), "256");
  assert.equal(value(check.args, "--memory"), "1024m");
  assert.equal(value(check.args, "--shm-size"), undefined);
  assert.ok(!envs(check.args).some((e) => e.startsWith("PLAYWRIGHT_")));
});

test("a browser E2E check can also have its own database", async (t) => {
  const guest = guestWith(t, {
    browserImageSha256: browser,
    databaseImageSha256: database,
  });
  const request = runRequest(
    { browser: true, database: true },
    { id: "e2e", command: ["database"] },
  );
  const result = await guest.transport.run(request);
  assert.equal(result.exitCode, 0);
  assert.equal(result.database, "ready");
  assert.equal(result.browser, true);
  const [db, check] = created(guest);
  assert.ok(db.args.includes(database));
  assert.ok(check.args.includes(browser));
  assert.match(value(check.args, "--network"), /^container:/);
  await guest.transport.stop(request);
  assert.deepEqual(Object.keys(guest.read().containers), []);
});

test("a browser check whose database is unready still reports its browser", async (t) => {
  const guest = guestWith(
    t,
    { browserImageSha256: browser, databaseImageSha256: database },
    { databaseExits: true },
  );
  const request = runRequest({ browser: true, database: true }, { id: "e2e" });
  const result = await guest.transport.run(request);
  assert.equal(result.database, "unready");
  assert.equal(result.browser, true);
  await guest.transport.stop(request);
});

test("a transport admits a browser image only when it is loaded, for the guest's architecture", async (t) => {
  const plain = validationGuest(t);
  const withBrowser = guestWith(t, { browserImageSha256: browser });
  const [a, b] = [
    await plain.transport.inspect(),
    await withBrowser.transport.inspect(),
  ];
  assert.equal(b.browserImageSha256, browser);
  assert.notEqual(a.bindingSha256, b.bindingSha256);
  for (const engine of [
    { browserImageMissing: true },
    { browserArch: "amd64" },
  ])
    await assert.rejects(
      guestWith(t, { browserImageSha256: browser }, engine).transport.inspect(),
      /observation unavailable/,
    );
  await assert.rejects(
    plain.transport.run(runRequest({ browser: true })),
    /Unsupported native validation request/,
  );
  assert.throws(
    () => validationGuest(t, {}, { browserImageSha256: "short" }).transport,
    /Invalid native validation authority/,
  );
});

test("a browser check whose limits drift is refused", async (t) => {
  const guest = guestWith(
    t,
    { browserImageSha256: browser },
    { inspectDrift: { ShmSize: 67108864 } },
  );
  const request = runRequest({ browser: true }, { id: "e2e" });
  await assert.rejects(
    guest.transport.run(request),
    /Native validation start observation unavailable/,
  );
  await guest.transport.stop(request);
  assert.deepEqual(Object.keys(guest.read().containers), []);
});

test("a check container carries only its image's own labels and ours", async (t) => {
  // Its image's label is inherited, and ours replace one of the same name.
  const inherited = guestWith(
    t,
    { browserImageSha256: browser },
    {
      browserLabels: {
        "org.opencontainers.image.version": "24.04",
        "aios.validation.attempt": "from-the-image",
      },
    },
  );
  const request = runRequest({ browser: true }, { id: "e2e" });
  assert.equal((await inherited.transport.run(request)).browser, true);
  await inherited.transport.stop(request);
  // A label from anywhere else is not ours to trust.
  const foreign = guestWith(
    t,
    { browserImageSha256: browser },
    { labelDrift: { "io.example.other": "1" } },
  );
  await assert.rejects(
    foreign.transport.run(request),
    /Native validation start observation unavailable/,
  );
});
