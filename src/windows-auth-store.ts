import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { DeliveryError } from "./controller.js";

const failure = () =>
  new DeliveryError(
    "Windows protected authentication storage is unavailable; preserve existing credentials and inspect separate host storage. Production remains disabled.",
  );
/** Initialize only a newly created setup directory; never repair existing ACLs. */
export function initializeWindowsAuthDirectory(directory: string) {
  const setup = String.raw`
$ErrorActionPreference='Stop'
try {
 $path=[Console]::In.ReadToEnd() | ConvertFrom-Json
 $item=Get-Item -LiteralPath $path -Force
 if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or (Get-ChildItem -LiteralPath $path -Force).Count -ne 0) { throw 'unsafe' }
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
 $acl=New-Object Security.AccessControl.DirectorySecurity
 $acl.SetOwner($sid)
 $acl.SetAccessRuleProtection($true,$false)
 foreach($identity in @($sid,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')),(New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))) {
  $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule)
 }
 Set-Acl -LiteralPath $path -AclObject $acl
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
      input: JSON.stringify(directory),
      encoding: "utf8",
      timeout: 15000,
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
 Add-Type -AssemblyName System.Security
 $request=[Console]::In.ReadToEnd() | ConvertFrom-Json
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 foreach($path in $request.paths) {
  $item=Get-Item -LiteralPath $path -Force
  if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'unsafe' }
  $acl=Get-Acl -LiteralPath $path
  if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid) { throw 'owner' }
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
   if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($sid,'S-1-5-18','S-1-5-32-544')) { throw 'acl' }
  }
 }
 if($request.action -eq 'check') { [Console]::Out.Write('T0s='); exit 0 }
 $bytes=[Convert]::FromBase64String($request.bytes)
 $entropy=[Convert]::FromBase64String($request.entropy)
 if($bytes.Length -gt 262144) { throw 'size' }
 if($request.action -eq 'protect') { $output=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser) }
 elseif($request.action -eq 'unprotect') { $output=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser) }
 else { throw 'action' }
 [Console]::Out.Write([Convert]::ToBase64String($output))
} catch { exit 1 }
`;

/** Separate host setup only. Existing files are never overwritten implicitly. */
export function windowsAuthStore(
  directory: string,
  metadataPaths: string[] = [],
) {
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
        input: JSON.stringify({
          action,
          bytes: bytes.toString("base64"),
          entropy,
          paths,
        }),
        encoding: "utf8",
        timeout: 15000,
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
  return {
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
        writeFileSync(path, encrypted, { flag: "wx", flush: true });
      } else {
        const staging = join(root, account + ".replace");
        writeFileSync(staging, encrypted, { flag: "wx", flush: true });
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
