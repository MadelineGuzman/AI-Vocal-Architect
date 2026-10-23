-- Drives the real continuous bridge with a "nudge this clip" request against a
-- strict double. Proves the bridge finds the item by GUID, moves its position by
-- the requested delta in one undo block, and consumes the request.
local REQUEST = '{"version":1,"kind":"nudge-item","itemId":"{ITEM-2}","deltaSeconds":-0.05,"requestedAt":1000000}'
local removed, set_item, set_pos, arranged = false, nil, nil, false
local undo = { begun = 0, ended = 0, label = nil }
local callbacks = {}
local clock = 10
os.getenv = function(key) assert(key == 'LOCALAPPDATA'); return '/test-only' end
os.time = function() return 1000 end
os.execute = function() return true end
os.remove = function(file) assert(file == '/test-only/Cadenzai/reaper-bridge/nudge-item.json'); removed = true; return true end
io.open = function(file, mode)
  if mode == 'rb' then
    if file == '/test-only/Cadenzai/reaper-bridge/nudge-item.json' then
      if removed then return nil end
      return { read = function() return REQUEST end, close = function() return true end }
    end
    assert(file == '/test-only/Cadenzai/reaper-bridge/request.json' or file == '/test-only/Cadenzai/reaper-bridge/cursor.json' or file == '/test-only/Cadenzai/reaper-bridge/eq-request.json' or file == '/test-only/Cadenzai/reaper-bridge/fx-request.json' or file == '/test-only/Cadenzai/reaper-bridge/auto-request.json' or file == '/test-only/Cadenzai/reaper-bridge/transport.json' or file == '/test-only/Cadenzai/reaper-bridge/chain-request.json' or file == '/test-only/Cadenzai/reaper-bridge/select-item.json')
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
  CountMediaItems = function(proj) assert(proj == project); return 3 end,
  GetMediaItem = function(proj, i) assert(proj == project); return 'item' .. i end,
  GetSetMediaItemInfo_String = function(item, key, _, set) assert(key == 'GUID' and set == false); return true, (item == 'item1' and '{ITEM-2}' or ('{OTHER-' .. item .. '}')) end,
  Undo_BeginBlock2 = function(proj) assert(proj == 0); undo.begun = undo.begun + 1 end,
  Undo_EndBlock2 = function(proj, label) assert(proj == 0); undo.ended = undo.ended + 1; undo.label = label end,
  GetMediaItemInfo_Value = function(item, key) assert(item == 'item1' and key == 'D_POSITION'); return 12.5 end,
  SetMediaItemInfo_Value = function(item, key, val) assert(key == 'D_POSITION'); set_item = item; set_pos = val; return true end,
  UpdateArrange = function() arranged = true end,
  atexit = function() end,
  time_precise = function() clock = clock + 0.3; return clock end,
  defer = function(fn) callbacks[#callbacks + 1] = fn end,
  ShowMessageBox = function(message) error(message) end,
}, { __index = function(_, key) error('Unexpected API: ' .. key) end })

dofile('reaper/Cadenzai_Read_Selection.lua')
for _ = 1, 3 do if #callbacks > 0 then local fn = table.remove(callbacks, 1); fn() end end

assert(removed, 'the nudge request is consumed')
assert(undo.begun == 1 and undo.ended == 1, 'the move is one undo step')
assert(undo.label == 'Cadenzai: nudge clip', 'the undo step is labelled')
assert(set_item == 'item1', 'the tapped item (by GUID) is moved')
assert(set_pos and math.abs(set_pos - 12.45) < 0.0001, 'the clip moves earlier by the requested 50 ms')
assert(arranged, 'the arrange view is refreshed')
print('Bridge nudge clip (move item by GUID, one undo step) test passed.')
