// A synthetic usage reader (Issue 04, owner decision C): it reports the usage
// state its holder sets, from one account, and counts its observations. Used
// by the coding tests and the owner-run usage canary; never a real reading.
const usedPercent = { healthy: 10, low: 85, exhausted: 100 };

/** A reader for `accountId`. Set `state` to "healthy", "low", "exhausted" or
 * "unknown" (no observation at all); `observe(at)` stamps the observation at
 * `at`, by default `clock()`. As a real window does, its reset time stays
 * fixed (an hour after the first observation), so the usage scope an owner
 * approval names doesn't change with the clock. */
export function syntheticUsage(accountId, clock = Date.now) {
  let resetsAt;
  const reader = {
    state: "healthy",
    observations: 0,
    async observe(at = clock()) {
      reader.observations += 1;
      if (reader.state === "unknown") return undefined;
      const percent = usedPercent[reader.state];
      return {
        observedAt: new Date(at).toISOString(),
        accountId,
        authMode: "chatgpt",
        windows: [
          {
            id: "primary",
            usedPercent: percent,
            resetsAt: (resetsAt ??= Math.floor(at / 1000) + 3600),
          },
        ],
        exhausted: percent >= 100,
      };
    },
  };
  return reader;
}
