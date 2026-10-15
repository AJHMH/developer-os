import { redact } from "./redaction.js";
import type { CodingSession } from "./feature-candidate.js";

export interface RepairAttempt {
  reviewRunId?: string;
  prCheckRunId?: string;
  id: string;
  fence: number;
  runnerId: string;
  findings: string[];
  inputSha256: string;
  candidateSha256?: string;
  validationOperationId?: string;
  codingSession?: CodingSession;
  state: "running" | "stopped" | "uncertain";
  outcome: "pending" | "passed" | "failed" | "interrupted" | "exhausted";
  startedAt: string;
  finishedAt?: string;
  startActiveMs: number;
  activeMs: number;
  remainingMs: number;
  remainingCycles: number;
}
export interface RepairEvidence {
  allowanceCycles: number;
  allowanceMs: number;
  activeMs: number;
  checkpoint?: { at: number; runnerId: string };
  attempts: RepairAttempt[];
  extensions: { addedCycles: number; addedMs: number; at: string }[];
}
export function repairFindings(values: string[]): string[] {
  if (
    !Array.isArray(values) ||
    !values.length ||
    values.length > 32 ||
    !values.every(
      (v) =>
        typeof v === "string" &&
        v.trim().length > 0 &&
        v.length <= 2000 &&
        !/[\u0000-\u001f\u007f]/.test(v) &&
        redact(v) === v,
    )
  )
    throw Error("Repair findings must be a bounded non-secret batch");
  return [...values];
}
export function repairBudget(): RepairEvidence {
  return {
    allowanceCycles: 3,
    allowanceMs: 3600000,
    activeMs: 0,
    attempts: [],
    extensions: [],
  };
}
