-- Drives the real continuous selection bridge with an approved analysis request
-- present, against a strict read-only + audio API double. Any unlisted API
-- (including a project write) fails. Proves the bridge consumes the request,
-- runs the read-only measurement, echoes the requestId, releases the accessor,
-- and keeps publishing the live selection.
local REQUEST = '{"version":1,"kind":"analyze-selection","requestId":"req-test-00000001","requestedAt":1000000}'
local state_out, levels_out, removed, releases, messages = nil, nil, false, 0, {}
local callbacks = {}
local clock = 10
os.getenv = function(key) assert(key == 'LOCALAPPDATA'); return '/test-only' end
os.time = function() return 1000 end
os.execute = function() return true end  -- do not actually launch the app in tests
os.remove = function(file) assert(file == '/test-only/Cadenzai/reaper-bridge/request.json'); removed = true; return true end
io.open = function(file, mode)
  if mode == 'rb' then
    if file == '/test-only/Cadenzai/reaper-bridge/cursor.json' or file == '/test-only/Cadenzai/reaper-bridge/eq-request.json' or file == '/test-only/Cadenzai/reaper-bridge/fx-request.json' or file == '/test-only/Cadenzai/reaper-bridge/auto-request.json' or file == '/test-only/Cadenzai/reaper-bridge/transport.json' or file == '/test-only/Cadenzai/reaper-bridge/chain-request.json' or file == '/test-only/Cadenzai/reaper-bridge/select-item.json' or file == '/test-only/Cadenzai/reaper-bridge/nudge-item.json' then return nil end
    assert(file == '/test-only/Cadenzai/reaper-bridge/request.json')
    if removed then return nil end
    return { read = function() return REQUEST end, close = function() return true end }
  end
  if file == '/test-only/Cadenzai/reaper-bridge/state.json' then
    assert(mode == 'wb'); return { write = function(_, s) state_out = s; return true end, close = function() return true end }
  end
  assert(file == '/test-only/Cadenzai/reaper-bridge/levels.json' and mode == 'wb')
  return { write = function(_, s) levels_out = s; return true end, close = function() return true end }
end
local project = 'project'
reaper = setmetatable({
  -- Selection publishing
  RecursiveCreateDirectory = function() end,
  SetExtState = function(_, _, _, persist) assert(persist == false) end,
  GetProjectName = function() return 'Song' end,
  CountSelectedTracks2 = function() return 1 end,
  GetSelectedTrack2 = function() return 'track' end,
  GetTrackName = function() return true, 'Vocal' end,
  GetTrackGUID = function() return 'track-id' end,
  GetMediaTrackInfo_Value = function(_, key) assert(key == 'IP_TRACKNUMBER'); return 1 end,
  GetMasterTrack = function() return 'master' end,
  genGuid = function() return '{GUID}' end,
  GetProjectStateChangeCount = function() return 1 end,
  EnumProjects = function(index) if index == -1 or index == 0 then return project, 'test.rpp' end end,
  GetExtState = function(_, key) return key == 'heartbeat' and '1000' or 'project-session' end,
  -- Read-only audio analysis
  CountSelectedMediaItems = function() return 1 end,
  GetSelectedMediaItem = function() return 'item' end,
  GetMediaItem_Track = function() return 'track' end,
  GetActiveTake = function() return 'take' end,
  TakeIsMIDI = function() return false end,
  GetMediaItemTakeInfo_Value = function(_, key) return key == 'D_PLAYRATE' and 1 or 0 end,
  GetTakeNumStretchMarkers = function() return 0 end,
  GetMediaItemInfo_Value = function(_, key) return key == 'D_POSITION' and 10 or key == 'D_LENGTH' and 2 or 0 end,
  GetMediaItemTake_Source = function() return 'source' end,
  GetMediaSourceType = function() return 'WAV' end,
  GetMediaSourceLength = function() return 2, false end,
  GetMediaSourceSampleRate = function() return 8000 end,
  GetMediaSourceNumChannels = function() return 1 end,
  GetSet_LoopTimeRange2 = function(_, set) assert(set == false); return 10.25, 11.25 end,
  CreateTakeAudioAccessor = function() return 'accessor' end,
  GetAudioAccessorStartTime = function() return 0 end,
  GetAudioAccessorEndTime = function() return 2 end,
  GetSetMediaItemTakeInfo_String = function(_, _, _, set) assert(set == false); return true, 'take-id' end,
  GetTakeName = function() return 'Test tone' end,
  new_array = function(size) local b = {}; b.clear = function() for i = 1, size do b[i] = 0 end end; return b end,
  ValidatePtr2 = function() return true end,
  AudioAccessorStateChanged = function() return false end,
  GetAudioAccessorSamples = function(_, rate, channels, start, count, buffer)
    assert(rate == 8000 and channels == 1)
    for i = 1, count do buffer[i] = 0.5 * math.sin(2 * math.pi * 1000 * (math.floor(start * rate) + i - 1) / rate) end
    return 1
  end,
  DestroyAudioAccessor = function() releases = releases + 1 end,
  atexit = function() end,
  time_precise = function() clock = clock + 0.004; return clock end,
  defer = function(fn) callbacks[#callbacks + 1] = fn end,
  ShowMessageBox = function(message) messages[#messages + 1] = message end,
}, { __index = function(_, key) error('Unexpected API: ' .. key) end })

dofile('reaper/Cadenzai_Read_Selection.lua')
-- Drain deferred work (tick + analysis step) until the measurement completes.
local guard = 0
while #callbacks > 0 and guard < 1000 do
  local fn = table.remove(callbacks, 1)
  fn()
  guard = guard + 1
  if levels_out and levels_out:find('"status":"ready"', 1, true) then break end
end

assert(#messages == 0, 'no error dialog should appear: ' .. (messages[1] or ''))
assert(state_out and state_out:find('track-id', 1, true), 'live selection is still published')
assert(removed, 'the request file is consumed')
assert(levels_out and levels_out:find('"status":"ready"', 1, true), 'the measurement completes')
assert(levels_out:find('"requestId":"req-test-00000001"', 1, true), 'the requestId is echoed back')
assert(not levels_out:find('.lua:', 1, true), 'no script paths leak into the report')
assert(releases == 1, 'the audio accessor is released exactly once')
print(levels_out)
print('Bridge request-driven read-only analysis, requestId echo, selection continuity and accessor release tests passed.')
