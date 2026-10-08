// THROWAWAY: positive-control endpoint and offline worker network denial.
// Run: node .scratch/aios-v1-implementation/podman-network-prototype.mjs
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
const exe=join(process.env.LOCALAPPDATA,'Programs/Podman/podman.exe');
const suffix=randomUUID().slice(0,8);
const network=`aios-network-${suffix}`;
const service=`aios-http-${suffix}`;
const token=`AIOS-SYNTHETIC-${suffix}`;
const image='docker.io/library/alpine@sha256:3e9b4b680bfc9fb5269227cffbd6d42be39fbf7c0b908123913864aa4447e764';
function run(args){
 const result=spawnSync(exe,['--connection','aios-podman-noshare',...args],{encoding:'utf8',timeout:30000,windowsHide:true});
 if(result.error||result.status!==0)throw Error(`Command failed: ${args[0]} (exit ${result.status})`);
 return result.stdout.trim();
}
const restrictions=['--pull=never','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user=65534:65534'];
let created=false;
try{
 run(['network','create',network]);
 run(['run','-d','--name',service,'--network',network,...restrictions,image,'sh','-c',`while true; do printf 'HTTP/1.1 200 OK\\r\\nContent-Length: ${token.length}\\r\\nConnection: close\\r\\n\\r\\n${token}' | nc -l -p 8080 -w 2; done`]);
 created=true;
 const inspect=JSON.parse(run(['inspect',service]))[0];
 const address=inspect.NetworkSettings.Networks[network].IPAddress;
 if(!/^\d+\.\d+\.\d+\.\d+$/.test(address))throw Error('No verified IPv4 endpoint');
 const endpoint=`http://${address}:8080/canary`;
 const control=run(['run','--name',`aios-control-${suffix}`,'--network',network,...restrictions,image,'wget','-q','-T','3','-O','-',endpoint]);
 if(control!==token)throw Error('Positive control did not receive synthetic token');
 console.log(JSON.stringify({positiveControl:'passed',endpoint,tokenMatched:true}));
 const worker=run(['run','--name',`aios-offline-${suffix}`,'--network=none',...restrictions,image,'sh','-c',`if wget -q -T 3 -O /dev/null '${endpoint}'; then echo UNEXPECTED_ACCESS; else echo DENIED; fi; ip route`]);
 console.log(JSON.stringify({offlineWorker:worker==='DENIED'?'denied':'failed-or-unexpected',observed:worker}));
 const secondControl=run(['run','--name',`aios-control-after-${suffix}`,'--network',network,...restrictions,image,'wget','-q','-T','3','-O','-',endpoint]);
 console.log(JSON.stringify({positiveControlAfter:secondControl===token?'passed':'failed'}));
 if(worker!=='DENIED'||secondControl!==token)throw Error('Network boundary not established');
}finally{
 if(created)run(['stop','--time','2',service]);
 console.log(JSON.stringify({retainedNetwork:network,retainedService:service,serviceStopAttempted:created}));
}
