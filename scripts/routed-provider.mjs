// The fake model provider for offline routed runs (Issue 04): no network, no
// use of the token it is given, and fixed code-mode scripts that edit
// through `apply_patch` and read back through `exec_command`. Shared by the
// routed acceptance and the usage canary.

/** Keep-alive scripts while the launch is probed, then the work script: two
 * minutes, and few enough to keep Codex's output inside its 64 KiB bound. */
export const maxKeepalives = 24;

/** The fixed code-mode script for turn `tag`: add a file through
 * `apply_patch`, read it back through `exec_command`, and report a marker
 * that only a successful read produces. The script's source never contains
 * the marker itself. */
export function workScript(tag) {
  const file = `routed-${tag}.txt`,
    content = `routed ${tag}`;
  const patch = `*** Begin Patch\n*** Add File: ${file}\n+${content}\n*** End Patch\n`;
  return [
    `await tools.apply_patch(${JSON.stringify(patch)});`,
    `const read = await tools.exec_command({cmd: ${JSON.stringify(`cat /workspace/${file}`)}});`,
    `text(JSON.stringify(read).includes(${JSON.stringify(content)}) ? ${JSON.stringify(["AIOS", "ROUTED", "OK", tag])}.join("-") : "AIOS routed tools failed");`,
    "",
  ].join("\n");
}
// Shorter than exec_command's default yield, so each script ends by itself.
const waitScript = [
  'await tools.exec_command({cmd: "sleep 5"});',
  'text(["AIOS", "ROUTED", "WAIT"].join("-"));',
  "",
].join("\n");

/** Server-sent events for one canned response, as Codex reads them. */
function events(id, items) {
  return [
    { type: "response.created", response: { id } },
    ...items.map((item) => ({ type: "response.output_item.done", item })),
    {
      type: "response.completed",
      response: {
        id,
        usage: {
          input_tokens: 1,
          input_tokens_details: null,
          output_tokens: 1,
          output_tokens_details: null,
          total_tokens: 2,
        },
      },
    },
  ]
    .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
}

/** A provider for one turn: no network, and no use of the token it is given.
 * Requests get a keep-alive script until `released()`, so a probe sees the
 * workspace exactly as admitted; then the work script; then a final message.
 * Its observation keeps counts and fixed flags only. */
export function fakeProvider(tag, released) {
  const observation = {
    requests: 0,
    keepalives: 0,
    toolsWorked: false,
    finalAnswered: false,
    unexpected: 0,
  };
  let workCall;
  const marker = ["AIOS", "ROUTED", "OK", tag].join("-");
  const call = (n, script) => [
    {
      type: "reasoning",
      id: `rs_${tag}_${n}`,
      summary: [],
      encrypted_content: Buffer.from("routed-acceptance-only").toString(
        "base64",
      ),
    },
    {
      type: "custom_tool_call",
      id: `ctc_${tag}_${n}`,
      call_id: `call_${tag}_${n}`,
      name: "exec",
      input: script,
    },
  ];
  async function* provider(_token, body) {
    const n = observation.requests++;
    const input = JSON.parse(body).input;
    // Every request after the first follows one of this turn's scripts.
    if (n > 0 && input.at(-1)?.type !== "custom_tool_call_output")
      observation.unexpected++;
    let items;
    if (!workCall && !released() && observation.keepalives < maxKeepalives) {
      observation.keepalives++;
      items = call(n, waitScript);
    } else if (!workCall) {
      workCall = `call_${tag}_${n}`;
      items = call(n, workScript(tag));
    } else {
      observation.toolsWorked ||= input.some(
        (item) =>
          item?.type === "custom_tool_call_output" &&
          item.call_id === workCall &&
          JSON.stringify(item.output).includes(marker),
      );
      observation.finalAnswered = true;
      items = [
        {
          type: "message",
          id: `msg_${tag}_${n}`,
          role: "assistant",
          content: [{ type: "output_text", text: "Done." }],
        },
      ];
    }
    yield Buffer.from(events(`resp_${tag}_${n}`, items));
  }
  return { provider, observation };
}
