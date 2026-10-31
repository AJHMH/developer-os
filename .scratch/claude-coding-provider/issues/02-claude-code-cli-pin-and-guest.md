# 02: Pinned Claude Code CLI, guest and `claudeAgent`

Type: task
Status: needs-triage

## What to build

- Add `"claude-code"` to `CodingProvider` and a `claudeAgent` beside
  `codexAgent` in `src/coding-agent.ts`:
  - `argv`: headless `-p --output-format stream-json --verbose`, with a fixed
    permission mode and tool set, `--resume <session_id>` for a resume, and no
    settings or MCP files read from the workspace.
  - `turn`: validate the stream-json transcript (`system` init with
    `session_id`, `assistant`/`user` messages, final `result`) as strictly as
    `codingTurn` does for Codex.
  - `bindsThread`/`boundThread`: the init event's `session_id`.
- Pin the `@anthropic-ai/claude-code` version and digest per host target, the
  way `host-target.ts` pins Codex. Define a Claude pin shape and admission
  scope rather than reusing `codeModeHostSha256`.
- A guest that mounts the pinned CLI read-only, uses `CLAUDE_CONFIG_DIR` as the
  retained session home, and keeps its own retained-home rules.
- The transport names `agent: claudeAgent`, so the controller records
  `provider: "claude-code"` on its sessions.

## Acceptance

- Offline turn, resume and refusal tests mirroring
  `worker-native-coding.test.mjs` and `worker-native-resume.test.mjs`.
- A Codex session followed by a Claude session supersedes the Codex lineage.

## Blocked by

None for the offline path; the routed path depends on 03.
