# Offline general-worker qualification (Issue 04)

`scripts/run-native-worker-qualification.mjs` is an owner-run, offline,
adversarial check of both general workers on the Mac's dedicated VM. It runs
under the owner's coding and validation admission records. It opens no
credentials, authorizes no inference and never enables production. A passing
report is evidence for the owner to judge, not a qualification decision.

## Re-pinning after a guest change

When a merged PR moves a guest program digest, its "Pin impact" section says
so. The owner record for that worker then stops admitting it until you re-pin.
You re-pin with this document's one qualification command, the one under
[Running it](#running-it), which you run twice: once to print the fresh pins,
and once to pass with them. Follow these steps in order, on the Mac, in
`~/Repos/developer-os`, with the VM running:

1. Update and build the checkout:

   ```sh
   git switch main && git pull --ff-only && npm ci --ignore-scripts && npm run build
   ```

2. Run the qualification. With an out-of-date record it stops before any
   worker starts and exits with code 1:

   ```sh
   node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-worker-qualification.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/claude-coding-admission.json" "$HOME/.developer-os/admission/validation-admission.json" 9419aebdf4ccbf7bd0096475d0db76ca83f0db496a23592a2bfc3b769894473c "$HOME/.developer-os/issue04-worker-qualification-$(date +%Y%m%d-%H%M%S).json" --approve-offline-native-run
   ```

   Its last line is JSON with `"outcome": "blocked"` and `freshPins`. For a
   coding guest change, `freshPins.coding` holds the four pins `cliVersion`,
   `cliSha256`, `policySha256` and `bindingSha256`.

3. Check the printed pins. `policySha256` must be the new Claude Code coding
   digest in [owner-hosts.md](owner-hosts.md) and in the PR's "Pin impact".
   `cliVersion` and `cliSha256` should not have changed unless the PR says
   so.

4. In `~/.developer-os/admission/claude-coding-admission.json`, replace the
   four values under `pins` with the printed ones. Set `approvedAt` to the
   current time in exactly this form, which the record refuses otherwise, and
   which this prints:

   ```sh
   date -u +%Y-%m-%dT%H:%M:%S.000Z
   ```

   Leave `scope` as it is. If the PR moved the validation digest, do the same
   with `freshPins.validation` in `validation-admission.json`.

5. Run the same command from step 2 again. A pass prints
   `"outcome": "observed-offline-worker-qualification"` and no `freshPins`.
   Anything else is described under [Outcomes](#outcomes). Keep the report
   file it names as evidence.

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
  - in the worker's home, none of Claude Code's settings, memory, extensions
    or tools (`claude-config`, below);
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
- **`read-only-binaries`:** `/claude` is mounted read-only, according to `/proc/self/mountinfo`, and refuse writes. The mount
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

  These are the container's own limits, whatever Claude Code's own
  permissions would allow. The probe runs as the container user, the same
  identity Claude Code has.

The coding guest runs the probe inside the exact live session. It passes the
session's own management record as the private path, confirming first that the
record exists. The probe is part of the coding guest program, so it is covered
by the coding `policySha256`.

Validation runs the probe as checks, which return only an exit code. Each check
therefore passes only when its own probe's line reads `passed-`. Validation's
private path is the guest's validation state directory. The validation guest
cannot confirm that path to the check, so the owner-home probe is the stronger
evidence there.

## Provisioning the Claude Code CLI

Claude Code is the coding agent (ADR 0008). The coding guest runs the native `claude` binary from the official per-platform package for the
guest, which is musl Linux on arm64. The binary links only musl's libc, which
the Alpine offline template provides. The pin is `claudeCode` in
`src/host-target.ts`:

| Package                                              | Registry integrity                                                                                | `claude` SHA-256                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `@anthropic-ai/claude-code-linux-arm64-musl@2.1.311` | `sha512-ymSGc6vv0QCcVQZCC2JG03P/upLraox+iXAG1DfnUU1OZBCIR9QncxINBEp6QgnKbqywwR2/ic3GD8hAz0Tiow==` | `172150e3f9ea07e8e2e2e29862d7d9a25f5c234d8e909e4063df237665bf09b9` |

The Claude Code guest program (`claudeGuest` in `src/podman-coding.ts`)
refuses to inspect, prepare or launch unless the file is in VM management
storage, private to the guest user, and matches the pin. Run the block with the VM running. It runs in a subshell in a new
temporary folder, so your shell stays where it was. `npm pack` checks the
registry integrity as it downloads, and `--ignore-scripts` runs nothing from
the package. The last command prints the guest's hash, which must match the
table.

```sh
(D=$(mktemp -d) && cd "$D" && npm pack --ignore-scripts @anthropic-ai/claude-code-linux-arm64-musl@2.1.311 && tar -xzf anthropic-ai-claude-code-linux-arm64-musl-2.1.311.tgz && shasum -a 256 package/claude &&
/opt/podman/bin/podman machine cp package/claude aios-macos-noshare:/var/home/core/.local/state/aios-offline-v1/claude-2.1.311 &&
/opt/podman/bin/podman machine ssh aios-macos-noshare 'chmod 600 ~/.local/state/aios-offline-v1/claude-2.1.311 && sha256sum ~/.local/state/aios-offline-v1/claude-2.1.311')
```

### Loading the Claude Code worker image

Claude Code's `Bash` tool runs only under bash or zsh, and the Alpine template
the other workers use has only busybox `sh`. So the Claude Code worker runs
Docker's official bash image, `bash:5.3.15-alpine3.24` (Alpine 3.24.1, built
2026-06-16), pinned by its arm64 manifest digest as `claudeCode.template` in
`src/host-target.ts`. It keeps busybox, so the boundary probe's tools are
there, and bash is `/usr/local/bin/bash`, which the worker names in `SHELL`.
The worker program refuses the image unless its environment is exactly the
pinned one. It creates the container with `--entrypoint=`, which Podman
records as `[""]` and doesn't run, so the image's own entrypoint never runs
before the worker's command. It refuses a container with any other entrypoint.

With the VM running, pull it into the VM's rootless Podman by digest, then
check that it reports that digest and `arm64`:

```sh
/opt/podman/bin/podman --connection aios-macos-noshare pull docker.io/library/bash@sha256:826e424f395d3d1e10adc155e63f3c69090c5559c5f3914b0d4c9064e767b06a
/opt/podman/bin/podman --connection aios-macos-noshare image inspect --format '{{.RepoDigests}} {{.Architecture}}' docker.io/library/bash@sha256:826e424f395d3d1e10adc155e63f3c69090c5559c5f3914b0d4c9064e767b06a
```

The validation worker keeps its Alpine image.

Claude Code turns are admitted by their own owner record, with scope
`aios-claude-coding-admission-v1` and pins `cliVersion`, `cliSha256`,
`policySha256` and `bindingSha256`. A Codex-era record
(`aios-native-coding-admission-v1`) is refused.

The Claude Code guest:

- **Image:** it runs the pinned bash image, not the Alpine template, with
  `SHELL=/usr/local/bin/bash` and its entrypoint cleared.
- **End of turn:** Claude Code exits on its own when its turn ends. Podman can
  still report the worker running, with its old pid, for a moment after the
  process has gone. If a poll then can't read the process, it inspects the
  container again and goes on only if it has stopped.
- **Mounts:** it mounts only the `claude` binary, read-only, beside the
  workspace and the session home.
- **Session home:** `CLAUDE_CONFIG_DIR` is the session home. A resume refuses a
  home that holds settings, `CLAUDE.md`, agents, commands, skills, hooks,
  output styles, rules or an MCP file. It drops the shell snapshots that Claude
  Code would source on its next start. It also drops `plugins`: the real CLI
  writes its built-in plugins' state to `plugins/store` on every start, and
  nothing in that folder may reach the next turn.
- **Request shape:** the worker sets `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`,
  so Claude Code sends no fields that need a beta header. Without it, the real
  CLI sends `context_management`, `thinking.display: "updates"` and deferred
  tools (`defer_loading`). The gateway sends no beta header and refuses all
  three. It accepts what the real CLI still sends:
  - `output_config`, with only its `effort` level;
  - a `system`-role message carrying the environment, as text only.
- **Event summaries:** only a summary of each stream-json event leaves the
  guest, matching `claudeEventSummary`. The summary keeps the event's kind,
  session and content-block kinds, and never its text, thinking or tool input
  and output.
- **Model route:** a routed turn reaches the host's `MessagesGateway` through
  the session relay. The relay accepts only `POST /v1/messages` and
  `POST /v1/messages?beta=true` for the pinned model, under the route's
  capability and delivery header. The worker gets exactly the route's
  environment (`claudeCodeRelayEnvironment`), which holds no API key; its
  capability is checked by digest.
- **Boundary probe:** it runs `claudeCodingBoundaryProbe`, the coding probe
  with Claude Code's own checks:
  - **`claude-config`:** the home must hold none of the names a resume
    refuses, and `/etc/claude-code`, Claude Code's managed-settings folder,
    must not exist. A `plugins` folder may hold only `store`.
  - **`credential-env`** also refuses `ANTHROPIC_API_KEY`,
    `CLAUDE_CODE_OAUTH_TOKEN` and `AWS_BEARER_TOKEN_BEDROCK`.
    `ANTHROPIC_AUTH_TOKEN`, the relay capability, must be set in a routed
    worker and absent in an offline one.
  - **`read-only-binaries`** checks only `/claude`.

## Running it

Both owner records must name their workers' fresh pins. If either does not, the
run stops before any worker starts and prints `freshPins` for both. Like every
native runner, it first refuses unless `dist/` is exactly what `src/` compiles
to. It takes a few minutes.

From a clean, built checkout with the VM running:

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-worker-qualification.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/claude-coding-admission.json" "$HOME/.developer-os/admission/validation-admission.json" 9419aebdf4ccbf7bd0096475d0db76ca83f0db496a23592a2bfc3b769894473c "$HOME/.developer-os/issue04-worker-qualification-$(date +%Y%m%d-%H%M%S).json" --approve-offline-native-run
```

### Qualifying the Claude Code worker

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
`freshPins.coding`. Once you've judged those pins, copy them into the record
and run the same command again, as in
[Re-pinning after a guest change](#re-pinning-after-a-guest-change).

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
Claude Code lineage on the dedicated VM, a launch and then an explicit resume,
under the owner's Claude Code coding admission record
(`aios-claude-coding-admission-v1`). The record must name the fresh pins, as
for the qualification above; any other record is refused.

Each turn is routed, with the same route a metered turn uses (ADR 0008):

- Claude Code reaches the model only through the session relay on
  127.0.0.1:18091.
- The relay reaches only a real `MessagesGateway` on the host. It runs under a
  fresh grant and a synthetic key for that turn, and its budget is a counter,
  never the owner's spend budget.
- The gateway reaches only a **fake provider** on the host,
  `fakeMessagesProvider` in `scripts/routed-provider.mjs`. It sends no network
  request and never uses the key it is given.

The fake provider answers in the Messages stream format and calls Claude
Code's own tools, in this order:

- **Keep-alives:** a `Bash` `sleep 5` until the launch has been probed (at most
  24). A resume has none.
- **Work:** `Write` adds `routed-<turn>.txt`, then `Bash` reads it back with
  `cat`. Only a successful read that returns the file's content counts.
- **Final message:** then the turn ends.
- **Tool results:** it reads them from every message after the last assistant
  message. Claude Code 2.1.309 and later can follow the results with a
  `system` message carrying its environment.

Any request that isn't the turn's next step, such as a title or a token count,
is answered with plain text and counted as `unexpected`, which blocks the run
at `routed-launch-tools-ran`. A request to a path or model the relay refuses
never reaches the gateway; it appears only as Claude Code's own handling of a 403.

During the launch, between model requests and before the turn's edit, the
coding boundary probe runs in the routed session:

- The routed `relay-listener` and `relay-answers` controls show exactly one
  listener, the relay, and that it answers.
- `only-admitted` still sees the workspace exactly as admitted. Claude Code's
  own edit comes after the probe, so it can't fail that control.

Every turn must:

- report one conversation (the session id in Claude Code's `init` event), the
  resume continuing the launch's;
- exit 0;
- show the read-back, with no gateway refusal;
- end its grant with the turn, so a later use is refused as `revoked`;
- stop exactly;
- leave its edit in the collected workspace.

Each turn gets a fresh relay capability. The lineage keeps one delivery and
route, and the guest enforces that: a resume must keep its predecessor's mode,
delivery and route, with a new capability, or it is refused before any worker
exists. The report keeps counts and fixed labels only, never request or
response content.

Run it with the Claude Code record from the worker qualification above:

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-routed-acceptance.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/claude-coding-admission.json" "$HOME/.developer-os/issue04-routed-acceptance-$(date +%Y%m%d-%H%M%S).json" --approve-offline-native-run
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
- The fake provider assumes Claude Code calls its own `Write` and `Bash`
  tools as captured. A Claude Code that calls tools differently shows up as
  `unexpected` requests or a missing read-back.

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
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/sweep-abandoned-coding-sessions.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/claude-coding-admission.json"
```

`abandoned` is what a sweep would remove. `kept` counts the rest: `lineage`
sessions, `unstopped` ones, `unprepared` ones and `cleaned` tombstones. An
`unprepared` record names no admission. Usually that session never had a
container, but a record from an older guest can, and the sweep leaves it. So
these counts don't add up to the VM's container count. `lineages` names up to
64 kept lineage sessions by `operationId`, `fence` and `intent`, so lineage
cleanup can be pointed at one; a session recorded before the guest kept that
name is only counted. Add `--approve-removal`
to the same command to remove the `abandoned` sessions.
It works through at most 8 at a time, and at most 20 seconds of removals per
batch, until it has tried them all, and moves past any it
can't remove. A refused session stays for a later sweep; `refused` says how many,
and the command then exits non-zero.

The sweep uses the Claude Code guest under your Claude Code record and must
match its pins:

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/sweep-abandoned-coding-sessions.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/claude-coding-admission.json"
```
