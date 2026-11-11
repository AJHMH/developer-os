/** A controlled stand-in for the owner's production admission (ticket 04)
 * that admits exactly the fixture's coding pins and validation binding.
 * `patch` overrides what it admits; `revoked()` makes it refuse. */
export function controlledProduction(f, patch = {}) {
  let revoked = false;
  return {
    path: "/controlled/production-admission.json",
    calls: 0,
    revoke() {
      revoked = true;
    },
    admitted() {
      this.calls++;
      if (revoked)
        throw Error("Owner production admission is missing or invalid");
      return {
        coding: { ...f.runtime.pins },
        validationBindingSha256: f.validation.bindingSha256,
        productionSha256: "9".repeat(64),
        ...patch,
      };
    },
  };
}
