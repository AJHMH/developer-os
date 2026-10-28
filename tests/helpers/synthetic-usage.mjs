// The shared synthetic usage reader (Issue 04 slice 4c, owner decision C),
// installed as a coding fixture's reader at the fixture clock.
import { syntheticUsage as reader } from "../../scripts/synthetic-usage.mjs";

/** Replace the fixture's usage reader. Set `state` to "healthy", "low",
 * "exhausted" or "unknown" (no observation at all). */
export function syntheticUsage(f, accountId) {
  const usage = reader(accountId, () => f.now);
  f.subscription = (at) => usage.observe(at);
  return usage;
}
