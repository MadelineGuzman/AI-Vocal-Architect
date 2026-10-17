# Cadenzai one-click launcher.
# If Cadenzai is already open, this just brings its window to the front (so you
# never lose it or open duplicates). Otherwise it starts the local server if
# needed, waits for it, then opens Cadenzai in its own app-style window.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class CadenzaiWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  public static IntPtr Find(string needle) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(300); GetWindowText(h, sb, 300);
      if (sb.ToString().IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$url  = 'http://127.0.0.1:3000'
$title = 'Cadenzai: AI Vocal Architect'

# Already open? Just bring it to the front.
$existing = [CadenzaiWin]::Find($title)
if ($existing -ne [IntPtr]::Zero) {
  [CadenzaiWin]::ShowWindow($existing, 9) | Out-Null  # SW_RESTORE
  [CadenzaiWin]::SetForegroundWindow($existing) | Out-Null
  return
}

function Test-Up {
  try { Invoke-WebRequest -UseBasicParsing "$url/api/health" -TimeoutSec 1 | Out-Null; return $true }
  catch { return $false }
}

if (-not (Test-Up)) {
  $serverTitle = 'Cadenzai Server (close this window to stop Cadenzai)'
  Start-Process -FilePath 'cmd.exe' -WorkingDirectory $root -WindowStyle Minimized `
    -ArgumentList '/c', "title $serverTitle && npm run dev"
  $ok = $false
  for ($i = 0; $i -lt 80; $i++) { if (Test-Up) { $ok = $true; break }; Start-Sleep -Milliseconds 500 }
  if (-not $ok) {
    [void][System.Windows.Forms.MessageBox]::Show(
      "Cadenzai's server did not start.`n`nMake sure Node.js is installed and that 'npm install' has been run once in:`n$root",
      'Cadenzai')
    return
  }
}

# Open a clean, chromeless app window (Chrome or Edge); else the default browser.
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($browser) {
  Start-Process -FilePath $browser -ArgumentList "--app=$url", '--window-size=1200,820'
} else {
  Start-Process $url
}
