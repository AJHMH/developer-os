// Turns shared by the coding-session tests.
export const firstThread = "11111111-1111-4111-8111-111111111111";
// A turn that starts its CLI thread and then fails leaves a stopped,
// resumable session that owns that thread.
export const failedTurn = async (request) => ({
  operationId: request.operationId,
  fence: request.fence,
  exitCode: 1,
  events: [
    { type: "thread.started", thread_id: firstThread },
    { type: "turn.started" },
    { type: "turn.failed", error: { message: "synthetic failure" } },
  ],
});
