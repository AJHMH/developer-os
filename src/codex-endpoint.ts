/** Credential-free Responses fixture. Runs in trusted rootless management,
 * joining only the worker network namespace. It has no upstream or owner token.
 * Its grant is bound to one delivery, namespace, deadline and request budget. */
export const codexEndpointFixture = String.raw`
import json,sys,os,time,threading,hmac,hashlib,base64,queue
from http.server import HTTPServer,BaseHTTPRequestHandler
C=json.loads(sys.stdin.readline()); revoked=threading.Event(); accepted=0; deadline=time.monotonic()+C['ttl']
marker='AIOS model-only inference complete'
responses=queue.Queue(maxsize=1)
def emit(value): print(json.dumps(value),flush=True)
def control():
 for line in sys.stdin:
  if json.loads(line)=={'action':'revoke','deliveryId':C['deliveryId']}:
   revoked.set();emit({'revoked':True,'deliveryId':C['deliveryId']})
  elif C.get('gateway'):
   value=json.loads(line)
   if set(value)=={'gatewayResponse','deliveryId'} and value['deliveryId']==C['deliveryId']: responses.put_nowait(value['gatewayResponse'])
 os._exit(0)
threading.Thread(target=control,daemon=True).start()
def expire():
 time.sleep(max(0,deadline-time.monotonic()));revoked.set();os._exit(0)
threading.Thread(target=expire,daemon=True).start()
class Server(HTTPServer):
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
   body=self.rfile.read(size)
   if len(body)!=size: return self.deny()
   value=json.loads(body)
   if value.get('model')!='gpt-6.1-sol' or value.get('stream') is not True or value.get('store') is not False: return self.deny()
   users=[i for i in value.get('input',[]) if i.get('role')=='user']
   if not any(i.get('content')=='Say exactly: '+marker or any(p.get('text')=='Say exactly: '+marker for p in i.get('content',[]) if isinstance(p,dict)) for i in users): return self.deny()
   if any(t.get('name','').startswith('mcp__') or t.get('type') not in ['function'] for t in value.get('tools',[])): return self.deny()
   if revoked.is_set() or time.monotonic()>=deadline or accepted>=C['budget']: return self.deny()
   accepted+=1
   item={'id':'msg_aios_fixture','type':'message','role':'assistant','status':'completed','content':[{'type':'output_text','text':marker,'annotations':[]}]}
   response={'id':'resp_aios_fixture','object':'response','status':'completed','model':'gpt-6.1-sol','output':[item],'usage':{'input_tokens':0,'output_tokens':0,'total_tokens':0}}
   events=[{'type':'response.created','response':{**response,'status':'in_progress','output':[]}}, {'type':'response.output_item.added','output_index':0,'item':{**item,'status':'in_progress','content':[]}}, {'type':'response.content_part.added','item_id':item['id'],'output_index':0,'content_index':0,'part':{'type':'output_text','text':'','annotations':[]}}, {'type':'response.output_text.delta','item_id':item['id'],'output_index':0,'content_index':0,'delta':marker}, {'type':'response.output_text.done','item_id':item['id'],'output_index':0,'content_index':0,'text':marker}, {'type':'response.content_part.done','item_id':item['id'],'output_index':0,'content_index':0,'part':item['content'][0]}, {'type':'response.output_item.done','output_index':0,'item':item}, {'type':'response.completed','response':response}]
   data=b''.join(('event: '+e['type']+'\ndata: '+json.dumps(e)+'\n\n').encode() for e in events)
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
