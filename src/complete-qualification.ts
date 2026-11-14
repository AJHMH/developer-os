import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { readOwnerBytes } from "./coding-admission.js";
import { claudeCodingPinFields } from "./feature-candidate.js";
import { hostTargets, supportsHostOS } from "./host-target.js";
import { validationPinKeys } from "./native-validation.js";

/** The complete controller qualification on macOS (#274, v1 ticket 16): one
 * report that binds the owner-run acceptances, each proving some boundaries,
 * by path and SHA-256. They must all come from one clean, freshly built
 * source revision, on one supported Mac and VM, under the same coding and
 * validation pins. Each required boundary is then passed, failed or not run,
 * from the exact stages that evidence it. It passes only when every
 * component is accepted and every boundary passed. Production stays
 * disabled either way. */
export const completeQualificationScope = "native-complete-qualification";
export const passingCompleteQualification =
  "observed-native-complete-qualification";
const reportMaxBytes = 1 << 20;

/** Each component's report scope and passing outcome. */
export const qualificationComponents = Object.freeze({
  worker: {
    scope: "native-worker-offline-qualification",
    outcome: "observed-offline-worker-qualification",
  },
  session: {
    scope: "native-coding-offline-session-acceptance",
    outcome: "observed-offline-session-acceptance",
  },
  validation: {
    scope: "native-validation-offline-admission-acceptance",
    outcome: "observed-offline-validation-admission-acceptance",
  },
  lifecycle: {
    scope: "native-lifecycle-controls",
    outcome: "observed-native-lifecycle-controls",
  },
  delivery: {
    scope: "native-delivery-through-cleanup",
    outcome: "observed-native-delivery-through-cleanup",
  },
} as const);
export type QualificationComponent = keyof typeof qualificationComponents;

/** Every required boundary, its ticket 16 criterion, and the component
 * stages that evidence it. */
export const qualificationBoundaries: readonly {
  id: string;
  criterion: number;
  evidence: readonly [QualificationComponent, readonly string[]][];
}[] = Object.freeze([
  {
    id: "runtime-pins",
    criterion: 1,
    evidence: [
      [
        "worker",
        [
          "coding-fresh-pins",
          "validation-fresh-pins",
          "owner-records-name-fresh-pins",
          "changed-pins-refused",
        ],
      ],
    ],
  },
  {
    id: "boundary-probes",
    criterion: 2,
    evidence: [
      ["worker", ["coding-live-boundary-probe", "validation-boundary-probe"]],
    ],
  },
  {
    id: "signing-and-authentication",
    criterion: 3,
    evidence: [
      [
        "delivery",
        [
          "repository-facts",
          "cli-publish-feature",
          "cli-monitor-pr-checks",
          "cli-merge-feature",
        ],
      ],
    ],
  },
  {
    id: "output-admission",
    criterion: 3,
    evidence: [
      ["lifecycle", ["c-symlink-output-refused"]],
      ["session", ["lineage-a-moved-input-collected"]],
    ],
  },
  {
    id: "isolated-web-validation",
    criterion: 3,
    evidence: [
      [
        "validation",
        [
          "controller-dependency-validation",
          "controller-database-validation",
          "controller-browser-validation",
        ],
      ],
    ],
  },
  {
    id: "descendant-termination",
    criterion: 4,
    evidence: [
      [
        "worker",
        [
          "coding-exact-stop-removes-descendants",
          "validation-deadline-kills-descendants",
          "validation-stop-mid-check-and-fence",
        ],
      ],
    ],
  },
  {
    id: "pause-and-cancel",
    criterion: 4,
    evidence: [
      [
        "lifecycle",
        [
          "a-pause-mid-coding",
          "a-cancel-mid-validation",
          "a-resume-refused-after-cancel",
        ],
      ],
    ],
  },
  {
    id: "explicit-session-resume",
    criterion: 4,
    evidence: [
      [
        "session",
        ["lineage-a-resume-onto-moved-main", "lineage-a-resume-after-recovery"],
      ],
      ["lifecycle", ["a-code-after-resume"]],
    ],
  },
  {
    id: "controller-recovery",
    criterion: 4,
    evidence: [
      ["lifecycle", ["b-controller-killed-mid-coding", "b-recover"]],
      [
        "session",
        ["lineage-a-stranded-resume", "lineage-a-recovery-returns-home"],
      ],
    ],
  },
  {
    id: "delivery-through-cleanup",
    criterion: 3,
    evidence: [
      [
        "delivery",
        ["cli-monitor-main-checks", "cli-sync-main", "cli-cleanup-branches"],
      ],
    ],
  },
]);

/** The probes the worker qualification must have run and passed, in both
 * workers, the two ticket 16 added among them. */
export const requiredProbes = Object.freeze({
  coding: ["proxy", "cross-delivery"],
  validation: ["proxy"],
});

type Outcome = "passed" | "failed" | "not-run";
type Json = Record<string, unknown>;
const object = (v: unknown): v is Json =>
  !!v && typeof v === "object" && !Array.isArray(v);
const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const sameFields = (a: unknown, b: unknown, fields: readonly string[]) =>
  object(a) && object(b) && fields.every((f) => a[f] === b[f]);

export interface ComponentEvidence {
  path: string;
  sha256: string;
  accepted: boolean;
  problems: string[];
}

/** Combine the component reports at `paths` into the complete
 * qualification. `revision` is the clean source revision the combination
 * itself runs from; every component must come from it. */
export function completeQualification(
  paths: Partial<Record<QualificationComponent, string>>,
  revision: string,
): Json {
  const components: Partial<Record<QualificationComponent, ComponentEvidence>> =
    {};
  const reports: Partial<Record<QualificationComponent, Json>> = {};
  for (const name of Object.keys(
    qualificationComponents,
  ) as QualificationComponent[]) {
    const path = paths[name];
    if (path === undefined) continue;
    const evidence: ComponentEvidence = {
      path,
      sha256: "",
      accepted: false,
      problems: [],
    };
    components[name] = evidence;
    try {
      if (!isAbsolute(path)) throw Error("its path isn't absolute");
      const bytes = readOwnerBytes(path, reportMaxBytes);
      evidence.sha256 = sha256(bytes);
      const report: unknown = JSON.parse(bytes.toString("utf8"));
      if (!object(report)) throw Error("it isn't a report");
      reports[name] = report;
    } catch (error) {
      evidence.problems.push(
        `unreadable: ${error instanceof Error && error.message ? error.message : "not a private owner file"}`,
      );
    }
  }
  // The worker qualification names the pins and the VM everything shares.
  const worker = reports.worker;
  const pins = object(worker?.pins) ? worker.pins : undefined;
  const codingPins = pins?.coding;
  const validationPins = object(pins?.validation) ? pins.validation : undefined;
  const validationFields = validationPins
    ? validationPinKeys(validationPins as never)
    : [];
  const machine = object(worker?.host) ? worker.host.machine : undefined;
  const darwin = hostTargets.darwin;
  for (const [name, report] of Object.entries(reports) as [
    QualificationComponent,
    Json,
  ][]) {
    const want = qualificationComponents[name];
    const problems = components[name]!.problems;
    if (report.scope !== want.scope) problems.push("another kind of report");
    if (report.outcome !== want.outcome)
      problems.push(`outcome ${String(report.outcome)}`);
    if (report.buildFresh !== true) problems.push("a stale build");
    if (report.sourceDirty !== false) problems.push("a dirty source tree");
    if (report.sourceRevision !== revision)
      problems.push(`source revision ${String(report.sourceRevision)}`);
    if (report.productionEnabled === true) problems.push("production enabled");
    const host = object(report.host) ? report.host : {};
    if (
      host.platform !== darwin.platform ||
      host.arch !== darwin.arch ||
      !supportsHostOS(darwin, host.release)
    )
      problems.push("an unsupported host");
    if (host.machine !== machine || typeof machine !== "string")
      problems.push("another VM");
    // Pins, where the report records them: the worker's own, the session's
    // coding pins, the validation run's, and the CLI runs' fresh pins.
    const own = object(report.pins) ? report.pins : undefined;
    const fresh = object(report.freshPins) ? report.freshPins : undefined;
    const coding =
      name === "session"
        ? own
        : name === "worker"
          ? own?.coding
          : fresh?.coding;
    const validation =
      name === "validation"
        ? own
        : name === "worker"
          ? own?.validation
          : fresh?.validation;
    if (
      name !== "validation" &&
      !sameFields(coding, codingPins, claudeCodingPinFields)
    )
      problems.push("other coding pins");
    if (
      name !== "session" &&
      (!validationFields.length ||
        !sameFields(validation, validationPins, validationFields))
    )
      problems.push("other validation pins");
    components[name]!.accepted = problems.length === 0;
  }
  const stageOutcome = (
    name: QualificationComponent,
    stage: string,
  ): Outcome => {
    if (!components[name]?.accepted) return "not-run";
    const stages = reports[name]!.stages;
    const found = Array.isArray(stages)
      ? (stages as Json[]).find((s) => s?.name === stage)
      : undefined;
    if (!found || found.outcome === "not-run") return "not-run";
    return found.outcome === "passed" ? "passed" : "failed";
  };
  const boundaries = qualificationBoundaries.map((b) => {
    const evidence = b.evidence.flatMap(([name, stages]) =>
      stages.map((stage) => ({
        component: name,
        stage,
        outcome: stageOutcome(name, stage),
      })),
    );
    if (b.id === "boundary-probes" && components.worker?.accepted)
      for (const kind of ["coding", "validation"] as const) {
        const section = worker![kind];
        const probes =
          object(section) && Array.isArray(section.probes)
            ? (section.probes as Json[])
            : [];
        if (!probes.length)
          evidence.push({
            component: "worker",
            stage: `${kind}-probes`,
            outcome: "not-run",
          });
        for (const probe of probes)
          evidence.push({
            component: "worker",
            stage: `${kind}-probe-${String(probe.name)}`,
            outcome: probe.outcome === "passed" ? "passed" : "failed",
          });
        for (const name of requiredProbes[kind])
          if (!probes.some((p) => p.name === name))
            evidence.push({
              component: "worker",
              stage: `${kind}-probe-${name}`,
              outcome: "not-run",
            });
      }
    const outcome: Outcome = evidence.some((e) => e.outcome === "failed")
      ? "failed"
      : evidence.some((e) => e.outcome === "not-run")
        ? "not-run"
        : "passed";
    return { id: b.id, criterion: b.criterion, outcome, evidence };
  });
  const missing = (
    Object.keys(qualificationComponents) as QualificationComponent[]
  ).filter((name) => !components[name]);
  const passed =
    !missing.length &&
    Object.values(components).every((c) => c.accepted) &&
    boundaries.every((b) => b.outcome === "passed");
  return {
    scope: completeQualificationScope,
    outcome: passed ? passingCompleteQualification : "blocked",
    productionEnabled: false,
    sourceRevision: revision,
    host: worker?.host ?? null,
    pins: pins ?? null,
    components,
    missing,
    boundaries,
  };
}
