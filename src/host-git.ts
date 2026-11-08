/** The working directory for every host git process: outside any target
 * repository, so nothing in one is ever resolved relative to it. `-C` still
 * selects the repository. */
export const hostGitCwd = "/";
