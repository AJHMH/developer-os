// The interpreter for host fixtures. Macs and Linux commonly have only
// `python3`, and Windows installs `python`; AIOS_TEST_PYTHON overrides either.
export const testPython =
  process.env.AIOS_TEST_PYTHON ||
  (process.platform === "win32" ? "python" : "python3");
