// The boundary probe runs in a network-less container, where busybox wget
// fails a proxy fetch at once. Tests run it on the host instead, where GNU
// wget retries an unroutable gateway for minutes. Point the probe's proxy
// gateways at loopback, where port 3128 refuses at once: only the address
// changes, never the check.
const gateways = "for g in 192.168.127.1 10.0.2.2;";

export function hostProbe(script) {
  if (!script.includes(gateways))
    throw Error("The proxy probe's gateways changed; update host-probe.mjs");
  return script.replace(gateways, "for g in 127.0.0.1;");
}
