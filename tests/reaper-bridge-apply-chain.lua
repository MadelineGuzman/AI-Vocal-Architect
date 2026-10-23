-- Drives the real continuous bridge with an approved "build the chain" request
-- against a strict double. Any unlisted API fails. Proves the bridge builds ONE
-- ReaEQ (high-pass + tone bands set to real values) plus the ordered FX rack, all
-- in a single undo block, consumes the request, and echoes the result.
local REQUEST = '{"version":1,"kind":"apply-chain","requestId":"chain-test-00000001","trackId":"{TRK}",' ..
  '"hpf":80,"bands":[{"f":300,"g":-2,"q":1},{"f":3000,"g":1.5,"q":0.9}],"fx":["ReaComp","ReaDelay"],"profile":"Chopped & Screwed","requestedAt":1000000}'
local chain_result_out, removed = nil, false
local callbacks = {}
local clock = 10
local undo = { begun = 0, ended = 0, label = nil }
local added, renamed = {}, nil
local eq_params, enabled = {}, {}
os.getenv = function(key) assert(key == 'LOCALAPPDATA'); return '/test-only' end
os.time = function() return 1000 end
os.execute = function() return true end  -- do not actually launch the app in tests
os.remove = function(file) assert(file == '/test-only/Cadenzai/reaper-bridge/chain-request.json'); removed = true; return true end
io.open = function(file, mode)
  if mode == 'rb' then
    if file == '/test-only/Cadenzai/reaper-bridge/chain-request.json' then
      if removed then return nil end
      return { read = function() return REQUEST end, close = function() return true end }
    end
    assert(file == '/test-only/Cadenzai/reaper-bridge/request.json' or file == '/test-only/Cadenzai/reaper-bridge/cursor.json' or file == '/test-only/Cadenzai/reaper-bridge/eq-request.json' or file == '/test-only/Cadenzai/reaper-bridge/fx-request.json' or file == '/test-only/Cadenzai/reaper-bridge/auto-request.json' or file == '/test-only/Cadenzai/reaper-bridge/transport.json' or file == '/test-only/Cadenzai/reaper-bridge/select-item.json')
    return nil
  end
  if file == '/test-only/Cadenzai/reaper-bridge/state.json' then
    assert(mode == 'wb'); return { write = function() return true end, close = function() return true end }
  end
  assert(file == '/test-only/Cadenzai/reaper-bridge/chain-result.json' and mode == 'wb')
  return { write = function(_, s) chain_result_out = s; return true end, close = function() return true end }
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
  TrackFX_AddByName = function(t, name, recfx, inst) assert(t == 'trk' and recfx == false and inst == -1); added[#added + 1] = name; return #added - 1 end,
  TrackFX_SetNamedConfigParm = function(t, _, key, val) assert(t == 'trk' and key == 'renamed_name'); renamed = val; return true end,
  TrackFX_SetEQParam = function(t, _, bandtype, bandidx, ptype, val, isnorm)
    assert(t == 'trk' and isnorm == false)
    eq_params[bandtype] = eq_params[bandtype] or {}
    eq_params[bandtype][bandidx] = eq_params[bandtype][bandidx] or {}
    eq_params[bandtype][bandidx][ptype] = val
    return true
  end,
  TrackFX_SetEQBandEnabled = function(t, _, bandtype, bandidx, en) assert(t == 'trk' and en == true); enabled[bandtype .. ':' .. bandidx] = true; return true end,
  atexit = function() end,
  time_precise = function() clock = clock + 0.3; return clock end,
  defer = function(fn) callbacks[#callbacks + 1] = fn end,
  ShowMessageBox = function(message) error(message) end,
}, { __index = function(_, key) error('Unexpected API: ' .. key) end })

dofile('reaper/Cadenzai_Read_Selection.lua')
for _ = 1, 4 do if #callbacks > 0 then local fn = table.remove(callbacks, 1); fn() end end

assert(removed, 'the chain request file is consumed')
assert(undo.begun == 1 and undo.ended == 1, 'the whole chain is built in exactly one undo block')
assert(undo.label == 'Cadenzai: build Chopped & Screwed chain', 'the undo step names the profile')
-- One ReaEQ first, then the FX rack in order.
assert(added[1] == 'ReaEQ' and added[2] == 'ReaComp' and added[3] == 'ReaDelay', 'ReaEQ then the ordered FX rack are added')
assert(renamed == 'Cadenzai EQ', 'the EQ is clearly named')
-- High-pass band (type 0) set to the requested frequency and enabled.
assert(eq_params[0] and eq_params[0][0] and eq_params[0][0][0] == 80, 'the high-pass is set to 80 Hz')
assert(enabled['0:0'], 'the high-pass band is enabled')
-- Two tone bells (type 2) set to real freq/gain/Q.
assert(eq_params[2][0][0] == 300 and eq_params[2][0][1] == -2 and eq_params[2][0][2] == 1, 'first tone band set correctly')
assert(eq_params[2][1][0] == 3000 and eq_params[2][1][1] == 1.5 and eq_params[2][1][2] == 0.9, 'second tone band set correctly')
assert(chain_result_out and chain_result_out:find('"status":"applied"', 1, true), 'an applied result is echoed back')
assert(chain_result_out:find('"requestId":"chain-test-00000001"', 1, true), 'the requestId is echoed back')
assert(chain_result_out:find('"bandCount":2', 1, true) and chain_result_out:find('"fxCount":2', 1, true), 'band and effect counts are reported')
assert(chain_result_out:find('Lead Vox', 1, true), 'the track name is reported')
print(chain_result_out)
print('Bridge build-the-chain: one undo block, ReaEQ (HPF + tone bands) + ordered FX rack, and echoed result tests passed.')
