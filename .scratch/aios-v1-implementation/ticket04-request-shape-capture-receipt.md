# Issue 04 slice 3: Codex 0.161.0 request-shape capture (offline)

Captured 24 October 2026 on the Mac VM (`aios-macos-noshare`, aarch64), from
`main` at `c7c6161`. No inference, no credentials, nothing published.

## How

- `codex-request-capture-guest.py` runs in the guest, piped to
  `podman machine ssh aios-macos-noshare python3`.
  - It builds a coding container the way `src/podman-coding.ts:418` does:
    `--network=none`, read-only, the derived seccomp, uid 65534, the pinned
    binary bind-mounted read-only and the hash checked against `0129f94f…`.
  - It adds one env var, `AIOS_MODEL_ROUTE`, holding a random 64-hex grant.
- A capture-only recorder runs on the container's own `127.0.0.1:18090`. It
  enters the worker's network namespace with
  `podman unshare nsenter --net=/proc/<pid>/ns/net`, as the fixed relay does.
  - It records the request line, header names (values only for
    content-type, accept, user-agent and originator) and the body.
  - It answers with canned SSE. A request that needs a tool gets a reasoning
    item plus a call to the offered tool; a request carrying tool output gets
    `Done.`.
- The locked argv, launch and then `exec resume <thread>`, gains
  `-c model_provider="capture"` and `model_providers.capture.*`: `base_url`,
  `env_key="AIOS_MODEL_ROUTE"`, `wire_api="responses"`,
  `requires_openai_auth=false` and `supports_websockets=false`. It also sets
  `-c model="gpt-6.1-sol"`. No `config.toml` and an empty `CODEX_HOME`.
- Two captures: the pinned argv, and a variant adding
  `-c features.code_mode=false`. Each has a launch and a resume, with 2
  requests per turn. That makes 8 requests.
- The containers and the capture directory were removed (`cleanedUp: true`).
- `codex-request-capture-check.mjs` passes every body through
  `GeneralSessionGateway.inspect` (from `dist/`, built from `c7c6161`).
  - Gateway names come from the observation.
  - Each refused field or item is then removed, to find the next refusal.

## What Codex sends

- **Transport.** Only `POST /v1/responses HTTP/1.1`, with `Content-Length`.
  - No chunking, no content-encoding, no query string, no websocket upgrade.
  - No other path: no `/models` and no preflight.
  - The relay's single-route rule fits Codex as it is.
- **Capability.** It is sent only as `authorization: Bearer <grant>`. It never
  appears in another header, in the body, or in Codex's JSON event log.
- **Headers (14):**
  - `x-codex-beta-features`, `x-codex-window-id`, `x-codex-turn-metadata`;
  - `x-openai-internal-codex-responses-lite`, `x-client-request-id`;
  - `session-id`, `thread-id`;
  - `accept: text/event-stream`, `content-type: application/json`,
    `authorization`;
  - `originator: codex_exec`,
    `user-agent: codex_exec/0.161.0 (Alpine Linux 3.22.2; aarch64) …`;
  - `host`, `content-length`.
- **Body fields:**
  - `model`: `gpt-6.1-sol`;
  - `stream`: true;
  - `store`: false;
  - `input`;
  - `tool_choice`: `"auto"`;
  - `parallel_tool_calls`: false;
  - `reasoning`: `{effort: "low", context: "all_turns"}`;
  - `include`: `["reasoning.encrypted_content"]`;
  - `prompt_cache_key`;
  - `text`: `{verbosity: "low"}`;
  - `client_metadata`.
  - There is **no top-level `tools`** field.
- **`client_metadata` keys:** `root_turn_id`, `session_id`, `thread_id`,
  `turn_id`, `x-codex-window-id`, `x-codex-installation-id` and
  `x-codex-turn-metadata`.
- **Input items.** Bodies are about 52–54 KB.
  - The input opens with one `additional_tools` item (`id`, `role: developer`,
    `tools`).
  - Then come `message` items: developer and user, each with `input_text`.
  - A follow-up replays `reasoning` (`summary`, `content: null`,
    `encrypted_content`), `custom_tool_call` and `custom_tool_call_output`.
  - A resume replays the earlier messages, including the assistant one, and
    sends `additional_tools` again.
- **Tools offered.** All of them sit inside `additional_tools`, grouped by
  namespace:
  - `functions`: `custom:exec` (code mode, JavaScript, with a Lark grammar),
    plus `function:wait`, `request_user_input` and
    `request_user_input_async`;
  - `clock`: `sleep`;
  - `collaboration`: `followup_task`, `interrupt_agent`, `list_agents`,
    `send_message`, `spawn_agent` and `wait_agent`.
- **`-c features.code_mode=false`** had no visible effect: the requests were
  the same size and had the same shape.

## Gateway gaps

Every one of the 8 requests is refused today. The refusals come in this
order, and they are the same in every request:

1. `field`: `client_metadata`.
2. `value`: `reasoning.context` (`"all_turns"`). The gateway allows only
   `effort` and `summary`.
3. `item`: `additional_tools`.

Once those three are removed, every request is admitted. The allowlists for
item types, tool calls, outputs and `include` otherwise match what Codex sent.

## Findings that need an owner decision

1. **The worker has no working command or edit tool.**
   - The pinned binary offers no shell, `apply_patch` or `local_shell` tool.
     Its only command route is code mode's `exec`.
   - In this container code mode fails closed. Codex reports that the
     code-mode host `/codex-code-mode-host` was not found, and each `exec`
     call returns `failed to spawn code-mode host … (os error 2)`.
   - As pinned, a credentialed general session could talk, but could not
     change the workspace.
   - `features.code_mode=false` is not the switch that brings a classic shell
     tool back. The follow-up section below gives the settings that do.
2. **The `responses-lite` dependency.** The gateway replaces worker headers.
   The provider may need `x-openai-internal-codex-responses-lite` (and
   possibly `x-codex-beta-features`) to read an `additional_tools` input
   item. Dropping them could break real turns. Only a live turn can confirm
   this, so it falls under slice 5's budget.
3. **`client_metadata` carries installation and thread identifiers.** The
   gateway can either strip it or allow it with only those keys. ADR 0002
   says it forwards "only the Responses request body", so stripping it means
   changing the body.

## Follow-up: which setting gives the worker a shell and edit tool

Investigated offline the same day, on the same VM and with the same recorder.
`main` was at `9940dfa`, which adds only `CLAUDE.md`.

- **Feature flags don't help.** `codex features list` shows `code_mode` off,
  `code_mode_host` on (stable) and `shell_tool`/`unified_exec` on. Neither
  `--disable code_mode_host` nor `features.code_mode=false` changed the tool
  set. With the host disabled, the error changes to "code-mode host is
  disabled".
- **The cause is the model's catalog entry.** Run `codex debug models` in a
  `--network=none` container. The bundled entry for `gpt-6.1-sol` sets
  `tool_mode: "code_mode_only"` and `use_responses_lite: true`. The other
  value for `tool_mode` is `direct`.
- **The override is `model_catalog_json`.** It is a path to a catalog JSON
  file, and Codex refuses a catalog that contains no models. The capture
  dumps Codex's own catalog and changes only the pinned model's `tool_mode`
  to `direct`. It writes the result to `/session/catalog.json` and passes
  `-c model_catalog_json="/session/catalog.json"`.
  - The tools then become `exec_command`, `write_stdin`, `custom:apply_patch`,
    `view_image`, the goal and `request_user_input` tools, `clock` and
    `collaboration`. They still arrive in an `additional_tools` item.
  - If `use_responses_lite` is also set to false, the tools move to a
    top-level `tools` array, along with `instructions`. That array includes
    a hosted `web_search` tool and `namespace` entries, which the gateway
    refuses (`tool namespace,web_search`), and the responses-lite header
    disappears.
- **The sandbox mode decides whether those tools work:**

  | `--sandbox` | `apply_patch` | `exec_command` |
  |---|---|---|
  | `workspace-write` (locked argv) | not exercised | exit 101: "bubblewrap is unavailable" |
  | `workspace-write` + `--enable use_legacy_landlock` (deprecated) | failed: "Failed to write file" | exit 101: "filesystem-restricted execution requires bubblewrap" |
  | `danger-full-access` | **file written** | **`ls /workspace` exit 0** |

  - With `danger-full-access`, the launch and the explicit resume each
    completed an `apply_patch`, then an `exec_command`, then a final message.
    `hello-7.txt` and `hello-15.txt` were left in the workspace.
  - That shape is refused by the same three gaps:
    `client_metadata`, then `reasoning.context`, then `additional_tools`.
  - Codex's sandbox can't run in this container for a structural reason.
    Bubblewrap needs `unshare`, and the coding seccomp profile removes
    `unshare` and `setns`.
  - So the only working combination is the container as the sole sandbox
    (`danger-full-access` inside `--network=none`, read-only, no
    capabilities, with the derived seccomp profile) plus a pinned catalog
    override.
- **Open risks of this route:**
  - `gpt-6.1-sol` is catalogued as code-mode-only, so direct tools may
    perform worse with that model. Only live turns can show that.
  - The catalog becomes a new input file that the guest program would
    generate and hash-check.
  - Changing the locked argv to `danger-full-access` needs the boundary
    probe to keep proving that every isolation property comes from the
    container.
- The code-mode host route is covered in the next section.

## Follow-up: the pinned code-mode host

Investigated offline on the same VM. No download was needed.

- **Source.** The host comes from the same official package we already pin.
  - The local npm cache holds
    `https://registry.npmjs.org/@openai/codex/-/codex-0.161.0-linux-arm64.tgz`
    (157,136,568 bytes, fetched 11 October). It re-verifies against its
    integrity
    `sha512-SBu0n4C1Pby9rGKUNA02yHEg/ScbECgiTIiKiKhbYWiUWqGPV1hY0Br7joEntbz0dyNzSWqNPD8uOqxcOry/Fg==`.
  - It was unpacked into the session scratchpad, and its layout is
    `vendor/aarch64-unknown-linux-musl/`. The relevant files are:

    | File | SHA-256 |
    |---|---|
    | `bin/codex` | `0129f94f…28a7` (byte-identical to the current pin) |
    | `bin/codex-code-mode-host` | `64efe2950af9d8ac9e9b94b0aac5e41f56307422e34e66a4217aaea0a221fed0` (66,790,400 bytes) |
    | `codex-resources/bwrap` | `c547cbdc762a70ed216789ffaa4c6c0e7d2beabe32245a498f8e365a9fc8dab4` |

  - The package also ships `codex-path/rg`, `codex-resources/zsh` and a
    voice runtime. None of them is needed.
- **Placement.** Codex looks for the host beside its own executable, at
  `/codex-code-mode-host`. The capture program now takes
  `HELPERS = {container path: [VM file, sha256]}`. It hash-checks each
  helper, copies it and bind-mounts it read-only.
  - Both helpers were copied, hash-verified, to
    `~/.local/state/aios-request-capture-assets/` in the VM. That folder is
    separate from `aios-offline-v1`.
- **Results.** The pinned argv and catalog were unchanged (`code_mode_only`,
  no `model_catalog_json`). One code-mode `exec` script called
  `tools.apply_patch(...)` and then `tools.exec_command({cmd: "ls /workspace"})`.

  | Helpers | `--sandbox` | Result |
  |---|---|---|
  | host | `workspace-write` | script failed: "Failed to write file" |
  | host + packaged `bwrap` at `/codex-resources/bwrap` | `workspace-write` | same failure |
  | host | `danger-full-access` | **script completed: file written, `ls` exit 0** |

  - With `danger-full-access`, the launch and the explicit resume each
    completed. `hello-7.txt` and `hello-12.txt` were left in the workspace.
  - The `custom_tool_call_output` carries an array of `input_text` items.
  - Gateway refusals are the same three:
    `client_metadata`, then `reasoning.context`, then `additional_tools`.
    Removing them admits the request.
  - The containers and capture directories were removed. No
    `aios-request-capture` containers remain.
- **What this means.** The worker can keep Codex's intended code mode for
  `gpt-6.1-sol`, with no catalog override, by adding one pinned binary from
  the package it already trusts. That binary is about 67 MB and must be
  checked like `/codex`.
  - Either route needs `danger-full-access`. Codex's own sandbox can't start
    under the coding seccomp profile, which removes `unshare` and `setns`.
    So the container stays the only sandbox.
- **Windows.** The `linux-x64` tarball is not in this Mac's npm cache. Its host
  hash would come from the official `codex-0.161.0-linux-x64.tgz`, which
  you'd fetch on `C:\Users\mraar`.

## Not covered

- Windows was not captured. Its guest runs the x64 build of the same version.
- A real provider's reply to these bodies is not covered (that needs
  inference).
- The SSE format was accepted by Codex: both turns completed with exit 0.
  That shows only that the canned events parse, not what the provider sends.

The raw capture reports stay outside the repository, in the session
scratchpad.
