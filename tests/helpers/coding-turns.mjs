// Turns shared by the coding-session tests.
export const firstThread = "11111111-1111-4111-8111-111111111111";
/** A Claude Code turn's summarized events: its init, then its result. */
export const claudeEvents = (thread, completed) => [
  { type: "system", subtype: "init", session_id: thread },
  completed
    ? {
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: thread,
      }
    : {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        session_id: thread,
      },
];
// A Claude Code turn that starts its conversation and then fails leaves a
// stopped, resumable session that owns that conversation.
export const failedTurn = async (request) => ({
  operationId: request.operationId,
  fence: request.fence,
  exitCode: 1,
  events: claudeEvents(request.threadId ?? firstThread, false),
});
// The same failure on Codex.
export const codexFailedTurn = async (request) => ({
  operationId: request.operationId,
  fence: request.fence,
  exitCode: 1,
  events: [
    { type: "thread.started", thread_id: firstThread },
    { type: "turn.started" },
    { type: "turn.failed", error: { message: "synthetic failure" } },
  ],
});
