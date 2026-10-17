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
tick()
