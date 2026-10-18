-- Drives the real continuous bridge with an approved "add stock effect" request
-- against a strict double. Any unlisted API fails. Proves the bridge finds the
-- target track by GUID, adds exactly the requested whitelisted effect in a
-- single undo block, consumes the request, and echoes the outcome.
local REQUEST = '{"version":1,"kind":"apply-effect","requestId":"fx-test-00000001","trackId":"{TRK}","fx":"ReaDelay","requestedAt":1000000}'
local fx_result_out, removed_fx = nil, false
local callbacks = {}
local clock = 10
local undo = { begun = 0, ended = 0, label = nil }
local added = nil
os.getenv = function(key) assert(key == 'LOCALAPPDATA'); return '/test-only' end
os.time = function() return 1000 end
os.execute = function() return true end  -- do not actually launch the app in tests
os.remove = function(file) assert(file == '/test-only/Cadenzai/reaper-bridge/fx-request.json'); removed_fx = true; return true end
io.open = function(file, mode)
  if mode == 'rb' then
    if file == '/test-only/Cadenzai/reaper-bridge/fx-request.json' then
      if removed_fx then return nil end
      return { read = function() return REQUEST end, close = function() return true end }
    end
    assert(file == '/test-only/Cadenzai/reaper-bridge/request.json' or file == '/test-only/Cadenzai/reaper-bridge/cursor.json' or file == '/test-only/Cadenzai/reaper-bridge/eq-request.json')
    return nil
  end
  if file == '/test-only/Cadenzai/reaper-bridge/state.json' then
    assert(mode == 'wb'); return { write = function() return true end, close = function() return true end }
  end
  assert(file == '/test-only/Cadenzai/reaper-bridge/fx-result.json' and mode == 'wb')
  return { write = function(_, s) fx_result_out = s; return true end, close = function() return true end }
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
  Undo_BeginBlock2 = function(proj) assert(proj == 0); undo.begun = undo.begun + 1 end,
  Undo_EndBlock2 = function(proj, label) assert(proj == 0); undo.ended = undo.ended + 1; undo.label = label end,
  TrackFX_AddByName = function(t, name, recfx, inst) assert(t == 'trk' and recfx == false and inst == -1); added = name; return 0 end,
  atexit = function() end,
  time_precise = function() clock = clock + 0.3; return clock end,
  defer = function(fn) callbacks[#callbacks + 1] = fn end,
  ShowMessageBox = function(message) error(message) end,
}, { __index = function(_, key) error('Unexpected API: ' .. key) end })

dofile('reaper/Cadenzai_Read_Selection.lua')
for _ = 1, 4 do if #callbacks > 0 then local fn = table.remove(callbacks, 1); fn() end end

assert(removed_fx, 'the effect request file is consumed')
assert(added == 'ReaDelay', 'the requested whitelisted effect is added')
assert(undo.begun == 1 and undo.ended == 1, 'the change is wrapped in exactly one undo block')
assert(undo.label == 'Cadenzai: add ReaDelay', 'the undo step is clearly labelled')
assert(fx_result_out and fx_result_out:find('"status":"applied"', 1, true), 'an applied result is echoed back')
assert(fx_result_out:find('"requestId":"fx-test-00000001"', 1, true), 'the requestId is echoed back')
assert(fx_result_out:find('"fxName":"ReaDelay"', 1, true), 'the effect name is reported')
assert(fx_result_out:find('Lead Vox', 1, true), 'the track name is reported')
print(fx_result_out)
print('Bridge producer-directed effect add: track lookup, single undo block, whitelisted effect, and echoed result tests passed.')
