# Issue 04: the prepared npm dependency cache (controlled dependency phase, D1)

Base: `main` at `289dfad`. 29 October 2026. Host-only; no guest change, no
pin change, no network in tests, nothing installed or executed.

## Owner decisions (29 October)

The remaining item "controlled dependency phases" follows the spec's
"Dependency access uses declared registries or prepared caches in a separate
controlled phase". The owner chose:
- **Source:** a prepared cache. The host fetches each lockfile tarball from
  the declared registry and verifies its sha512; the worker stays
  `--network=none` and installs offline, so dependency scripts run only
  inside isolation.
- **Authority:** the candidate's lockfile, bounded: features may add
  dependencies, but every entry must name the one declared registry with
  sha512 integrity, within fixed count and byte bounds, and the plan digest is
  evidence.
- **Phase:** validation first; coding keeps its offline mode.

The work is split. D1, this slice, is the host-side plan and fetch. D2 is the
validation guest's offline install, which changes the validation policy pin.

## What changed

- **`src/dependency-cache.ts`:**
  - `npmCachePlan(lockfile)`: a lockfile version 2 or 3, at most 16 MiB, read
    as data. Every package under `node_modules/` must resolve to exactly
    `https://registry.npmjs.org` plus a tarball path, with a well-formed
    sha512 among its integrity hashes; bundled packages are skipped. Anything
    else refuses the whole lockfile: another registry or plain http, git or
    file sources, workspace links, packages outside `node_modules/`, ports,
    credentials, queries, encoded or plain dot segments, missing or sha1-only
    or malformed integrity, one tarball under two integrities, more than 4096
    tarballs. The plan is sorted and deduplicated, with the lockfile's and its
    own SHA-256.
  - `fetchNpmCache(plan, { reader, signal, totalBytes })`: re-checks the plan
    and its digest before any request, then fetches each tarball through the
    injected reader within 64 MiB and 60 s, all within 512 MiB, uncompressed,
    and admits the cache only if every sha512 matches. Files are named
    `<sha512>.tgz`. Any refusal, unreachable registry or cancellation admits
    nothing.
  - The reader is injected and receives the per-tarball byte bound, so the
    real HTTPS reader can stop reading early; it arrives with D2, where it is
    wired and tested against a local server. Each read is raced against its
    abort signal, so a reader that ignores cancellation cannot hold the host.
  - One tarball reached through two paths is fetched and verified for each,
    but kept as one cache file.
- `CONTEXT.md` defines "Prepared dependency cache"; `docs/isolated-validation.md`
  describes the plan and fetch.

## Review

Two-axis review. Applied:
- The CONTEXT.md entry was inserted inside the previous term; it now follows
  that term's `_Avoid_` line.
- Registry names keep their case (for example `JSONStream`), so ordinary
  lockfiles are not refused.
- The fetch re-checked plan paths more weakly than the plan: a hand-edited
  plan with a dot segment and a recomputed digest passed. Plan and fetch now
  share one check that the path is unchanged by URL parsing.
- The reader gets the byte bound, reads are raced against cancellation, an
  integrity string over 1 KiB is refused before splitting, duplicate tarballs
  are one file, and the refusal helpers narrow types instead of `!`.

Left as is: workspaces, `http://` and other registries are refused, as the
owner's bounded scope intends; the lockfile bound stays at 16 MiB so large
real lockfiles fit; the flat `<sha512>.tgz` files become an npm cache inside
the guest in D2.

## Testing

`tests/zz-validation-dependency-cache.test.mjs`, 34 tests after review, written first and
red before the module existed. The name sorts last, so it joins Windows shard 5
and no other file changes shard.
- The plan: exact tarballs, sorted and deduplicated, bundled entries skipped,
  stable digest that changes with the lockfile; an empty lockfile; 19 refused
  lockfile shapes; the size and count bounds.
- The fetch: exactly the planned URLs, each sha512 verified, content-addressed
  files and byte total; refusal for a tampered tarball, a missing one, an
  unreachable registry, a compressed response, an oversized tarball, the total
  bound, a changed plan (no request made) and cancellation.
- After review: names keep their case, an oversized integrity, one tarball
  through two paths, a dot-segment plan path with a recomputed digest, and a
  reader that ignores cancellation.
- Coverage of the module: 100% of lines, 97.8% of branches.
- Full suite before the review fixes: 1,367 tests, 1,363 passed, 0 failed,
  4 skipped. The fixes touch only the new module and its test file, which
  pass after them.
- Mutation checks: removing the integrity, plan-digest and conflict guards
  each fails a test. Three guards survived because the registry-path equality
  already refuses what they checked (origin, query, workspace links); they
  were removed, and port and encoded-segment cases were added to prove the
  equality covers them. After review, removing the dot-segment, integrity
  length or dedupe guard fails a test, and removing the race makes its test
  time out.

Production remains disabled.
