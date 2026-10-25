import { modelRoutePort } from "./feature-candidate.js";

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
  // Codex regenerates its own bundled skills here on every start; the coding
  // guest admits exactly that folder and nothing else.
  [
    "codex-skills",
    'test ! -e "$HOME/skills" || test "$(ls -A "$HOME/skills")" = .system',
  ],
  ["mcp-config", '! grep -qs mcp_servers "$HOME/config.toml"'],
  [
    "hooks-rules-agents",
    'for p in hooks.json rules AGENTS.md AGENTS.override.md; do ! test -e "$HOME/$p" || exit 1; done',
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
  // Plain HTTP, so a missing TLS client cannot pass the denial for free.
  ["npm-registry", "! wget -q -T 2 -O /dev/null http://registry.npmjs.org/"],
  [
    "read-only-root",
    'grep -Eq "^[0-9]+ [0-9]+ [0-9:]+ [^ ]+ / ro[, ]" /proc/self/mountinfo',
  ],
  ["unprivileged", 'test "$(id -u)" = 65534'],
  ["escape-unshare", "! unshare -Ur true"],
  ["escape-chroot", "! busybox chroot / /bin/true"],
  ["escape-cgroup", "! ( echo $$ > /sys/fs/cgroup/cgroup.procs )"],
] as const;

/** 127.0.0.1 and the relay port, as `/proc/net/tcp` writes a local address. */
const relayAddress = `0100007F:${modelRoutePort.toString(16).toUpperCase().padStart(4, "0")}`;
const relayUrl = `http://127.0.0.1:${modelRoutePort}/`;
/** The coding worker's own controls (ADR 0002). `$mode` is `routed` or
 * `offline`, from the guest's own session record. A routed worker has exactly
 * the session relay listening, which answers a plain GET with its empty 403
 * and so never reaches the gateway; an offline worker has nothing listening.
 * Codex runs with `danger-full-access`, so the container itself must keep its
 * binaries read-only, its process unprivileged, and take writes only in the
 * workspace and session. Podman's in-memory tmpfs (`/tmp`, `/var/tmp`, `/run`,
 * `/dev/shm`) stay writable: they are private to the container and gone at
 * stop, and the guest pins the bind mounts to exactly four. */
const codingProbes = [
  [
    "relay-listener",
    `l=$(grep -c " 0A " /proc/net/tcp); if test "$mode" = routed; then test "$l" = 1 && grep -q ": ${relayAddress} 00000000:0000 0A " /proc/net/tcp; else test "$mode" = offline && test "$l" = 0; fi && ! grep -qs " 0A " /proc/net/tcp6`,
  ],
  [
    "relay-answers",
    // The relay serves one request at a time, so a GET may wait behind one.
    // Offline, the connection itself must be refused: an HTTP error would
    // mean something is listening.
    `if test "$mode" = routed; then for i in 1 2 3; do wget -T 5 -O /dev/null ${relayUrl} 2>&1 | grep -Eq "403:? Forbidden" && exit 0; done; exit 1; else test "$mode" = offline && wget -T 2 -O /dev/null ${relayUrl} 2>&1 | grep -q "Connection refused"; fi`,
  ],
  [
    "read-only-binaries",
    // The mount itself must be read-only: a running executable refuses writes
    // anyway, and the container user owns the files.
    'for p in /codex /codex-code-mode-host; do test -f $p && grep -Eq "^[0-9]+ [0-9]+ [0-9:]+ [^ ]+ $p ro[, ]" /proc/self/mountinfo && ! ( : >> $p ) || exit 1; done',
  ],
  [
    "hardened-process",
    'grep -Eq "^CapEff:[[:space:]]+0+$" /proc/self/status && grep -Eq "^NoNewPrivs:[[:space:]]+1$" /proc/self/status && grep -Eq "^Seccomp:[[:space:]]+2$" /proc/self/status',
  ],
  [
    "writable-only-work",
    'for p in /workspace /session; do f="$p/.aios-probe-$$"; ( : > "$f" ) && rm -f "$f" || exit 1; done; for p in / /etc /usr /bin /lib /root /home /opt /var /srv; do f="$p/.aios-probe-$$"; ! ( : > "$f" ) || { rm -f "$f"; exit 1; }; done; for f in /etc/hosts /etc/hostname /etc/resolv.conf; do ! test -e $f || ! ( : >> $f ) || exit 1; done',
  ],
] as const;

const script = (list: readonly (readonly [string, string])[]) =>
  [
    "set -u",
    'admitted="$1"; private="$2"; mode="${3-}"',
    'r() { if ( eval "$2" ) >/dev/null 2>&1; then echo "passed-$1"; else echo "failed-$1"; fi; }',
    ...list.map(([name, body]) => `r ${name} '${body}'`),
  ].join("; ");

/** Every probe, in output order. A run passes only on exactly these lines,
 * each prefixed `passed-`. */
export const boundaryProbeNames: readonly string[] = Object.freeze(
  probes.map(([name]) => name),
);
export const boundaryProbe = script(probes);

/** The coding worker's probe: the shared probes, then its own controls. Its
 * third argument is the session's mode. */
export const codingBoundaryProbeNames: readonly string[] = Object.freeze([
  ...boundaryProbeNames,
  ...codingProbes.map(([name]) => name),
]);
export const codingBoundaryProbe = script([...probes, ...codingProbes]);

/** Per-probe outcomes from the probe's output, refusing anything else. */
export function boundaryProbeOutcomes(
  output: string,
  names: readonly string[] = boundaryProbeNames,
) {
  const lines = output.trim().split("\n");
  if (lines.length !== names.length)
    throw Error("Boundary probe output is malformed");
  return names.map((name, index) => {
    const line = lines[index];
    if (line !== `passed-${name}` && line !== `failed-${name}`)
      throw Error("Boundary probe output is malformed");
    return { name, outcome: line === `passed-${name}` ? "passed" : "failed" };
  });
}
