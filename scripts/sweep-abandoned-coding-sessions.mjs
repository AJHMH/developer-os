#!/usr/bin/env node
// Owner-run sweep of coding sessions nothing can ever need again on a real
// dedicated VM: a start that recorded no thread, and a resume whose recovery
// returned its home. Without --approve-removal it only counts. It never
// provisions or starts the VM, and it refuses a guest that the owner's coding
// admission record does not name. Run it through scripts/run-native-acceptance.mjs,
// so it cannot overlap an acceptance run that still needs a stopped session.
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { freshBuild } from "./fresh-build.mjs";

const usage =
  "Usage: node scripts/sweep-abandoned-coding-sessions.mjs <aios-machine> <coding-admission.json> [--approve-removal]";
const [machine, admissionPath, approval, ...extra] = process.argv.slice(2);
if (
  !/^aios-[a-z0-9-]+$/.test(machine ?? "") ||
  !admissionPath ||
  (approval !== undefined && approval !== "--approve-removal") ||
  extra.length
) {
  console.error(usage);
  process.exit(1);
}
try {
  freshBuild(fileURLToPath(new URL("..", import.meta.url)));
  const [
    { NativePodmanCodingTransport },
    { nativeCodingAuthority },
    admission,
  ] = await Promise.all([
    import("../dist/podman-coding.js"),
    import("../dist/native-coding-runtime.js"),
    import("../dist/coding-admission.js"),
  ]);
  const transport = new NativePodmanCodingTransport(
    machine,
    nativeCodingAuthority(machine),
  );
  const admitted = admission.ownerCodingAdmission(admissionPath).pins();
  const observed = await transport.inspect({
    operationId: randomUUID(),
    fence: 1,
    state: "stopped",
    intent: "start",
  });
  for (const field of Object.keys(admitted))
    if (admitted[field] !== observed[field])
      throw Error(`The owner's coding admission does not name ${field}`);
  const apply = approval === "--approve-removal";
  let removed = 0,
    sweep;
  do {
    sweep = await transport.cleanupAbandonedSessions(apply);
    removed += sweep.removed;
  } while (apply && sweep.removed > 0 && sweep.abandoned > 0);
  const { abandoned, refused, kept } = sweep;
  console.log(JSON.stringify({ apply, removed, abandoned, refused, kept }));
  if (apply && (abandoned > 0 || refused > 0)) process.exitCode = 1;
} catch (error) {
  console.error(String(error?.message).slice(0, 300));
  process.exitCode = 1;
}
