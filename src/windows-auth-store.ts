import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { DeliveryError } from "./errors.js";

const failure = () =>
  new DeliveryError(
    "Windows protected authentication storage is unavailable; preserve existing credentials and inspect separate host storage. Production remains disabled.",
  );

// Keep bootstrap to core .NET operations: importing PowerShell modules/cmdlets
// or a general JSON framework can consume the deadline before ACL validation.
// All values remain data on stdin; base64 framing cannot become script syntax.
const systemRuntime = String.raw`
$PSModuleAutoLoadingPreference='None'
`;
/** Initialize only a newly created setup directory; never repair existing ACLs. */
export function initializeWindowsAuthDirectory(directory: string) {
  const setup = String.raw`
$ErrorActionPreference='Stop'
try {
 ${systemRuntime}
 $wire=[Console]::In.ReadToEnd()
 if($wire.Length -gt 524288) { throw 'size' }
 $path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($wire))
 $attributes=[IO.File]::GetAttributes($path)
 if(($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or [IO.Directory]::GetFileSystemEntries($path).Length -ne 0) { throw 'unsafe' }
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
 $acl=[Security.AccessControl.DirectorySecurity]::new()
 $acl.SetOwner($sid)
 $acl.SetAccessRuleProtection($true,$false)
 foreach($identity in @($sid,([Security.Principal.SecurityIdentifier]::new('S-1-5-18')),([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')))) {
  $rule=[Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  [void]$acl.AddAccessRule($rule)
 }
 [IO.Directory]::SetAccessControl($path,$acl)
} catch { exit 1 }
`;
  if (process.platform !== "win32" || !isAbsolute(directory)) throw failure();
  const result = spawnSync(
    join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(setup, "utf16le").toString("base64"),
    ],
    {
      input: Buffer.from(directory, "utf8").toString("base64"),
      encoding: "utf8",
      // A cold PowerShell start on a busy Windows runner has taken over 15 s
      // (PR 171); a slow start must not read as a refusal.
      timeout: 60000,
      maxBuffer: 8192,
      windowsHide: true,
      shell: false,
      env: { SystemRoot: process.env.SystemRoot },
    },
  );
  if (result.status !== 0) throw failure();
}
// A fixed host script receives bounded data only on stdin. CurrentUser DPAPI
// never exposes plaintext to a worker, command line, disk helper or environment.
const script = String.raw`
$ErrorActionPreference='Stop'
try {
 ${systemRuntime}
 $wire=[Console]::In.ReadToEnd()
 if($wire.Length -gt 524288) { throw 'size' }
 $fields=$wire.Split([char]10)
 if($fields.Length -lt 5 -or $fields.Length -gt 1028 -or $fields[0] -notin @('check','create','protect','unprotect')) { throw 'request' }
 $action=$fields[0]
 $bytes=[Convert]::FromBase64String($fields[1])
 $entropy=[Convert]::FromBase64String($fields[2])
 if($bytes.Length -gt 262144 -or $entropy.Length -ne 32) { throw 'size' }
 $name=$fields[3]
 $paths=[Collections.Generic.List[string]]::new()
 for($i=4;$i -lt $fields.Length;$i++) { $paths.Add([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($fields[$i]))) }
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 foreach($path in $paths) {
  $attributes=[IO.File]::GetAttributes($path)
  if(($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'unsafe' }
  if(($attributes -band [IO.FileAttributes]::Directory) -ne 0) { $acl=[IO.Directory]::GetAccessControl($path) }
  else { $acl=[IO.File]::GetAccessControl($path) }
  if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid) { throw 'owner' }
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
   if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($sid,'S-1-5-18','S-1-5-32-544')) { throw 'acl' }
  }
 }
 if($action -eq 'check') { [Console]::Out.Write('T0s='); exit 0 }
 if($action -eq 'create') {
  if($paths.Count -ne 1 -or $name -notmatch '^(registration\.json|[a-f0-9]{64}\.(dpapi|replace))$') { throw 'name' }
  $path=[IO.Path]::Combine($paths[0],$name)
  $acl=[Security.AccessControl.FileSecurity]::new()
  $acl.SetOwner(([Security.Principal.SecurityIdentifier]::new($sid)))
  $acl.SetAccessRuleProtection($true,$false)
  foreach($identity in @($sid,'S-1-5-18','S-1-5-32-544')) {
   $rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($identity),'FullControl','Allow')
   [void]$acl.AddAccessRule($rule)
  }
  $stream=[IO.FileStream]::new($path,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough,$acl)
  try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
  [Console]::Out.Write('T0s='); exit 0
 }
 [void][Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a')
 if($action -eq 'protect') { $output=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser) }
 elseif($action -eq 'unprotect') { $output=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser) }
 else { throw 'action' }
 [Console]::Out.Write([Convert]::ToBase64String($output))
} catch { exit 1 }
`;

/** Separate host setup only. Existing files are never overwritten implicitly. */
function windowsStorageAccess(directory: string, metadataPaths: string[] = []) {
  if (
    process.platform !== "win32" ||
    process.arch !== "x64" ||
    !isAbsolute(directory)
  )
    throw failure();
  const root = realpathSync(directory);
  if (
    root.toLowerCase() !== resolve(directory).toLowerCase() ||
    lstatSync(directory).isSymbolicLink()
  )
    throw failure();
  const powershell = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const ordinary = (path: string) => {
    const entry = lstatSync(path);
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      entry.nlink !== 1 ||
      entry.size > 262144 ||
      realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()
    )
      throw failure();
  };
  const crypt = (
    action: string,
    account: string,
    bytes: Buffer,
    paths: string[],
    name?: string,
  ) => {
    const entropy = createHash("sha256")
      .update(JSON.stringify([root.toLowerCase(), account]))
      .digest()
      .toString("base64");
    const result = spawnSync(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      {
        input: [
          action,
          bytes.toString("base64"),
          entropy,
          name ?? "",
          ...paths.map((path) => Buffer.from(path, "utf8").toString("base64")),
        ].join("\n"),
        encoding: "utf8",
        // The same cold start as directory setup; see above.
        timeout: 60000,
        maxBuffer: 524288,
        windowsHide: true,
        shell: false,
        cwd: process.env.SystemRoot ?? "C:\\Windows",
        env: { SystemRoot: process.env.SystemRoot },
      },
    );
    if (result.status !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.stdout))
      throw failure();
    return Buffer.from(result.stdout, "base64");
  };
  const pathFor = (account: string) => {
    if (!/^[a-f0-9]{64}$/.test(account)) throw failure();
    return join(root, account + ".dpapi");
  };
  for (const path of metadataPaths) ordinary(path);
  crypt("check", "0".repeat(64), Buffer.alloc(0), [root, ...metadataPaths]);
  // Set owner and private ACL atomically at CreateNew, including on elevated
  // hosts whose default file owner is the Administrators group. Never repair
  // retained files; the same strict checks still apply before and after writes.
  const create = (name: string, bytes: Buffer) => {
    crypt("create", "0".repeat(64), bytes, [root], name);
    const path = join(root, name);
    ordinary(path);
    crypt("check", "0".repeat(64), Buffer.alloc(0), [root, path]);
  };
  return { root, ordinary, crypt, pathFor, create };
}
export function assertWindowsPrivateStorage(
  directory: string,
  metadataPaths: string[] = [],
): void {
  windowsStorageAccess(directory, metadataPaths);
}
export function windowsAuthStore(
  directory: string,
  metadataPaths: string[] = [],
) {
  const { root, ordinary, crypt, pathFor, create } = windowsStorageAccess(
    directory,
    metadataPaths,
  );
  return {
    createRegistration(value: string) {
      if (!value.length || Buffer.byteLength(value) > 4096) throw failure();
      create("registration.json", Buffer.from(value));
    },
    read(account: string) {
      const path = pathFor(account);
      ordinary(path);
      return crypt("unprotect", account, readFileSync(path), [
        root,
        path,
      ]).toString("utf8");
    },
    write(account: string, value: string, replace: boolean) {
      const path = pathFor(account),
        present = existsSync(path);
      if (
        present !== replace ||
        Buffer.byteLength(value) > 131072 ||
        !value.length
      )
        throw failure();
      if (present) ordinary(path);
      const encrypted = crypt(
        "protect",
        account,
        Buffer.from(value),
        present ? [root, path] : [root],
      );
      if (!replace) {
        create(account + ".dpapi", encrypted);
      } else {
        const staging = join(root, account + ".replace");
        create(account + ".replace", encrypted);
        try {
          ordinary(path);
          renameSync(staging, path);
        } finally {
          if (existsSync(staging)) unlinkSync(staging);
        }
      }
      ordinary(path);
      if (
        crypt("unprotect", account, readFileSync(path), [root, path]).toString(
          "utf8",
        ) !== value
      )
        throw failure();
    },
  };
}
