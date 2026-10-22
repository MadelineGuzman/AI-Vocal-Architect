-- Drives the real continuous bridge with a navigation-only "move cursor" request
-- against a strict read-only double. Any unlisted API (including a project edit)
-- fails. Proves the bridge moves REAPER's edit cursor to the requested time,
-- consumes the request, and touches no audio/edit APIs.
local CURSOR = '{"version":1,"kind":"move-cursor","timeSeconds":147.6,"requestedAt":1000000}'
local state_out, removed, moved = nil, false, nil
local callbacks = {}
local clock = 10
os.getenv = function(key) assert(key == 'LOCALAPPDATA'); return '/test-only' end
os.time = function() return 1000 end
os.execute = function() return true end  -- do not actually launch the app in tests
os.remove = function(file) assert(file == '/test-only/Cadenzai/reaper-bridge/cursor.json'); removed = true; return true end
io.open = function(file, mode)
  if mode == 'rb' then
    if file == '/test-only/Cadenzai/reaper-bridge/cursor.json' then
      if removed then return nil end
      return { read = function() return CURSOR end, close = function() return true end }
    end
    assert(file == '/test-only/Cadenzai/reaper-bridge/request.json' or file == '/test-only/Cadenzai/reaper-bridge/eq-request.json' or file == '/test-only/Cadenzai/reaper-bridge/fx-request.json' or file == '/test-only/Cadenzai/reaper-bridge/auto-request.json' or file == '/test-only/Cadenzai/reaper-bridge/transport.json' or file == '/test-only/Cadenzai/reaper-bridge/chain-request.json'); return nil
  end
  assert(file == '/test-only/Cadenzai/reaper-bridge/state.json' and mode == 'wb')
  return { write = function(_, s) state_out = s; return true end, close = function() return true end }
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
  SetEditCurPos = function(pos, moveview, seekplay) moved = { pos = pos, moveview = moveview, seekplay = seekplay } end,
  atexit = function() end,
  time_precise = function() clock = clock + 0.3; return clock end,
  defer = function(fn) callbacks[#callbacks + 1] = fn end,
  ShowMessageBox = function(message) error(message) end,
}, { __index = function(_, key) error('Unexpected API: ' .. key) end })

dofile('reaper/Cadenzai_Read_Selection.lua')
for _ = 1, 3 do if #callbacks > 0 then local fn = table.remove(callbacks, 1); fn() end end

assert(state_out, 'selection still published')
assert(removed, 'cursor request consumed')
assert(moved and math.abs(moved.pos - 147.6) < 0.0001, 'edit cursor moved to the clicked time')
assert(moved.moveview == true, 'the view follows the cursor')
print('Bridge cursor-move navigation (read-only, no edits) test passed.')
