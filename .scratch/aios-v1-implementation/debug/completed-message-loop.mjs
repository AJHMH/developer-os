// Offline diagnostic harness. These are synthetic witnesses, not captured live responses.
import assert from 'node:assert/strict';
import { HostSubscriptionGateway, gatewayRequest, gatewayMarker, syntheticGatewayAccount, syntheticGatewayApproval } from '../../../dist/subscription-gateway.js';
const variant = process.argv[2] ?? 'matching';
const completedOutputs = {
  matching: [{type:'message',role:'assistant',content:[{type:'output_text',text:gatewayMarker}]}],
  omitted: [],
  observed: [],
  whitespace: [{type:'message',role:'assistant',content:[{type:'output_text',text:gatewayMarker+'\n'}]}],
  different: [{type:'message',role:'assistant',content:[{type:'output_text',text:'synthetic different result'}]}],
};
assert.ok(Object.hasOwn(completedOutputs, variant), 'Unknown synthetic variant');
const events = [
  {type:'response.output_text.delta',delta:gatewayMarker},
  ...(variant === 'observed' ? [{type:'response.output_text.done',text:gatewayMarker}] : []),
  {type:'response.completed',response:{status:'completed',output:completedOutputs[variant]}},
];
const body = Buffer.from(events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''));
const account = syntheticGatewayAccount();
const delivery = '00000000-0000-4000-8000-000000000021';
const gateway = new HostSubscriptionGateway(syntheticGatewayApproval(delivery,account),()=>account,async()=>body);
let accepted = false;
try { await gateway.respond(delivery,gateway.capability,gatewayRequest); accepted=true; }
catch { /* Report only safe diagnostics. */ }
finally { gateway.revoke(); }
const {completed,failed,deltaMatches,completedOutputPresent,completedOutputAllowed,completedTextMatches} = gateway.observation.stream;
console.log(JSON.stringify({synthetic:true,variant,accepted,stream:gateway.observation.stream}));
// Red-capable acceptance probe. A mismatch is deliberately refused by the real gateway.
assert.equal(accepted,true,'Gateway withheld synthetic completed-message discrepancy');
