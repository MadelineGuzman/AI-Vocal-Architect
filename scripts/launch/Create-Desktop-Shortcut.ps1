# Creates (or refreshes) a "Cadenzai" shortcut on the Windows desktop that
# points at the one-click launcher. Run once; re-run any time to repair it.
$ErrorActionPreference = 'Stop'
$root    = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$target  = Join-Path $root 'Launch Cadenzai.cmd'
$desktop = [Environment]::GetFolderPath('Desktop')
$link    = Join-Path $desktop 'Cadenzai.lnk'

$shell    = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath       = $target
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle      = 7  # minimized, so the launcher console does not flash open
$shortcut.Description      = 'Launch Cadenzai (opens in its own window)'
$shortcut.Save()

Write-Host "Created desktop shortcut: $link"
