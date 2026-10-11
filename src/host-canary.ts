import { spawn } from "node:child_process";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const service = String.raw`
const http=require('node:http');
const id=process.argv[1];
const server=http.createServer((req,res)=>{
 if(req.url!='/aios-synthetic/'+id || !['GET','POST'].includes(req.method)){res.writeHead(404);res.end();req.resume();return;}
 let size=0;req.on('data',b=>{size+=b.length;if(size>4096)req.destroy();});
 req.on('end',()=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({canary:id,jsonrpc:'2.0',id:1,result:{tools:[]}}));});
});
server.on('connect',(_r,s)=>s.destroy());server.on('upgrade',(_r,s)=>s.destroy());
server.listen(0,'0.0.0.0',()=>console.log(JSON.stringify({port:server.address().port})));
setTimeout(()=>{server.closeAllConnections();server.close(()=>process.exit(0));},25000);
`;
export const hostCanaryVersion = createHash("sha256")
  .update(readFileSync(new URL(import.meta.url)))
  .digest("hex");

/** Explicit adversarial qualification fixture. A short-lived Windows listener
 * exposes only a random synthetic HTTP/MCP response. All files are newly
 * generated canaries; no real controller/peer/credential files are read. */
export async function withHostCanary<T>(
  observe: (challenge: { id: string; port: number; files: string[] }) => T,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "aios-host-positive-"));
  const id = randomUUID();
  const files = [
    "host.txt",
    "synthetic-authority.txt",
    "synthetic-peer.txt",
  ].map((name) => join(root, name));
  const content = `Synthetic private credential ${randomBytes(32).toString("hex")}\n`;
  for (const file of files)
    writeFileSync(file, content, { flag: "wx", mode: 0o600 });
  const child = spawn(process.execPath, ["-e", service, id], {
    cwd: root,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
    env: {
      SystemRoot: process.env.SystemRoot,
      PATH:
        process.platform === "win32"
          ? `${process.env.SystemRoot}\\System32`
          : "/usr/bin:/bin",
      TEMP: root,
      TMP: root,
    },
  });
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Synthetic service unavailable")),
        3000,
      );
      let output = "";
      child.on("error", () => {
        clearTimeout(timer);
        reject(Error("Synthetic service unavailable"));
      });
      child.on("exit", () => {
        clearTimeout(timer);
        reject(Error("Synthetic service unavailable"));
      });
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.length > 128) {
          clearTimeout(timer);
          reject(Error("Invalid service evidence"));
          return;
        }
        if (output.includes("\n")) {
          clearTimeout(timer);
          try {
            const data = JSON.parse(output);
            if (
              !Number.isSafeInteger(data.port) ||
              data.port < 1 ||
              data.port > 65535
            )
              throw Error();
            resolve(data.port);
          } catch {
            reject(Error("Invalid service evidence"));
          }
        }
      });
    });
    if (!files.every((file) => readFileSync(file, "utf8") === content))
      throw Error("Invalid host controls");
    const result = observe({ id, port, files });
    if (!files.every((file) => readFileSync(file, "utf8") === content))
      throw Error("Changed host controls");
    return result;
  } finally {
    child.kill();
    await closed;
    rmSync(root, { recursive: true, force: true });
  }
}
