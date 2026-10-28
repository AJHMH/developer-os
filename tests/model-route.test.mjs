import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PinnedCodingRuntime,
  lockedCodingArgv,
  modelRoutePort,
  modelRouteVariable,
  validModelRoute,
} from "../dist/feature-candidate.js";

const route = Object.freeze({
  deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  capability: "c".repeat(64),
  decisionSha256: "d".repeat(64),
});
const thread = "11111111-2222-4333-8444-555555555555";
// ADR 0002: fixed provider overrides, no config.toml, the pinned model, and
// the container as the only sandbox.
const overrides = [
  "-c",
  'model_provider="aios"',
  "-c",
  'model_providers.aios.name="AIOS session relay"',
  "-c",
  'model_providers.aios.base_url="http://127.0.0.1:18091/v1"',
  "-c",
  'model_providers.aios.env_key="AIOS_MODEL_ROUTE"',
  "-c",
  'model_providers.aios.wire_api="responses"',
  "-c",
  "model_providers.aios.requires_openai_auth=false",
  "-c",
  "model_providers.aios.supports_websockets=false",
  "-c",
  `model_providers.aios.http_headers.X-AIOS-Delivery="${route.deliveryId}"`,
  "-c",
  'model="gpt-6.1-sol"',
];

test("an offline turn keeps the locked workspace-write argv", () => {
  assert.deepEqual(lockedCodingArgv(undefined), [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
  ]);
  assert.deepEqual(lockedCodingArgv(thread), [
    "exec",
    "resume",
    "--json",
    "--skip-git-repo-check",
    "-c",
    'sandbox_mode="workspace-write"',
    thread,
  ]);
});

test("a model route adds only the fixed relay overrides and full access inside the container", () => {
  assert.equal(modelRoutePort, 18091);
  assert.equal(modelRouteVariable, "AIOS_MODEL_ROUTE");
  assert.deepEqual(lockedCodingArgv(undefined, route), [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    "danger-full-access",
    ...overrides,
  ]);
  assert.deepEqual(lockedCodingArgv(thread, route), [
    "exec",
    "resume",
    "--json",
    "--skip-git-repo-check",
    "-c",
    'sandbox_mode="danger-full-access"',
    ...overrides,
    thread,
  ]);
  // The relay capability travels by environment, never on the command line.
  assert.equal(
    lockedCodingArgv(undefined, route).some((arg) =>
      arg.includes(route.capability),
    ),
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
  cliVersion: "0.161.0",
  cliSha256: "1".repeat(64),
  codeModeHostSha256: "2".repeat(64),
  policySha256: "3".repeat(64),
  bindingSha256: "4".repeat(64),
});
const routedRequest = () => ({
  operationId: "12345678-1234-4234-8234-123456789abc",
  fence: 1,
  state: "running",
  intent: "start",
  argv: [...lockedCodingArgv(undefined, route), "{}"],
  branch: "codex/example",
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
// never crosses to the worker, and a route without one is refused.
const gateway = Object.freeze({
  capability: route.capability,
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
  request.argv = [...lockedCodingArgv(undefined), "{}"];
  const runtime = new PinnedCodingRuntime(pins, transport());
  await assert.rejects(
    runtime.execute(request, gateway),
    /Coding executable or authority changed/,
  );
});

test("a gateway for another capability is refused before the transport runs", async () => {
  const runtime = new PinnedCodingRuntime(pins, transport());
  await assert.rejects(
    runtime.execute(routedRequest(), {
      ...gateway,
      capability: "f".repeat(64),
    }),
    /Coding executable or authority changed/,
  );
});
