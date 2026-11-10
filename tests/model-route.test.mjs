import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PinnedCodingRuntime,
  modelRoutePort,
  validModelRoute,
} from "../dist/feature-candidate.js";
import { claudeCodeArgv } from "../dist/coding-agent.js";

const route = Object.freeze({
  deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  capability: "c".repeat(64),
  decisionSha256: "d".repeat(64),
});
test("a routed Claude Code turn has the offline argv and the relay's fixed port", () => {
  assert.equal(modelRoutePort, 18091);
  // The model route reaches Claude Code by environment, so its argv is the
  // offline one and never carries the relay capability.
  assert.equal(
    claudeCodeArgv(undefined).some((arg) => arg.includes(route.capability)),
    false,
  );
});

test("only a well-formed route is valid", () => {
  assert.equal(validModelRoute(route), true);
  for (const changed of [
    undefined,
    null,
    "route",
    { ...route, deliveryId: "not-a-uuid" },
    { ...route, deliveryId: route.deliveryId.toUpperCase() },
    { ...route, capability: "C".repeat(64) },
    { ...route, capability: "c".repeat(63) },
    { ...route, decisionSha256: "x" },
    { ...route, extra: true },
    { deliveryId: route.deliveryId, capability: route.capability },
    { ...route, capability: ["c".repeat(64)] },
    { ...route, deliveryId: [route.deliveryId] },
  ])
    assert.equal(validModelRoute(changed), false, JSON.stringify(changed));
});

const pins = Object.freeze({
  cliVersion: "2.1.311",
  cliSha256: "1".repeat(64),
  policySha256: "3".repeat(64),
  bindingSha256: "4".repeat(64),
});
const routedRequest = () => ({
  operationId: "12345678-1234-4234-8234-123456789abc",
  fence: 1,
  state: "running",
  intent: "start",
  argv: [...claudeCodeArgv(undefined), "{}"],
  branch: "aios/example",
  sourceRevision: "b".repeat(40),
  inputSha256: "e".repeat(64),
  files: [],
  pins: { ...pins },
  modelRoute: { ...route },
  allowanceMs: 1000,
  mayDispatch: () => true,
  checkpoint: () => true,
  onEvent: () => true,
});
const transport = (overrides) => ({
  mode: "controlled",
  inspect: async () => ({ ...pins }),
  run: async () => {
    throw Error("must not run");
  },
  stop: async () => {
    throw Error("unused");
  },
  collect: async () => {
    throw Error("unused");
  },
  ...overrides,
});

// Slice 4a: a routed turn's gateway reaches the transport unchanged; it
// never crosses to the worker, and a route without one is refused. The
// route's capability is the relay's own, never the gateway's (ADR 0002).
const gateway = Object.freeze({
  capability: "d".repeat(64),
  respond: async () => {
    throw Error("unused");
  },
  revoke: () => {},
});

for (const field of ["capability", "decisionSha256"])
  test(`a route ${field} changed while pins are inspected refuses the launch`, async () => {
    const request = routedRequest();
    const runtime = new PinnedCodingRuntime(
      pins,
      transport({
        inspect: async () => {
          request.modelRoute[field] = "f".repeat(64);
          return { ...pins };
        },
      }),
    );
    await assert.rejects(
      runtime.execute(request, gateway),
      /Coding executable or authority changed/,
    );
  });

test("the transport gets the admitted route, not the caller's object", async () => {
  const request = routedRequest();
  let seen;
  const runtime = new PinnedCodingRuntime(
    pins,
    transport({
      run: async (launch) => {
        request.modelRoute.decisionSha256 = "f".repeat(64);
        seen = { ...launch.modelRoute };
        throw Error("stop here");
      },
    }),
  );
  await assert.rejects(runtime.execute(request, gateway), /stop here/);
  assert.deepEqual(seen, route);
});

test("a routed turn's gateway reaches the transport unchanged", async () => {
  let seen;
  const runtime = new PinnedCodingRuntime(
    pins,
    transport({
      run: async (launch, stdout, served) => {
        seen = served;
        throw Error("stop here");
      },
    }),
  );
  await assert.rejects(runtime.execute(routedRequest(), gateway), /stop here/);
  assert.equal(seen, gateway);
});

test("a routed turn without a gateway is refused before the transport runs", async () => {
  const runtime = new PinnedCodingRuntime(pins, transport());
  await assert.rejects(
    runtime.execute(routedRequest()),
    /Coding executable or authority changed/,
  );
});

test("an offline turn never carries a gateway", async () => {
  const request = routedRequest();
  delete request.modelRoute;
  const runtime = new PinnedCodingRuntime(pins, transport());
  await assert.rejects(
    runtime.execute(request, gateway),
    /Coding executable or authority changed/,
  );
});

test("a gateway sharing the relay's capability is refused before the transport runs", async () => {
  const runtime = new PinnedCodingRuntime(pins, transport());
  await assert.rejects(
    runtime.execute(routedRequest(), {
      ...gateway,
      capability: route.capability,
    }),
    /Coding executable or authority changed/,
  );
});
