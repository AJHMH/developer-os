import { inferenceFixtureContract } from "../dist/inference-contract.js";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { codexEndpointFixture } from "../dist/codex-endpoint.js";

test("synthetic expiry arms after slow client setup and interrupts a confirmed body read", (t) => {
  const result = spawnSync(
    process.env.AIOS_TEST_PYTHON ?? "python",
    [
      "-c",
      String.raw`
import sys,subprocess,json,socket,time,tempfile,threading,queue
contract=json.loads(sys.stdin.readline())
origin=time.monotonic()
def phase(name):print("expiry-phase "+name+" "+str(round(time.monotonic()-origin,3))+"s",file=sys.stderr,flush=True)
phase("python-started")
source="import time,socket; time.sleep(3.2)\ndef forbidden_dns(*args):raise RuntimeError('loopback fixture must not resolve hostnames')\nsocket.getfqdn=forbidden_dns\n"+sys.stdin.read();identity='expiry-fixture';cap='synthetic'
reserve=socket.socket();reserve.bind(('127.0.0.1',0));port=reserve.getsockname()[1];reserve.close()
errors=tempfile.TemporaryFile()
phase('starting-child')
p=subprocess.Popen([sys.executable,'-u','-c',source],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=errors,bufsize=0)
sockets=[];events=queue.Queue()
def read_events():
 for line in iter(p.stdout.readline,b''):events.put(line)
 events.put(None)
threading.Thread(target=read_events,daemon=True).start()
def event(timeout=10):
 try:
  line=events.get(timeout=timeout)
  if line is None:raise queue.Empty
  return json.loads(line)
 except queue.Empty:
  errors.seek(0);raise AssertionError('missing expiry event; child stderr: '+errors.read().decode())
def control(value):p.stdin.write((json.dumps(value)+'\n').encode());p.stdin.flush()
body=json.dumps({'model':'gpt-6.1-sol','store':False,'stream':True,'input':[{'role':'user','content':'Say exactly: AIOS model-only inference complete'}]}).encode()
header=('POST /v1/responses HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer '+cap+'\r\nX-AIOS-Delivery: '+identity+'\r\nContent-Type: application/json\r\nContent-Length: '+str(len(body))+'\r\nConnection: close\r\n\r\n').encode()
try:
 control({'port':port,'deliveryId':identity,'capability':cap,'budget':2,'ttl':60,'armable':True,'gateway':False,'contract':contract})
 assert event()=={'ready':True,'deliveryId':identity}
 phase('server-ready')
 time.sleep(1.8) # Reproduces setup latency longer than the old 1.5-second grant.
 phase('connecting-first-request')
 first=socket.create_connection(('127.0.0.1',port));sockets.append(first);first.settimeout(3);first.sendall(header+body)
 response=b''
 while True:
  chunk=first.recv(65536)
  if not chunk:break
  response+=chunk
 assert response.startswith(b'HTTP/1.1 200 ')
 assert event()['accepted']==1
 phase('first-request-accepted')
 slow=socket.create_connection(('127.0.0.1',port));sockets.append(slow);slow.settimeout(3);slow.sendall(header+body[:-1])
 assert event()=={'bodyReadPending':True,'deliveryId':identity}
 phase('body-read-pending')
 started=time.monotonic();control({'action':'arm-expiry','deliveryId':identity})
 assert event()=={'expiryArmed':True,'deliveryId':identity}
 phase('expiry-armed')
 time.sleep(0.5);control({'action':'arm-expiry','deliveryId':identity}) # Cannot extend.
 p.wait(timeout=2.1)
 phase('child-exited')
 assert p.returncode==0
 try:assert slow.recv(4096)==b''
 except ConnectionResetError:pass # Windows reports abrupt process-exit closure as RST.
 assert 1.0<time.monotonic()-started<2.4
finally:
 for s in sockets:s.close()
 if p.poll() is None:p.kill()
 p.wait(timeout=3);errors.close()
print('pending read interrupted without extending grant')
`,
    ],
    {
      input:
        JSON.stringify(inferenceFixtureContract()) +
        "\n" +
        codexEndpointFixture,
      encoding: "utf8",
      timeout: 20000,
    },
  );
  t.diagnostic(result.stderr);
  assert.equal(
    result.status,
    0,
    JSON.stringify({ error: result.error?.code, signal: result.signal }) +
      "\n" +
      result.stderr,
  );
  assert.equal(
    result.stdout.trim(),
    "pending read interrupted without extending grant",
  );
});

test("expiry arming cannot extend a lease or alter a gateway grant", () => {
  const result = spawnSync(
    process.env.AIOS_TEST_PYTHON ?? "python",
    [
      "-c",
      String.raw`
import ast,sys,json
source=sys.stdin.read();program=ast.parse(source);branch=next(n for n in ast.walk(program) if isinstance(n,ast.If) and "C.get('armable')" in ast.unparse(n.test))
class Clock:
 def monotonic(self):return 42
time=Clock();line=json.dumps({'action':'arm-expiry','deliveryId':'fixture'});events=[]
class Thread:
 def __init__(self,**kwargs):assert kwargs=={'target':expire,'daemon':True}
 def start(self):events.append('timer')
class Threads:Thread=Thread
threading=Threads()
def expire():pass
def emit(value):events.append(value)
for gateway,enabled,count,already,by,allowed in [(False,True,1,False,42.25,True),(True,True,1,False,60,False),(False,False,1,False,60,False),(False,True,0,False,60,False),(False,True,1,True,60,False),(False,True,1,False,41,False)]:
 C={'gateway':gateway,'armable':enabled,'deliveryId':'fixture'};accepted=count;armed=already;deadline=by;events=[]
 permit=eval(compile(ast.Expression(branch.test),'actual-arm-guard','eval'))
 assert permit==allowed
 if permit:
  exec(compile(ast.fix_missing_locations(ast.Module(body=branch.body,type_ignores=[])),'actual-arm','exec'))
  assert deadline==by and armed and events==['timer',{'expiryArmed':True,'deliveryId':'fixture'}]
 else:assert deadline==by and events==[]
print('only a ready synthetic lease can be shortened')
`,
    ],
    { input: codexEndpointFixture, encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    "only a ready synthetic lease can be shortened",
  );
});
