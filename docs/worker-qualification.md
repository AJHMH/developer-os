# Offline general-worker qualification (Issue 04)

`scripts/run-native-worker-qualification.mjs` is an owner-run, offline,
adversarial check of both general workers on the Mac's dedicated VM. It runs
under the owner's coding and validation admission records. It opens no
credentials, authorizes no inference and never enables production. A passing
report is evidence for the owner to judge, not a qualification decision.

## What it checks

| Issue 04 criterion                                | Coding worker                                           | Validation worker                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1. Changed pins refuse                            | Each changed pin is refused by the pinned runtime       | Same                                                                                                                     |
| 2. Only admitted files enter                      | The boundary probe, run in a live session               | The boundary probe, one check per probe                                                                                  |
| 3. No host shares, sockets, management or network | Same probe                                              | Same probe                                                                                                               |
| 5. Lifecycle controls                             | A detached descendant removed by the exact session stop | Descendants killed at the guest deadline; a stop mid-check; a late check fenced; a changed tree never reported as tested |
| 6. Retained results                               | Every stage and probe, failed ones included             | Same                                                                                                                     |

The **boundary probe** (`src/worker-probes.ts`) is one fixed line of shell. It
uses only the busybox tools of the pinned Alpine images and first proves each
tool exists, so a missing tool fails instead of passing. It checks:

- **Positive control:** the admitted file is visible, and it is the
  workspace's only entry, so there is no `.git` or other content.
- **Excluded content:**
  - no owner home or guest-private management state;
  - no `.ssh`, `.gnupg`, `.gitconfig`, `gh` config, `.netrc` or `.aws` in the
    worker's home;
  - in the worker's home: no MCP servers in `config.toml`; no `hooks.json`,
    `rules` or `AGENTS.md`; and a `skills` folder only if its sole entry is
    `.system`, Codex's own bundled skills, which it regenerates on every
    start;
  - no engine or management sockets;
  - no credential variables.
- **Mounts and network:** no host-share mounts, loopback-only networking, and
  no outbound connection, the npm registry included. The registry check uses
  plain HTTP, so a missing TLS client can't make it pass.
- **Hardening:** the root mount is read-only by its own mount options, and the
  user is 65534.
- **Escapes:** `unshare`, `chroot` and cgroup escapes are refused.

Adding the probe changed the coding guest program, so its `policySha256`
changed. The owner coding admission therefore needs one re-approval before
this runs.

The coding worker runs the **coding probe**: the shared probes, then five of
its own. Its third argument is the session's mode, `routed` or `offline`,
which the guest takes from the session's own record and the caller never
chooses.

- **`relay-listener`:** a routed worker has exactly one listening socket, the
  session relay on 127.0.0.1:18091. An offline worker has none. Neither has an
  IPv6 listener.
- **`relay-answers`:** a routed worker's GET to the relay gets the relay's
  empty 403. That shows the route is reachable, without reaching the gateway
  or counting a request. It is tried up to three times, five seconds each,
  because the relay serves one request at a time. An offline worker's
  connection must be refused, since any HTTP answer would mean something is
  listening.
- **`read-only-binaries`:** `/codex` and `/codex-code-mode-host` are mounted
  read-only, according to `/proc/self/mountinfo`, and refuse writes. The mount
  is the real check: a running executable refuses writes anyway, and the
  container user owns the files.
- **`hardened-process`:** the process has no effective capabilities, has
  `NoNewPrivs` set, and runs under a seccomp filter.
- **`writable-only-work`:** a file can be created, then removed, in
  `/workspace` and `/session`. Writes to `/`, `/etc`, `/usr`, `/bin`, `/lib`,
  `/root`, `/home`, `/opt`, `/var`, `/srv`, `/etc/hosts`, `/etc/hostname` and
  `/etc/resolv.conf` are refused.

  Podman's in-memory tmpfs mounts (`/tmp`, `/var/tmp`, `/run` and
  `/dev/shm`) stay writable. They are private to the container and gone when
  it stops, and bootstrap needs `/tmp/launch`. The guest separately pins the
  container's bind mounts to exactly four.

  Codex runs with `danger-full-access`, so these are the container's own
  limits, whatever Codex's sandbox would allow. The probe runs as the
  container user, the same identity Codex has.

The coding guest runs the probe inside the exact live session. It passes the
session's own management record as the private path, confirming first that the
record exists. The probe is part of the coding guest program, so it is covered
by the coding `policySha256`.

Validation runs the probe as checks, which return only an exit code. Each check
therefore passes only when its own probe's line reads `passed-`. Validation's
private path is the guest's validation state directory. The validation guest
cannot confirm that path to the check, so the owner-home probe is the stronger
evidence there.

## Provisioning the code-mode host

The coding worker needs the code-mode host beside its CLI (ADR 0002
amendment). It comes from the same official package as the pinned CLI. The
guest refuses to inspect, prepare or launch unless the file is in VM
management storage, private to the guest user, and matches its pin:

| Package                             | `codex-code-mode-host` SHA-256                                     |
| ----------------------------------- | ------------------------------------------------------------------ |
| `@openai/codex@0.161.0-linux-arm64` | `64efe2950af9d8ac9e9b94b0aac5e41f56307422e34e66a4217aaea0a221fed0` |

Run the block in one terminal, in order, with the VM running. The copy uses a
relative path from the folder the first line moves into. The last command
prints the guest's hash, which must match the table.

```sh
D=$(mktemp -d) && cd "$D" && npm pack --ignore-scripts @openai/codex@0.161.0-linux-arm64 && tar -xzf openai-codex-0.161.0-linux-arm64.tgz && shasum -a 256 package/vendor/aarch64-unknown-linux-musl/bin/codex-code-mode-host
/opt/podman/bin/podman machine cp package/vendor/aarch64-unknown-linux-musl/bin/codex-code-mode-host aios-macos-noshare:/var/home/core/.local/state/aios-offline-v1/codex-code-mode-host-0.161.0
/opt/podman/bin/podman machine ssh aios-macos-noshare 'chmod 600 ~/.local/state/aios-offline-v1/codex-code-mode-host-0.161.0 && sha256sum ~/.local/state/aios-offline-v1/codex-code-mode-host-0.161.0'
```

The owner coding admission record then needs re-approval. The new pin
`codeModeHostSha256` is part of the record, and the coding guest program,
and with it `policySha256`, changed.

## Provisioning the Claude Code CLI

Claude Code replaces Codex as the coding agent (ADR 0008). The coding guest
runs the native `claude` binary from the official per-platform package for the
guest, which is musl Linux on arm64. The binary links only musl's libc, which
the Alpine offline template provides. The pin is `claudeCode` in
`src/host-target.ts`:

| Package                                              | Registry integrity                                                                                | `claude` SHA-256                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `@anthropic-ai/claude-code-linux-arm64-musl@2.1.311` | `sha512-ymSGc6vv0QCcVQZCC2JG03P/upLraox+iXAG1DfnUU1OZBCIR9QncxINBEp6QgnKbqywwR2/ic3GD8hAz0Tiow==` | `172150e3f9ea07e8e2e2e29862d7d9a25f5c234d8e909e4063df237665bf09b9` |

The Claude Code guest program (`claudeGuest` in `src/podman-coding.ts`)
refuses to inspect, prepare or launch unless the file is in VM management
storage, private to the guest user, and matches the pin. No delivery runs that
guest yet. Run the block in one terminal, in order, with the
VM running. `npm pack` checks the registry integrity as it downloads, and
`--ignore-scripts` runs nothing from the package. The last command prints the
guest's hash, which must match the table.

```sh
D=$(mktemp -d) && cd "$D" && npm pack --ignore-scripts @anthropic-ai/claude-code-linux-arm64-musl@2.1.311 && tar -xzf anthropic-ai-claude-code-linux-arm64-musl-2.1.311.tgz && shasum -a 256 package/claude
/opt/podman/bin/podman machine cp package/claude aios-macos-noshare:/var/home/core/.local/state/aios-offline-v1/claude-2.1.311
/opt/podman/bin/podman machine ssh aios-macos-noshare 'chmod 600 ~/.local/state/aios-offline-v1/claude-2.1.311 && sha256sum ~/.local/state/aios-offline-v1/claude-2.1.311'
```

Claude Code turns are admitted by their own owner record, with scope
`aios-claude-coding-admission-v1` and pins `cliVersion`, `cliSha256`,
`policySha256` and `bindingSha256`. There is no code-mode host pin. A
Codex-era coding admission record never admits a Claude Code turn, and the
owner writes the new record once the guest program is final.

The Claude Code guest differs from the Codex guest in these ways:

- **Mounts:** it mounts only the `claude` binary, read-only, beside the
  workspace and the session home.
- **Session home:** `CLAUDE_CONFIG_DIR` is the session home. A resume refuses a
  home that holds settings, `CLAUDE.md`, agents, commands, skills, hooks,
  plugins, output styles, rules or an MCP file. It drops the shell snapshots
  that Claude Code would source on its next start.
- **Event summaries:** only a summary of each stream-json event leaves the
  guest, matching `claudeEventSummary`. The summary keeps the event's kind,
  session and content-block kinds, and never its text, thinking or tool input
  and output.
- **Model route:** a routed turn reaches the host's `MessagesGateway` through
  the session relay. The relay accepts only `POST /v1/messages` and
  `POST /v1/messages?beta=true` for the pinned model, under the route's
  capability and delivery header. The worker gets exactly the route's
  environment (`claudeCodeRelayEnvironment`), which holds no API key; its
  capability is checked by digest. Codex's relay keeps its Responses route.
- **Boundary probe:** it runs `claudeCodingBoundaryProbe`, which is the coding
  probe with Claude Code's checks in place of Codex's:
  - **`claude-config`** replaces `codex-skills`, `mcp-config` and
    `hooks-rules-agents`. The home must hold none of the names a resume
    refuses, and `/etc/claude-code`, Claude Code's managed-settings folder,
    must not exist.
  - **`credential-env`** also refuses `ANTHROPIC_API_KEY`,
    `CLAUDE_CODE_OAUTH_TOKEN` and `AWS_BEARER_TOKEN_BEDROCK`.
    `ANTHROPIC_AUTH_TOKEN`, the relay capability, must be set in a routed
    worker and absent in an offline one.
  - **`read-only-binaries`** checks only `/claude`.

  A Codex probe result is never accepted as a Claude Code one.

The Codex guest program is unchanged, so its `policySha256` and the Codex
admission record that pins it still match.

## Running it

Both owner records must name their workers' fresh pins. If either does not, the
run stops before any worker starts and prints `freshPins` for both. Like every
native runner, it first refuses unless `dist/` is exactly what `src/` compiles
to. It takes a few minutes.

From a clean, built checkout with the VM running:

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-worker-qualification.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/coding-admission.json" "$HOME/.developer-os/admission/validation-admission.json" 171e65262c8018f8f09a360006af2acbb2c0c494cb2be933025b466ea3d672dc "$HOME/.developer-os/issue04-worker-qualification-$(date +%Y%m%d-%H%M%S).json" --approve-offline-native-run
```

### Qualifying the Claude Code worker

The coding record's `scope` chooses the coding worker. A record with scope
`aios-claude-coding-admission-v1` qualifies the Claude Code guest, and any
other record qualifies Codex. The report's `codingAgent` says which ran.

The Claude Code worker's live session is routed, because Claude Code reaches a
model only through the session relay:

- The relay leads to a real `MessagesGateway` on the host, under a fresh
  delivery, relay capability and synthetic key for each run.
- The gateway's provider is a stand-in. It sends no network request. It holds
  each request until the probe is done, then answers with nothing.
- Its budget is a counter, never the owner's spend budget. The report keeps
  only the counts, in `coding.routedRequests`.
- The probe therefore checks the routed controls: exactly the relay listening,
  the relay's empty 403, and `ANTHROPIC_AUTH_TOKEN` present.

Pin changes are checked over the Claude Code pins: `cliVersion`, `cliSha256`,
`policySha256` and `bindingSha256`.

For a first run, provision the CLI as in
[Provisioning the Claude Code CLI](#provisioning-the-claude-code-cli). Then
write a Claude Code record whose pins don't match yet:

```json
{
  "scope": "aios-claude-coding-admission-v1",
  "approvedAt": "2026-11-08T00:00:00.000Z",
  "pins": {
    "cliVersion": "0.0.0",
    "cliSha256": "0000000000000000000000000000000000000000000000000000000000000000",
    "policySha256": "0000000000000000000000000000000000000000000000000000000000000000",
    "bindingSha256": "0000000000000000000000000000000000000000000000000000000000000000"
  }
}
```

Save it as `~/.developer-os/admission/claude-coding-admission.json`, private
to you. A run with it blocks at `owner-records-name-fresh-pins` and prints
`freshPins.coding`. Once you've judged those pins, copy them into the record,
then run again:

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-worker-qualification.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/claude-coding-admission.json" "$HOME/.developer-os/admission/validation-admission.json" 171e65262c8018f8f09a360006af2acbb2c0c494cb2be933025b466ea3d672dc "$HOME/.developer-os/issue04-worker-qualification-$(date +%Y%m%d-%H%M%S).json" --approve-offline-native-run
```

## Limits

These are not covered here:

- recovery and safe import;
- coding fencing, beyond what the session acceptance already showed;
- the workers' full effective configuration, which is not kept in the report.
  The guests verify it at each effect.

Some results are weaker than they look:

- The validation private path cannot be confirmed by the validation guest.
- `escape-unshare` would pass if busybox `unshare` rejected the `-r` option
  rather than the namespace. The `tools` probe proves the applet exists, not
  the option.
- The coding `probe-boundary` action is not limited to qualification. It
  exists only on the live transport, and production stays disabled.

## Outcomes

- **`observed-offline-worker-qualification`:** every probe passed, every
  lifecycle control held, and the coding session was removed.
- **`failed`:** every check ran, but at least one probe failed. They are listed
  in `failedProbes` as `worker:probe`, and the full report is kept as
  evidence. The coding session stays in the VM for diagnosis.
- **`blocked`:** a record, a pin or a lifecycle control refused, at the stage
  named in the report. Later stages are listed as `not-run`. Any coding session
  that was started is stopped.
- **`uncertain`:** the coding session could not be confirmed stopped. Recover
  it before any other run.

A passing run removes its coding session last, after its evidence is written.
The turn ends as soon as it is probed, so the guest may or may not have recorded
a thread. With one, `cleanupSupersededLineage` removes the session by its exact
identity. Without one, it refuses and the abandoned-session sweep below removes
it, along with any other abandoned session. `coding.cleanup` in the report says
which (`lineage` or `sweep`). If the session is still there, the run is `blocked`
at `coding-session-cleanup`, and the other stages' results still stand.

The report also records:

- the source revision and the build's digests;
- the probe's own digest;
- both workers' pins;
- every stage's timing.

Production delivery stays disabled either way.

## Routed session acceptance

`scripts/run-native-routed-acceptance.mjs` is the plan's slice 3 native
check of a routed coding session, offline and without inference. It runs one
lineage on the dedicated VM, a launch and then an explicit resume, under the
owner's coding admission record. The record must name the fresh pins, as for
the qualification above.

Each turn is routed, with the same route a credentialed turn will use:

- Codex reaches the model only through the session relay on 127.0.0.1:18091.
- The relay reaches only the real `GeneralSessionGateway` on the host.
- The gateway reaches only a **fake provider** on the host. It sends no
  network request and never uses the token it is given, which is synthetic.

The fake provider answers with fixed code-mode scripts, in this order:

- **Keep-alive scripts:** a five-second `sleep`, until the launch has been
  probed (at most 24). A resume has none.
- **Work script:** a script that adds `routed-<turn>.txt` through
  `apply_patch`, reads it back through `exec_command`, and reports a marker
  that only a successful read produces.
- **Final message:** then the turn ends, and Codex exits on its own.

During the launch, between model requests and before the turn's edit, the
coding boundary probe runs in the routed session:

- The routed `relay-listener` and `relay-answers` controls show exactly one
  listener, the relay, and that it answers.
- `only-admitted` still sees the workspace exactly as admitted. Codex's own
  edit comes after the probe, so it can't fail that control.

Every turn must:

- report one thread, the resume continuing the launch's;
- exit 0;
- show the marker, with no gateway refusal;
- end its grant with the turn, so a later use is refused as `revoked`;
- stop exactly;
- leave its edit in the collected workspace.

Each turn gets a fresh relay capability. The lineage keeps one delivery and
mediation decision, and the guest enforces that: a resume must keep its
predecessor's mode (routed or offline), delivery and mediation decision, with
a new capability, or it is refused before any worker exists. The report keeps
counts and fixed labels only, never request or response content.

Adding that check changed the coding guest program, so its `policySha256`
changed (to `77885706…`). The owner coding admission needs one
re-approval before the next coding run; a record that doesn't match prints
`freshPins`. A session stopped under the earlier guest can't be resumed after
the upgrade, because a resume must carry its predecessor's pins; start a new
lineage instead.

A stopped session keeps its workspace and home, but not its private program
copies: once the worker is gone, stop removes the session's `codex` (about
350 MB) and `codex-code-mode-host` copies. A stopped session never runs
again, and a resume copies its own. This changed the coding guest program
again, so `policySha256` is now `829e7e1e…` and the coding admission
needs one more re-approval.

Sessions stopped before that change still hold their copies. To remove them
once, delete only those two files, and only from sessions whose record says
`stopped`; a prepared session still needs its copies to launch:

```sh
podman machine ssh aios-macos-noshare 'for r in ~/.local/state/aios-coding-v1/aios-coding-*.json; do grep -q phase.:..stopped $r && rm -fv ${r%.json}/codex ${r%.json}/codex-code-mode-host; done; true'
```

### Routed acceptance for Claude Code

As with the worker qualification, a coding record with scope
`aios-claude-coding-admission-v1` runs the routed acceptance on the Claude Code
guest. The report's `agent` is `claude`. The lineage, stages and checks are the
same, with these differences:

- **Gateway:** each turn's requests reach a real `MessagesGateway`. It runs
  under a fresh grant and a synthetic key for that turn, and its budget is a
  counter, never the owner's spend budget.
- **Fake provider:** `fakeMessagesProvider` in `scripts/routed-provider.mjs`
  answers in the Messages stream format and calls Claude Code's own tools:
  - **Keep-alives:** a `Bash` `sleep 5` until the launch has been probed (at
    most 24).
  - **Work:** `Write` adds `routed-<turn>.txt`, then `Bash` reads it back with
    `cat`. Only a successful read that returns the file's content counts.
  - **Final message:** then the turn ends.
- **Thread:** a turn's conversation is the session id in Claude Code's `init`
  event. The resume must report the same one.
- **Unexpected requests:** any request that isn't the turn's next step, such as
  a title or a token count, is answered with plain text and counted as
  `unexpected`, which blocks the run at `routed-launch-tools-ran`. A request to
  a path or model the relay refuses never reaches the gateway. It appears only
  as Claude Code's own handling of a 403.

Run it with the Claude Code record from the worker qualification above:

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-routed-acceptance.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/claude-coding-admission.json" "$HOME/.developer-os/issue04-routed-acceptance-$(date +%Y%m%d-%H%M%S).json" --approve-offline-native-run
```

## Coding container census

This read-only command counts a VM's `aios-coding-*` containers by what their
guest records say: `head with thread`, `reserved predecessor`, `recovered`,
`resume without thread`, `start without thread`, `reconciled:*`, `cleaned`,
`no admission` or `no record`. Each row also shows the phase and the first 8
characters of the record's `policy` and `binding` pins. A resume must carry its
predecessor's pins, so a `policy` other than the coding digest in
[owner hosts](owner-hosts.md) can't resume under the current guest. It prints no
session identities or content.

From the checkout:

```sh
/opt/podman/bin/podman machine ssh aios-macos-noshare /usr/bin/python3 -I - < scripts/coding-container-census.py
```

A session's kind says what can still reach it. A container is never guaranteed:
any of these can have lost theirs to a removal outside the guest, and a resume
then refuses.

| Kind                                    | Container, if any           | What can reach it                                                                  |
| --------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| `head with thread`                      | `exited`                    | Resume under the same pins; superseded lineage cleanup                             |
| `reserved predecessor`                  | `exited`                    | Lineage cleanup of its head; recovery or reconciliation of the resume reserving it |
| `resume without thread`, never launched | `created` or none           | Recovery, which makes it `recovered`                                               |
| `resume without thread`, launched       | `exited`                    | Reconciliation, which adopts or retires it                                         |
| `reconciled:retired`                    | `exited`                    | Retired lineage cleanup                                                            |
| `reconciled:superseded`                 | `exited`                    | Re-running superseded lineage cleanup                                              |
| `start without thread`                  | `created`, `exited` or none | The sweep below                                                                    |
| `recovered`                             | `created` or none           | The sweep below                                                                    |
| `no admission`                          | Usually none                | Nothing removes it; a record from an older guest can still have a container        |
| `cleaned`                               | None                        | Nothing; the record is a tombstone                                                 |
| `no record`                             | Any                         | Nothing in the guest                                                               |

A session whose `phase` isn't `stopped` needs its exact-session stop first.

## Abandoned coding sessions

Every coding session leaves a stopped container and folder in the VM, and each
one adds to every container listing. A passing owner-run acceptance removes its
own sessions, but a blocked or failed run, or a delivery, leaves them. Lineage
cleanup only reaches a retired or superseded lineage named by its head. Two kinds
of session have no such route, and nothing can ever need them again:

- A start that recorded no thread, whether its `create` failed, it was stopped
  before launch (the engine shows these as `created`), or it launched and
  stopped before reporting a thread. Resume requires a recorded thread.
- A resume whose recovery returned its home. It never launched, and recovery
  runs once. Its predecessor keeps its own container and resumes as before.

The sweep below removes those folders and containers, and keeps their records
as tombstones. It finds them from the guest's own records, because no caller
keeps their identities. It keeps every other session: one with a thread, a
stranded or unresolved resume, a retired or superseded lineage awaiting its
cleanup, and any session whose stop never finished. It refuses while any
container runs, and it refuses a guest that the coding admission record doesn't
name. Run it when no delivery is mid-turn, because a turn collects its workspace
right after its stop. The shared runner keeps it from overlapping an acceptance
run.

Count first. This removes nothing and prints what a sweep would do:

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/sweep-abandoned-coding-sessions.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/coding-admission.json"
```

`abandoned` is what a sweep would remove. `kept` counts the rest: `lineage`
sessions, `unstopped` ones, `unprepared` ones and `cleaned` tombstones. An
`unprepared` record names no admission. Usually that session never had a
container, but a record from an older guest can, and the sweep leaves it. So
these counts don't add up to the VM's container count. Add `--approve-removal`
to the same command to remove the `abandoned` sessions.
It works through 8 at a time until it has tried them all, and moves past any it
can't remove. A refused session stays for a later sweep; `refused` says how many,
and the command then exits non-zero.

The coding record's `scope` chooses the guest, as for the qualification. With
the Claude Code record, the sweep uses the Claude Code guest and must match its
pins. The output's `agent` says which guest ran:

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/sweep-abandoned-coding-sessions.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/claude-coding-admission.json"
```

From a clean, built checkout with the VM running:

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-routed-acceptance.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/coding-admission.json" "$HOME/.developer-os/issue04-routed-acceptance-$(date +%Y%m%d-%H%M%S).json" --approve-offline-native-run
```

Outcomes:

- **`observed-offline-routed-acceptance`:** every stage passed and every
  probe passed. The last stage removes the lineage from the VM by its head, so
  a passing run leaves no session.
- **`failed`:** every check ran, but a probe failed. The failed probes are
  listed in `failedProbes`, and the lineage stays in the VM for diagnosis.
- **`blocked`:** at the stage named in the report. Later stages are listed as
  `not-run`.
- **`uncertain`:** a session could not be confirmed stopped.

A record that doesn't match prints `freshPins`.

Limits:

- No real provider is involved. A real reply's size, timing and events are
  for slice 5.
- The fake provider's scripts assume code mode's `tools.apply_patch` and
  `tools.exec_command`, as captured. A Codex that yields a script back to the
  model, or calls tools differently, shows up as `unexpected` requests or a
  missing marker.

## Usage canary

`scripts/run-native-usage-canary.mjs` is the plan's slice 4d owner-run
offline canary (owner decision C). The delivery controller drives routed
coding turns through the real native transport and a real
`GeneralSessionGateway`, under the owner's coding admission record. The
gateway's only provider is the fake one above. Planning, validation,
onboarding facts, the worker probe, the mediation decision and usage
observations are synthetic stand-ins, in a disposable folder; the report
lists them under `synthetic`.

One lineage, in order:

- **Before any turn:** unknown usage is refused, even when approved. Low
  usage is refused until the owner approves it.
- **Launch:** usage becomes exhausted once the turn has started. The next
  model request is refused, the grant is revoked as `exhausted`, the session
  stops exactly, the interruption is recorded, and the workspace is kept as
  `interrupted-turn` evidence, never as a candidate.
- **Restart:** refused without the owner's restart approval, even though
  usage is healthy again.
- **Resume:** after approval, the restart resumes the launch's thread under
  the same route. The decision record is withdrawn once the turn has
  started, and the resume ends the same way, as `withdrawn`.
- **New lineage:** a new decision is recorded and the restart approved. The
  turn starts a new thread under the new decision, supersedes the old
  lineage, runs the work script through the route and completes.

Every turn must stop exactly. A passing run then removes both lineages: the
superseded one through the controller's `cleanupSupersededLineage(id,
operationId)`, which records `cleanedAt`, and the new one by its exact identity
on the transport, because the controller keeps no route to a lineage it hasn't
superseded. At the end, every session is stopped again by its exact identity.

From a clean, built checkout with the VM running:

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-usage-canary.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/coding-admission.json" "$HOME/.developer-os/issue04-usage-canary-$(date +%Y%m%d-%H%M%S).json" --approve-offline-native-run
```

Outcomes:

- **`observed-offline-usage-canary`:** every stage passed, and the run left no
  session.
- **`blocked`:** at the stage named in the report. Later stages are listed as
  `not-run`.
- **`uncertain`:** a session could not be confirmed stopped.

A record that doesn't match prints `freshPins`. No guest code changed, so the
current coding records apply. No real provider or usage reading is involved;
those are for slice 5.

## Credentialed qualification

`scripts/run-native-credentialed-qualification.mjs` is the plan's slice 5
owner-run runner. **It spends subscription usage.** Two routed provider
turns on the Mac, a launch and its explicit resume, each with a 3-minute
allowance and a fixed trivial prompt (owner decision B). It drives the real
native transport directly, as the routed acceptance does: the real
`GeneralSessionGateway` with the real provider, the owner's vault account
read at every model request, and a real usage observation at every model
request. The controller's mediation decision is not used; the usage canary
covers it offline.

In order:

- **Before the approval is spent:** usage is fresh, measured and healthy.
  Low, unknown or exhausted usage refuses the run and leaves the approval
  unspent. Low usage is refused rather than approved mid-run, since no one
  approves inside an unattended run (decision C met strictly, as H does).
- **Before any turn:** the coding record names the fresh pins; the vault
  account is eligible for the run; usage is still healthy.
- **Launch:** the boundary probe runs in the live session while its first
  model request waits; the provider answers through the route; the grant
  ends with the turn and refuses use after it; the session stops exactly and
  its workspace is collected.
- **Resume:** the launch's thread, with a fresh relay capability. Its first
  model request is live; at the next, a synthetic exhaustion stand-in at the
  gate ends the turn at once, revoking the grant and stopping the session;
  the workspace is collected as preserved evidence.
- **Credential:** the access token appears in no byte the sessions sent to
  the host and no collected file. Every boundary probe must have run and
  passed, including the credential, endpoint and npm-registry checks.
- **Restart:** restarting the lapsed thread under the spent approval is
  refused before any effect, though usage is healthy; only a fresh approval
  allows more. Usage is observed again at the end.
- **Cleanup:** a passing run removes the lineage from the VM by its head, once
  its evidence is written. A rerun starts its own lineage, so nothing resumes
  this one. A failed or blocked run keeps it for diagnosis.

The report keeps the pinned model, usage before and after, every request
count, refusal and provider status, and never the token, the usage windows or
the account email; errors are redacted of the token. Each turn allows at most
8 model requests.

First, the owner sets `ACCOUNT_ID` (the vault account) and `PRIVATE_STATE` (a
private state directory), prepares the run and sets `RUN_ID` to the printed run
ID; the plan expires after an hour:

```sh
node scripts/run-native-credentialed-qualification.mjs prepare aios-macos-noshare "$HOME/.developer-os/admission/coding-admission.json" "${ACCOUNT_ID:?}" "${PRIVATE_STATE:?}"
```

Then, from a clean, built checkout with the VM running, with `AUTH_DIR` and
`CODEX` (the pinned codex executable) set:

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-credentialed-qualification.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/coding-admission.json" "${AUTH_DIR:?}" "${ACCOUNT_ID:?}" "${CODEX:?}" "${PRIVATE_STATE:?}" "$HOME/.developer-os/issue04-credentialed-$(date +%Y%m%d-%H%M%S).json" --approve-run "${RUN_ID:?}" --approve-turns 2
```

The approval is spent before any credential is read, so a rerun needs a
fresh `prepare`. Outcomes: `observed-credentialed-qualification`; `failed`
when a boundary probe failed; `blocked` at the named stage, with later
stages `not-run`; `uncertain` when a session could not be confirmed stopped.
`blocked` at `lineage-cleanup` means only the removal failed: every earlier
stage's evidence stands, and it doesn't call for spending another run.
A provider refusal is recorded by status: per the plan's header risk, a
fixed gateway-side header would be a separately reviewed change.
