-- Drives the real continuous bridge with an approved "apply drawn EQ" request
-- against a strict double. Any unlisted API fails. Proves the bridge finds the
-- target track by GUID, adds exactly one ReaEQ in a single undo block, sets each
-- drawn bell band (freq/gain/Q), consumes the request, and echoes the outcome.
local REQUEST = '{"version":1,"kind":"apply-eq","requestId":"eq-test-00000001","trackId":"{TRK}",' ..
  '"bands":[{"f":300,"g":-4,"q":1.2},{"f":3000,"g":2.5,"q":0.8}],"requestedAt":1000000}'
local eq_result_out, removed_eq = nil, false
local callbacks = {}
local clock = 10
local undo = { begun = 0, ended = 0, label = nil }
local added_fx, renamed = 0, nil
local params = {}   -- params[bandidx][paramtype] = value
local enabled = {}  -- enabled[bandidx] = true
os.getenv = function(key) assert(key == 'LOCALAPPDATA'); return '/test-only' end
os.time = function() return 1000 end
os.execute = function() return true end  -- do not actually launch the app in tests
os.remove = function(file) assert(file == '/test-only/Cadenzai/reaper-bridge/eq-request.json'); removed_eq = true; return true end
io.open = function(file, mode)
  if mode == 'rb' then
    if file == '/test-only/Cadenzai/reaper-bridge/eq-request.json' then
      if removed_eq then return nil end
      return { read = function() return REQUEST end, close = function() return true end }
    end
    assert(file == '/test-only/Cadenzai/reaper-bridge/request.json' or file == '/test-only/Cadenzai/reaper-bridge/cursor.json' or file == '/test-only/Cadenzai/reaper-bridge/fx-request.json' or file == '/test-only/Cadenzai/reaper-bridge/auto-request.json')
    return nil
  end
  if file == '/test-only/Cadenzai/reaper-bridge/state.json' then
    assert(mode == 'wb'); return { write = function() return true end, close = function() return true end }
  end
  assert(file == '/test-only/Cadenzai/reaper-bridge/eq-result.json' and mode == 'wb')
  return { write = function(_, s) eq_result_out = s; return true end, close = function() return true end }
end
local project = 'project'
reaper = setmetatable({
  -- Selection publishing (minimal: nothing selected)
  RecursiveCreateDirectory = function() end,
  SetExtState = function(_, _, _, persist) assert(persist == false) end,
  GetProjectName = function() return 'Song' end,
  CountSelectedTracks2 = function() return 0 end,
  GetMasterTrack = function() return 'master' end,
  genGuid = function() return '{GUID}' end,
  GetProjectStateChangeCount = function() return 1 end,
  EnumProjects = function(index) if index == -1 or index == 0 then return project, 'test.rpp' end end,
  -- Track lookup by GUID
  CountTracks = function(proj) assert(proj == project); return 2 end,
  GetTrack = function(proj, i) assert(proj == project); return i == 0 and 'other' or 'trk' end,
  GetTrackGUID = function(t) return t == 'trk' and '{TRK}' or '{OTHER}' end,
  GetTrackName = function(t) assert(t == 'trk'); return true, 'Lead Vox' end,
  -- EQ write-back
  Undo_BeginBlock2 = function(proj) assert(proj == 0); undo.begun = undo.begun + 1 end,
  Undo_EndBlock2 = function(proj, label) assert(proj == 0); undo.ended = undo.ended + 1; undo.label = label end,
  TrackFX_AddByName = function(t, name, recfx, inst) assert(t == 'trk' and name == 'ReaEQ' and recfx == false and inst == -1); added_fx = added_fx + 1; return 0 end,
  TrackFX_SetNamedConfigParm = function(t, fx, key, val) assert(t == 'trk' and fx == 0 and key == 'renamed_name'); renamed = val; return true end,
  TrackFX_SetEQParam = function(t, fx, bandtype, bandidx, paramtype, val, isnorm)
    assert(t == 'trk' and fx == 0 and bandtype == 2 and isnorm == false)
    params[bandidx] = params[bandidx] or {}
    params[bandidx][paramtype] = val
    return true
  end,
  TrackFX_SetEQBandEnabled = function(t, fx, bandtype, bandidx, en) assert(t == 'trk' and fx == 0 and bandtype == 2 and en == true); enabled[bandidx] = true; return true end,
  atexit = function() end,
  time_precise = function() clock = clock + 0.3; return clock end,
  defer = function(fn) callbacks[#callbacks + 1] = fn end,
  ShowMessageBox = function(message) error(message) end,
}, { __index = function(_, key) error('Unexpected API: ' .. key) end })

dofile('reaper/Cadenzai_Read_Selection.lua')
for _ = 1, 4 do if #callbacks > 0 then local fn = table.remove(callbacks, 1); fn() end end

assert(removed_eq, 'the EQ request file is consumed')
assert(added_fx == 1, 'exactly one ReaEQ is added')
assert(undo.begun == 1 and undo.ended == 1, 'the change is wrapped in exactly one undo block')
assert(undo.label == 'Cadenzai: apply drawn EQ', 'the undo step is clearly labelled')
assert(renamed == 'Cadenzai EQ', 'the ReaEQ is clearly named')
-- Band 0: 300 Hz / -4 dB / Q 1.2; band 1: 3000 Hz / 2.5 dB / Q 0.8.
assert(params[0][0] == 300 and params[0][1] == -4 and params[0][2] == 1.2, 'first drawn band set correctly')
assert(params[1][0] == 3000 and params[1][1] == 2.5 and params[1][2] == 0.8, 'second drawn band set correctly')
assert(enabled[0] and enabled[1], 'both bands are enabled')
assert(eq_result_out and eq_result_out:find('"status":"applied"', 1, true), 'an applied result is echoed back')
assert(eq_result_out:find('"requestId":"eq-test-00000001"', 1, true), 'the requestId is echoed back')
assert(eq_result_out:find('"bandCount":2', 1, true), 'the band count is reported')
assert(eq_result_out:find('Lead Vox', 1, true), 'the track name is reported')
print(eq_result_out)
print('Bridge producer-directed EQ write-back: track lookup, single undo block, band set, and echoed result tests passed.')
