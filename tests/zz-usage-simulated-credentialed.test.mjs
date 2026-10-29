// Slice 5: the owner-run credentialed qualification against a simulated VM
// and provider, through the real gateway. The name sorts after every other
// test file, so no other file changes shard.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { GeneralSessionProviderRefusal } from "../dist/general-session-gateway.js";
import { codingBoundaryProbeNames } from "../dist/worker-probes.js";
import {
  requiredSubscriptionScopes,
  subscriptionAccountId,
  subscriptionIssuer,
} from "../dist/subscription-account.js";
import {
  consumeApproval,
  credentialedQualification,
  passingOutcome,
  prepareRun,
  stageNames,
  usageAuthority,
} from "../scripts/run-native-credentialed-qualification.mjs";

const pins = {
  cliVersion: "0.161.0",
  cliSha256: "1".repeat(64),
  codeModeHostSha256: "6".repeat(64),
  policySha256: "2".repeat(64),
  bindingSha256: "3".repeat(64),
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
const AsyncFunction = (async () => {}).constructor;
const captured = JSON.parse(
  readFileSync(
    new URL("./fixtures/codex-0.161.0-launch-request.json", import.meta.url),
    "utf8",
  ),
);
const opening = captured.input.filter(
  (item) => item.type === "additional_tools" || item.type === "message",
);
const hostId = `urn:uuid:${randomUUID()}`;
const token = "owner-access-token-" + "t".repeat(32);
const ownerAccount = (changes = {}) => ({
  issuer: subscriptionIssuer,
  clientId: "oaiapp_owner",
  subject: "owner",
  hostId,
  planUsageAuthorized: true,
  scopes: [...requiredSubscriptionScopes],
  expiresAt: Date.now() + 40 * 60_000,
  accessToken: token,
  ...changes,
});
const accountId = subscriptionAccountId(ownerAccount());
const usageReport = (changes = {}) => ({
  checkId: randomUUID(),
  checkedAt: new Date().toISOString(),
  accountId: "u".repeat(64),
  decision: "ready",
  remainingPercent: 80,
  scope: "s".repeat(64),
  ...changes,
});

/** Server-sent events for one response, as Codex reads them. */
const sse = (id, items) =>
  [
    { type: "response.created", response: { id } },
    ...items.map((item) => ({ type: "response.output_item.done", item })),
    { type: "response.completed", response: { id } },
  ]
    .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
async function itemsOf(stream) {
  let text = "";
  for await (const chunk of stream) text += Buffer.from(chunk).toString();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)))
    .filter((event) => event.type === "response.output_item.done")
    .map((event) => event.item);
}

/** The model: one `cat` tool call, then the line it printed. It only ever
 * sees the token the gateway gives it. */
function model(faults) {
  const observation = { requests: 0, tokens: new Set() };
  async function* provider(given, body) {
    observation.requests++;
    observation.tokens.add(given);
    if (faults.providerStatus)
      throw new GeneralSessionProviderRefusal(faults.providerStatus);
    const last = JSON.parse(body).input.at(-1);
    const n = observation.requests;
    const items =
      last?.type === "custom_tool_call_output" || faults.answersAtOnce
        ? [
            {
              type: "message",
              id: `msg_${n}`,
              role: "assistant",
              content: [
                { type: "output_text", text: "AIOS credentialed canary" },
              ],
            },
          ]
        : [
            {
              type: "custom_tool_call",
              id: `ctc_${n}`,
              call_id: `call_${n}`,
              name: "exec",
              input:
                'const r = await tools.exec_command({cmd: "cat /workspace/canary.txt"});\ntext(r.output);\n',
            },
          ];
    yield Buffer.from(sse(`resp_${n}`, items));
  }
  return { provider, observation };
}

/** A fake VM whose Codex speaks the captured request shape to the real
 * gateway, retrying refused requests until its gate stops it. */
function vm(faults = {}) {
  const sessions = new Map(),
    threads = new Map(),
    effects = [];
  const line = (event) => Buffer.from(JSON.stringify(event) + "\n");
  const state = (s) => sessions.get(s.operationId);
  const transport = {
    async inspect() {
      if (faults.echo) throw Error("Adapter refused " + faults.echo);
      return { ...pins, ...(faults.pins ?? {}) };
    },
    async run(request, stdout, gateway) {
      if (!request.mayDispatch()) throw Error("Dispatch refused");
      assert.notEqual(gateway.capability, request.modelRoute.capability);
      effects.push("run:" + request.intent);
      const files = new Map(
        request.files.map((f) => [f.path, Buffer.from(f.bytes)]),
      );
      if (faults.leak) files.set("leak.txt", Buffer.from(faults.leak));
      const session = { phase: "running", files, processes: 2 };
      sessions.set(request.operationId, session);
      const thread = request.threadId ?? randomUUID();
      stdout(line({ type: "thread.started", thread_id: thread }));
      const history = threads.get(request.threadId) ?? [...opening];
      threads.set(thread, history);
      history.push({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: request.argv.at(-1) }],
      });
      try {
        for (let n = 0; n < 50; n++) {
          if (!request.checkpoint()) return { exitCode: 1 };
          let items;
          try {
            items = await itemsOf(
              await gateway.respond(
                request.modelRoute.deliveryId,
                gateway.capability,
                JSON.stringify({ ...captured, input: history }),
              ),
            );
          } catch {
            await tick();
            continue;
          }
          const call = items.find((i) => i.type === "custom_tool_call");
          history.push(...items);
          if (!call) {
            stdout(line({ type: "turn.completed" }));
            return { exitCode: 0 };
          }
          const out = [];
          const tools = {
            async exec_command({ cmd }) {
              const read = /^cat \/workspace\/(.+)$/.exec(cmd);
              return {
                output: (read && files.get(read[1])?.toString()) ?? "",
                exit_code: 0,
              };
            },
          };
          await new AsyncFunction("tools", "text", call.input)(tools, (v) =>
            out.push(String(v)),
          );
          history.push({
            type: "custom_tool_call_output",
            call_id: call.call_id,
            output: out.map((text) => ({ type: "input_text", text })),
          });
        }
        return { exitCode: 1 };
      } finally {
        gateway.revoke("stopped");
        session.phase = "stopped";
        session.processes = faults.survivor ? 1 : 0;
      }
    },
    async probeBoundary(session, path) {
      const s = state(session);
      if (s?.phase !== "running")
        throw Error("Native coding probe-boundary observation unavailable");
      effects.push("probe:" + path);
      return {
        probes: codingBoundaryProbeNames
          .filter((name) => name !== faults.probeMissing)
          .map((name) => ({
            name,
            outcome: faults.probeFails === name ? "failed" : "passed",
          })),
        processes: 3,
        pins: { ...pins },
      };
    },
    async observeSession(session) {
      const s = state(session);
      if (!s)
        throw Error("Native coding observe-session observation unavailable");
      return {
        phase: s.phase,
        running: s.phase === "running",
        remainingProcesses: s.processes,
        processesGone: s.processes === 0,
      };
    },
    async collect(session) {
      const s = state(session);
      if (s?.phase !== "stopped") throw Error("Native coding collect refused");
      return {
        complete: true,
        files: [...s.files].map(([path, bytes]) => ({ path, bytes })),
      };
    },
    async stop(session) {
      effects.push("stop");
      if (faults.survivor) return { stopped: false, remainingProcesses: 1 };
      const s = state(session);
      if (s) Object.assign(s, { phase: "stopped", processes: 0 });
      return { stopped: true, remainingProcesses: 0 };
    },
  };
  return { transport, effects };
}

async function qualify(faults = {}) {
  const { transport, effects } = vm(faults);
  const { provider, observation } = model(faults);
  let observed = 0;
  const report = await credentialedQualification({
    transport,
    admission: { pins: () => ({ ...pins }) },
    account: () => ownerAccount(faults.account),
    accountId,
    hostId,
    observeUsage: async () => usageReport(faults.usage?.(++observed) ?? {}),
    provider,
  });
  return { report, effects, model: observation };
}
const blockedAt = (report) =>
  report.stages.find((s) => s.outcome === "blocked")?.name;

test("usage authority refuses all but a fresh healthy window of the same account", () => {
  assert.equal(usageAuthority(usageReport()), "permitted");
  assert.equal(
    usageAuthority(
      usageReport({ decision: "approval-required", remainingPercent: 10 }),
    ),
    "approval-required",
  );
  assert.equal(
    usageAuthority(
      usageReport({ decision: "approval-required", remainingPercent: null }),
    ),
    "unknown",
  );
  assert.equal(
    usageAuthority(usageReport({ decision: "exhausted", remainingPercent: 0 })),
    "exhausted",
  );
  assert.equal(usageAuthority(usageReport(), "v".repeat(64)), "account");
});

test("the credentialed qualification passes with two live turns and every control enforced", async () => {
  const { report, effects, model: seen } = await qualify();
  assert.equal(report.outcome, passingOutcome, report.error);
  assert.deepEqual(
    report.stages.map((s) => [s.name, s.outcome]),
    stageNames.map((name) => [name, "passed"]),
  );
  assert.deepEqual(
    effects.filter((e) => e.startsWith("run:")),
    ["run:start", "run:resume"],
    "exactly the approved two turns ran",
  );
  assert.ok(effects.includes("probe:canary.txt"));
  assert.equal(report.model, "gpt-6.1-sol");
  assert.equal(report.restart, undefined, "the restart had no effect");
  // The launch's tool call and answer; the resume's tool call, and nothing
  // after its stand-in exhaustion.
  assert.equal(seen.requests, 3);
  assert.deepEqual([...seen.tokens], [token], "only the host's token");
  assert.equal(report.launch.gateway.completed, 2);
  assert.equal(report.resume.gateway.revokedFor, "exhausted");
  assert.deepEqual(
    report.resume.authority.map((a) => a.decided),
    ["permitted", "exhausted"],
  );
  assert.equal(report.resume.authority[1].authority, "permitted");
  assert.deepEqual(report.resume.collected, ["canary.txt"]);
  assert.ok(report.usageBefore && report.usageAfter);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(token));
  assert.deepEqual(report.finalStops, [
    { fence: 1, stopped: true },
    { fence: 2, stopped: true },
  ]);
});

for (const [name, usage, reason] of [
  [
    "low",
    { decision: "approval-required", remainingPercent: 10 },
    "approval-required",
  ],
  [
    "unknown",
    { decision: "approval-required", remainingPercent: null },
    "unknown",
  ],
  ["exhausted", { decision: "exhausted", remainingPercent: 0 }, "exhausted"],
])
  test(`${name} usage refuses the run before any turn`, async () => {
    const {
      report,
      effects,
      model: seen,
    } = await qualify({
      usage: () => usage,
    });
    assert.equal(report.outcome, "blocked");
    assert.equal(blockedAt(report), "usage-before");
    assert.match(report.error, new RegExp(reason));
    assert.deepEqual(effects, []);
    assert.equal(seen.requests, 0);
  });

test("an ineligible account refuses the run before usage or any turn", async () => {
  const { report, effects } = await qualify({
    account: { planUsageAuthorized: false },
  });
  assert.equal(blockedAt(report), "account-eligible");
  assert.deepEqual(effects, []);
});

test("a record naming other pins refuses before any turn", async () => {
  const { report, effects } = await qualify({
    pins: { cliSha256: "9".repeat(64) },
  });
  assert.equal(blockedAt(report), "owner-record-names-fresh-pins");
  assert.deepEqual(effects, []);
});

test("usage from another account mid-launch ends it at once", async () => {
  const { report, model: seen } = await qualify({
    usage: (n) => (n > 1 ? { accountId: "v".repeat(64) } : {}),
  });
  assert.equal(blockedAt(report), "routed-launch-live-probe");
  assert.equal(report.launch.lapsed, "account");
  assert.equal(seen.requests, 0, "no request reached the provider");
});

test("a provider refusal blocks the launch with its status", async () => {
  const { report } = await qualify({ providerStatus: 400 });
  assert.equal(report.outcome, "blocked");
  assert.deepEqual(report.launch.gateway.providerStatuses.slice(0, 1), [400]);
});

test("a resume that answers in one request cannot show the exhaustion stand-in", async () => {
  const { report } = await qualify({ answersAtOnce: true });
  assert.equal(blockedAt(report), "routed-resume-exhausted-mid-turn");
});

test("a credential in the worker's workspace blocks the run", async () => {
  const { report } = await qualify({ leak: token });
  assert.equal(blockedAt(report), "credential-not-visible");
  assert.doesNotMatch(JSON.stringify(report), new RegExp(token));
});

test("a failed boundary probe fails the run", async () => {
  const { report } = await qualify({ probeFails: "npm-registry" });
  assert.equal(report.outcome, "failed");
  assert.deepEqual(report.failedProbes, ["npm-registry"]);
});

test("a boundary probe that never ran fails the run", async () => {
  const { report } = await qualify({ probeMissing: "network" });
  assert.equal(report.outcome, "failed");
  assert.deepEqual(report.failedProbes, ["network"]);
});

test("an adapter error echoing the credential never reaches the report", async () => {
  const { report } = await qualify({ echo: token });
  assert.equal(blockedAt(report), "coding-fresh-pins");
  assert.match(report.error, /<credential>/);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(token));
});

test("a session that survives its stop leaves the run uncertain", async () => {
  const { report } = await qualify({ survivor: true });
  assert.equal(report.outcome, "uncertain");
});

test("the one-shot approval names its plan's run and exactly two turns, and is spent once", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "aios-credentialed-"));
  const owner = { machine: "aios-test", pins, accountId, stateDir };
  const plan = prepareRun(owner);
  const approve = (changes = {}, now) =>
    consumeApproval({ ...owner, runId: plan.runId, turns: 2, ...changes }, now);
  assert.throws(() => approve({ turns: 3 }), /exactly 2 turns/);
  assert.throws(() => approve({ runId: randomUUID() }), /ENOENT/);
  assert.throws(() => approve({ machine: "aios-other" }), /current plan/);
  assert.throws(
    () => approve({ pins: { ...pins, policySha256: "9".repeat(64) } }),
    /current plan/,
  );
  assert.throws(() => approve({}, plan.expiresAt), /current plan/);
  assert.equal(approve().runId, plan.runId);
  assert.throws(() => approve(), /EEXIST/, "spent once");
  // A plan edited after preparation is not a current plan either.
  const second = prepareRun(owner);
  const path = join(
    stateDir,
    `credentialed-qualification-${second.runId}.plan.json`,
  );
  writeFileSync(path, JSON.stringify({ ...second, turns: 4 }));
  assert.throws(
    () => consumeApproval({ ...owner, runId: second.runId, turns: 2 }),
    /current plan/,
  );
});
