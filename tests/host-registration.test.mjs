import assert from "node:assert/strict";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  hostRegistration,
  prepareHostRegistration,
  validHostRegistration,
} from "../dist/host-registration.js";

// The owner's non-secret host registration (ADR 0006): the stored Anthropic
// account record is bound to its host ID, so preparing it again keeps it.
function roots(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-host-reg-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repository"),
    state = join(root, "state");
  mkdirSync(repository);
  mkdirSync(state);
  return { root, repository, state, auth: join(root, "auth") };
}
const refused = /ordinary external storage/;

test("a host registration is prepared once and then kept", (t) => {
  const r = roots(t);
  const first = prepareHostRegistration(r.auth, r.repository, r.state);
  assert.equal(first.status, "prepared");
  assert.equal(first.credentialsStored, false);
  assert.equal(first.deliveryEnabled, false);
  assert.match(first.hostId, /^urn:uuid:/);
  const again = prepareHostRegistration(r.auth, r.repository, r.state);
  assert.equal(again.hostId, first.hostId);
  assert.deepEqual(hostRegistration(r.auth), {
    schema: 1,
    hostId: first.hostId,
    agentName: "Developer OS",
  });
});

test("only an exact registration record is valid", () => {
  const record = {
    schema: 1,
    hostId: "urn:uuid:01234567-89ab-cdef-0123-456789abcdef",
    agentName: "Developer OS",
  };
  assert.equal(validHostRegistration(record), true);
  for (const value of [
    null,
    "registration",
    { ...record, schema: 2 },
    { ...record, hostId: "host" },
    { ...record, extra: true },
  ])
    assert.equal(validHostRegistration(value), false);
});

test("preparation refuses storage beside the repository or ledger", (t) => {
  const r = roots(t);
  for (const [directory, repository, state] of [
    ["auth", r.repository, r.state],
    [join(r.repository, "auth"), r.repository, r.state],
    [join(r.state, "auth"), r.repository, r.state],
    [r.auth, join(r.root, "missing"), r.state],
  ])
    assert.throws(
      () => prepareHostRegistration(directory, repository, state),
      refused,
    );
});

test("preparation refuses a linked directory or parent", (t) => {
  const r = roots(t);
  const target = join(r.root, "target");
  mkdirSync(target);
  symlinkSync(target, r.auth);
  assert.throws(
    () => prepareHostRegistration(r.auth, r.repository, r.state),
    refused,
  );
  assert.throws(
    () => prepareHostRegistration(join(r.auth, "inner"), r.repository, r.state),
    refused,
  );
});

test("an existing registration is kept only as one private, valid file", async (t) => {
  for (const [name, corrupt] of [
    ["invalid", (path) => writeFileSync(path, '{"schema":2}')],
    ["oversized", (path) => writeFileSync(path, " ".repeat(5000))],
    [
      "linked",
      (path, root) => {
        const other = join(root, "other.json");
        writeFileSync(other, readFileSync(path), { mode: 0o600 });
        rmSync(path);
        symlinkSync(other, path);
      },
    ],
    ["hard-linked", (path, root) => linkSync(path, join(root, "copy.json"))],
  ])
    await t.test(name, (t) => {
      const r = roots(t);
      const { registrationPath } = prepareHostRegistration(
        r.auth,
        r.repository,
        r.state,
      );
      corrupt(registrationPath, r.root);
      assert.throws(
        () => prepareHostRegistration(r.auth, r.repository, r.state),
        refused,
      );
    });
});

test("reading a registration refuses an invalid record", (t) => {
  const r = roots(t);
  const { registrationPath } = prepareHostRegistration(
    r.auth,
    r.repository,
    r.state,
  );
  writeFileSync(registrationPath, '{"schema":1}');
  assert.throws(() => hostRegistration(r.auth), /registration is invalid/);
});
