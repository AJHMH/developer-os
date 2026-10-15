# Ticket 24 PR readiness

> Historical/design artifact: statements below apply to the recorded investigation, proposal or revision. For implemented capabilities, later completion evidence and remaining production gates, see [implementation status](../../docs/implementation-status.md).


Branch: codex/ticket24-windows-worker. Proposed base: main.

The proposal combines protected Windows subscription storage, trusted capability
qualification, a fixed isolated task and validation, native recovery controls,
and the approved operator-workflow retrospective. Production remains disabled.

Validation and independent reviews are retained in:

- ticket24-windows-controls-review.md
- ticket24-windows-task-review.md
- ../windows-qualification-retro/review.md

Final credential-free Windows suite at 02f6068: 186 tests, 185 passed, one
macOS-only ACL skip. Typecheck and formatting passed. The retrospective review
resolved all Standards and Spec findings. Native acceptance evidence belongs to
1c0f614; native source changes at 02f6068 invalidate those historical bindings.
Fresh owner-authorized enrollment and qualification remain required for the
changed build. This documentation-only publication commit changes no runtime.

Publish the signed proposal through the Factory App so the owner's current-head
GitHub review can satisfy the independent latest-push requirement. Keep all
required checks, verified signatures and resolved-thread protections intact.
PR creation, owner approval and merge are separate actions.
