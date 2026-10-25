import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  generalSessionLimits,
  type GeneralSessionRevocation,
} from "./general-session-gateway.js";

/** What the relay bridge needs from the session's gateway. */
export interface SessionGateway {
  readonly capability: string;
  respond(
    deliveryId: string,
    capability: string,
    raw: string,
  ): Promise<AsyncIterable<Uint8Array>>;
  revoke(reason: GeneralSessionRevocation): void;
}

const requestBytes = generalSessionLimits.requestBytes;
/** Bounds on the relay channel. A request frame carries one whole body;
 * response bytes cross in chunks of at most `chunkBytes`. */
export const sessionRelayLimits = Object.freeze({
  requestBytes,
  chunkBytes: 65536,
  /** The longest frame either side accepts: one request body, in base64. */
  frameChars: Math.ceil(requestBytes / 3) * 4 + 64,
  /** The guest waits at most 15 s for the relay itself; this also covers
   * the channel's start and the guest's own checks. */
  readyMs: 30000,
  /** The longest the relay waits between response frames. */
  responseGapMs: generalSessionLimits.requestMs + 5000,
});

/** The session relay (ADR 0002). Guest management runs it inside the
 * worker's network namespace; it holds no credential. Its first stdin line is
 * its configuration; later lines are the host's response frames. It forwards
 * only the body of the session's exact Responses request, one at a time, and
 * refuses everything else with an empty 403. When the channel closes, it
 * stops at once. */
export const sessionRelaySource = String.raw`
import json,sys,os,threading,hmac,queue,base64,re
from http.server import HTTPServer,BaseHTTPRequestHandler
from socketserver import TCPServer
C=json.loads(sys.stdin.readline())
frames=queue.Queue()
def emit(value):
 sys.stdout.write(json.dumps(value)+'\n');sys.stdout.flush()
def control():
 try:
  for line in sys.stdin: frames.put(json.loads(line))
 except ValueError: pass
 os._exit(0)
threading.Thread(target=control,daemon=True).start()
class Server(HTTPServer):
 def server_bind(self):
  TCPServer.server_bind(self);self.server_name='127.0.0.1';self.server_port=self.server_address[1]
 def get_request(self):
  connection,address=super().get_request();connection.settimeout(10);return connection,address
count=0
class Handler(BaseHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args): pass
 # Never answer 100-continue: an expectation is refused like any other extra.
 def handle_expect_100(self): return True
 def deny(self):
  self.send_response(403);self.send_header('Content-Length','0');self.send_header('Connection','close');self.end_headers();self.close_connection=True
 # Unknown methods and malformed requests get the same empty 403.
 def send_error(self,code,message=None,explain=None): self.deny()
 def do_GET(self): self.deny()
 do_PUT=do_GET;do_DELETE=do_GET;do_PATCH=do_GET;do_OPTIONS=do_GET;do_HEAD=do_GET;do_CONNECT=do_GET;do_TRACE=do_GET
 def do_POST(self):
  global count
  started=False
  try:
   h=self.headers;auth=h.get_all('Authorization',[]);length=h.get_all('Content-Length',[])
   if self.path!='/v1/responses' or len(auth)!=1 or not hmac.compare_digest(auth[0].encode(),('Bearer '+C['capability']).encode()) or h.get_all('X-AIOS-Delivery')!=[C['deliveryId']]: return self.deny()
   if h.get('Upgrade') or h.get('Transfer-Encoding') or h.get('Content-Encoding') or h.get('Expect') or h.get_content_type()!='application/json': return self.deny()
   if len(length)!=1 or not re.fullmatch('[0-9]{1,9}',length[0]) or not 0<int(length[0])<=C['requestBytes']: return self.deny()
   body=self.rfile.read(int(length[0]))
   if len(body)!=int(length[0]): return self.deny()
   value=json.loads(body.decode('utf-8'))
   if not isinstance(value,dict) or value.get('model')!=C['model']: return self.deny()
   count+=1;emit({'request':count,'body':base64.b64encode(body).decode()})
   # Stay in step with the host until it ends this request, even if the
   # worker has gone; any other frame ends the relay.
   writable=True
   while True:
    try: frame=frames.get(timeout=C['responseGapMs']/1000)
    except queue.Empty: os._exit(1)
    if not isinstance(frame,dict) or frame.get('request')!=count: os._exit(1)
    if set(frame)=={'request','chunk'} and isinstance(frame['chunk'],str):
     data=base64.b64decode(frame['chunk'],validate=True)
     try:
      if not started:
       self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Cache-Control','no-store');self.send_header('Connection','close');self.end_headers();started=True
      if writable: self.wfile.write(data)
     except OSError: writable=False
    elif frame=={'request':count,'end':True}:
     if not started and writable:
      self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Connection','close');self.end_headers()
     break
    elif frame=={'request':count,'refused':True}:
     if not started and writable: self.deny()
     break
    else: os._exit(1)
   self.close_connection=True
  except Exception:
   self.close_connection=True
   if not started:
    try: self.deny()
    except OSError: pass
# Listen only from inside the worker's own network namespace.
if C.get('netns') is not None and os.stat('/proc/self/ns/net').st_ino!=os.stat(C['netns']).st_ino: os._exit(1)
server=Server(('127.0.0.1',C['port']),Handler)
emit({'ready':True,'port':server.server_address[1],'pid':os.getpid()})
server.serve_forever()
`;

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export interface SessionRelay {
  /** True once the channel is lost or closed; the gateway is revoked then. */
  readonly lost: boolean;
  close(): void;
}

/** Bridges an open relay channel to the session's gateway. Resolves with the
 * channel's first frame, its ready report, for the caller to validate. Any
 * misbehaviour, or the channel ending, loses the relay: the gateway is
 * revoked, the in-flight stream is closed and the channel is killed. */
export function openSessionRelay(
  channel: ChildProcessWithoutNullStreams,
  deliveryId: string,
  gateway: SessionGateway,
  readyMs: number = sessionRelayLimits.readyMs,
): Promise<{ ready: Record<string, unknown>; relay: SessionRelay }> {
  const { chunkBytes, frameChars } = sessionRelayLimits;
  let lost = false,
    ready = false,
    busy = false,
    next = 1,
    pending = "",
    diagnostics = 0;
  let reject: (error: Error) => void = () => {};
  const relay: SessionRelay = {
    get lost() {
      return lost;
    },
    close: () => lose(),
  };
  const lose = () => {
    if (lost) return;
    lost = true;
    clearTimeout(timer);
    gateway.revoke("stopped");
    channel.stdin.end();
    channel.kill();
    reject(Error("Session relay unavailable"));
  };
  const timer = setTimeout(lose, readyMs);
  const write = (frame: Record<string, unknown>) =>
    new Promise<void>((resolve) => {
      if (lost || channel.stdin.write(JSON.stringify(frame) + "\n"))
        return resolve();
      const done = () => {
        channel.stdin.off("drain", done);
        channel.off("close", done);
        resolve();
      };
      channel.stdin.once("drain", done);
      channel.once("close", done);
    });
  const forward = async (request: number, body: string) => {
    const raw = Buffer.from(body, "base64");
    let text: string;
    try {
      if (raw.toString("base64") !== body || !raw.length) throw Error();
      if (raw.length > sessionRelayLimits.requestBytes) throw Error();
      text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      return lose();
    }
    let last: Record<string, unknown> = { request, end: true };
    try {
      const stream = await gateway.respond(
        deliveryId,
        gateway.capability,
        text,
      );
      for await (const bytes of stream) {
        if (lost) break;
        const chunk = Buffer.from(bytes);
        for (let at = 0; at < chunk.length && !lost; at += chunkBytes)
          await write({
            request,
            chunk: chunk.subarray(at, at + chunkBytes).toString("base64"),
          });
      }
    } catch {
      // A refusal before any bytes is an empty 403; after, a cut stream.
      last = { request, refused: true };
    }
    // The relay may send its next request as soon as this frame lands.
    busy = false;
    if (!lost) await write(last);
  };
  channel.on("error", lose);
  channel.on("close", lose);
  channel.stdin.on("error", lose);
  channel.stderr.on("data", (bytes: Buffer) => {
    if ((diagnostics += bytes.length) > 1048576) lose();
  });
  return new Promise((accept, fail) => {
    reject = fail;
    channel.stdout.on("data", (bytes: Buffer) => {
      if (lost) return;
      pending += bytes.toString("latin1");
      for (let index; (index = pending.indexOf("\n")) >= 0; ) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        let frame: unknown;
        try {
          if (line.length > frameChars) throw Error();
          frame = JSON.parse(line);
        } catch {
          return lose();
        }
        if (!ready) {
          if (!object(frame)) return lose();
          ready = true;
          clearTimeout(timer);
          accept({ ready: frame, relay });
          continue;
        }
        if (
          busy ||
          !object(frame) ||
          Object.keys(frame).sort().join(",") !== "body,request" ||
          frame.request !== next ||
          typeof frame.body !== "string"
        )
          return lose();
        busy = true;
        void forward(next++, frame.body);
      }
      if (pending.length > frameChars) lose();
    });
  });
}
