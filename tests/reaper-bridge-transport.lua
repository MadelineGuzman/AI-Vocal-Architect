-- Drives the real continuous bridge with a transport request (record) against a
-- strict double. Any unlisted API fails. Proves the bridge runs exactly the
-- allow-listed REAPER transport command, consumes the request, and touches no
-- project/edit/FX APIs.
local REQUEST = '{"version":1,"kind":"transport","action":"record","requestedAt":1000000}'
local commanded, removed = nil, false
local callbacks = {}
local clock = 10
os.getenv = function(key) assert(key == 'LOCALAPPDATA'); return '/test-only' end
os.time = function() return 1000 end
os.execute = function() return true end  -- do not actually launch the app in tests
os.remove = function(file) assert(file == '/test-only/Cadenzai/reaper-bridge/transport.json'); removed = true; return true end
io.open = function(file, mode)
  if mode == 'rb' then
    if file == '/test-only/Cadenzai/reaper-bridge/transport.json' then
      if removed then return nil end
      return { read = function() return REQUEST end, close = function() return true end }
    end
    assert(file == '/test-only/Cadenzai/reaper-bridge/request.json' or file == '/test-only/Cadenzai/reaper-bridge/cursor.json' or file == '/test-only/Cadenzai/reaper-bridge/eq-request.json' or file == '/test-only/Cadenzai/reaper-bridge/fx-request.json' or file == '/test-only/Cadenzai/reaper-bridge/auto-request.json')
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
  Main_OnCommand = function(id, flag) assert(flag == 0); commanded = id end,
  atexit = function() end,
  time_precise = function() clock = clock + 0.3; return clock end,
  defer = function(fn) callbacks[#callbacks + 1] = fn end,
  ShowMessageBox = function(message) error(message) end,
}, { __index = function(_, key) error('Unexpected API: ' .. key) end })

dofile('reaper/Cadenzai_Read_Selection.lua')
for _ = 1, 3 do if #callbacks > 0 then local fn = table.remove(callbacks, 1); fn() end end

assert(removed, 'the transport request file is consumed')
assert(commanded == 1013, 'the record transport action (1013) is run')
print('Bridge transport control: allow-listed transport command run, request consumed, no edits test passed.')
