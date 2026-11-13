import { createHash } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { insideRepository, readOwnerBytes } from "./coding-admission.js";
import {
  completeQualificationScope,
  passingCompleteQualification,
  qualificationComponents,
} from "./complete-qualification.js";
import {
  type ClaudeCodingPins,
  claudeCodingPinFields,
  validClaudeCodingPins,
} from "./feature-candidate.js";
import {
  type ValidationPins,
  validationBindingSha256,
  validationPinKeys,
  validValidationPins,
} from "./native-validation.js";

export const productionAdmissionScope = "aios-production-admission-v1";
/** The worker qualification report a production admission must name. */
export const qualificationReportScope = "native-worker-offline-qualification";
export const passingQualificationOutcome =
  "observed-offline-worker-qualification";
/** A qualification report is a few kilobytes; this bounds the read. */
const reportMaxBytes = 1 << 20;

/** What the owner's production record admits, read afresh. */
export interface ProductionAdmitted {
  /** The Claude Code pins a delivery's coding must have run under. */
  coding: ClaudeCodingPins;
  /** The binding its validation attempts must record (see
   * `validationBindingSha256`). */
  validationBindingSha256: string;
  /** Digest of the record's bytes, which a publication records. */
  productionSha256: string;
  /** What the record's report qualifies: the workers alone, or the complete
   * controller (#274), which the pilot requires. */
  level: "worker" | "complete";
}

/** The owner's production admission (ticket 04): a private, per-host record
 * naming the exact coding and validation pins of a passing worker
 * qualification report, which it names by absolute path and SHA-256. Only a
 * delivery whose coding and validation ran under those pins may publish, and
 * so reach any later stage. Editing or removing the record or the report, or
 * any pin change, revokes it at the next check. */
export interface ProductionAdmission {
  readonly path: string;
  /** Throws when the record or its report is unusable. */
  admitted(): ProductionAdmitted;
}

const sha256 = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>) =>
  Object.keys(value).sort().join();
/** An object with exactly `fields`. */
const exact = (
  value: unknown,
  fields: readonly string[],
): value is Record<string, unknown> =>
  object(value) && keys(value) === [...fields].sort().join();
/** Exactly `fields`, each equal to `pins`'s. */
export const samePins = (
  value: unknown,
  pins: object,
  fields: readonly string[],
) =>
  exact(value, fields) &&
  fields.every(
    (field) => value[field] === (pins as Record<string, unknown>)[field],
  );

export function ownerProductionAdmission(
  path: string,
  options: { clock?: () => number } = {},
): ProductionAdmission {
  const clock = options.clock ?? Date.now;
  if (typeof path !== "string" || !isAbsolute(path))
    throw Error("Production admission record path must be absolute");
  const file = resolve(path);
  if (insideRepository(dirname(file)))
    throw Error("Production admission records never live in a repository");
  return Object.freeze({
    path: file,
    admitted(): ProductionAdmitted {
      try {
        const bytes = readOwnerBytes(file);
        const record: unknown = JSON.parse(bytes.toString("utf8"));
        if (
          !object(record) ||
          keys(record) !==
            "approvedAt,pins,qualificationReport,qualificationSha256,scope" ||
          record.scope !== productionAdmissionScope ||
          typeof record.approvedAt !== "string" ||
          new Date(record.approvedAt).toISOString() !== record.approvedAt ||
          Date.parse(record.approvedAt) > clock() ||
          typeof record.qualificationReport !== "string" ||
          !isAbsolute(record.qualificationReport) ||
          typeof record.qualificationSha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(record.qualificationSha256) ||
          !object(record.pins) ||
          keys(record.pins) !== "coding,validation"
        )
          throw Error();
        const coding = record.pins.coding as ClaudeCodingPins;
        const validation = record.pins.validation as ValidationPins;
        if (
          !exact(coding, claudeCodingPinFields) ||
          !validClaudeCodingPins(coding) ||
          !exact(validation, validationPinKeys(validation)) ||
          !validValidationPins(validation)
        )
          throw Error();
        const reportBytes = readOwnerBytes(
          record.qualificationReport,
          reportMaxBytes,
        );
        if (sha256(reportBytes) !== record.qualificationSha256) throw Error();
        const report: unknown = JSON.parse(reportBytes.toString("utf8"));
        const complete =
          object(report) && report.scope === completeQualificationScope;
        if (
          !object(report) ||
          (complete
            ? report.outcome !== passingCompleteQualification ||
              !completeComponentsIntact(report.components)
            : report.scope !== qualificationReportScope ||
              report.outcome !== passingQualificationOutcome) ||
          report.buildFresh !== true ||
          report.sourceDirty !== false ||
          !object(report.pins) ||
          !samePins(report.pins.coding, coding, claudeCodingPinFields) ||
          !samePins(
            report.pins.validation,
            validation,
            validationPinKeys(validation),
          )
        )
          throw Error();
        return {
          coding: Object.fromEntries(
            claudeCodingPinFields.map((field) => [field, coding[field]]),
          ) as unknown as ClaudeCodingPins,
          validationBindingSha256: validationBindingSha256(validation),
          productionSha256: sha256(bytes),
          level: complete ? "complete" : "worker",
        };
      } catch {
        throw Error("Owner production admission is missing or invalid");
      }
    },
  });
}

/** Every component of a complete qualification is still the accepted report
 * it bound: present, readable and unchanged since. */
function completeComponentsIntact(components: unknown): boolean {
  if (!object(components)) return false;
  const names = Object.keys(qualificationComponents);
  if (keys(components) !== [...names].sort().join()) return false;
  return names.every((name) => {
    const c = components[name];
    if (
      !object(c) ||
      c.accepted !== true ||
      typeof c.path !== "string" ||
      !isAbsolute(c.path) ||
      typeof c.sha256 !== "string"
    )
      return false;
    try {
      return sha256(readOwnerBytes(c.path, reportMaxBytes)) === c.sha256;
    } catch {
      return false;
    }
  });
}
