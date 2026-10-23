-- Drives the real continuous bridge with transport requests against a strict
-- double. Any unlisted API fails. Proves the bridge runs exactly the allow-listed
-- REAPER actions (record -> 1013, and "delete last take" -> Undo 40029),
-- consumes each request, and touches no project/edit/FX APIs directly.
local queue = {
  '{"version":1,"kind":"transport","action":"record","requestedAt":1000000}',
  '{"version":1,"kind":"transport","action":"delete-take","requestedAt":1000001}',
}
local qi = 1
local commands = {}
local callbacks = {}
local clock = 10
os.getenv = function(key) assert(key == 'LOCALAPPDATA'); return '/test-only' end
os.time = function() return 1000 end
os.execute = function() return true end  -- do not actually launch the app in tests
os.remove = function(file) assert(file == '/test-only/Cadenzai/reaper-bridge/transport.json'); qi = qi + 1; return true end
io.open = function(file, mode)
  if mode == 'rb' then
    if file == '/test-only/Cadenzai/reaper-bridge/transport.json' then
      if qi > #queue then return nil end
      local item = queue[qi]
      return { read = function() return item end, close = function() return true end }
    end
    assert(file == '/test-only/Cadenzai/reaper-bridge/request.json' or file == '/test-only/Cadenzai/reaper-bridge/cursor.json' or file == '/test-only/Cadenzai/reaper-bridge/eq-request.json' or file == '/test-only/Cadenzai/reaper-bridge/fx-request.json' or file == '/test-only/Cadenzai/reaper-bridge/auto-request.json' or file == '/test-only/Cadenzai/reaper-bridge/chain-request.json' or file == '/test-only/Cadenzai/reaper-bridge/select-item.json')
    return nil
  end
  assert(file == '/test-only/Cadenzai/reaper-bridge/state.json' and mode == 'wb')
  return { write = function() return true end, close = function() return true end }
end
local project = 'project'
reaper = setmetatable({
  RecursiveCreateDirectory = function() end,
  SetExtState = function(_, _, _, persist) assert(persist == false) end,
  GetProjectName = function() return 'Song' end,
  CountSelectedTracks2 = function() return 0 end,
  GetMasterTrack = function() return 'master' end,
  genGuid = function() return '{GUID}' end,
  GetProjectStateChangeCount = function() return 1 end,
  EnumProjects = function(index) if index == -1 or index == 0 then return project, 'test.rpp' end end,
  Main_OnCommand = function(id, flag) assert(flag == 0); commands[#commands + 1] = id end,
  atexit = function() end,
  time_precise = function() clock = clock + 0.3; return clock end,
  defer = function(fn) callbacks[#callbacks + 1] = fn end,
  ShowMessageBox = function(message) error(message) end,
}, { __index = function(_, key) error('Unexpected API: ' .. key) end })

dofile('reaper/Cadenzai_Read_Selection.lua')
for _ = 1, 5 do if #callbacks > 0 then local fn = table.remove(callbacks, 1); fn() end end

assert(qi > #queue, 'both transport requests are consumed')
assert(#commands == 2, 'exactly the two requested actions are run')
assert(commands[1] == 1013, 'record runs the Record transport action (1013)')
assert(commands[2] == 40029, 'delete last take runs REAPER Undo (40029), which is reversible')
print('Bridge transport control: allow-listed transport + reversible delete-take run, requests consumed, no edits test passed.')
