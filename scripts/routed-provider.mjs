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

/** Server-sent events for one canned Messages response, as Claude Code reads
 * them, for `model`. `blocks` are complete content blocks; each `tool_use`
 * block's input streams as one JSON delta. */
export function messagesEvents(id, model, blocks, stopReason) {
  const events = [
    {
      type: "message_start",
      message: {
        id,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
    ...blocks.flatMap((block, index) =>
      block.type === "tool_use"
        ? [
            {
              type: "content_block_start",
              index,
              content_block: { ...block, input: {} },
            },
            {
              type: "content_block_delta",
              index,
              delta: {
                type: "input_json_delta",
                partial_json: JSON.stringify(block.input),
              },
            },
            { type: "content_block_stop", index },
          ]
        : [
            {
              type: "content_block_start",
              index,
              content_block: { type: "text", text: "" },
            },
            {
              type: "content_block_delta",
              index,
              delta: { type: "text_delta", text: block.text },
            },
            { type: "content_block_stop", index },
          ],
    ),
    {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ];
  return events
    .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
}

/** The text of a `tool_result` block's content, which is a string or blocks. */
function resultText(block) {
  const content = block?.content;
  if (typeof content === "string") return content;
  return Array.isArray(content)
    ? content
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("")
    : "";
}

/** A Messages provider for one Claude Code turn (ADR 0008): no network, and
 * no use of the key it is given. Requests get a `Bash` keep-alive (`sleep 5`)
 * until `released()`; then `Write` adds `routed-<tag>.txt` and `Bash` reads it
 * back, and only a read that returns the content earns the marker; then a
 * final message ends the turn. Requests that are not a turn's next step, such
 * as a title or a token count, are counted as unexpected and get a plain
 * text answer. Its observation keeps counts and fixed flags only, like
 * `fakeProvider`'s. */
export function fakeMessagesProvider(tag, released, model) {
  const observation = {
    requests: 0,
    keepalives: 0,
    toolsWorked: false,
    finalAnswered: false,
    unexpected: 0,
  };
  const file = `routed-${tag}.txt`,
    content = `routed ${tag}`;
  const ids = { write: undefined, read: undefined };
  const tool = (n, name, input) => ({
    type: "tool_use",
    id: `toolu_${tag}_${n}`,
    name,
    input,
  });
  async function* provider(_key, body) {
    const n = observation.requests++;
    const messages = JSON.parse(body).messages ?? [];
    // The tool results answering the last assistant turn. Claude Code 2.1.309
    // and later may follow them with a system message (its environment), so
    // they are not always in the last message.
    const turnStart = messages.findLastIndex((m) => m?.role === "assistant");
    const results = messages
      .slice(turnStart + 1)
      .flatMap((m) =>
        Array.isArray(m?.content)
          ? m.content.filter((b) => b?.type === "tool_result")
          : [],
      );
    const answered = (id) => results.find((b) => b.tool_use_id === id);
    // Every request after the first follows one of this turn's tool calls.
    if (n > 0 && !results.length) {
      observation.unexpected++;
      yield Buffer.from(
        messagesEvents(
          `msg_${tag}_${n}`,
          model,
          [{ type: "text", text: "Done." }],
          "end_turn",
        ),
      );
      return;
    }
    let blocks,
      stop = "tool_use";
    if (!ids.write && !released() && observation.keepalives < maxKeepalives) {
      observation.keepalives++;
      blocks = [tool(n, "Bash", { command: "sleep 5", description: "Wait" })];
    } else if (!ids.write) {
      blocks = [
        tool(n, "Write", {
          file_path: `/workspace/${file}`,
          content: `${content}\n`,
        }),
      ];
      ids.write = blocks[0].id;
    } else if (!ids.read) {
      blocks = [
        tool(n, "Bash", {
          command: `cat /workspace/${file}`,
          description: "Read back",
        }),
      ];
      ids.read = blocks[0].id;
    } else {
      observation.toolsWorked ||=
        answered(ids.read) !== undefined &&
        answered(ids.read).is_error !== true &&
        resultText(answered(ids.read)).includes(content);
      observation.finalAnswered = true;
      blocks = [{ type: "text", text: "Done." }];
      stop = "end_turn";
    }
    yield Buffer.from(messagesEvents(`msg_${tag}_${n}`, model, blocks, stop));
  }
  return { provider, observation };
}
