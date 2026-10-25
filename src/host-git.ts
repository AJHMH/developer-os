/** The working directory for every host git process. Windows resolves a bare
 * program name against the current directory before PATH, so a target
 * repository's own `git.exe` would run on the host if git started inside it.
 * `-C` still selects the repository. */
export const hostGitCwd =
  process.platform === "win32"
    ? (process.env.SystemRoot ?? "C:\\Windows")
    : "/";
