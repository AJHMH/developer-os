import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  argumentsOf,
  OperatorRefusal,
  digest,
  locked,
  readState,
  requireValue as check,
  stateDirectory,
  writeState,
} from "./operator/state.mjs";

const text = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 1000 &&
  !/[\x00-\x1f]/.test(value);
const amount = (value) => Number.isSafeInteger(value) && value >= 0;
function approval(value) {
  check(text(value), "Explicit operator approval reference required");
}
function reduce(events) {
  let state;
  const operations = new Set();
  for (const [index, event] of events.entries()) {
    const { hash, ...body } = event;
    check(
      event.index === index &&
        body.previous === (events[index - 1]?.hash ?? null) &&
        digest(body) === hash,
      "Invalid ledger history",
    );
    const data = event.data;
    if (event.kind === "init") {
      check(
        index === 0 &&
          text(data.scope) &&
          amount(data.minutes) &&
          data.minutes > 0 &&
          amount(data.cycles),
        "Invalid initial allowance",
      );
      state = {
        scopes: [data.scope],
        allowedMs: data.minutes * 60000,
        usedMs: 0,
        cycles: data.cycles,
        usedCycles: 0,
        active: null,
        failures: [],
        plans: [],
      };
      check(Number.isSafeInteger(state.allowedMs), "Allowance overflow");
    } else {
      check(state, "Ledger initialization required");
      if (event.kind === "extend") {
        approval(data.approval);
        check(
          !state.active && amount(data.minutes) && amount(data.cycles),
          "Stop active work before extension",
        );
        state.allowedMs += data.minutes * 60000;
        state.cycles += data.cycles;
      } else if (event.kind === "scope") {
        approval(data.approval);
        check(
          !state.active && text(data.scope),
          "Stop active work before scope authorization",
        );
        state.scopes.push(data.scope);
      } else if (event.kind === "begin") {
        check(
          !state.active &&
            state.scopes.includes(data.scope) &&
            state.usedMs < state.allowedMs &&
            (!data.repair || state.usedCycles < state.cycles) &&
            typeof data.repair === "boolean" &&
            text(data.operation) &&
            !operations.has(data.operation),
          "Work is active, out of scope or exhausted",
        );
        operations.add(data.operation);
        state.active = { operation: data.operation, scope: data.scope };
        if (data.repair) state.usedCycles++;
      } else if (["checkpoint", "end", "recover"].includes(event.kind)) {
        check(
          state.active?.operation === data.operation && amount(data.activeMs),
          "Matching active operation and nonnegative charge required",
        );
        if (event.kind === "recover") approval(data.approval);
        state.usedMs += data.activeMs;
        if (event.kind !== "checkpoint") state.active = null;
      } else if (event.kind === "plan") {
        check(
          state.scopes.includes(data.scope) &&
            [data.question, data.reproduction, data.evidence].every(text),
          "Authorized scope, question, reproduction and evidence reference required",
        );
        state.plans.push({
          scope: data.scope,
          question: data.question,
          reproduction: data.reproduction,
          evidence: data.evidence,
        });
      } else if (event.kind === "failure") {
        check(
          /^[a-f0-9]{40}$/.test(data.revision) &&
            [data.repository, data.check, data.symptom, data.evidence].every(
              text,
            ),
          "Revision-bound failure evidence required",
        );
        const fingerprint = digest({
          repository: data.repository,
          check: data.check,
          symptom: data.symptom,
        });
        state.failures.push({ ...data, fingerprint });
      } else throw Error("Unknown ledger event");
      check(
        [state.allowedMs, state.usedMs, state.cycles, state.usedCycles].every(
          amount,
        ),
        "Ledger allowance overflow",
      );
    }
  }
  check(state, "Empty ledger");
  return {
    ...state,
    remainingMs: Math.max(0, state.allowedMs - state.usedMs),
    remainingCycles: Math.max(0, state.cycles - state.usedCycles),
  };
}
export async function investigation(options) {
  const { repository, directory, kind, data = {} } = options;
  const root = stateDirectory(directory, repository);
  return locked(root, () => {
    const exists = existsSync(join(root, "investigation.json"));
    check(exists || kind === "init", "Initialize ledger first");
    check(!exists || kind !== "init", "Existing ledger cannot be reset");
    const ledger = exists
      ? readState(root, "investigation.json")
      : { schemaVersion: 1, events: [] };
    check(
      ledger.schemaVersion === 1 &&
        Array.isArray(ledger.events) &&
        ledger.events.length < 10000,
      "Invalid or full ledger",
    );
    if (kind === "status") return reduce(ledger.events);
    const body = {
      index: ledger.events.length,
      previous: ledger.events.at(-1)?.hash ?? null,
      kind,
      data,
      recordedAt: new Date().toISOString(),
    };
    const events = [...ledger.events, { ...body, hash: digest(body) }];
    const state = reduce(events);
    writeState(root, "investigation.json", { schemaVersion: 1, events });
    return state;
  });
}
async function main() {
  const [kind, ...argv] = process.argv.slice(2),
    o = argumentsOf(argv, [
      "repo",
      "state-dir",
      "scope",
      "operation",
      "repair",
      "approval",
      "failure-repository",
      "revision",
      "check",
      "symptom",
      "evidence",
      "minutes",
      "cycles",
      "active-ms",
      "question",
      "reproduction",
    ]);
  const operation =
    o.operation ?? (kind === "begin" ? randomUUID() : undefined);
  const data = Object.fromEntries(
    Object.entries({
      scope: o.scope,
      operation,
      approval: o.approval,
      repository: o["failure-repository"],
      revision: o.revision,
      check: o.check,
      symptom: o.symptom,
      evidence: o.evidence,
      question: o.question,
      reproduction: o.reproduction,
    }).filter(([, v]) => v !== undefined),
  );
  for (const [flag, name] of [
    ["minutes", "minutes"],
    ["cycles", "cycles"],
    ["active-ms", "activeMs"],
  ])
    if (o[flag] !== undefined) {
      check(
        /^(0|[1-9][0-9]*)$/.test(o[flag]),
        "Explicit nonnegative integer required",
      );
      data[name] = Number(o[flag]);
    }
  if (kind === "begin") {
    check(
      ["true", "false"].includes(o.repair),
      "Explicit --repair true|false required",
    );
    data.repair = o.repair === "true";
  }
  check(o.repo && o["state-dir"], "--repo and --state-dir required");
  console.log(
    JSON.stringify(
      await investigation({
        repository: o.repo,
        directory: o["state-dir"],
        kind,
        data,
      }),
      null,
      2,
    ),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(
      error instanceof OperatorRefusal
        ? error.message
        : "Ledger operation refused; inspect private state, scope, lock and allowance. No approval authority is implied.",
    );
    process.exitCode = 1;
  });
