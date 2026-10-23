-- Proves the bridge publishes the focused (single selected non-master) track's
-- clips — position, length, name, colour — in the snapshot, for the tap-to-point
-- timeline. Read-only.
local payload, callback = nil, nil
os.getenv = function(key) assert(key == 'LOCALAPPDATA'); return '/test-only' end
os.time = function() return 1000 end
os.execute = function() return true end
io.open = function(file, mode)
  if mode == 'rb' then return nil end
  assert(file == '/test-only/Cadenzai/reaper-bridge/state.json' and mode == 'wb')
  return { write = function(_, value) payload = value; return true end, close = function() return true end }
end
local project = 'project'
reaper = setmetatable({
  RecursiveCreateDirectory = function() end,
  SetExtState = function(_, _, _, persist) assert(persist == false) end,
  GetProjectStateChangeCount = function() return 1 end,
  genGuid = function() return '{SESSION}' end,
  EnumProjects = function(index) if index == -1 or index == 0 then return project, 'test.rpp' end end,
  GetProjectName = function() return 'Song' end,
  -- One selected, non-master track in focus.
  CountSelectedTracks2 = function() return 1 end,
  GetSelectedTrack2 = function(_, i) assert(i == 0); return 'trk' end,
  GetTrackName = function(t) assert(t == 'trk'); return true, 'Lead Vox' end,
  GetMediaTrackInfo_Value = function(_, key) assert(key == 'IP_TRACKNUMBER'); return 1 end,
  GetMasterTrack = function() return 'master' end,
  GetTrackGUID = function(t) return t == 'trk' and '{TRK}' or '{M}' end,
  -- The focused track's two clips.
  CountTrackMediaItems = function(t) assert(t == 'trk'); return 2 end,
  GetTrackMediaItem = function(t, i) assert(t == 'trk'); return 'it' .. i end,
  GetMediaItemInfo_Value = function(item, key)
    if key == 'D_POSITION' then return item == 'it0' and 0.0 or 4.0 end
    if key == 'D_LENGTH' then return 2.0 end
    return 0
  end,
  GetSetMediaItemInfo_String = function(item, key, _, set) assert(key == 'GUID' and set == false); return true, (item == 'it0' and '{IT-0}' or '{IT-1}') end,
  GetActiveTake = function(item) return 'tk-' .. item end,
  GetTakeName = function(tk) return tk == 'tk-it0' and 'Verse' or 'Hook' end,
  GetDisplayedMediaItemColor = function() return 100 end,
  ColorFromNative = function(c) assert(c == 100); return 255, 128, 0 end,
  atexit = function() end,
  time_precise = function() return 10 end,
  defer = function(fn) callback = fn end,
  ShowMessageBox = function(message) error(message) end,
}, { __index = function(_, key) error('Unexpected API: ' .. key) end })

dofile('reaper/Cadenzai_Read_Selection.lua')

assert(payload, 'a snapshot was published')
assert(payload:find('"clips":[', 1, true), 'the snapshot carries a clips array')
assert(payload:find('"id":"{IT-0}"', 1, true) and payload:find('"id":"{IT-1}"', 1, true), 'both clip GUIDs are present')
assert(payload:find('"name":"Verse"', 1, true) and payload:find('"name":"Hook"', 1, true), 'clip names are present')
assert(payload:find('"start":4.0000', 1, true), 'the second clip starts at its real position')
assert(payload:find('"color":"#ff8000"', 1, true), 'the item colour is published as hex')
print('Bridge focused-track clips publish (position, length, name, colour) test passed.')
