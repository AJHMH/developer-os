// THROWAWAY live prototype: does empty static MCP plus deny-all remove discovery?
// Run: node .scratch/aios-v1-implementation/mcp-boundary-prototype.mjs
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const executable = join(process.env.LOCALAPPDATA, 'DockerSandboxes/bin/sbx.exe');
const guest = String.raw`
const endpoint=process.env.MCP_GATEWAY_URL;
const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
async function request(method,params,id){
 const r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method,params,...(id===undefined?{}:{id})}),signal:AbortSignal.timeout(10000)});
 const session=r.headers.get('mcp-session-id');if(session)headers['Mcp-Session-Id']=session;
 const body=await r.text();let value;
 for(const line of body.split('\n')){try{value=JSON.parse(line.replace(/^data: /,''));}catch{}}
 return {httpStatus:r.status,value};
}
const initialized=await request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'aios-canary',version:'1'}},1);
headers['MCP-Protocol-Version']='2025-03-26';
await request('notifications/initialized',{});
const tools=await request('tools/list',{},2);
console.log(JSON.stringify({initializeHttp:initialized.httpStatus,toolsHttp:tools.httpStatus,toolNames:tools.value?.result?.tools?.map(t=>t.name),errorCode:tools.value?.error?.code}));
`;
const result=spawnSync(executable,['exec','-i','aios-ticket4-static-empty','node','--input-type=module'],{input:guest,encoding:'utf8',timeout:40000,windowsHide:true});
console.log(result.stdout);
console.log(JSON.stringify({exitCode:result.status}));
