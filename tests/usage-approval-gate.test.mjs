import assert from "node:assert/strict";
import test from "node:test";
import * as subscription from "../dist/subscription.js";

const now = Date.parse("2026-10-17T12:00:00Z");
const report = (checkedAt = new Date(now).toISOString()) => ({
  checkId: "check",
  checkedAt,
  accountId: "owner",
  decision: "approval-required",
  remainingPercent: 20,
  scope: "allowance",
});

test("usage approval rejects future, stale and malformed observations consistently", () => {
  const gate = new subscription.UsageApprovalGate(() => now);
  for (const timestamp of [now + 1, now - 60001, Number.NaN]) {
    const checkedAt = Number.isNaN(timestamp)
      ? "invalid"
      : new Date(timestamp).toISOString();
    const usage = report(checkedAt);
    assert.equal(gate.approve(usage, "check"), undefined);
    assert.equal(gate.permits({ ...usage, decision: "ready" }), false);
    assert.equal(
      gate.permits({
        ...usage,
        approval: { scope: usage.scope, at: new Date(now).toISOString() },
      }),
      false,
    );
  }
});

test("owner approval binds once and cannot move to another operation or scope", () => {
  const gate = new subscription.UsageApprovalGate(() => now);
  const initial = report();
  const approved = gate.approve(initial, "check");
  assert.equal(initial.approval, undefined);
  assert.equal(gate.permits(approved), true);
  const bound = gate.bind(approved, "operation-one");
  assert.equal(approved.approval.operationId, undefined);
  assert.equal(
    gate.permits(bound, {
      operationId: "operation-one",
      accountId: "owner",
      scope: "allowance",
    }),
    true,
  );
  assert.equal(gate.permits(bound), false);
  assert.equal(gate.bind(bound, "operation-two"), undefined);
  assert.equal(gate.permits(bound, { operationId: "operation-two" }), false);
  assert.equal(
    gate.permits(bound, { operationId: "operation-one", accountId: "other" }),
    false,
  );
  assert.equal(
    gate.permits(bound, { operationId: "operation-one", scope: "different" }),
    false,
  );
  assert.equal(gate.approve(initial, "old-check"), undefined);
  assert.equal(
    gate.approve({ ...initial, decision: "exhausted" }, "check"),
    undefined,
  );
});

test("observation scope carries a detached grant only for the same account and allowance windows", () => {
  const gate = new subscription.UsageApprovalGate(() => now);
  const observation = {
    observedAt: new Date(now).toISOString(),
    accountId: "owner",
    authMode: "chatgpt",
    exhausted: false,
    windows: [
      {
        id: "weekly",
        usedPercent: 80,
        resetsAt: Math.floor(now / 1000) + 3600,
      },
    ],
  };
  const first = gate.observe(observation);
  assert.equal(first.decision, "approval-required");
  assert.equal(first.remainingPercent, 20);
  const bound = gate.bind(gate.approve(first, first.checkId), "operation");
  const refreshed = gate.observe(observation, bound);
  assert.equal(gate.permits(refreshed, { operationId: "operation" }), true);
  refreshed.approval.operationId = "changed";
  assert.equal(bound.approval.operationId, "operation");
  assert.equal(
    gate.observe({ ...observation, accountId: "other" }, bound).approval,
    undefined,
  );
  assert.equal(
    gate.observe({ ...observation, exhausted: true }, bound).approval,
    undefined,
  );
  assert.equal(
    gate.observe(
      {
        ...observation,
        windows: [
          {
            ...observation.windows[0],
            resetsAt: observation.windows[0].resetsAt + 1,
          },
        ],
      },
      bound,
    ).approval,
    undefined,
  );
  const unknown = gate.observe(undefined, undefined, "owner");
  assert.equal(unknown.accountId, "owner");
  assert.equal(
    unknown.scope,
    gate.observe({ ...observation, windows: [] }).scope,
  );
  assert.equal(
    gate.observe({
      ...observation,
      observedAt: new Date(now + 1).toISOString(),
    }).decision,
    "approval-required",
  );
  assert.equal(
    gate.observe({
      ...observation,
      windows: [{ ...observation.windows[0], usedPercent: 79 }],
    }).decision,
    "ready",
  );
  assert.equal(
    gate.observe({
      ...observation,
      windows: [{ ...observation.windows[0], usedPercent: 100 }],
    }).decision,
    "exhausted",
  );
});

test("check and approval freshness use the same injected clock including exact endpoints", () => {
  let at = now;
  const gate = new subscription.UsageApprovalGate(() => at);
  const bound = gate.bind(gate.approve(report(), "check"), "operation");
  at += 60000;
  assert.equal(gate.permits(bound, { operationId: "operation" }), true);
  at += 1;
  assert.equal(gate.permits(bound, { operationId: "operation" }), false);
  at = now - 1;
  assert.equal(gate.permits(bound, { operationId: "operation" }), false);
  at = now;
  for (const date of [
    "invalid",
    new Date(now + 1).toISOString(),
    new Date(now - 60001).toISOString(),
  ]) {
    assert.equal(
      gate.permits(
        { ...bound, approval: { ...bound.approval, at: date } },
        { operationId: "operation" },
      ),
      false,
    );
  }
});

test("a bound approval covers its whole dispatched coding turn, and only that", () => {
  let at = now;
  const gate = new subscription.UsageApprovalGate(() => at);
  const approved = gate.approve(report(), "check");
  const bound = gate.bind(approved, "operation");
  const turn = { operationId: "operation", dispatchedTurn: true };
  // An hour later, with a fresh observation, the turn is still covered.
  at = now + 3_600_000;
  const observed = { ...bound, checkedAt: new Date(at).toISOString() };
  assert.equal(gate.permits(observed, turn), true);
  // Not another operation, not an unbound approval, and not other
  // bound operations such as fixed workers or online runs.
  assert.equal(
    gate.permits(observed, { ...turn, operationId: "other" }),
    false,
  );
  assert.equal(
    gate.permits({ ...approved, checkedAt: observed.checkedAt }, turn),
    false,
  );
  assert.equal(gate.permits(observed, { operationId: "operation" }), false);
  // The observation must still be fresh, and the approval well-formed.
  assert.equal(gate.permits(bound, turn), false);
  for (const date of ["invalid", new Date(at + 1).toISOString()])
    assert.equal(
      gate.permits(
        { ...observed, approval: { ...observed.approval, at: date } },
        turn,
      ),
      false,
    );
  assert.equal(
    gate.permits({ ...observed, decision: "exhausted" }, turn),
    false,
  );
});

test("an unavailable usage read keeps its bounded reason and still requires approval", () => {
  const gate = new subscription.UsageApprovalGate(() => now);
  const usage = gate.observe({ refusal: "executable-size" });
  assert.equal(usage.unavailable, "executable-size");
  assert.equal(usage.decision, "approval-required");
  assert.equal(usage.scope, "unknown");
  // A reason outside the bounded set is dropped, never stored.
  assert.equal(
    gate.observe({ refusal: "synthetic private provider text" }).unavailable,
    undefined,
  );
  assert.equal(gate.observe(undefined).unavailable, undefined);
});
