#!/usr/bin/env node
// CI: a PR that moves an admitted guest digest must say so in its "Pin impact"
// section, naming the new digest, because the owner has to re-pin the Mac.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const digests = (doc) =>
  Object.fromEntries(
    [
      ...doc.matchAll(/^\| (Coding|Validation) +\| `([a-f0-9]{64})` +\|$/gm),
    ].map((row) => [row[1], row[2]]),
  );

/** What a PR's body is missing, one line per moved digest; empty when complete. */
export function pinImpactProblems(baseDoc, headDoc, body) {
  const [base, head] = [digests(baseDoc), digests(headDoc)];
  const section =
    /^## Pin impact\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(body ?? "")?.[1] ??
    "";
  return Object.keys(head)
    .filter((guest) => base[guest] !== head[guest])
    .filter((guest) => !section.includes(head[guest]))
    .map(
      (guest) =>
        `This PR moves the ${guest} guest digest. Add a "## Pin impact" section naming ${head[guest]} and the re-pin it needs on the Mac.`,
    );
}

const invoked = process.argv[1] && realpathSync(process.argv[1]);
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  const path = "docs/owner-hosts.md";
  const problems = pinImpactProblems(
    execFileSync("git", ["show", `${process.env.BASE_SHA}:${path}`], {
      encoding: "utf8",
    }),
    readFileSync(path, "utf8"),
    process.env.PR_BODY,
  );
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exitCode = 1;
}
