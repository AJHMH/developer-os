// Explicit operator acceptance. Automatic tests use synthetic host adapters only.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
} from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const phases = {
  prepare: ["controls", "authStatus", "prepareInference"],
  inference: ["authStatus", "inference"],
  complete: ["capability", "task", "online", "report"],
};
const names = [...new Set(Object.values(phases).flat())];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const approvalArgument = (arg) =>
  /^--(?:approve|approved|execute)(?:-|=|$)/.test(arg);
function ordinaryFile(path, max) {
  const entry = lstatSync(path);
  if (
    !isAbsolute(path) ||
    !entry.isFile() ||
    entry.isSymbolicLink() ||
    entry.nlink !== 1 ||
    entry.size > max ||
    realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()
  )
    throw Error("Invalid operator file");
  return readFileSync(path);
}
export function readWindowsQualificationManifest(path) {
  const value = JSON.parse(ordinaryFile(path, 65536));
  if (
    Object.keys(value).sort().join(",") !== "schema,stateDirectory,steps" ||
    value.schema !== 1 ||
    !isAbsolute(value.stateDirectory) ||
    !value.steps ||
    Object.keys(value.steps).sort().join(",") !== names.toSorted().join(",")
  )
    throw Error("Invalid manifest");
  for (const step of Object.values(value.steps)) {
    if (
      !step ||
      Object.keys(step).sort().join(",") !== "args,script,sha256" ||
      !isAbsolute(step.script) ||
      !/^[a-f0-9]{64}$/.test(step.sha256) ||
      !Array.isArray(step.args) ||
      step.args.length > 64 ||
      step.args.some(
        (arg) =>
          typeof arg !== "string" ||
          arg.length > 4096 ||
          /[\r\n\0]/.test(arg) ||
          approvalArgument(arg),
      )
    )
      throw Error("Invalid step");
    if (digest(ordinaryFile(step.script, 1048576)) !== step.sha256)
      throw Error("Changed operator script");
  }
  const auth = value.steps.authStatus;
  const authOptions = [
    "--repo",
    "--state-dir",
    "--auth-directory",
    "--auth-account",
  ];
  if (
    basename(auth.script) !== "cli.js" ||
    auth.args[0] !== "auth-status" ||
    auth.args.length !== 9 ||
    new Set(auth.args.filter((_, i) => i % 2 === 1)).size !== 4 ||
    auth.args.some((arg, i) => i % 2 === 1 && !authOptions.includes(arg))
  )
    throw Error("Read-only auth status step required");
  if (auth.args[auth.args.indexOf("--state-dir") + 1] !== value.stateDirectory)
    throw Error("Changed auth authority");
  return value;
}
async function execute(step, signal) {
  if (digest(ordinaryFile(step.script, 1048576)) !== step.sha256)
    throw Error("Changed operator script");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [step.script, ...step.args], {
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
    let interrupted = false;
    const stop = () => {
      interrupted = true;
      child.kill();
    };
    const timer = setTimeout(stop, 600000);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    const clean = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
    };
    child.once("error", (error) => {
      clean();
      reject(error);
    });
    child.once("close", (code, terminated) => {
      clean();
      resolve(interrupted || terminated ? -1 : (code ?? 1));
    });
  });
}
/** Public host seam: injected adapters never grant production or inference authority. */
export async function runWindowsQualification(
  manifest,
  options,
  adapters = {},
) {
  const announce =
    adapters.announce ??
    ((event) => process.stdout.write(JSON.stringify(event) + "\n"));
  const sequence = phases[options.phase];
  if (
    !sequence ||
    (options.phase === "inference"
      ? !options.planOnly &&
        (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(
          options.approveRun ?? "",
        ) ||
          options.unknownUsageApproved !== true)
      : options.approveRun !== undefined || options.unknownUsageApproved) ||
    (options.phase === "complete"
      ? !options.planOnly && options.syntheticUsageApproved !== true
      : options.syntheticUsageApproved)
  )
    throw Error("Required phase approval is missing or misplaced");
  const steps = sequence.map((name) => ({
    ...manifest.steps[name],
    name,
    args: [
      ...manifest.steps[name].args,
      ...(name === "inference"
        ? [
            "--execute",
            "--approve-run",
            options.approveRun,
            "--approve-unknown-usage",
          ]
        : []),
      ...(name === "online" ? ["--approved-synthetic-unknown-usage"] : []),
    ],
  }));
  if (options.planOnly) {
    announce({
      status: "planned",
      phase: options.phase,
      stages: sequence,
      approvalRequired:
        options.phase === "inference"
          ? "exact-run-and-unknown-usage"
          : options.phase === "complete"
            ? "one-synthetic-usage-run"
            : "none",
      productionEnabled: false,
    });
    return 0;
  }
  if (
    (adapters.platform ?? process.platform) !== "win32" ||
    (adapters.arch ?? process.arch) !== "x64"
  )
    throw Error("Native Windows x64 host required");
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  let interrupted = false;
  // Test adapters own their isolated execution boundary. Real runs share the
  // generic acceptance runner's canonical-state mutex for the entire phase.
  const lock = adapters.run
    ? undefined
    : join(realpathSync(manifest.stateDirectory), ".native-acceptance.lock");
  if (lock) mkdirSync(lock, { mode: 0o700 });
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    for (const step of steps) {
      if (abort.signal.aborted) {
        interrupted = true;
        return 1;
      }
      const start = performance.now();
      const elapsed = () =>
        Math.max(0, Math.min(600000, Math.round(performance.now() - start)));
      announce({
        status: "started",
        stage: step.name,
        productionEnabled: false,
      });
      const progress = setInterval(
        () =>
          announce({
            status: "waiting",
            stage: step.name,
            elapsedMs: elapsed(),
            productionEnabled: false,
          }),
        30000,
      );
      let code;
      try {
        code = await (adapters.run ?? execute)(step, abort.signal);
      } catch {
        announce({
          status: "refused",
          stage: step.name,
          reason: "step-unavailable",
          elapsedMs: elapsed(),
          productionEnabled: false,
        });
        throw Error("Acceptance step unavailable");
      } finally {
        clearInterval(progress);
      }
      interrupted ||= code === -1 || abort.signal.aborted;
      announce({
        status: code === 0 && !interrupted ? "passed" : "refused",
        stage: step.name,
        elapsedMs: elapsed(),
        productionEnabled: false,
      });
      if (code !== 0 || interrupted) return code > 0 ? code : 1;
    }
    announce({
      status: options.phase === "prepare" ? "approval-required" : "completed",
      phase: options.phase,
      productionEnabled: false,
    });
    return 0;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    if (lock) {
      if (interrupted || abort.signal.aborted)
        announce({ status: "lock-retained", productionEnabled: false });
      else rmdirSync(lock);
    }
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values, positionals, tokens } = parseArgs({
      options: {
        manifest: { type: "string" },
        phase: { type: "string" },
        plan: { type: "boolean" },
        "approve-run": { type: "string" },
        "approve-unknown-usage": { type: "boolean" },
        "approved-synthetic-unknown-usage": { type: "boolean" },
      },
      allowPositionals: true,
      tokens: true,
    });
    const supplied = tokens
      .filter((token) => token.kind === "option")
      .map((token) => token.name);
    if (
      positionals.length ||
      !values.manifest ||
      !values.phase ||
      new Set(supplied).size !== supplied.length
    )
      throw Error();
    process.exitCode = await runWindowsQualification(
      readWindowsQualificationManifest(values.manifest),
      {
        phase: values.phase,
        planOnly: values.plan,
        approveRun: values["approve-run"],
        unknownUsageApproved: values["approve-unknown-usage"],
        syntheticUsageApproved: values["approved-synthetic-unknown-usage"],
      },
    );
  } catch {
    console.error(
      JSON.stringify({
        status: "refused",
        nextAction:
          "Check the reviewed manifest, current script hashes, explicit phase approvals and retained acceptance lock. No retries or refresh occur.",
        productionEnabled: false,
      }),
    );
    process.exitCode = 1;
  }
}
