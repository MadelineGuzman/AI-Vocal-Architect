-- Drives the real continuous bridge with a "select this item" (tap-to-point)
-- request against a strict double. Proves the bridge finds the item by GUID,
-- deselects the rest, selects it, moves the edit cursor to it, and consumes the
-- request — a navigation action only, no edits.
local REQUEST = '{"version":1,"kind":"select-item","itemId":"{ITEM-2}","requestedAt":1000000}'
local removed, deselected_all, selected_item, cursor, arranged = false, false, nil, nil, false
local callbacks = {}
local clock = 10
os.getenv = function(key) assert(key == 'LOCALAPPDATA'); return '/test-only' end
os.time = function() return 1000 end
os.execute = function() return true end
os.remove = function(file) assert(file == '/test-only/Cadenzai/reaper-bridge/select-item.json'); removed = true; return true end
io.open = function(file, mode)
  if mode == 'rb' then
    if file == '/test-only/Cadenzai/reaper-bridge/select-item.json' then
      if removed then return nil end
      return { read = function() return REQUEST end, close = function() return true end }
    end
    assert(file == '/test-only/Cadenzai/reaper-bridge/request.json' or file == '/test-only/Cadenzai/reaper-bridge/cursor.json' or file == '/test-only/Cadenzai/reaper-bridge/eq-request.json' or file == '/test-only/Cadenzai/reaper-bridge/fx-request.json' or file == '/test-only/Cadenzai/reaper-bridge/auto-request.json' or file == '/test-only/Cadenzai/reaper-bridge/transport.json' or file == '/test-only/Cadenzai/reaper-bridge/chain-request.json' or file == '/test-only/Cadenzai/reaper-bridge/nudge-item.json')
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
  SelectAllMediaItems = function(proj, sel) assert(proj == project and sel == false); deselected_all = true end,
  SetMediaItemSelected = function(item, sel) assert(sel == true); selected_item = item end,
  GetMediaItemInfo_Value = function(item, key) assert(item == 'item1' and key == 'D_POSITION'); return 12.5 end,
  SetEditCurPos = function(pos, moveview, seek) cursor = { pos = pos, moveview = moveview, seek = seek } end,
  UpdateArrange = function() arranged = true end,
  atexit = function() end,
  time_precise = function() clock = clock + 0.3; return clock end,
  defer = function(fn) callbacks[#callbacks + 1] = fn end,
  ShowMessageBox = function(message) error(message) end,
}, { __index = function(_, key) error('Unexpected API: ' .. key) end })

dofile('reaper/Cadenzai_Read_Selection.lua')
for _ = 1, 3 do if #callbacks > 0 then local fn = table.remove(callbacks, 1); fn() end end

assert(removed, 'the select-item request is consumed')
assert(deselected_all, 'other items are deselected first')
assert(selected_item == 'item1', 'the tapped item (matched by GUID) is selected')
assert(cursor and math.abs(cursor.pos - 12.5) < 0.0001 and cursor.moveview == true, 'the edit cursor moves to the item so the engineer sees it')
assert(arranged, 'the arrange view is refreshed')
print('Bridge tap-to-point (select item by GUID, navigation only) test passed.')
