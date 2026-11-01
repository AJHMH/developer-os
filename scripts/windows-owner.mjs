import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { join } from "node:path";

/** Synthetic setup only: give explicitly selected disposable synthetic
 * objects the owner required by positive evidence. Leave every access rule
 * unchanged. Does nothing off Windows. */
export function ownWindowsPaths(paths) {
  if (process.platform !== "win32") return;
  for (const path of paths)
    if (lstatSync(path).isSymbolicLink())
      throw Error("Synthetic owner setup refused a link");
  const script = String.raw`
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
$paths=[Console]::In.ReadToEnd() | ConvertFrom-Json
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
foreach($path in $paths) {
 if([IO.Directory]::Exists($path)) { $item=New-Object IO.DirectoryInfo($path) }
 else { $item=New-Object IO.FileInfo($path) }
 $acl=$item.GetAccessControl([Security.AccessControl.AccessControlSections]::Owner)
 $acl.SetOwner($sid)
 $item.SetAccessControl($acl)
}
`;
  const result = spawnSync(
    join(
      process.env.SystemRoot,
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    {
      input: JSON.stringify(paths),
      encoding: "utf8",
      // A cold PowerShell start on a busy Windows runner has taken over 15 s
      // (PRs 163 and 169); a slow start must not read as a refusal.
      timeout: 60000,
      shell: false,
      windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot },
    },
  );
  if (result.status !== 0) throw Error("Synthetic owner setup refused");
}
