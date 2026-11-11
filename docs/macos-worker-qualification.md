# macOS worker VM

The dedicated `aios-macos-noshare` VM (explicit AppleHV) hosts the coding and
validation guests. Each guest is admitted only by the owner's record naming its
fresh pins (`docs/owner-hosts.md`). The fixed synthetic worker and its
qualification (Ticket 25) were removed with Codex (#222); their dated receipts
stay under `.scratch/` as history.

## Close Podman Desktop before native runs

Quit Podman Desktop before a native run on this VM. While it's open it keeps
listing every container, and the 2-CPU VM can't keep up. A run then slows down
and can stop at any stage.

These three runs on 4 November 2026, of the since-removed fixed-worker qualify, had six each, in this order, on the
same VM boot, build, pins and delivery:

| Podman Desktop | Passed | Seconds per qualify | Container list requests |
| -------------- | ------ | ------------------- | ----------------------- |
| Closed         | 6 of 6 | 58–89               | 0                       |
| Open           | 2 of 6 | 68–134              | 554                     |
| Closed         | 6 of 6 | 48–67               | 0                       |

Each request returned about 1.1 MB, with about 800 containers in the VM. The open
run stopped at `codex-relay-cross-namespace`, `isolation-probe` (twice) and
`observation`, and an earlier `prepare` with the app open stopped at
`codex-binding` on its 30-second command timeout. If stops vary like this, check
the app first. The VM had been up longest in the last run, which was the fastest,
so these runs show no slowdown from uptime up to about 1.7 hours. Longer uptimes
weren't compared.

The app can also change the VM's state. Opening it while the VM was running left
that boot alone, and quitting it left the VM running that day, but an earlier quit
stopped the VM. After quitting, run `podman machine list`. If the VM stopped, start
it with `podman machine start aios-macos-noshare`.

## What moves the admission bindings

Both owner admission records name the VM by its
`/etc/machine-id`. The hardware UUID isn't used, because Apple's hypervisor
changes it on every boot.

| Change                                  | Admission `bindingSha256` |
| --------------------------------------- | ------------------------- |
| VM restart, including Podman's `LastUp` | Unchanged                 |
| Podman upgrade or reinstall             | Moves                     |
| macOS update                            | Moves                     |
| Mac hostname                            | Moves                     |
| Recreated VM (new machine ID)           | Moves                     |
| Other machine configuration (e.g. CPUs) | Moves                     |

Each of these except the restart is a real change, so it still refuses until
you rewrite the admission records. A record that doesn't match makes the
acceptances print `freshPins`. If a move follows a restart, check first whether
anything was installed:

```sh
pkgutil --pkg-info com.redhat.podman
hostname
uname -r
```

Podman Desktop can offer a Podman update. On 4 November 2026 Podman 6.1.4
replaced 6.1.1 two minutes before the VM started, and it was first taken for a
restart effect. The VM's restart proof is in the
[stable VM identity receipt](../.scratch/aios-v1-implementation/ticket04-stable-vm-identity-receipt.md).

## What stays in the VM

Stopped containers slow every container listing, so each guest action removes
what no later evidence reads:

- **Validation workers** go when their check finishes or the attempt stops.
- **Coding sessions** stay, because resume and recovery inspect them by exact
  identity, until `cleanupRetiredLineage` or `cleanupSupersededLineage` removes
  them. A passing owner-run acceptance or qualification removes its own once its
  evidence is written; a failed or blocked run keeps them for diagnosis. The
  sessions of any other delivery stay.

Removal never uses `--force`, and only names a container its own record names.

## General coding session acceptance (Issue 04)

`scripts/run-native-coding-acceptance.mjs` drives the coding transport on the
Claude Code guest against the dedicated VM in two synthetic lineages, offline
and without credentials:

- Lineage A: a first launch, a resume onto a moved main (a named base move), a
  check that the moved main's input was kept, a refused reuse of a
  consumed predecessor, a resume stranded after preparation and recovered, and
  a resume after recovery.
- Lineage B: a resume stopped right after launch, never recovered, reconciled
  as unresolved, retired, cleaned up (idempotently), and never resumed again.

It uses the VM's existing coding authority, never provisions or starts the VM,
refuses to overwrite a report, and stops every attempted session at the end.
Each refusal it expects must happen for the expected reason. The first launch
must report an offline Claude Code session; if it runs but reports none, the
outcome is `blocked-before-thread`. Run it through the shared runner, which takes the
acceptance lock and keeps the Mac awake:

```sh
cd ~/Repos/developer-os
npm ci --ignore-scripts && npm run build
/opt/podman/bin/podman machine list   # aios-macos-noshare must be running
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" \
  scripts/run-native-coding-acceptance.mjs -- aios-macos-noshare \
  "$HOME/.developer-os/issue04-session-acceptance-$(date +%Y%m%d-%H%M%S).json" \
  --approve-offline-native-run
```

A passing run leaves no session behind: it sweeps the stranded resume (see
[abandoned coding sessions](worker-qualification.md#abandoned-coding-sessions))
and cleans lineages A and B. A run that stops early leaves its sessions in the
VM.
The report is evidence only: `productionEnabled` and `qualified` stay false.
On 20 October 2026 every stage passed on this Mac on the earlier Codex guest;
see the
[native session acceptance receipt](../.scratch/aios-v1-implementation/ticket04-native-session-acceptance-receipt.md).
On 10 November 2026 it passed on the Claude Code guest for the first time:
all 26 stages, from clean `main` at `4a867bf`, under the pins `policySha256`
`c5a7a034…`, `bindingSha256` `8e2cfe1c…` and Claude Code 2.1.311. Before reusing a session home,
the guest removes what Claude Code regenerates on every start (its shell
snapshots and `plugins`) and refuses any other configuration.

## Owner coding admission acceptance (Issue 04)

The delivery controller runs a coding turn on a live VM transport only when
your Claude Code admission record names that transport's exact fresh pins
(ADR 0008). The record is a private file you write yourself, outside any
repository, readable only by you, in a folder only you can change:

```json
{
  "scope": "aios-claude-coding-admission-v1",
  "approvedAt": "2026-11-08T18:00:00.000Z",
  "pins": {
    "cliVersion": "2.1.311",
    "cliSha256": "<64 hex>",
    "policySha256": "<64 hex>",
    "bindingSha256": "<64 hex>"
  }
}
```

No other fields are accepted, and a Codex-era record
(`aios-native-coding-admission-v1`) is refused. `approvedAt` must be a
canonical UTC time that is not in the future. The runtime re-reads the record
before dispatch, on the turn's result, when it trusts a stop or other receipt,
and at least once a second while a turn streams. Removing or editing it stops
further coding. A session stopped while its record is missing or different
stays uncertain until the matching record is restored and the session is
recovered. Any pin change, such as a new CLI, guest policy, Podman, VM or host,
needs a new record. The binding names the VM by its `/etc/machine-id`, not its
hardware UUID, which Apple's hypervisor changes on every boot. It also leaves
out the time Podman records for the VM's last start. Restarting the VM keeps
the record valid; recreating it needs a new one. Production delivery stays
disabled either way.

The acceptance drives one metered Claude Code turn through the controller and
the real transport under the record. Planning, validation and onboarding facts
are synthetic stand-ins. The controller opens a real Messages gateway, and
every model request is admitted and charged against the delivery's real spend
budget; only the model provider is a stand-in, which has Claude Code write and
read back one file. The stage `controller-metered-turn` checks that the
requests were charged and that no request was left reserved or interrupted by
the budget. A passing run then removes the session from the VM by its exact
identity. If the record is missing or names other pins, the run stops before
any coding and prints the fresh pins so that you can check or write the
record. Before anything else, it also refuses unless `dist/` is exactly what
`src/` compiles to, which `npm run build` fixes:

```sh
cd ~/Repos/developer-os
npm ci --ignore-scripts && npm run build
/opt/podman/bin/podman machine list   # aios-macos-noshare must be running
mkdir -m 700 -p "$HOME/.developer-os/admission"
# Write $HOME/.developer-os/admission/claude-coding-admission.json yourself; chmod 600.
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" \
  scripts/run-native-coding-admission-acceptance.mjs -- aios-macos-noshare \
  "$HOME/.developer-os/admission/claude-coding-admission.json" \
  "$HOME/.developer-os/issue04-admission-acceptance-$(date +%Y%m%d-%H%M%S).json" \
  --approve-offline-native-run
```
