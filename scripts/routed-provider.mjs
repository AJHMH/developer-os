// The fake Messages provider for offline routed runs (Issue 04, ADR 0008): no
// network, no use of the key it is given, and fixed calls to Claude Code's
// own `Write` and `Bash` tools. Shared by the routed and admission
// acceptances.

/** Keep-alive requests while the launch is probed, then the work: two
 * minutes, and few enough to keep the turn's output inside its 64 KiB bound. */
export const maxKeepalives = 24;

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
 * text answer. Its observation keeps counts and fixed flags only. */
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
