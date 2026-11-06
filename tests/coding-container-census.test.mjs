import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { test } from "node:test";
import { testPython } from "./helpers/python.mjs";

const posix = {
  skip: process.platform === "win32" ? "Needs a POSIX fake podman" : false,
};
const pins = { policySha256: "a".repeat(64), bindingSha256: "b".repeat(64) };

// The census against a fake engine and guest state, fed on stdin as the owner runs it.
function census(t, containers, records) {
  const home = fs.mkdtempSync(`${os.tmpdir()}/aios-census-`);
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const state = `${home}/.local/state/aios-coding-v1`;
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(`${home}/bin`);
  for (const [name, record] of Object.entries(records))
    fs.writeFileSync(`${state}/${name}.json`, JSON.stringify(record));
  fs.writeFileSync(
    `${home}/bin/podman`,
    `#!/bin/sh\necho "$*" >> "${home}/calls"\ncat "${home}/listing.json"\n`,
    { mode: 0o700 },
  );
  fs.writeFileSync(`${home}/listing.json`, JSON.stringify(containers));
  const before = fs.readdirSync(state).sort();
  const result = spawnSync(testPython, ["-I", "-"], {
    input: fs.readFileSync("scripts/coding-container-census.py"),
    env: { HOME: home, PATH: `${home}/bin:${process.env.PATH}` },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readdirSync(state).sort(), before, "it writes no state");
  return {
    lines: result.stdout.trim().split("\n"),
    calls: fs.readFileSync(`${home}/calls`, "utf8").trim().split("\n"),
  };
}
const exited = (...names) =>
  names.map((name) => ({ Names: [`aios-coding-${name}`], State: "exited" }));

test("the census counts each kind of session", posix, (t) => {
  const stopped = { phase: "stopped", admission: {}, pins };
  const resume = { ...stopped, admission: { resumeFrom: {} } };
  const { lines, calls } = census(
    t,
    exited(
      "head",
      "head2",
      "reserved",
      "recovered",
      "nothread",
      "stranded",
      "old",
      "gone",
      "swept",
      "retired",
    ),
    {
      "aios-coding-head": { ...stopped, threadId: "t" },
      "aios-coding-head2": { ...stopped, threadId: "t" },
      "aios-coding-reserved": { ...resume, threadId: "t", resumedBy: "x" },
      "aios-coding-recovered": { ...resume, recovered: true },
      "aios-coding-nothread": stopped,
      "aios-coding-stranded": resume,
      "aios-coding-old": { phase: "stopped" },
      "aios-coding-swept": { ...stopped, cleaned: true },
      "aios-coding-retired": { ...resume, reconciled: "retired" },
    },
  );
  const row = (count, kind, phase, policy, binding) =>
    [count, "exited", kind, phase, policy, binding].join(" | ");
  const [a, b] = ["aaaaaaaa", "bbbbbbbb"];
  assert.equal(lines[0], "containers 10");
  assert.equal(lines[1], "count state kind phase policy binding");
  assert.equal(lines[2], row(2, "head with thread", "stopped", a, b));
  assert.deepEqual(
    lines.slice(3).sort(),
    [
      row(1, "recovered", "stopped", a, b),
      row(1, "reserved predecessor", "stopped", a, b),
      row(1, "start without thread", "stopped", a, b),
      row(1, "resume without thread", "stopped", a, b),
      row(1, "no admission", "stopped", "none", "none"),
      row(1, "no record", "-", "-", "-"),
      row(1, "cleaned", "stopped", a, b),
      row(1, "reconciled:retired", "stopped", a, b),
    ].sort(),
  );
  assert.deepEqual(calls, ["ps -a --filter name=aios-coding- --format json"]);
});

test("the census reports an empty VM", posix, (t) => {
  assert.deepEqual(census(t, [], {}).lines.slice(0, 1), ["containers 0"]);
});
