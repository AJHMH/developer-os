/** The boundary probe both general workers run inside their own hardened
 * container: the coding guest execs it in a live session, and the validation
 * qualification runs it as checks. It is fixed text, never caller-supplied,
 * and uses only the busybox tools and applets of the pinned Alpine images. The
 * first probe proves each of them exists, so a missing tool fails instead of
 * passing a denial.
 *
 * Arguments: $1 the admitted workspace file, which must be visible and must be
 * the workspace's only entry (the positive control), and $2 a guest-private
 * management path that must not be visible. Each output line is
 * `passed-<probe>` or `failed-<probe>`. It is one line of shell, so it also
 * fits a validation check's argv, which refuses control characters and items
 * over 2,000 characters. */
const probes = [
  [
    "tools",
    'for t in cat grep id ls wget unshare busybox; do command -v "$t" || exit 1; done; for a in chroot unshare; do busybox --list | grep -qx "$a" || exit 1; done',
  ],
  ["admitted-visible", 'test -f "$admitted" && cat "$admitted"'],
  ["only-admitted", 'test "$(ls -A /workspace)" = "${admitted##*/}"'],
  ["guest-private", '! test -e "$private" && ! test -e "/proc/1/root$private"'],
  [
    "owner-home",
    "for p in /Users /mnt/c /var/home /home/core /home/user; do ! test -e $p || exit 1; done",
  ],
  [
    "credential-files",
    'for p in .ssh .gnupg .gitconfig .config/gh .netrc .aws; do ! test -e "$HOME/$p" || exit 1; done',
  ],
  [
    "skills-mcp-hooks",
    '! grep -qs mcp_servers "$HOME/config.toml" && ! test -e "$HOME/skills" && ! test -e "$HOME/hooks.json"',
  ],
  [
    "credential-env",
    'test -z "${SSH_AUTH_SOCK+x}${GPG_AGENT_INFO+x}${GITHUB_TOKEN+x}${GH_TOKEN+x}${OPENAI_API_KEY+x}${CODEX_API_KEY+x}"',
  ],
  [
    "engine-sockets",
    "! test -e /run/podman/podman.sock && ! test -e /var/run/docker.sock && ! test -e /run/user",
  ],
  [
    "guest-management",
    "! test -e /run/systemd/private && ! test -e /run/dbus/system_bus_socket",
  ],
  [
    "host-shares",
    '! grep -Eq " - (9p|virtiofs|cifs|smb3|nfs|nfs4|fuse.sshfs) " /proc/self/mountinfo',
  ],
  [
    "loopback-only",
    'test "$(grep -c : /proc/net/dev)" = 1 && grep -q " lo:" /proc/net/dev',
  ],
  ["network", "! wget -q -T 2 -O /dev/null http://example.com"],
  [
    "read-only-root",
    'grep -Eq "^[0-9]+ [0-9]+ [0-9:]+ [^ ]+ / ro[, ]" /proc/self/mountinfo',
  ],
  ["unprivileged", 'test "$(id -u)" = 65534'],
  ["escape-unshare", "! unshare -Ur true"],
  ["escape-chroot", "! busybox chroot / /bin/true"],
  ["escape-cgroup", "! ( echo $$ > /sys/fs/cgroup/cgroup.procs )"],
] as const;

/** Every probe, in output order. A run passes only on exactly these lines,
 * each prefixed `passed-`. */
export const boundaryProbeNames: readonly string[] = Object.freeze(
  probes.map(([name]) => name),
);

export const boundaryProbe = [
  "set -u",
  'admitted="$1"; private="$2"',
  'r() { if ( eval "$2" ) >/dev/null 2>&1; then echo "passed-$1"; else echo "failed-$1"; fi; }',
  ...probes.map(([name, body]) => `r ${name} '${body}'`),
].join("; ");

/** Per-probe outcomes from the probe's output, refusing anything else. */
export function boundaryProbeOutcomes(output: string) {
  const lines = output.trim().split("\n");
  if (lines.length !== boundaryProbeNames.length)
    throw Error("Boundary probe output is malformed");
  return boundaryProbeNames.map((name, index) => {
    const line = lines[index];
    if (line !== `passed-${name}` && line !== `failed-${name}`)
      throw Error("Boundary probe output is malformed");
    return { name, outcome: line === `passed-${name}` ? "passed" : "failed" };
  });
}
