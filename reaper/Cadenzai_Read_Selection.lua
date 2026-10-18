-- Cadenzai: read-only selection bridge. Run from REAPER's Actions list.
-- Publishes the current selection and, only when Cadenzai sends an approved
-- "analyze selected section" request, runs the same read-only level analysis.
-- No project writes, gain/effects/transport changes, or network calls.
-- Stop by running the action again and choosing Terminate.
local script_dir = debug.getinfo(1, 'S').source:sub(2):gsub(string.char(92), '/'):match('^(.*[/])') or ''
local base = os.getenv('LOCALAPPDATA')
if not base then
  reaper.ShowMessageBox('This first bridge build requires Windows LOCALAPPDATA.', 'Cadenzai', 0)
  return
end
local directory = base .. '/Cadenzai/reaper-bridge'
reaper.RecursiveCreateDirectory(directory, 0)
local filename = directory .. '/state.json'
local request_file = directory .. '/request.json'
local cursor_file = directory .. '/cursor.json'
local eq_request_file = directory .. '/eq-request.json'
local eq_result_file = directory .. '/eq-result.json'
local fx_request_file = directory .. '/fx-request.json'
local fx_result_file = directory .. '/fx-result.json'
local auto_request_file = directory .. '/auto-request.json'
local auto_result_file = directory .. '/auto-result.json'
local json = dofile(script_dir .. 'lib/json.lua')
local metrics = dofile(script_dir .. 'lib/levels.lua')
local analyze = dofile(script_dir .. 'lib/analyze.lua')
-- Release any in-flight analysis accessor if REAPER exits mid-measurement.
reaper.atexit(analyze.cleanup)
local session = reaper.genGuid()
local projects = {}
local sequence, last_poll, last_publish = 0, -1, -1
local last_content = nil
local last_handled = nil
local last_cursor = nil
local last_eq = nil
local last_fx = nil
local last_auto = nil

-- Read the single approved request file. Only a correlation id is extracted;
-- no paths, commands, or executable data are ever read from it.
local function read_request()
  local file = io.open(request_file, 'rb')
  if not file then return nil end
  local content = file:read(4096)
  file:close()
  if not content or not content:find('"kind":"analyze-selection"', 1, true) then return nil end
  local id = content:match('"requestId":"([%w%-]+)"')
  if not id or #id < 8 or #id > 128 then return nil end
  local requested = tonumber(content:match('"requestedAt":(%d+)'))
  -- Ignore stale or clock-skewed requests so a restart cannot replay an old one.
  if requested and math.abs(os.time() * 1000 - requested) > 20000 then return nil end
  return id
end

-- Read a navigation-only request to move the edit cursor to a time. No edits.
local function read_cursor()
  local file = io.open(cursor_file, 'rb')
  if not file then return nil end
  local content = file:read(512)
  file:close()
  if not content or not content:find('"kind":"move-cursor"', 1, true) then return nil end
  local t = tonumber(content:match('"timeSeconds":(%-?%d+%.?%d*)'))
  local stamp = content:match('"requestedAt":(%d+)')
  if not t or not stamp or t < -1 or t > 1e7 then return nil end
  local requested = tonumber(stamp)
  if requested and math.abs(os.time() * 1000 - requested) > 20000 then return nil end
  return { time = t, stamp = stamp }
end

local function write_eq_result(id, status, message, track_name, band_count)
  local payload = json.encode({ version = 1, kind = 'apply-eq-result', requestId = id, status = status,
    message = tostring(message), trackName = track_name or '', bandCount = band_count or 0, updatedAt = os.time() * 1000 })
  local file = io.open(eq_result_file, 'wb')
  if file then file:write(payload); file:close() end
end

-- Read one approved "apply drawn EQ" request: a target track GUID and a small
-- set of bell bands. No paths, commands, or executable data are ever read.
local function read_eq_request()
  local file = io.open(eq_request_file, 'rb')
  if not file then return nil end
  local content = file:read(8192)
  file:close()
  if not content or not content:find('"kind":"apply-eq"', 1, true) then return nil end
  local id = content:match('"requestId":"([%w%-]+)"')
  if not id or #id < 8 or #id > 128 then return nil end
  local track_id = content:match('"trackId":"([%w%-{}]+)"')
  if not track_id then return nil end
  local stamp = content:match('"requestedAt":(%d+)')
  if stamp and math.abs(os.time() * 1000 - tonumber(stamp)) > 20000 then return nil end
  local bands_str = content:match('"bands":%[(.-)%]')
  if not bands_str then return nil end
  local bands = {}
  for obj in bands_str:gmatch('{(.-)}') do
    local f = tonumber(obj:match('"f":(%-?%d+%.?%d*)'))
    local g = tonumber(obj:match('"g":(%-?%d+%.?%d*)'))
    local q = tonumber(obj:match('"q":(%-?%d+%.?%d*)'))
    if f and g and q and f >= 20 and f <= 24000 and g >= -36 and g <= 36 and q >= 0.1 and q <= 10 then
      bands[#bands + 1] = { f = f, g = g, q = q }
      if #bands >= 16 then break end
    end
  end
  if #bands == 0 then return nil end
  return { id = id, trackId = track_id, bands = bands, stamp = stamp }
end

-- Find the analyzed track by its GUID in the active project (never the master).
local function find_track_by_guid(guid)
  local active = reaper.EnumProjects(-1, '')
  if not active then return nil end
  local count = reaper.CountTracks(active)
  for i = 0, count - 1 do
    local track = reaper.GetTrack(active, i)
    if track and reaper.GetTrackGUID(track) == guid then return track end
  end
  return nil
end

-- Producer-directed write: add ONE clearly named ReaEQ with the drawn bells, in
-- a single undoable step. This is the only place the bridge changes the project,
-- and only in response to an explicit click in Cadenzai. Undo in REAPER removes
-- it; nothing else about the project, routing, or other effects is touched.
local function apply_eq(req)
  local track = find_track_by_guid(req.trackId)
  if not track then
    write_eq_result(req.id, 'error', 'Could not find the analyzed track. Re-analyze it, then apply again.', '', 0)
    return
  end
  local _, track_name = reaper.GetTrackName(track, '')
  reaper.Undo_BeginBlock2(0)
  local ok, err = pcall(function()
    local fx = reaper.TrackFX_AddByName(track, 'ReaEQ', false, -1)
    if fx < 0 then error('ReaEQ is not available in this REAPER install.') end
    pcall(function() reaper.TrackFX_SetNamedConfigParm(track, fx, 'renamed_name', 'Cadenzai EQ') end)
    for i = 1, #req.bands do
      local b = req.bands[i]
      local bi = i - 1
      -- bandtype 2 = "band" (bell); params 0 = frequency, 1 = gain (dB), 2 = Q.
      reaper.TrackFX_SetEQParam(track, fx, 2, bi, 0, b.f, false)
      reaper.TrackFX_SetEQParam(track, fx, 2, bi, 1, b.g, false)
      reaper.TrackFX_SetEQParam(track, fx, 2, bi, 2, b.q, false)
      pcall(function() reaper.TrackFX_SetEQBandEnabled(track, fx, 2, bi, true) end)
    end
  end)
  reaper.Undo_EndBlock2(0, 'Cadenzai: apply drawn EQ', -1)
  if ok then
    write_eq_result(req.id, 'applied', 'Added a Cadenzai EQ with ' .. #req.bands .. ' band(s).', track_name, #req.bands)
  else
    write_eq_result(req.id, 'error', err, track_name, 0)
  end
end

-- Describe-to-effect: add one whitelisted stock effect to a track. Only names
-- from this fixed allow-list are ever acted on.
local FX_ALLOWED = { ReaDelay = true, ReaVerbate = true, ReaComp = true }

local function write_fx_result(id, status, message, fx_name, track_name)
  local payload = json.encode({ version = 1, kind = 'apply-effect-result', requestId = id, status = status,
    message = tostring(message), fxName = fx_name or '', trackName = track_name or '', updatedAt = os.time() * 1000 })
  local file = io.open(fx_result_file, 'wb')
  if file then file:write(payload); file:close() end
end

local function read_fx_request()
  local file = io.open(fx_request_file, 'rb')
  if not file then return nil end
  local content = file:read(4096)
  file:close()
  if not content or not content:find('"kind":"apply-effect"', 1, true) then return nil end
  local id = content:match('"requestId":"([%w%-]+)"')
  if not id or #id < 8 or #id > 128 then return nil end
  local track_id = content:match('"trackId":"([%w%-{}]+)"')
  if not track_id then return nil end
  local fx = content:match('"fx":"(%a+)"')
  if not fx or not FX_ALLOWED[fx] then return nil end
  local stamp = content:match('"requestedAt":(%d+)')
  if stamp and math.abs(os.time() * 1000 - tonumber(stamp)) > 20000 then return nil end
  return { id = id, trackId = track_id, fx = fx }
end

-- Producer-directed write: add ONE allow-listed stock effect on the selected
-- track, in a single undo step. Only changes the project on an explicit click,
-- adds nothing but that one effect, and is reversible with undo in REAPER.
local function apply_fx(req)
  if not FX_ALLOWED[req.fx] then write_fx_result(req.id, 'error', 'That effect is not available.', '', ''); return end
  local track = find_track_by_guid(req.trackId)
  if not track then
    write_fx_result(req.id, 'error', 'Could not find the selected track. Select it in REAPER, then try again.', req.fx, '')
    return
  end
  local _, track_name = reaper.GetTrackName(track, '')
  reaper.Undo_BeginBlock2(0)
  local ok, err = pcall(function()
    local fx = reaper.TrackFX_AddByName(track, req.fx, false, -1)
    if fx < 0 then error(req.fx .. ' is not available in this REAPER install.') end
  end)
  reaper.Undo_EndBlock2(0, 'Cadenzai: add ' .. req.fx, -1)
  if ok then write_fx_result(req.id, 'applied', 'Added ' .. req.fx .. ' to the track.', req.fx, track_name)
  else write_fx_result(req.id, 'error', err, req.fx, track_name) end
end

-- Time-selection automation: write a track volume envelope over REAPER's current
-- time selection. Only these whitelisted moves are ever acted on.
local AUTO_ALLOWED = { ['volume-swell'] = true, ['volume-fade'] = true }

local function write_auto_result(id, status, message, track_name)
  local payload = json.encode({ version = 1, kind = 'apply-automation-result', requestId = id, status = status,
    message = tostring(message), trackName = track_name or '', updatedAt = os.time() * 1000 })
  local file = io.open(auto_result_file, 'wb')
  if file then file:write(payload); file:close() end
end

local function read_auto_request()
  local file = io.open(auto_request_file, 'rb')
  if not file then return nil end
  local content = file:read(4096)
  file:close()
  if not content or not content:find('"kind":"apply-automation"', 1, true) then return nil end
  local id = content:match('"requestId":"([%w%-]+)"')
  if not id or #id < 8 or #id > 128 then return nil end
  local track_id = content:match('"trackId":"([%w%-{}]+)"')
  if not track_id then return nil end
  local auto = content:match('"auto":"([%w%-]+)"')
  if not auto or not AUTO_ALLOWED[auto] then return nil end
  local stamp = content:match('"requestedAt":(%d+)')
  if stamp and math.abs(os.time() * 1000 - tonumber(stamp)) > 20000 then return nil end
  return { id = id, trackId = track_id, auto = auto }
end

-- Producer-directed write: a track volume envelope over the current time
-- selection, in one undo step. Reads REAPER's live time selection (never guesses
-- "where"); changes only this one track's volume automation, reversible with undo.
local function apply_automation(req)
  if not AUTO_ALLOWED[req.auto] then write_auto_result(req.id, 'error', 'That automation is not available.', ''); return end
  local track = find_track_by_guid(req.trackId)
  if not track then
    write_auto_result(req.id, 'error', 'Could not find the selected track. Select it in REAPER, then try again.', '')
    return
  end
  local start_t, end_t = reaper.GetSet_LoopTimeRange2(0, false, false, 0, 0, false)
  if not start_t or not end_t or (end_t - start_t) < 0.05 then
    write_auto_result(req.id, 'error', 'Drag a time selection in REAPER over the part you want, then try again.', '')
    return
  end
  local _, track_name = reaper.GetTrackName(track, '')
  reaper.Undo_BeginBlock2(0)
  local ok, err = pcall(function()
    local env = reaper.GetTrackEnvelopeByName(track, 'Volume')
    if not env then
      reaper.SetOnlyTrackSelected(track)
      reaper.Main_OnCommandEx(40406, 0, 0) -- Track: Toggle track volume envelope visible
      env = reaper.GetTrackEnvelopeByName(track, 'Volume')
    end
    if not env then error('Could not open the track volume envelope.') end
    local scaling = reaper.GetEnvelopeScalingMode(env)
    local function val(db) return reaper.ScaleToEnvelopeMode(scaling, 10 ^ (db / 20)) end
    reaper.DeleteEnvelopePointRange(env, start_t - 0.001, end_t + 0.001)
    if req.auto == 'volume-swell' then
      reaper.InsertEnvelopePoint(env, start_t, val(-18), 0, 0, false, true)
      reaper.InsertEnvelopePoint(env, end_t, val(0), 0, 0, false, true)
    else
      reaper.InsertEnvelopePoint(env, start_t, val(0), 0, 0, false, true)
      reaper.InsertEnvelopePoint(env, end_t, val(-60), 0, 0, false, true)
    end
    reaper.Envelope_SortPoints(env)
  end)
  reaper.Undo_EndBlock2(0, 'Cadenzai: ' .. (req.auto == 'volume-swell' and 'volume swell' or 'fade out'), -1)
  if ok then
    local label = req.auto == 'volume-swell' and 'Wrote a volume swell' or 'Wrote a fade'
    write_auto_result(req.id, 'applied', string.format('%s over %.1f–%.1f s.', label, start_t, end_t), track_name)
  else
    write_auto_result(req.id, 'error', err, track_name)
  end
end

local function quote(value)
  return '"' .. tostring(value):gsub('[%z\1-\31\\"]', function(c)
    return string.format('\\u%04x', string.byte(c))
  end) .. '"'
end

local function capture()
  local active, project_file = reaper.EnumProjects(-1, '')
  if not active then return nil end
  local alive, index = {}, 0
  while true do
    local project = reaper.EnumProjects(index, '')
    if not project then break end
    alive[tostring(project)] = true
    index = index + 1
  end
  for key in pairs(projects) do if not alive[key] then projects[key] = nil end end
  local key = tostring(active)
  if not projects[key] then projects[key] = reaper.genGuid() end
  reaper.SetExtState('CadenzaiBridge', 'project:' .. key, projects[key], false)
  local name = reaper.GetProjectName(active, '')
  if name == '' then name = 'Unsaved project' end
  local tracks = {}
  local count = reaper.CountSelectedTracks2(active, true)
  if count > 512 then error('Select at most 512 tracks for this bridge.') end
  for i = 0, count - 1 do
    local track = reaper.GetSelectedTrack2(active, i, true)
    if track then
      local _, track_name = reaper.GetTrackName(track, '')
      local number = math.max(0, math.floor(reaper.GetMediaTrackInfo_Value(track, 'IP_TRACKNUMBER')))
      local master = track == reaper.GetMasterTrack(active)
      tracks[#tracks + 1] = '{"id":' .. quote(reaper.GetTrackGUID(track)) ..
        ',"name":' .. quote(track_name) .. ',"number":' .. number .. ',"isMaster":' .. tostring(master) .. '}'
    end
  end
  return '"revision":' .. reaper.GetProjectStateChangeCount(active) .. ',"project":{"sessionId":' .. quote(projects[key]) .. ',"name":' .. quote(name) ..
    ',"saved":' .. tostring(project_file ~= '') .. '},"tracks":[' .. table.concat(tracks, ',') .. ']'
end

local function tick()
  local now = reaper.time_precise()
  if now - last_poll >= 0.25 then
    last_poll = now
    local ok, content = pcall(capture)
    if not ok then reaper.ShowMessageBox(tostring(content), 'Cadenzai bridge stopped', 0); return end
    if content and (content ~= last_content or now - last_publish >= 1) then
      sequence = sequence + 1
      local payload = '{"version":1,"sessionId":' .. quote(session) .. ',"sequence":' .. sequence ..
        ',"updatedAt":' .. (os.time() * 1000) .. ',' .. content .. '}'
      if #payload > 131072 then reaper.ShowMessageBox('Selection metadata is too large.', 'Cadenzai bridge stopped', 0); return end
      local file, err = io.open(filename, 'wb')
      if not file then reaper.ShowMessageBox(tostring(err), 'Cadenzai bridge stopped', 0); return end
      local written, write_error = file:write(payload)
      local closed, close_error = file:close()
      if not written or not closed then
        reaper.ShowMessageBox(tostring(write_error or close_error), 'Cadenzai bridge stopped', 0); return
      end
      reaper.SetExtState('CadenzaiBridge', 'heartbeat', tostring(os.time()), false)
      last_content, last_publish = content, now
    end
    -- Navigation only: move REAPER's edit cursor to a clicked point. No edits,
    -- no audio, no project changes — the producer is driving, not Cadenzai.
    local cursor = read_cursor()
    if cursor and cursor.stamp ~= last_cursor then
      last_cursor = cursor.stamp
      os.remove(cursor_file)
      reaper.SetEditCurPos(cursor.time, true, true)
    end
    -- Producer-directed EQ write-back: only when Cadenzai sends an explicit,
    -- approved request. One ReaEQ, one undo step, nothing else in the project.
    local eq = read_eq_request()
    if eq and eq.id ~= last_eq then
      last_eq = eq.id
      os.remove(eq_request_file)
      local aok, aerr = pcall(apply_eq, eq)
      if not aok then write_eq_result(eq.id, 'error', aerr, '', 0) end
    end
    -- Describe-to-effect: add one allow-listed stock effect on explicit request.
    local fx = read_fx_request()
    if fx and fx.id ~= last_fx then
      last_fx = fx.id
      os.remove(fx_request_file)
      local fok, ferr = pcall(apply_fx, fx)
      if not fok then write_fx_result(fx.id, 'error', ferr, '', '') end
    end
    -- Time-selection automation: write a volume envelope over the selection.
    local auto = read_auto_request()
    if auto and auto.id ~= last_auto then
      last_auto = auto.id
      os.remove(auto_request_file)
      local aok, aerr = pcall(apply_automation, auto)
      if not aok then write_auto_result(auto.id, 'error', aerr, '') end
    end
    -- One analysis at a time; a new request id starts a read-only measurement
    -- of whatever is selected in REAPER at this moment.
    if not analyze.isBusy() then
      local id = read_request()
      if id and id ~= last_handled then
        last_handled = id
        os.remove(request_file)
        analyze.run{ directory = directory, json = json, metrics = metrics, requestId = id }
      end
    end
  end
  reaper.defer(tick)
end

-- Open (or focus) the Cadenzai window so running this script is the only step.
-- The launcher starts the local server if needed and brings an existing window
-- to the front instead of opening a duplicate.
pcall(function()
  local launcher = (script_dir .. '../scripts/launch/cadenzai-launcher.ps1'):gsub('/', '\\')
  os.execute('start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' .. launcher .. '"')
end)

tick()
