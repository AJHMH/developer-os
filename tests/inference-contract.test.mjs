import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { codexEndpointFixture } from "../dist/codex-endpoint.js";
import {
  inferenceFixtureContract,
  matchesInferenceRequest,
  syntheticGatewayResponse,
} from "../dist/inference-contract.js";
test("host predicate and full Python endpoint agree on the fixed inference contract", () => {
  const contract = inferenceFixtureContract();
  const good = contract.request;
  const cases = [
    good,
    {
      ...good,
      input: [{ role: "developer", content: "fixed context" }, ...good.input],
    },
    {
      ...good,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: contract.prompt }],
        },
      ],
    },
    { ...good, tools: [{ type: "function", name: "ordinary" }] },
    null,
    {},
    { ...good, tools: null },
    { ...good, model: "other" },
    { ...good, stream: false },
    { ...good, store: true },
    { ...good, input: [] },
    { ...good, input: [...good.input, { role: "user", content: "different" }] },
    { ...good, input: [{ role: "assistant", content: contract.prompt }] },
    {
      ...good,
      input: [
        { role: "user", type: "function_call", content: contract.prompt },
      ],
    },
    { ...good, tools: [{ type: "function", name: "mcp__host" }] },
    { ...good, tools: [null] },
  ].map(JSON.stringify);
  cases.push("invalid json", "x".repeat(65537));
  const result = spawnSync(
    process.env.AIOS_TEST_PYTHON ?? "python",
    [
      "-c",
      String.raw`
import json,sys,subprocess,socket,http.client,base64,tempfile
config=json.loads(sys.stdin.readline());source=sys.stdin.read()
reserve=socket.socket();reserve.bind(('127.0.0.1',0));port=reserve.getsockname()[1];reserve.close()
with tempfile.TemporaryFile() as errors:
 p=subprocess.Popen([sys.executable,'-u','-c',source],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=errors,text=True)
 try:
  p.stdin.write(json.dumps(dict(port=port,deliveryId='contract',capability='fixture',budget=len(config['cases'])+1,ttl=30,gateway=False,contract=config['contract']))+'\n');p.stdin.flush()
  assert json.loads(p.stdout.readline())['ready'] is True
  results=[]
  for body in config['cases']:
   connection=http.client.HTTPConnection('127.0.0.1',port,timeout=3)
   connection.request('POST','/v1/responses',body=body.encode(),headers={'Authorization':'Bearer fixture','X-AIOS-Delivery':'contract','Content-Type':'application/json'})
   response=connection.getresponse();data=response.read();results.append(dict(status=response.status,body=base64.b64encode(data).decode()));connection.close()
  print(json.dumps(results))
 finally:
  p.kill();p.wait(timeout=3)
`,
    ],
    {
      input: JSON.stringify({ contract, cases }) + "\n" + codexEndpointFixture,
      encoding: "utf8",
      timeout: 45000,
      maxBuffer: 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  for (let i = 0; i < cases.length; i++) {
    const accepted = matchesInferenceRequest(cases[i]);
    assert.equal(observed[i].status, accepted ? 200 : 403, `case ${i}`);
    if (accepted)
      assert.deepEqual(
        Buffer.from(observed[i].body, "base64"),
        syntheticGatewayResponse(),
      );
  }
});
