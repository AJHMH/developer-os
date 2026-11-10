import type { Delivery } from "./controller.js";
import { needsResumeRecovery } from "./feature-candidate.js";

interface LifecyclePorts {
  read(id: string): Delivery;
  stopValidation(id: string): Promise<Delivery>;
  stopFeature(id: string): Promise<Delivery>;
  finishRepair(id: string, repairId: string): Delivery;
}

/** All current and retained process sessions must independently be stopped:
 * the coding session and every validation attempt. Repair attempts are
 * orchestration allowances, not process sessions. */
export function sessionsQuiescent(delivery: Delivery): boolean {
  // A stopped resume that may have moved its predecessor's home is retained.
  if (
    delivery.feature?.session &&
    needsResumeRecovery(delivery.feature.session)
  )
    return false;
  return [
    delivery.feature?.session,
    ...(delivery.validation?.attempts ?? []),
  ].every((session) => !session || session.state === "stopped");
}

/** Stops a delivery's process sessions by their exact identity. It updates
 * durable documents only through the caller's ports. */
export class SessionLifecycle {
  constructor(private readonly ports: LifecyclePorts) {}

  async stopAll(id: string): Promise<Delivery> {
    let current = this.ports.read(id);
    if (
      current.validation?.attempts.some(
        (attempt) => attempt.state !== "stopped",
      )
    )
      await this.ports.stopValidation(id);
    current = this.ports.read(id);
    if (current.feature?.session && current.feature.session.state !== "stopped")
      await this.ports.stopFeature(id);
    const repair = this.ports.read(id).repair?.attempts.at(-1);
    if (repair && repair.state !== "stopped")
      this.ports.finishRepair(id, repair.id);
    return this.ports.read(id);
  }
}
