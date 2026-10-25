// Slice 3 offline capture check. Reads reports from codex-request-capture-guest.py
// and prints, per captured request, its shape (names and fixed values only, never
// prompt text) and what GeneralSessionGateway would refuse. Run after `npm run build`.
// Usage: node .scratch/aios-v1-implementation/codex-request-capture-check.mjs <report.json>...
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { GeneralSessionGateway } from "../../dist/general-session-gateway.js";

const grant = () => ({
  deliveryId: randomUUID(),
  sessionId: randomUUID(),
  accountId: "a".repeat(64),
  hostId: `urn:uuid:${randomUUID()}`,
  expiresAt: Date.now() + 60_000,
  maxRequests: 8,
});
const never = () => {
  throw Error("capture check never reaches account or authority");
};

function shape(body) {
  const items = Array.isArray(body.input) ? body.input : [];
  const tools = [];
  for (const item of items)
    if (item?.type === "additional_tools")
      for (const t of item.tools ?? [])
        tools.push(
          t.type === "namespace"
            ? `namespace ${t.name}[${(t.tools ?? []).map((x) => `${x.type}:${x.name}`).join(",")}]`
            : `${t.type}:${t.name}`,
        );
  const content = new Set();
  for (const item of items)
    for (const c of Array.isArray(item?.content) ? item.content : [])
      content.add(`${item.type ?? "message"}/${item.role ?? "-"}/${c.type}`);
  return {
    fields: Object.keys(body),
    model: body.model,
    stream: body.stream,
    store: body.store,
    include: body.include,
    reasoning: body.reasoning,
    text: body.text,
    tool_choice: body.tool_choice,
    parallel_tool_calls: body.parallel_tool_calls,
    clientMetadataKeys: Object.keys(body.client_metadata ?? {}),
    topLevelTools: (body.tools ?? []).map((t) => `${t.type}:${t.name}`),
    items: items.map((i) => i?.type ?? "(message)"),
    itemKeys: Object.fromEntries(
      [...new Set(items.map((i) => i?.type ?? "(message)"))].map((t) => [
        t,
        [
          ...new Set(
            items
              .filter((i) => (i?.type ?? "(message)") === t)
              .flatMap(Object.keys),
          ),
        ],
      ]),
    ),
    content: [...content],
    additionalTools: tools,
  };
}

for (const path of process.argv.slice(2)) {
  const report = JSON.parse(readFileSync(path, "utf8"));
  console.log(
    `\n# ${path}  variant=${JSON.stringify(report.variant)} cleanedUp=${report.cleanedUp}`,
  );
  for (const run of report.runs) {
    console.log(
      `\n## ${run.phase}: exit ${run.exit}, ${run.seconds}s, ${run.requests.length} request(s), grantInLogs=${run.grantInLogs}`,
    );
    const errors = run.events
      .filter((e) => e.item?.type === "error")
      .map((e) => e.item.message.slice(0, 160));
    if (errors.length) console.log("codex error items:", errors);
    console.log(
      "events:",
      run.events
        .map((e) =>
          e.type ? `${e.type}${e.item ? ":" + e.item.type : ""}` : "non-json",
        )
        .join(" "),
    );
    for (const q of run.requests) {
      if (q.error) {
        console.log(`#${q.n} recorder error: ${q.error}`);
        continue;
      }
      const raw = Buffer.from(q.bodyB64, "base64").toString("utf8");
      const gateway = new GeneralSessionGateway(grant(), never, never);
      let verdict = "admitted";
      try {
        gateway.inspect(raw);
      } catch (e) {
        verdict = `refused: ${e.reason ?? e.message}`;
      }
      const o = gateway.observation;
      console.log(
        JSON.stringify(
          {
            n: q.n,
            request: `${q.method} ${q.target} ${q.version}`,
            answeredWith: q.answeredWith,
            headers: q.headers.map(([k, v]) =>
              v === "<redacted>" ? k : `${k}=${v}`,
            ),
            authorizationIsBearerGrant: q.authorizationIsBearerGrant,
            grantElsewhere: q.grantElsewhereInHeaders || q.grantInBody,
            bodyBytes: q.bodyBytes,
            gateway: {
              verdict,
              refusedFields: o.refusedFields,
              refusedItemTypes: o.refusedItemTypes,
              refusedToolTypes: o.refusedToolTypes,
            },
            shape: shape(JSON.parse(raw)),
          },
          null,
          1,
        ),
      );
    }
  }
}
