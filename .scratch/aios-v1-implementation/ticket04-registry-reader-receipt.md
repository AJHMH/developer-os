# Issue 04: the dependency cache's registry reader and v1 bounds (D2a)

Base: `main` at `78afaf2`. 29 October 2026. Host-only; no guest or pin change,
no network in tests.

## Owner decisions for D2 (29 October)

- **Transfer:** chunked management calls carry the cache into the validation
  VM, each chunk checked by sha256 and each tarball by its sha512.
- **Checks:** install once per attempt into a dependency layer, offline in its
  own container; mount it read-only at `/workspace/node_modules` in each
  check. The tested tree stays the candidate files; the layer has its own
  digest in the evidence.
- **Bound:** v1 caches at most 2048 tarballs and 128 MiB.

D2 is split: D2a, this slice, is the reader and the bounds; D2b is the guest
upload, offline install and read-only layer, which changes the validation pin.

A local probe on this Mac (npm 11.13.0, no network) confirmed the install
model: after `npm cache add <tarball>` into a private cache, `npm ci --offline`
installed a lockfile whose `resolved` named the registry, by integrity, with
the registry unreachable, and the package's `postinstall` ran.

## What changed

- `src/dependency-cache.ts`:
  - `httpsRegistryReader(request?)`: one https GET of a registry tarball URL;
    any other URL is refused before connecting. It asks for identity
    encoding, returns a redirect's or a compressed response's status (and
    encoding) for `fetchNpmCache` to refuse, never following it, and rejects
    past the byte bound or on cancellation. `request` is injectable.
  - `dependencyCacheLimits`: 2048 tarballs and 128 MiB in total.
  - Each read's byte bound is the smaller of one tarball's bound and what is
    left of the total; a declared length over it is refused before reading.
  - The reader uses its own https agent with certificate checking, so no
    global agent, environment proxy or disabled verification applies.
- `docs/isolated-validation.md` updated.

## Review

Two-axis review. Applied: an explicit `content-encoding: identity` was
treated as compression and is now read normally; a declared length over the
bound is refused before reading; each read gets only the remaining budget; a
dedicated agent with certificate checking; a test for abort before any
response. Left as is: the reader repeats the shape of `npm-artifact.ts`'s
reader, which serves the online canary and refuses statuses itself, so
merging them would change that canary; the local stand-in exercises the
request handling over http, and TLS to the real registry is exercised by
D2b's native run.

## Testing

Ten tests added to `tests/zz-validation-dependency-cache.test.mjs` (44 in
all), the first six written first and red before the reader existed, against a local HTTP
stand-in reached through the injected request function: the body and identity
request; a redirect returned and not followed; compression reported; the byte
bound; cancellation, before and during the response; non-registry URLs
refused before connecting, including a host the same length as the
registry's; an explicit identity encoding; a declared length over the bound;
the remaining budget as each read's bound. The stand-in asserts the dedicated
agent and certificate checking on every request. Mutation checks: removing the byte
bound, the identity header or the registry prefix check each fails a test.
Module coverage stays at 100% of lines.

## PR 142 coverage follow-up

The Factory coverage gate refused the first head: changed branches passed
(20/22), but global branch coverage fell by a fraction (6300/6747 to
6319/6768) and no decrease is allowed. The four uncovered branches were an
unreachable "equal" sort result and `statusCode ?? 0` (both removed), a fetch
cancelled before it starts (now tested, with no request made), and the
in-stream byte bound, which the up-front length check had taken over in its
test (the test now sends a chunked body with no declared length). The module
is at 100% of lines and branches.

Production remains disabled.
