import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { readSecret, secretInputLimit } from "../dist/secret-input.js";

function input({ tty }) {
  const e = new EventEmitter();
  e.isTTY = tty;
  e.modes = [];
  if (tty) e.setRawMode = (mode) => e.modes.push(mode);
  e.setEncoding = () => {};
  e.pause = () => {};
  e.resume = () => {};
  return e;
}
const sink = () => {
  const out = [];
  return { out, write: (s) => out.push(s) };
};

test("at a terminal the secret is read with echo off and ends at Enter", async () => {
  const i = input({ tty: true }),
    o = sink();
  const pending = readSecret("Key: ", i, o);
  i.emit("data", "sk-abx");
  i.emit("data", "\u007fc\r");
  assert.equal(await pending, "sk-abc");
  assert.deepEqual(i.modes, [true, false]);
  assert.deepEqual(o.out, ["Key: ", "\n"]);
});

test("Ctrl-C cancels at a terminal and restores the terminal", async () => {
  const i = input({ tty: true });
  const pending = readSecret("Key: ", i, sink());
  i.emit("data", "sk\u0003");
  await assert.rejects(pending, /Cancelled/);
  assert.deepEqual(i.modes, [true, false]);
});

test("piped input is read to its end and trimmed, with no prompt", async () => {
  const i = input({ tty: false }),
    o = sink();
  const pending = readSecret("Key: ", i, o);
  i.emit("data", "  sk-piped\n");
  i.emit("end");
  assert.equal(await pending, "sk-piped");
  assert.deepEqual(o.out, []);
});

test("empty, oversized and failed input are refused", async () => {
  const empty = input({ tty: false });
  const a = readSecret("", empty, sink());
  empty.emit("data", " \n");
  empty.emit("end");
  await assert.rejects(a, /No secret/);
  const big = input({ tty: false });
  const b = readSecret("", big, sink());
  big.emit("data", "x".repeat(secretInputLimit + 1));
  await assert.rejects(b, /too long/);
  const broken = input({ tty: false });
  const c = readSecret("", broken, sink());
  broken.emit("error", Error("EIO"));
  await assert.rejects(c, /Reading the secret failed/);
});
