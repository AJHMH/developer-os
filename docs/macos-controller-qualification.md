# Complete controller qualification on macOS (#274)

v1 ticket 16 qualifies the whole controller on the Mac, from intake through
cleanup. It does that by combining the owner-run acceptances that each prove
one boundary, plus one run for the controls nothing else exercises natively.
Production stays disabled.

## Boundary probes

The worker qualification's boundary probe gained two probes for this ticket
([worker qualification](worker-qualification.md#what-it-checks)):
- **`proxy`**, in both workers: no proxy is configured, and none answers at
  the VM's gateway addresses.
- **`cross-delivery`**, in the coding worker: only this session's binds, and
  no guest or host process.

Both passed natively on 13 November, in
`issue04-worker-qualification-20261113-130529.json`, from `main` at `f7e8a0c`
(#319).

## Lifecycle controls

`run-native-cli-delivery-acceptance.mjs --lifecycle` runs three real metered
deliveries of one synthetic repository, one at a time, through the CLI on the
VM. Each control interrupts a step that is running, from a second CLI
process, as you would:

- **Delivery A, pause, resume and cancel:**
  - `code-feature` runs. Mid-turn, `pause` must stop that exact session, and
    the paused step's own process must end without a candidate.
  - `resume` must return the delivery to work, and `code-feature` must then
    reach a candidate. The report records whether it resumed the thread.
  - `validate-candidate` runs. Mid-check, `cancel` must stop that exact
    attempt, which must not report a pass.
  - `resume` must then be refused, naming the cancellation.
- **Delivery B, controller recovery:**
  - `code-feature` runs, and its CLI process is killed outright (`SIGKILL`),
    as a crashed controller would be. The delivery must still show the
    session running.
  - `recover` must stop that exact session, with no candidate.
- **Delivery C, output admission:**
  - The request asks for `latest.html` as a symbolic link to `index.html`.
  - The turn must run to its end, and the guest's output admission must refuse
    the link, so no candidate is admitted.

Each delivery is cancelled if still open, then released, so the next can own
the repository. Each one's last coding session is then removed from the VM.

Every stage the run never reached is reported as `not-run`, so a blocked run
still lists every boundary. The passing outcome is
`observed-native-lifecycle-controls`. It costs about four coding turns of the
$5 budget, roughly $0.25.

It needs no signing key, because nothing is published:

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-cli-delivery-acceptance.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/claude-coding-admission.json" "$HOME/.developer-os/admission/validation-admission.json" "$HOME/.developer-os-auth" "$HOME/.developer-os/issue16-lifecycle-$(date +%Y%m%d-%H%M%S).json" --approve-metered-native-run --lifecycle
```

### Limits

- Delivery C's refusal shows no candidate after a full turn. The guest's
  refusal reason isn't reported, so a turn that refused for another reason
  would read the same. The request asks only for the link.
- Descendant and orphan termination is shown by the worker qualification's
  exact stops, not here.
