// A synthetic usage reader for the coding tests (Issue 04 slice 4c, owner
// decision C). It reports the usage state the test sets, from one account, at
// the observing controller's clock, and counts its observations.
const usedPercent = { healthy: 10, low: 85, exhausted: 100 };

/** Replace the fixture's usage reader. Set `state` to "healthy", "low",
 * "exhausted" or "unknown" (no observation at all). */
export function syntheticUsage(f, accountId) {
  const reader = { state: "healthy", observations: 0 },
    fixture = f.subscription;
  f.subscription = async (at) => {
    reader.observations += 1;
    if (reader.state === "unknown") return undefined;
    const percent = usedPercent[reader.state],
      observed = await fixture(at);
    return {
      ...observed,
      accountId,
      windows: observed.windows.map((w) => ({ ...w, usedPercent: percent })),
      exhausted: percent >= 100,
    };
  };
  return reader;
}
