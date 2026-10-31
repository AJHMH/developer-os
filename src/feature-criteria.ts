import { readOwnerRecord } from "./coding-admission.js";
import type { FeaturePlan, FeaturePlanner } from "./feature-candidate.js";

const scope = "aios-feature-criteria-v1";
/** Criteria, verification and clarifications fit well within this. */
const maxBytes = 256 * 1024;

/** The v1 feature planner (ADR 0004): the owner's private criteria file for
 * one delivery, outside every repository. It answers only the exact request,
 * and clarifications, it names; `featurePlan()` still validates its plan. */
export function ownerCriteriaPlanner(
  path: string,
  deliveryId: string,
): FeaturePlanner {
  return {
    async plan(input: string): Promise<FeaturePlan> {
      const record = readOwnerRecord(path, maxBytes) as Record<string, unknown>;
      if (!record || typeof record !== "object" || Array.isArray(record))
        throw Error("Invalid owner criteria");
      const { request, clarifications = [], ...plan } = record;
      if (
        record.scope !== scope ||
        record.deliveryId !== deliveryId ||
        typeof request !== "string" ||
        !Array.isArray(clarifications) ||
        !clarifications.every((c) => typeof c === "string") ||
        Object.keys(record).some(
          (key) =>
            ![
              "scope",
              "deliveryId",
              "request",
              "clarifications",
              "criteria",
              "verification",
              "ambiguity",
              "requires",
            ].includes(key),
        )
      )
        throw Error("Invalid owner criteria");
      // The controller plans the request alone, and a clarification with
      // every clarification so far (`clarifyFeature`).
      const answers = clarifications.length
        ? JSON.stringify({ request, clarifications })
        : request;
      if (answers !== input)
        throw Error("Owner criteria answer another request");
      return {
        criteria: plan.criteria,
        verification: plan.verification,
        ambiguity: plan.ambiguity,
        ...(plan.requires === undefined ? {} : { requires: plan.requires }),
      } as FeaturePlan;
    },
  };
}
