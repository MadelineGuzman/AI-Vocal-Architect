-- Shared read-only level analysis driver.
-- Reused by the continuous selection bridge (on an approved request) and by the
-- manual action. It measures one selected take over the time selection using an
-- audio accessor before effects. It never changes gain, audio, effects, routing,
-- transport, or the project. Only measurements are written locally.
local M = {}

-- At most one analysis runs at a time. `active` lets a single atexit handler,
-- registered once by the caller, release the accessor if REAPER exits mid-run.
local active = nil

local function strip(message) return (tostring(message):gsub('^.-:%d+: ', '')) end

function M.isBusy() return active ~= nil end

-- opts: { directory=string, json=table, metrics=table, requestId=string|nil, onDone=function(ok)|nil }
function M.run(opts)
  local directory = opts.directory
  local json = opts.json
  local metrics = opts.metrics
  local requestId = opts.requestId
  local destination = directory .. '/levels.json'
  local accessor
  local finished = false
  local report

  local function publish()
    report.updatedAt = os.time() * 1000
    local file, err = io.open(destination, 'wb')
    if not file then error(err) end
    local written, write_error = file:write(json.encode(report))
    local closed, close_error = file:close()
    if not written or not closed then error(write_error or close_error) end
  end
  local function release()
    if accessor then reaper.DestroyAudioAccessor(accessor); accessor = nil end
  end
  local function done(ok)
    finished = true
    active = nil
    if opts.onDone then opts.onDone(ok) end
  end
  local function fail(message)
    release()
    report = { version = 1, kind = 'notice', message = strip(message), requestId = requestId }
    local delivered = pcall(publish)
    done(false)
    if not delivered then
      reaper.ShowMessageBox('Cadenzai could not receive the level check. ' .. strip(message), 'Recording level check', 0)
    end
  end

  local function start()
    local project = reaper.EnumProjects(-1, '')
    local project_id = reaper.GetExtState('CadenzaiBridge', 'project:' .. tostring(project))
    local heartbeat = tonumber(reaper.GetExtState('CadenzaiBridge', 'heartbeat')) or 0
    if project_id == '' or os.time() - heartbeat > 4 then error('Start or restart the updated Cadenzai selection bridge first.') end
    if reaper.CountSelectedTracks2(project, true) ~= 1 then error('Select exactly one recording track.') end
    local track = reaper.GetSelectedTrack2(project, 0, true)
    if track == reaper.GetMasterTrack(project) then error('Choose a recording track, not the master.') end
    if reaper.CountSelectedMediaItems(project) ~= 1 then error('Select one audio item on that track, then drag a time selection over the section to measure.') end
    local item = reaper.GetSelectedMediaItem(project, 0)
    if reaper.GetMediaItem_Track(item) ~= track then error('The selected audio item must belong to the selected track.') end
    local take = reaper.GetActiveTake(item)
    if not take or reaper.TakeIsMIDI(take) then error('Select an audio recording; MIDI and instrument output are not supported yet.') end
    -- Keep the first measurement path narrow until edited-source timing is validated in REAPER.
    if math.abs(reaper.GetMediaItemTakeInfo_Value(take, 'D_PLAYRATE') - 1) > 0.000001 or
       math.abs(reaper.GetMediaItemTakeInfo_Value(take, 'D_PITCH')) > 0.000001 or
       reaper.GetTakeNumStretchMarkers(take) > 0 then
      error('This first level check supports non-looped audio at its original speed and pitch, without stretch markers.')
    end
    local source = reaper.GetMediaItemTake_Source(take)
    local source_type = reaper.GetMediaSourceType(source)
    if source_type == 'SECTION' then error('Section/reversed sources are not supported in this first level check.') end
    local rate = reaper.GetMediaSourceSampleRate(source)
    local channels = reaper.GetMediaSourceNumChannels(source)
    if rate <= 0 or channels <= 0 then error('REAPER could not read this recording because it is set to offline. Usually this just means REAPER put the audio to sleep while it was in the background - your file is fine. In REAPER, turn off Preferences > Media > "Set media items offline when application is not active" (or run Options > Set all media online), then click Analyze again. If REAPER still shows no waveform after that, the original audio file may need to be relocated.') end
    if rate < 8000 or rate > 192000 or rate ~= math.floor(rate) or (channels ~= 1 and channels ~= 2) then error('Use mono or stereo audio at a sample rate between 8 and 192 kHz.') end
    local selection_start, selection_end = reaper.GetSet_LoopTimeRange2(project, false, false, 0, 0, false)
    if selection_end <= selection_start then error('Drag a time selection in REAPER over the section you want to measure.') end
    local position = reaper.GetMediaItemInfo_Value(item, 'D_POSITION')
    local length = reaper.GetMediaItemInfo_Value(item, 'D_LENGTH')
    local source_length, is_beats = reaper.GetMediaSourceLength(source)
    local offset = reaper.GetMediaItemTakeInfo_Value(take, 'D_STARTOFFS')
    if is_beats or offset < 0 or (reaper.GetMediaItemInfo_Value(item, 'B_LOOPSRC') ~= 0 and offset + length > source_length + 1 / rate) then
      error('Repeated loops or negative source offsets are not supported in this first level check.')
    end
    local start_time = math.max(selection_start, position)
    local end_time = math.min(selection_end, position + length)
    if end_time <= start_time then error('The time selection does not overlap the selected recording.') end
    if end_time - start_time > 120 then error('Choose a section of two minutes or less for this first level check.') end
    accessor = reaper.CreateTakeAudioAccessor(take)
    if not accessor then error('REAPER could not create a read-only audio accessor.') end
    local accessor_start = reaper.GetAudioAccessorStartTime(accessor)
    local accessor_end = reaper.GetAudioAccessorEndTime(accessor)
    -- Take accessor coordinates are relative to the item; source offsets are handled by REAPER.
    local read_start = start_time - position
    local frames = math.floor((end_time - start_time) * rate)
    if frames < 1 or read_start < accessor_start - 1 / rate or read_start + frames / rate > accessor_end + 1 / rate then error('The selected range is outside the available take audio.') end
    local revision = reaper.GetProjectStateChangeCount(project)
    local _, take_id = reaper.GetSetMediaItemTakeInfo_String(take, 'GUID', '', false)
    local _, track_name = reaper.GetTrackName(track, '')
    report = { version = 1, id = reaper.genGuid(), status = 'running', message = 'Measuring selected recording',
      requestId = requestId,
      projectId = project_id, projectRevision = revision, trackId = reaper.GetTrackGUID(track), trackName = track_name,
      takeId = take_id, takeName = reaper.GetTakeName(take), signal = 'take-pre-fx', sampleRate = rate, channels = channels,
      startSeconds = start_time, endSeconds = start_time + frames / rate, progress = 0 }
    publish()
    local state = metrics.new(rate, channels)
    local buffer = reaper.new_array(4096 * channels)
    local processed, last_publish = 0, reaper.time_precise()
    local function step()
      local ok, err = pcall(function()
        if reaper.EnumProjects(-1, '') ~= project or not reaper.ValidatePtr2(project, take, 'MediaItem_Take*') or
           reaper.GetProjectStateChangeCount(project) ~= revision or reaper.AudioAccessorStateChanged(accessor) then
          error('Project or audio changed during analysis. Run the check again on the intended section.')
        end
        local deadline = reaper.time_precise() + 0.006
        repeat
          local count = math.min(4096, frames - processed)
          buffer.clear()
          local result = reaper.GetAudioAccessorSamples(accessor, rate, channels, read_start + processed / rate, count, buffer)
          if result < 0 then error('REAPER could not read the audio samples.') end
          -- REAPER returns zero for no audio; the cleared buffer represents silence.
          metrics.add(state, buffer, count)
          processed = processed + count
        until processed >= frames or reaper.time_precise() >= deadline
        if reaper.GetProjectStateChangeCount(project) ~= revision or reaper.AudioAccessorStateChanged(accessor) then
          error('Audio changed during analysis. Run the check again.')
        end
        report.progress = processed / frames
        if processed >= frames then
          report.status = 'ready'; report.message = 'Measured selected recording'; report.metrics = metrics.finish(state)
          release(); publish(); done(true)
        elseif reaper.time_precise() - last_publish >= 0.5 then publish(); last_publish = reaper.time_precise() end
      end)
      if not ok then fail(tostring(err)); return end
      if not finished then reaper.defer(step) end
    end
    active = { release = release, publish = publish,
      report_ref = function() return report end, is_finished = function() return finished end }
    reaper.defer(step)
  end

  local ok, err = pcall(start)
  if not ok then fail(tostring(err)) end
end

-- Register once with reaper.atexit so an interrupted analysis still releases the
-- accessor and records that it stopped before completion.
function M.cleanup()
  if not active then return end
  active.release()
  local report = active.report_ref()
  if report and not active.is_finished() then
    report.status = 'error'; report.message = 'Analysis stopped before completion'
    pcall(active.publish)
  end
  active = nil
end

return M
