#!/usr/bin/env node
// Owner-run endorsement of a protected mediation decision record's usage
// account. Previews by default; writes only with `--confirm true` and the
// previewed `--expect` hash.
import {
  OperatorRefusal,
  argumentsOf,
  requireValue as check,
} from "./operator/state.mjs";

async function main() {
  const o = argumentsOf(process.argv.slice(2), [
    "state-dir",
    "delivery",
    "codex-executable",
    "expect",
    "confirm",
  ]);
  check(
    o["state-dir"] && o.delivery && o["codex-executable"],
    "--state-dir, --delivery and --codex-executable are required",
  );
  check(
    o.confirm === undefined || (o.confirm === "true" && o.expect),
    "Use --confirm true with the previewed --expect hash to write",
  );
  const { endorseUsageAccount } = await import(
    "../dist/subscription-endorsement.js"
  );
  const { codexSubscriptionReader } = await import("../dist/codex-usage.js");
  const result = await endorseUsageAccount({
    state: o["state-dir"],
    deliveryId: o.delivery,
    reader: codexSubscriptionReader(o["codex-executable"]),
    ...(o.expect ? { expectedUsageAccountId: o.expect } : {}),
    confirm: o.confirm === "true",
  });
  console.log(JSON.stringify(result, null, 2));
}
main().catch((error) => {
  console.error(
    error instanceof OperatorRefusal || error?.name === "EndorsementRefusal"
      ? error.message
      : "Usage endorsement refused or incomplete. The decision record is unchanged unless a re-run reports it endorsed.",
  );
  process.exitCode = 1;
});
