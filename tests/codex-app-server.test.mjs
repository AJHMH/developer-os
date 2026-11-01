import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  maxExecutableBytes,
  readCodexAccount,
} from "../dist/codex-app-server.js";

const node = realpathSync(process.execPath);
const pin = createHash("sha256").update(readFileSync(node)).digest("hex");
function fixture(t, mode = "valid") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-codex-session-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "empty");
  mkdirSync(home);
  const script = join(root, "app-server.mjs");
  writeFileSync(
    script,
    `import readline from 'node:readline';
const mode=process.argv[2];
if(process.argv.includes('--version')){console.log('codex-cli 0.161.0');process.exit(0);}
const isolated=process.argv.some(arg=>arg.includes('aios_capability'));
if(isolated && !(process.env.CODEX_HOME===process.env.HOME && process.env.HOME===process.env.USERPROFILE && process.cwd()===process.env.HOME))process.exit(19);
const send=value=>{const text=JSON.stringify(value)+'\\n';process.stdout.write(text.slice(0,3));process.stdout.write(text.slice(3));};
for await(const line of readline.createInterface({input:process.stdin})){
 const value=JSON.parse(line);
 if(mode==='hung')continue;
 if(mode==='malformed'){console.log('invalid');continue;}
 if(mode==='oversized'){process.stdout.write('x'.repeat(256*1024+1));continue;}
 if(value.method==='initialize')send({id:1,result:{}});
 else if(value.method==='initialized')continue;
 else if(value.method==='account/read'){
  if(value.params.refreshToken!==false)process.exit(20);
  send({id:2,result:{account:isolated?null:{type:'chatgpt',email:'synthetic@example.invalid'},requiresOpenaiAuth:!isolated}});
 }else if(value.method==='account/rateLimits/read')send({id:3,result:{rateLimits:{limitId:'codex',primary:{usedPercent:10,resetsAt:2000000000}}}});
 else process.exit(21);
}
`,
  );
  return {
    home,
    executable: { path: node, sha256: pin, argumentsPrefix: [script, mode] },
  };
}

test("one pinned fake app-server supports owner usage and an isolated credential-free capability read", async (t) => {
  const f = fixture(t);
  const owner = await readCodexAccount(f.executable, { policy: "owner" }, true);
  assert.equal(owner.account.email, "synthetic@example.invalid");
  assert.equal(owner.rateLimits.rateLimits.primary.usedPercent, 10);
  const isolated = await readCodexAccount(f.executable, {
    policy: "isolated",
    home: f.home,
  });
  assert.equal(isolated.account, null);
  assert.equal(isolated.requiresOpenaiAuth, false);
});

test("changed pins, malformed/oversized output and stalled handshakes return no account", async (t) => {
  const mismatch = fixture(t);
  assert.equal(
    await readCodexAccount(
      { ...mismatch.executable, sha256: "0".repeat(64) },
      { policy: "owner" },
    ),
    undefined,
  );
  for (const mode of ["malformed", "oversized", "hung"]) {
    const f = fixture(t, mode);
    assert.equal(
      await readCodexAccount(f.executable, { policy: "owner" }, true),
      undefined,
    );
  }
});

test("caller mutation cannot change the executable pin selected for an active session", async (t) => {
  const f = fixture(t),
    pending = readCodexAccount(f.executable, { policy: "owner" }, true);
  f.executable.sha256 = "0".repeat(64);
  f.executable.argumentsPrefix.length = 0;
  assert.equal((await pending).account.type, "chatgpt");
});

test("the executable bound admits the pinned Windows codex and refuses anything larger before hashing it", async (t) => {
  // The pinned native Windows codex 0.161.0 is 317 MiB.
  assert.ok(maxExecutableBytes > 317 * 1024 * 1024);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-codex-size-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "codex");
  writeFileSync(path, "");
  truncateSync(path, maxExecutableBytes + 1);
  const started = Date.now();
  assert.equal(
    await readCodexAccount(
      { path, sha256: "0".repeat(64) },
      { policy: "owner" },
      true,
    ),
    undefined,
  );
  // Refused on its size alone: hashing it would read every byte first.
  assert.ok(Date.now() - started < 1000);
});
