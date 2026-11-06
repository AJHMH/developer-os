// One call on the guest simulator at `root`, in a process of its own, so the
// fixture's host mocks never reach the test that asked. See
// guest-backed-sessions.mjs. It prints `{ result }` or `{ error }`.
import { createHash } from "node:crypto";
import { mock } from "node:test";
import { guestFixture } from "./native-coding-fixture.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const bytes = Buffer.from("guest-backed session\n");
const path = "index.html";
const prompt = "guest-backed";

async function mirror({ transport, read, write }, request) {
  write({ ...read(), threadId: request.thread });
  const identity = {
    operationId: request.operationId,
    fence: request.fence,
    state: "running",
    intent: request.intent,
  };
  let seen = false;
  await transport
    .run(
      {
        ...identity,
        ...(request.threadId
          ? {
              threadId: request.threadId,
              resumeFrom: {
                operationId: request.resumeFrom.operationId,
                fence: request.resumeFrom.fence,
                state: "stopped",
                intent: request.resumeFrom.intent,
              },
            }
          : {}),
        pins: await transport.inspect(identity),
        argv: request.threadId
          ? [
              "exec",
              "resume",
              "--json",
              "--skip-git-repo-check",
              "-c",
              'sandbox_mode="workspace-write"',
              request.threadId,
              prompt,
            ]
          : [
              "exec",
              "--json",
              "--skip-git-repo-check",
              "--sandbox",
              "workspace-write",
              prompt,
            ],
        branch: "codex/guest-backed",
        sourceRevision: sha256(prompt).slice(0, 40),
        files: [{ path, bytes, executable: false }],
        inputSha256: sha256(
          JSON.stringify([{ path, sha256: sha256(bytes), executable: false }]),
        ),
        allowanceMs: 60000,
        mayDispatch: () => true,
        // The turn ends once its thread is reported, as offline turns do.
        checkpoint: () => !seen,
        onEvent: () => true,
      },
      () => {
        seen = true;
      },
    )
    .catch((error) => {
      if (!seen) throw error;
    });
}

const actions = {
  mirror,
  clean: ({ transport }, session) =>
    transport.cleanupSupersededLineage(session),
  stop: ({ transport }, session) =>
    transport.stop({ ...session, state: "uncertain" }),
};

const [root, action, input] = process.argv.slice(2);
let answer;
try {
  const fixture = guestFixture({ mock, after() {} }, {}, root);
  answer = {
    result: (await actions[action](fixture, JSON.parse(input))) ?? {},
  };
} catch (error) {
  answer = { error: String(error?.message) };
}
process.stdout.write(JSON.stringify(answer), () => process.exit(0));
