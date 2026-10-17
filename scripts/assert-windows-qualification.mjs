import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hostTargets } from "../dist/host-target.js";
import {
  assertHostAcceptance,
  runHostAcceptanceCLI,
} from "./assert-host-qualification.mjs";

export function assertWindowsAcceptance(report, delivery) {
  assertHostAcceptance(report, delivery, hostTargets.win32);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runHostAcceptanceCLI(hostTargets.win32);
}
