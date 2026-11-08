// The CLI refuses every host but the owner's Mac (ADR 0007). Test files that
// start the real CLI import this first, so they also work off macOS however
// they are launched: through `npm test`, or by a runner that calls
// `node --test` directly, such as the Factory's coverage adapter. On macOS it
// changes nothing, so the CLI meets the real check there.
export function standInForOwnerHost(
  env = process.env,
  platform = process.platform,
) {
  if (platform !== "darwin") env.AIOS_TEST_HOST_PLATFORM ??= "darwin";
  return env;
}
standInForOwnerHost();
