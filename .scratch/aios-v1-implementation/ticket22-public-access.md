# Ticket 22 public online-access gate

`DeliveryController.onlineCanary(id)` and CLI `online-canary --id <delivery-id>`
exercise the fixed synthetic model/dependency boundary. The public controller
requires current trusted qualification, the ticket 21 historical positive
capability, exclusive ownership and stopped execution. It never changes
`ready`, `liveReady` or `productionEnabled` to true.

The worker runs without a network interface. A trusted guest relay joins its
private network namespace and accepts only one fixed synthetic model request and
one fixed dependency fetch. Separate one-use capabilities bind each route to the
run. The outer controller supplies fixture responses only after a fresh
account/window usage check. Host, MCP, arbitrary-host, redirect, CONNECT,
upgrade, wrong-body, wrong-capability and replay attempts are refused. Shutdown
revokes the relay and independently verifies zero remaining worker/relay
processes; uncertainty remains a recovery blocker.

A dependency pin is an optional private external JSON file with schema 1, the
literal `https://registry.npmjs.org` registry, one exact tarball path, byte count
and SHA-256. The host refuses redirects, encoded/alternate paths, changed bytes,
oversized archives and candidate-owned policy. It forwards only verified bytes;
it never installs or executes package content. The ticket 22 native receipts
record controlled synthetic artifact input and no public registry request.

For 20% or less remaining, unknown usage, or changed windows, owner approval is
fresh, account/window scoped and consumed by one run. Exhaustion cannot be
approved. Polling rechecks usage during a foreground run and revokes on exhaustion
or lost authority. Restart/re-dispatch requires a new check and approval. Live
inference adapters additionally require an exact prepared plan (one fixed request,
account, host, VM/policy/source identity, 30-second deadline, one request, no
retry, refresh or paid fallback). Tests verify the exact approval is consumed
before adapter effects.

The latest native result is in `ticket22-native-observation.json`. It uses the
current source policy version and the approved pinned VM binding, and proves only
synthetic traffic to VM-local fixtures with a synthetic high-remaining usage
report. The public test suite has 136 passing tests. Ticket 22 does not authorize
production delivery. No actual provider inference or public npm registry request
was run; a future live run needs an exact prepared plan approved by the owner.
