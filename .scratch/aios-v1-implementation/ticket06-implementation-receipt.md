# Ticket 06 implementation receipt

Date: 2026-10-14. Base: 479ba9c3413b571b1d4e8e8624f08660778c883d.
Branch: codex/ticket06-isolated-validation.

Implemented the controlled baseline/candidate validation slice through the public
controller and CLI command gates. See [the contract](../../docs/isolated-validation.md).
Baseline success is required before coding; candidate checks bind to the exact
admitted manifest. Owner declarations retain local/PR/main obligations, publishers,
timeouts, exceptions, environment and exact mutable application paths. Candidate
edits outside that allowlist cannot change validation inputs. Attempts retain
failures, bounded diagnostic reruns and shutdown uncertainty across ledger restart.

Validation on macOS:
- npm run typecheck: passed.
- npm run format:check: passed.
- node --test tests/isolated-validation.test.mjs: 33 passed, zero failures.
- AIOS_TEST_PYTHON=/usr/bin/python3 caffeinate -is npm test: 358 total,
  356 passed, two platform-specific skips, zero failures (29.4 seconds).
- git diff --check: passed.
- SHA-256 comparison: all 21 pre-existing local snapshots unchanged.

Independent Standards review: no remaining hard violations or heuristic findings.
Independent Spec review: no remaining actionable findings after protecting the
validation input complement and checking main identity again after async environment
inspection. A focused regression initially inherited the host signing configuration;
the temporary fixture now explicitly disables signing/hooks and sets fixture identity.

These are controlled adapter tests using temporary Git repositories, not native
runtime qualification. No provider call, production dependency script, native worker
or remote CI was run. GitHub/Factory coverage gates have not been evaluated for this
branch. Actual Windows/macOS isolation, dependency/script execution, disposable
browser/database behavior and pinned CLI qualification remain required. Hosted PR/main
result observation belongs to later delivery slices. Production delivery stays disabled.
