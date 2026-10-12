# Windows inference preparation — 11 October 2026

Owner completed independent Windows browser consent. The trusted broker returned
`authorized`, `credentialsStored: true`, Windows CurrentUser DPAPI,
`planUsageAuthorized: true`, and `deliveryEnabled: false`. Credential contents
were not printed, committed or copied to VM/worker storage.

The official exact package `@openai/codex@0.161.0-linux-x64` was fetched using
`npm pack --ignore-scripts`. Registry URL:
https://registry.npmjs.org/@openai/codex/-/codex-0.161.0-linux-x64.tgz
Registry integrity: `sha512-AVkNzeJWyCHHPyg5vxD8UE6aFsYaOwq0/x6mtmkOKy6LdjvsyxLr7Q7UULlk+Ma3+PnrN8uIxG2/XGPQ936hgA==`.
Extracted Linux x64 executable SHA-256:
`9a820c17865fa825d04db416818679a9d63bd72e50835c396f496e5684626c9c`.
Only that hash-pinned executable was provisioned in the dedicated VM management
storage; a differing existing file would have been refused. Prior pins remain.

Fresh external policy: `C:/Users/mraar/.developer-os/ticket19-native/pins-windows-ticket24-auth-20261011.json`.
Serial native preparation used `scripts/run-native-acceptance.mjs` and
`ticket24-windows-gateway-inference.mjs --policy <that policy>`.
Actual isolated Codex, synthetic account/provider, endpoint restrictions,
cross-delivery/namespace/revocation/quota/expiry checks and zero remaining worker
processes passed. See `ticket24-windows-gateway-observation.json`.
No real provider inference was sent. The exact live request is retained in
`ticket24-windows-gateway-inference-plan.json`; approval is pending.

Execution requires the exact unused run ID plus explicit unknown-usage approval,
unexpired plan, freshly matching account/host/request/VM/policy/gateway/worker
pins, then an external durable one-shot consumption marker before credential
access. It allows one request, 30 seconds, 65536 response bytes, no retries,
refresh or paid fallback. Revocation runs on exit. Preparation and execution
leave production delivery disabled. A failed or expired run requires a newly
prepared plan and approval.

## Standards

No blocking findings in this slice. Independent platform hashes, bounded
one-shot execution and durable consumption before credential access were reviewed.

## Spec

No corrective findings in this slice. Windows evidence is independent of Mac
qualification; live subscription inference and complete ticket 24 remain pending.

Findings: Standards 0; Spec 0.

Validation: typecheck and focused public-platform tests passed. Full suite:
164 tests, 163 passed, one macOS-only ACL skip, zero failures. Standards and Spec
reviews cleared this slice. Windows plan preparation passed under the serial
native acceptance lock; actual provider inference remains not-run.
