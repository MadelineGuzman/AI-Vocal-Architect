-- Drives the real continuous bridge with an approved "automate over the time
-- selection" request against a strict double. Any unlisted API fails. Proves the
-- bridge reads the time selection, finds the track by GUID, writes a volume
-- envelope ramp over exactly that range in one undo block, and echoes the result.
local REQUEST = '{"version":1,"kind":"apply-automation","requestId":"auto-test-00000001","trackId":"{TRK}","auto":"volume-swell","requestedAt":1000000}'
local auto_result_out, removed_auto = nil, false
local callbacks = {}
local clock = 10
local undo = { begun = 0, ended = 0, label = nil }
local points, deleted, sorted = {}, nil, false
os.getenv = function(key) assert(key == 'LOCALAPPDATA'); return '/test-only' end
os.time = function() return 1000 end
os.execute = function() return true end  -- do not actually launch the app in tests
os.remove = function(file) assert(file == '/test-only/Cadenzai/reaper-bridge/auto-request.json'); removed_auto = true; return true end
io.open = function(file, mode)
  if mode == 'rb' then
    if file == '/test-only/Cadenzai/reaper-bridge/auto-request.json' then
      if removed_auto then return nil end
      return { read = function() return REQUEST end, close = function() return true end }
    end
    assert(file == '/test-only/Cadenzai/reaper-bridge/request.json' or file == '/test-only/Cadenzai/reaper-bridge/cursor.json' or file == '/test-only/Cadenzai/reaper-bridge/eq-request.json' or file == '/test-only/Cadenzai/reaper-bridge/fx-request.json')
    return nil
  end
  if file == '/test-only/Cadenzai/reaper-bridge/state.json' then
    assert(mode == 'wb'); return { write = function() return true end, close = function() return true end }
  end
  assert(file == '/test-only/Cadenzai/reaper-bridge/auto-result.json' and mode == 'wb')
  return { write = function(_, s) auto_result_out = s; return true end, close = function() return true end }
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
  CountTracks = function(proj) assert(proj == project); return 1 end,
  GetTrack = function(proj, i) assert(proj == project and i == 0); return 'trk' end,
  GetTrackGUID = function(t) return t == 'trk' and '{TRK}' or '{OTHER}' end,
  GetTrackName = function(t) assert(t == 'trk'); return true, 'Lead Vox' end,
  GetSet_LoopTimeRange2 = function(_, isSet) assert(isSet == false); return 100.0, 110.0 end,
  Undo_BeginBlock2 = function(proj) assert(proj == 0); undo.begun = undo.begun + 1 end,
  Undo_EndBlock2 = function(proj, label) assert(proj == 0); undo.ended = undo.ended + 1; undo.label = label end,
  GetTrackEnvelopeByName = function(t, name) assert(t == 'trk' and name == 'Volume'); return 'env' end,
  GetEnvelopeScalingMode = function(env) assert(env == 'env'); return 0 end,
  ScaleToEnvelopeMode = function(_, v) return v end,  -- identity: linear amplitude
  DeleteEnvelopePointRange = function(env, t0, t1) assert(env == 'env'); deleted = { t0 = t0, t1 = t1 } end,
  InsertEnvelopePoint = function(env, time, value) assert(env == 'env'); points[#points + 1] = { time = time, value = value } end,
  Envelope_SortPoints = function(env) assert(env == 'env'); sorted = true end,
  atexit = function() end,
  time_precise = function() clock = clock + 0.3; return clock end,
  defer = function(fn) callbacks[#callbacks + 1] = fn end,
  ShowMessageBox = function(message) error(message) end,
}, { __index = function(_, key) error('Unexpected API: ' .. key) end })

dofile('reaper/Cadenzai_Read_Selection.lua')
for _ = 1, 4 do if #callbacks > 0 then local fn = table.remove(callbacks, 1); fn() end end

assert(removed_auto, 'the automation request file is consumed')
assert(undo.begun == 1 and undo.ended == 1, 'the change is wrapped in exactly one undo block')
assert(undo.label == 'Cadenzai: volume swell', 'the undo step is clearly labelled')
assert(deleted and math.abs(deleted.t0 - 100.0) < 0.01 and math.abs(deleted.t1 - 110.0) < 0.01, 'existing points in the range are cleared first')
assert(#points == 2, 'exactly two envelope points are written')
-- Swell: quiet (~-18 dB => ~0.126 linear) at the start, full (0 dB => 1.0) at the end.
assert(math.abs(points[1].time - 100.0) < 0.01 and math.abs(points[1].value - 0.1259) < 0.01, 'start of selection ramps up from quiet')
assert(math.abs(points[2].time - 110.0) < 0.01 and math.abs(points[2].value - 1.0) < 0.01, 'end of selection reaches full volume')
assert(sorted, 'points are sorted')
assert(auto_result_out and auto_result_out:find('"status":"applied"', 1, true), 'an applied result is echoed back')
assert(auto_result_out:find('"requestId":"auto-test-00000001"', 1, true), 'the requestId is echoed back')
assert(auto_result_out:find('swell', 1, true), 'the move is named in the result')
assert(auto_result_out:find('Lead Vox', 1, true), 'the track name is reported')
print(auto_result_out)
print('Bridge producer-directed automation: time-selection read, track lookup, single undo block, volume ramp and echoed result tests passed.')
