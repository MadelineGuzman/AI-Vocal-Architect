-- Runs the real bridge against a strict read-only REAPER test double.
local now, selected, project = 10, {}, 'project-a'
local tracks = { a = { name = 'Vocal "lead"\nBack\\line — Café', guid = '{A}', number = 1 },
                 b = { name = 'Bass', guid = '{B}', number = 2 },
                 master = { name = 'MASTER', guid = '{MASTER}', number = -1 } }
local payload, callback, guid = nil, nil, 0
local real_print = print
os.getenv = function(key) assert(key == 'LOCALAPPDATA'); return '/test-only' end
os.time = function() return 1000 + math.floor(now) end
os.execute = function() return true end  -- do not actually launch the app in tests
io.open = function(file, mode)
  -- No analysis request or cursor move present in this read-only selection scenario.
  if mode == 'rb' then assert(file == '/test-only/Cadenzai/reaper-bridge/request.json' or file == '/test-only/Cadenzai/reaper-bridge/cursor.json' or file == '/test-only/Cadenzai/reaper-bridge/eq-request.json' or file == '/test-only/Cadenzai/reaper-bridge/fx-request.json' or file == '/test-only/Cadenzai/reaper-bridge/auto-request.json' or file == '/test-only/Cadenzai/reaper-bridge/transport.json' or file == '/test-only/Cadenzai/reaper-bridge/chain-request.json' or file == '/test-only/Cadenzai/reaper-bridge/select-item.json' or file == '/test-only/Cadenzai/reaper-bridge/nudge-item.json'); return nil end
  assert(file == '/test-only/Cadenzai/reaper-bridge/state.json' and mode == 'wb')
  return { write = function(_, value) payload = value; return true end, close = function() return true end }
end
reaper = setmetatable({
  SetExtState = function(_,_,_,persist) assert(persist==false) end,
  GetProjectStateChangeCount = function() return 1 end,
  RecursiveCreateDirectory = function() return 1 end,
  genGuid = function() guid=guid+1; return '{SESSION-' .. guid .. '}' end,
  EnumProjects = function(index) if index == -1 or index == 0 then return project, project == 'project-a' and 'test.rpp' or '' end end,
  GetProjectName = function() return project == 'project-a' and 'Test song' or '' end,
  CountSelectedTracks2 = function() return #selected end,
  GetSelectedTrack2 = function(_, i) return selected[i+1] end,
  GetTrackName = function(t) return true, tracks[t].name end,
  GetTrackGUID = function(t) return tracks[t].guid end,
  GetMediaTrackInfo_Value = function(t, key) assert(key == 'IP_TRACKNUMBER'); return tracks[t].number end,
  GetMasterTrack = function() return 'master' end,
  time_precise = function() return now end,
  defer = function(fn) callback=fn end,
  atexit = function() end,
  ShowMessageBox = function(message) error(message) end,
}, { __index=function(_, key) error('Unexpected REAPER API: ' .. key) end })
dofile('reaper/Cadenzai_Read_Selection.lua')
assert(payload:find('"tracks":[]', 1, true))
local function step() now=now+0.3; callback() end
selected={'a'}; step(); assert(payload:find('{A}',1,true)); real_print(payload)
tracks.a.name='Renamed'; step(); assert(payload:find('Renamed',1,true))
tracks.a.number=3; step(); assert(payload:find('"number":3',1,true)); assert(payload:find('{A}',1,true))
selected={'a','b'}; step(); assert(payload:find('{B}',1,true))
selected={'master'}; step(); assert(payload:find('"isMaster":true',1,true))
project='project-b'; selected={}; step(); assert(payload:find('Unsaved project',1,true)); assert(payload:find('"saved":false',1,true))
local before=payload; step(); assert(payload == before, 'unchanged state should not write at each tick')
now=now+1; callback(); assert(payload ~= before, 'heartbeat must publish without selection changes')
real_print('Lua read-only selection, rename, reorder, multiple selection, master, project switch and heartbeat tests passed.')
