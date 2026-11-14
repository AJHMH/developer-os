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

## Combined qualification

`scripts/run-native-complete-qualification.mjs` binds five component reports
by path and SHA-256 into one report. It runs nothing on the VM and spends
nothing:

| Component    | Report outcome                                     | Boundaries it evidences                                                          |
| ------------ | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `worker`     | `observed-offline-worker-qualification`            | runtime pins; boundary probes; descendant termination                            |
| `session`    | `observed-offline-session-acceptance`              | explicit-session resume; controller recovery; output admission                   |
| `validation` | `observed-offline-validation-admission-acceptance` | isolated web validation: dependencies, PostgreSQL and the browser                |
| `lifecycle`  | `observed-native-lifecycle-controls`               | pause and cancel; explicit-session resume; controller recovery; output admission |
| `delivery`   | `observed-native-delivery-through-cleanup`         | signing and authentication; delivery through cleanup                             |

Every component must come from the same clean, freshly built source revision
that the combination itself runs from, on a supported Mac and the same VM,
under the worker qualification's coding and validation pins. A component that
doesn't is rejected, with its reasons. Each boundary is then `passed`,
`failed` or `not-run` from the exact stages that evidence it, and the boundary
probes also need every probe passed, `proxy` and `cross-delivery` included.
The combination passes, `observed-native-complete-qualification`, only when
all five are accepted and every boundary passed.

### Production admission levels

The production admission record may name either a worker qualification or a
passing complete qualification. `check-production` prints which, as `level`:

- **`worker`:** enough to publish test deliveries, as before.
- **`complete`:** the whole controller is qualified at these pins. The pilot
  (#275) requires it.

A complete record re-checks every component report's SHA-256 at each check,
so changing or removing one revokes it.

### Running it

All of it runs from one revision, in this order. The delivery publishes, so
the record must first admit the new coding pins at the worker level:

1. The worker qualification
   ([command](worker-qualification.md#re-pinning-after-a-guest-change)).
2. A production admission record naming that report, at the worker level.
3. The session acceptance
   ([command](macos-worker-qualification.md#general-coding-session-acceptance-issue-04)).
4. The validation acceptance with dependencies, PostgreSQL and the browser:

   ```sh
   node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-validation-admission-acceptance.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/validation-admission.json" 6d7bed6a62d9768114cce3ecaff0ac534acbda40cf7368c3f9df74cb367fb143 "$HOME/.developer-os/issue16-validation-$(date +%Y%m%d-%H%M%S).json" --approve-offline-native-run --with-npm-dependencies --with-database e29b5f75230807dfc40a4c8ff9e486b87a30df01cfcab04a4e99d5077d77ddfb --with-browser 2dee255e66f9985e1623c12a6f77535bb7487e7bd00a0b0ad82f98688ae60f4d 1.64.1
   ```

5. The lifecycle acceptance (above).
6. A real delivery through cleanup
   ([command](branch-cleanup.md#native-cleanup-acceptance)).
7. The combination:

   ```sh
   node scripts/run-native-complete-qualification.mjs "$HOME/.developer-os/issue16-complete-qualification-$(date +%Y%m%d-%H%M%S).json" --worker "$WORKER" --session "$SESSION" --validation "$VALIDATION" --lifecycle "$LIFECYCLE" --delivery "$DELIVERY"
   ```

   Set each variable to that step's report path first.

8. A production admission record naming the combined report. Then
   `check-production` prints `"level": "complete"`.

It all passed on 13 November, from `main` at `e049225` (#323); see the
[receipt](../.scratch/aios-v1-implementation/ticket16-macos-complete-qualification-receipt.md).

It passed again on 14 November, from `main` at `8e8df19` (#329), after the
#275 guest changes and on the owner-built Node 22 validation image; see the
[receipt](../.scratch/aios-v1-implementation/issue275-requalification-receipt.md).
