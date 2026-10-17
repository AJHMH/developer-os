import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hostTargets } from "../dist/host-target.js";
import {
  assertHostAcceptance,
  runHostAcceptanceCLI,
} from "./assert-host-qualification.mjs";

export function assertMacosAcceptance(report, delivery) {
  assertHostAcceptance(report, delivery, hostTargets.darwin);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runHostAcceptanceCLI(hostTargets.darwin);
}
