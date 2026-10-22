#!/usr/bin/env node
// Diagnostic wrapper for the owner coding admission acceptance (Issue 04).
// Runs the unchanged acceptance from the repository and logs what the
// controller swallows: each transport call's name, timing and error message,
// plus the type of each streamed event. Never logs guest output, prompts,
// files or credentials. Not acceptance evidence. The 21 October Mac run used a
// copy outside the repository that resolved the checkout from the home folder
// (SHA-256 7cdc7325…44f29); this copy resolves it from its own location.
import { appendFileSync, closeSync, openSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const load = (rel) => import(pathToFileURL(join(repo, rel)).href);
const sha256 = (v) => createHash("sha256").update(v).digest("hex");

const [machine, admissionPath, logPath, approval] = process.argv.slice(2);
if (!/^aios-[a-z0-9-]+$/.test(machine ?? "") || !admissionPath || !logPath ||
    approval !== "--approve-offline-native-run") {
  console.error("Usage: admission-inspect-diagnosis.mjs <aios-machine> <owner-admission.json> <new-log.txt> --approve-offline-native-run");
  process.exit(1);
}
closeSync(openSync(logPath, "wx", 0o600));
const t0 = performance.now();
const log = (line) => {
  const text = `${String(Math.round(performance.now() - t0)).padStart(6)}ms ${line}`;
  appendFileSync(logPath, text + "\n");
  console.error(text);
};
const msg = (e) => String(e?.message ?? e).slice(0, 300);

const { admissionAcceptance } = await load("scripts/run-native-coding-admission-acceptance.mjs");
const { NativePodmanCodingTransport } = await load("dist/podman-coding.js");
const { ownerCodingAdmission } = await load("dist/coding-admission.js");

const authority = sha256("issue04-native-offline-lifecycle-v1:" + machine);
const real = new NativePodmanCodingTransport(machine, authority);
if (real.mode !== "live" || real.productionEnabled !== false)
  throw Error("Expected the live transport with production disabled");

const traced = new Proxy(real, {
  get(target, key) {
    const value = Reflect.get(target, key, target);
    if (typeof value !== "function" || !["inspect", "run", "stop"].includes(key))
      return value;
    return async (request, stdout) => {
      log(`${key} start intent=${request?.intent} state=${request?.state} thread=${request?.threadId ? "set" : "none"}`);
      const sink = stdout && ((bytes) => {
        for (const line of bytes.toString("utf8").split("\n")) {
          if (!line.trim()) continue;
          try { log(`  event type=${JSON.parse(line)?.type}`); } catch { log("  event (partial frame)"); }
        }
        return stdout(bytes);
      });
      try {
        const result = await value.apply(target, sink ? [request, sink] : [request]);
        log(`${key} ok${key === "stop" ? ` stopped=${result?.stopped} remaining=${result?.remainingProcesses}` : ""}`);
        return result;
      } catch (error) {
        log(`${key} THREW: ${msg(error)}`);
        throw error;
      }
    };
  },
});

const realAdmission = ownerCodingAdmission(admissionPath);
const admission = {
  path: realAdmission.path,
  pins(maxAgeMs) {
    try { return realAdmission.pins(maxAgeMs); }
    catch (error) { log(`admission.pins(${maxAgeMs ?? 0}) THREW: ${msg(error)}`); throw error; }
  },
};

log(`diag start machine=${machine}`);
const report = await admissionAcceptance(traced, admission);
for (const s of report.stages) log(`stage ${s.name} ${s.outcome}${s.error ? ": " + s.error : ""}`);
log(`delivery ${JSON.stringify(report.delivery ?? null)}`);
log(`outcome ${report.outcome}${report.error ? ": " + report.error : ""}`);
