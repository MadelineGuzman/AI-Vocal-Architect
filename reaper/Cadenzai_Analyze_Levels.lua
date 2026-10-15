-- Manual one-shot level check. Prefer the "Analyze selected section" button in
-- the continuous Cadenzai bridge, which runs this same read-only analysis on
-- request. This standalone action remains available for manual use.
-- Samples remain in REAPER; only measurements are published locally.
local script_dir = debug.getinfo(1, 'S').source:sub(2):gsub(string.char(92), '/'):match('^(.*[/])')
local json = dofile(script_dir .. 'lib/json.lua')
local metrics = dofile(script_dir .. 'lib/levels.lua')
local analyze = dofile(script_dir .. 'lib/analyze.lua')
local base = os.getenv('LOCALAPPDATA')
if not base then reaper.ShowMessageBox('This build requires Windows.', 'Cadenzai', 0); return end
local directory = base .. '/Cadenzai/reaper-bridge'
reaper.RecursiveCreateDirectory(directory, 0)
reaper.atexit(analyze.cleanup)
analyze.run{ directory = directory, json = json, metrics = metrics }
