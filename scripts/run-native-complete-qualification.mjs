// The complete controller qualification on macOS (#274, v1 ticket 16): binds
// the owner-run component reports into one, each by path and SHA-256, from
// this clean, freshly built checkout. It runs nothing on the VM and spends
// nothing; every component must already have run from this same revision.
// A passing report is what a production admission names for the complete
// level. Production stays disabled.
import { spawnSync } from "node:child_process";
import { closeSync, openSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { freshBuild } from "./fresh-build.mjs";

const usage =
  "Usage: node scripts/run-native-complete-qualification.mjs <new-report.json> --worker <report> --session <report> --validation <report> --lifecycle <report> --delivery <report>";

/** The combination, as the owner runs it: `root` is this checkout. */
export async function runCompleteQualification(argv, root) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        worker: { type: "string" },
        session: { type: "string" },
        validation: { type: "string" },
        lifecycle: { type: "string" },
        delivery: { type: "string" },
      },
    });
  } catch {
    throw Error(usage);
  }
  const [reportPath, ...rest] = parsed.positionals;
  if (!reportPath || rest.length) throw Error(usage);
  // The build must be what this source compiles to, from a clean tree.
  const build = freshBuild(root);
  const git = (...args) =>
    spawnSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      timeout: 5000,
    }).stdout.trim();
  const sourceRevision = git("rev-parse", "HEAD");
  const sourceDirty = git("status", "--porcelain") !== "";
  if (sourceDirty)
    throw Error("The checkout has changes; qualify only a clean revision");
  const { completeQualification } = await import(
    "../dist/complete-qualification.js"
  );
  const report = {
    ...completeQualification(parsed.values, sourceRevision),
    ...build,
    buildFresh: true,
    sourceDirty,
  };
  // Never overwrite retained evidence.
  closeSync(openSync(reportPath, "wx", 0o600));
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return { report, reportPath };
}

const invoked = process.argv[1] && realpathSync(process.argv[1]);
if (invoked && import.meta.url === pathToFileURL(invoked).href)
  runCompleteQualification(
    process.argv.slice(2),
    fileURLToPath(new URL("..", import.meta.url)),
  )
    .then(({ report, reportPath }) => {
      console.log(
        JSON.stringify({
          outcome: report.outcome,
          reportPath,
          boundaries: Object.fromEntries(
            report.boundaries.map((b) => [b.id, b.outcome]),
          ),
          rejected: Object.fromEntries(
            Object.entries(report.components)
              .filter(([, c]) => !c.accepted)
              .map(([name, c]) => [name, c.problems]),
          ),
          missing: report.missing,
        }),
      );
      if (report.outcome !== "observed-native-complete-qualification")
        process.exitCode = 1;
    })
    .catch((error) => {
      console.error(String(error?.message).slice(0, 300));
      process.exitCode = 1;
    });
