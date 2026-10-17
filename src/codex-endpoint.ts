/** Credential-free Responses fixture. Runs in trusted rootless management,
 * joining only the worker network namespace. It has no upstream or owner token.
 * Its grant is bound to one delivery, namespace, deadline and request budget. */
export const codexEndpointFixture = String.raw`
import json,sys,os,time,threading,hmac,hashlib,base64,queue
from http.server import HTTPServer,BaseHTTPRequestHandler
from socketserver import TCPServer
C=json.loads(sys.stdin.readline()); revoked=threading.Event(); accepted=0; deadline=time.monotonic()+C['ttl']
armed=False
contract=C['contract'];marker=contract['marker']
responses=queue.Queue(maxsize=1)
def emit(value): print(json.dumps(value),flush=True)
def control():
 global deadline,armed
 for line in sys.stdin:
  if json.loads(line)=={'action':'revoke','deliveryId':C['deliveryId']}:
   revoked.set();emit({'revoked':True,'deliveryId':C['deliveryId']})
  elif C.get('armable') is True and not C.get('gateway') and not armed and accepted==1 and time.monotonic()<deadline and json.loads(line)=={'action':'arm-expiry','deliveryId':C['deliveryId']}:
   deadline=min(deadline,time.monotonic()+1.5);armed=True
   threading.Thread(target=expire,daemon=True).start()
   emit({'expiryArmed':True,'deliveryId':C['deliveryId']})
  elif C.get('gateway'):
   value=json.loads(line)
   if set(value)=={'gatewayResponse','deliveryId'} and value['deliveryId']==C['deliveryId']: responses.put_nowait(value['gatewayResponse'])
 os._exit(0)
threading.Thread(target=control,daemon=True).start()
def expire():
 time.sleep(max(0,deadline-time.monotonic()));revoked.set();os._exit(0)
threading.Thread(target=expire,daemon=True).start()
class Server(HTTPServer):
 def server_bind(self):
  TCPServer.server_bind(self);self.server_name='127.0.0.1';self.server_port=self.server_address[1]
 def get_request(self):
  connection,address=super().get_request();connection.settimeout(2);return connection,address
class Handler(BaseHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args): pass
 def deny(self):
  self.send_response(403);self.send_header('Content-Length','0');self.send_header('Connection','close');self.end_headers();self.close_connection=True
 def do_GET(self): self.deny()
 do_PUT=do_GET;do_DELETE=do_GET;do_PATCH=do_GET;do_OPTIONS=do_GET;do_CONNECT=do_GET;do_HEAD=do_GET
 def do_POST(self):
  global accepted
  self.connection.settimeout(2)
  try:
   if self.path!='/v1/responses' or revoked.is_set() or time.monotonic()>=deadline or accepted>=C['budget']: return self.deny()
   if len(self.headers.get_all('Authorization',[]))!=1 or self.headers.get_all('X-AIOS-Delivery')!=[C['deliveryId']]: return self.deny()
   if not hmac.compare_digest(self.headers['Authorization'],'Bearer '+C['capability']): return self.deny()
   if self.headers.get('Upgrade') or self.headers.get('Transfer-Encoding') or self.headers.get('Content-Encoding'): return self.deny()
   if self.headers.get_content_type()!='application/json' or len(self.headers.get_all('Content-Length',[]))!=1: return self.deny()
   size=int(self.headers['Content-Length'])
   if size<1 or size>65536: return self.deny()
   if C.get('armable') is True and not C.get('gateway') and accepted==1:
    emit({'bodyReadPending':True,'deliveryId':C['deliveryId']})
   body=self.rfile.read(size)
   if len(body)!=size: return self.deny()
   value=json.loads(body)
   if not isinstance(value,dict) or value.get('model')!=contract['model'] or value.get('stream') is not True or value.get('store') is not False: return self.deny()
   items=value.get('input');tools=value.get('tools',[])
   if not isinstance(items,list) or not isinstance(tools,list): return self.deny()
   if any(not isinstance(item,dict) or ('type' in item and item['type'] not in contract['inputTypes']) or item.get('role') not in contract['roles'] for item in items): return self.deny()
   users=[item for item in items if item.get('role')=='user']
   def text(item):
    content=item.get('content')
    if isinstance(content,str): return content
    if isinstance(content,list) and len(content)==1 and isinstance(content[0],dict) and content[0].get('type')==contract['inputTextType']: return content[0].get('text')
   if not users or text(users[-1])!=contract['prompt']: return self.deny()
   if any(not isinstance(tool,dict) or tool.get('type')!=contract['toolType'] or not isinstance(tool.get('name'),str) or tool['name'].startswith(contract['forbiddenToolPrefix']) for tool in tools): return self.deny()
   if revoked.is_set() or time.monotonic()>=deadline or accepted>=C['budget']: return self.deny()
   accepted+=1
   data=base64.b64decode(contract['responseBase64'],validate=True)
   emit({'accepted':accepted,'deliveryId':C['deliveryId'],'requestSha256':hashlib.sha256(body).hexdigest()})
   if C.get('gateway'):
    emit({'gatewayRequest':base64.b64encode(body).decode(),'deliveryId':C['deliveryId'],'capability':C['capability']})
    data=base64.b64decode(responses.get(timeout=max(0.01,deadline-time.monotonic())),validate=True)
    if not data or len(data)>65536: return self.deny()
   if revoked.is_set() or time.monotonic()>=deadline: return self.deny()
   self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(data)));self.send_header('Connection','close');self.end_headers();self.wfile.write(data);self.close_connection=True
  except Exception: self.deny()
server=Server(('127.0.0.1',C['port']),Handler)
emit({'ready':True,'deliveryId':C['deliveryId']})
server.timeout=0.2
while time.monotonic()<deadline: server.handle_request()
revoked.set();server.server_close()
`;
