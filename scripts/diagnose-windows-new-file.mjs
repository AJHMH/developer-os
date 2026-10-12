import fs from "node:fs";
import cp from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeWindowsAuthDirectory } from "../dist/windows-auth-store.js";

const root = fs.realpathSync(
  fs.mkdtempSync(join(tmpdir(), "aios-owner-probe-")),
);
try {
  initializeWindowsAuthDirectory(root);
  const file = join(root, "fixed-synthetic.txt");
  fs.writeFileSync(file, "fixed synthetic probe", { flag: "wx" });
  const script = String.raw`
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
foreach($name in @('Microsoft.PowerShell.Utility','Microsoft.PowerShell.Management','Microsoft.PowerShell.Security')) {
 Import-Module ([IO.Path]::Combine($PSHOME,'Modules',$name,($name+'.psd1'))) -ErrorAction Stop
}
$paths=[Console]::In.ReadToEnd() | ConvertFrom-Json
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
foreach($path in $paths) {
 $acl=Get-Acl -LiteralPath $path
 $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
 $unexpected=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin @($sid,'S-1-5-18','S-1-5-32-544') }).Count -gt 0
 [Console]::Out.WriteLine((@{currentUserOwner=($owner -eq $sid);administratorsOwner=($owner -eq 'S-1-5-32-544');unexpectedAllow=$unexpected} | ConvertTo-Json -Compress))
}
`;
  const result = cp.spawnSync(
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
      input: JSON.stringify([root, file]),
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
      shell: false,
      env: { SystemRoot: process.env.SystemRoot },
    },
  );
  console.log(JSON.stringify({ status: result.status }));
  console.log(result.stdout);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
