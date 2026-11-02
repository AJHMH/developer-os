// How long the usage reader waits for its app-server to exit. The name sorts
// after every other test file, so no other file changes shard.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { observeCodexAccount, stopGraceMs } from "../dist/codex-app-server.js";

const node = realpathSync(process.execPath);
const pin = createHash("sha256").update(readFileSync(node)).digest("hex");
// A fake app-server that answers the reads, then exits `exitMs` after it is
// asked to stop, or never when `exitMs` is null. Windows cannot defer a kill.
function fakeCodex(t, exitMs) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-codex-stop-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, "app-server.mjs");
  writeFileSync(
    script,
    `import readline from 'node:readline';
const exitMs=${JSON.stringify(exitMs)};
process.on('SIGTERM',()=>{if(exitMs!==null)setTimeout(()=>process.exit(0),exitMs);});
setInterval(()=>{},1000);
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
for await(const line of readline.createInterface({input:process.stdin})){
 const value=JSON.parse(line);
 if(value.method==='initialize')send({id:1,result:{}});
 else if(value.method==='account/read')send({id:2,result:{account:{type:'chatgpt',email:'synthetic@example.invalid'},requiresOpenaiAuth:true}});
 else if(value.method==='account/rateLimits/read')send({id:3,result:{rateLimits:{limitId:'codex',primary:{usedPercent:10,resetsAt:2000000000}}}});
}
`,
  );
  return { path: node, sha256: pin, argumentsPrefix: [script] };
}
const windows = process.platform === "win32" && "a kill cannot be deferred";

test(
  "a completed read survives an app-server that takes a second to exit",
  { skip: windows },
  async (t) => {
    // The pinned Windows codex has taken longer than 250 ms to exit.
    assert.ok(stopGraceMs >= 2000);
    const observed = await observeCodexAccount(
      fakeCodex(t, 1000),
      { policy: "owner" },
      true,
    );
    assert.equal(observed.refusal, undefined);
    assert.equal(
      observed.session.rateLimits.rateLimits.primary.usedPercent,
      10,
    );
  },
);

test(
  "an app-server that never exits is still killed and refused with stop",
  { skip: windows },
  async (t) => {
    const started = Date.now();
    const observed = await observeCodexAccount(
      fakeCodex(t, null),
      { policy: "owner" },
      true,
    );
    assert.equal(observed.refusal, "stop");
    assert.ok(Date.now() - started < stopGraceMs + 4000);
  },
);
