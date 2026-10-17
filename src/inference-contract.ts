export const gatewayModel = "gpt-6.1-sol";
export const gatewayMarker = "AIOS model-only inference complete";
export const gatewayRequest = JSON.stringify({
  model: gatewayModel,
  input: [{ role: "user", content: `Say exactly: ${gatewayMarker}` }],
  store: false,
  stream: true,
});

export function syntheticGatewayResponse(): Buffer {
  const item = {
    id: "msg_aios_fixture",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: gatewayMarker, annotations: [] }],
  };
  const response = {
    id: "resp_aios_fixture",
    object: "response",
    status: "completed",
    model: gatewayModel,
    output: [item],
  };
  const events = [
    {
      type: "response.created",
      response: { ...response, status: "in_progress", output: [] },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, status: "in_progress", content: [] },
    },
    {
      type: "response.content_part.added",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    },
    {
      type: "response.output_text.delta",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: gatewayMarker,
    },
    {
      type: "response.output_text.done",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      text: gatewayMarker,
    },
    {
      type: "response.content_part.done",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: item.content[0],
    },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response },
  ];
  return Buffer.from(
    events
      .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join(""),
  );
}

const inputTypes = ["message", "additional_tools"];
const roles = ["user", "developer", "system"];
const inputTextType = "input_text",
  toolType = "function",
  forbiddenToolPrefix = "mcp__";
export function matchesInferenceRequest(raw: string): boolean {
  try {
    if (Buffer.byteLength(raw) > 65536) return false;
    const value = JSON.parse(raw);
    if (
      !value ||
      value.model !== gatewayModel ||
      value.stream !== true ||
      value.store !== false ||
      !Array.isArray(value.input) ||
      !Array.isArray(value.tools === undefined ? [] : value.tools)
    )
      return false;
    const users = value.input.filter((item: any) => item?.role === "user");
    const text = (item: any) =>
      typeof item.content === "string"
        ? item.content
        : Array.isArray(item.content) &&
            item.content.length === 1 &&
            item.content[0]?.type === inputTextType
          ? item.content[0].text
          : undefined;
    return (
      users.length > 0 &&
      text(users.at(-1)) === `Say exactly: ${gatewayMarker}` &&
      value.input.every(
        (item: any) =>
          item &&
          (item.type === undefined || inputTypes.includes(item.type)) &&
          roles.includes(item.role),
      ) &&
      (value.tools === undefined ? [] : value.tools).every(
        (tool: any) =>
          tool &&
          tool.type === toolType &&
          typeof tool.name === "string" &&
          !tool.name.startsWith(forbiddenToolPrefix),
      )
    );
  } catch {
    return false;
  }
}
/** Fresh data for Python fixtures; values are never hand-maintained in a second language. */
export function inferenceFixtureContract() {
  return {
    model: gatewayModel,
    marker: gatewayMarker,
    prompt: `Say exactly: ${gatewayMarker}`,
    request: JSON.parse(gatewayRequest),
    requestRaw: gatewayRequest,
    responseBase64: syntheticGatewayResponse().toString("base64"),
    inputTypes: [...inputTypes],
    roles: [...roles],
    inputTextType,
    toolType,
    forbiddenToolPrefix,
  };
}
export function syntheticRelayContract() {
  return {
    request: Buffer.from(
      JSON.stringify({ model: "synthetic", input: "ticket22" }),
    ).toString("base64"),
    response: Buffer.from("AIOS synthetic model response\n").toString("base64"),
    dependency: Buffer.from("AIOS synthetic dependency artifact\n").toString(
      "base64",
    ),
  };
}
