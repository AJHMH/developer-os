// Read-only fixed error strings from the pinned credential-free official artifact.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { podmanMachine } from "../../dist/podman-platform.js";
const host = podmanMachine("aios-podman-noshare");
assert.equal(host.platform, "win32");
const source = `
import pathlib,hashlib,json,re
data=pathlib.Path.home().joinpath('.local/state/aios-offline-v1/codex-0.161.0').read_bytes()
assert hashlib.sha256(data).hexdigest()=='9a820c17865fa825d04db416818679a9d63bd72e50835c396f496e5684626c9c'
results=[]
for pattern in [b'failed to read thread',b'cannot read',b'not materialized',b'not persisted',b'thread is',b'thread/read']:
 for match in list(re.finditer(re.escape(pattern),data,re.IGNORECASE))[:4]:
  results.append(dict(pattern=pattern.decode(),context=data[max(0,match.start()-40):match.end()+180].decode('utf8','replace')))
print(json.dumps(results))
`;
const result = spawnSync(host.executable, ["machine", "ssh", host.config.Name, "python3"],
  { input: source, cwd: host.cwd, env: host.env, encoding: "utf8", timeout: 10000, maxBuffer: 65536, shell: false, windowsHide: true });
assert.equal(result.status, 0);
console.log(result.stdout);
