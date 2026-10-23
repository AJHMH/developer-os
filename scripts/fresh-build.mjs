// Native acceptance evidence names a source revision, so the build it runs
// must be the one that source compiles to. This compiles the checkout's src/
// with its own TypeScript into a private temporary folder and refuses unless
// every emitted module equals dist/ byte for byte. It never writes to the
// checkout. Leftover dist/ files from deleted sources are ignored: nothing
// compiled imports them.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function emittedModules(directory, base = directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return emittedModules(path, base);
    return entry.isFile() && entry.name.endsWith(".js")
      ? [relative(base, path).split(sep).join("/")]
      : [];
  });
}

/** Refuses unless `root`/dist holds exactly what `root`/src compiles to, and
 * returns a digest of those modules. */
export function freshBuild(root) {
  const scratch = mkdtempSync(join(tmpdir(), "aios-fresh-build-"));
  try {
    const compiled = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../node_modules/typescript/bin/tsc", import.meta.url),
        ),
        "-p",
        root,
        // The project's own settings, so each module is byte-identical to a
        // real build; only the output folder moves.
        "--outDir",
        scratch,
      ],
      { encoding: "utf8", timeout: 300000, windowsHide: true },
    );
    if (compiled.status === null)
      throw Error("The checkout's TypeScript could not run; run npm ci");
    if (compiled.status !== 0)
      throw Error("src/ does not compile; fix it, then run npm run build");
    const emitted = emittedModules(scratch).sort();
    const stale = emitted.filter((path) => {
      const built = join(root, "dist", ...path.split("/"));
      return (
        !existsSync(built) ||
        !readFileSync(built).equals(readFileSync(join(scratch, path)))
      );
    });
    if (!emitted.length || stale.length)
      throw Error(
        `dist/ was not built from the current src/; run npm run build (${stale
          .slice(0, 3)
          .join(", ")})`,
      );
    return {
      buildFresh: true,
      // The check itself, so a report pins the code that vouched for its build.
      freshBuildSha256: sha256(readFileSync(new URL(import.meta.url))),
      distSha256: sha256(
        JSON.stringify(
          emitted.map((path) => [
            path,
            sha256(readFileSync(join(scratch, path))),
          ]),
        ),
      ),
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
