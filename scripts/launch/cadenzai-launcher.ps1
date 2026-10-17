# Cadenzai one-click launcher.
# Starts the local Cadenzai server if it is not already running, waits for it,
# then opens Cadenzai in its own app-style window (no browser tabs or address
# bar). Safe to run repeatedly: it never starts a second server.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$url  = 'http://127.0.0.1:3000'

function Test-Up {
  try { Invoke-WebRequest -UseBasicParsing "$url/api/health" -TimeoutSec 1 | Out-Null; return $true }
  catch { return $false }
}

if (-not (Test-Up)) {
  # Start the server in its own minimized window so it is easy to close later.
  $title = 'Cadenzai Server (close this window to stop Cadenzai)'
  Start-Process -FilePath 'cmd.exe' -WorkingDirectory $root -WindowStyle Minimized `
    -ArgumentList '/c', "title $title && npm run dev"

  $ok = $false
  for ($i = 0; $i -lt 80; $i++) { if (Test-Up) { $ok = $true; break }; Start-Sleep -Milliseconds 500 }
  if (-not $ok) {
    [void][System.Windows.Forms.MessageBox]::Show(
      "Cadenzai's server did not start.`n`nMake sure Node.js is installed and that 'npm install' has been run once in:`n$root",
      'Cadenzai')
    return
  }
}

# Prefer a Chromium-based browser so we can open a clean, chromeless app window.
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
  # No Chromium browser found: open in the default browser instead.
  Start-Process $url
}
