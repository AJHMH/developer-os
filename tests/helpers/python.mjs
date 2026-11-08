// The interpreter for host fixtures. Macs and Linux commonly have only
// `python3`; AIOS_TEST_PYTHON overrides it.
export const testPython = process.env.AIOS_TEST_PYTHON || "python3";
