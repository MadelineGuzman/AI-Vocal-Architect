local engine=dofile('reaper/lib/levels.lua')
local json=dofile('reaper/lib/json.lua')
local function near(a,b) assert(a and math.abs(a-b)<0.00001,tostring(a)..' ~= '..b) end
local function signal(channels,fn)
  local s=engine.new(8000,channels)
  -- Irregular blocks prove RMS windows are independent of read block boundaries.
  for first=0,15999,137 do
    local frames=math.min(137,16000-first)
    local samples={}
    for i=0,frames-1 do for c=1,channels do samples[#samples+1]=fn(first+i,c) end end
    engine.add(s,samples,frames)
  end
  return engine.finish(s)
end
local sine=signal(1,function(i) return 0.5*math.sin(2*math.pi*1000*i/8000) end)
near(sine.samplePeakDbfs,-6.02059991328); near(sine.rmsDbfs,-9.03089986992); near(sine.crestDb,3.01029995664)
near(sine.activeVariationDb,0)
local stereo=signal(2,function(i,c) return (c==1 and 1 or -1)*0.5*math.sin(2*math.pi*1000*i/8000) end)
near(stereo.rmsDbfs,sine.rmsDbfs)
local silent=signal(1,function() return 0 end)
assert(silent.silent and silent.rmsDbfs==nil and silent.samplePeakDbfs==nil and silent.activeVariationDb==nil)
local constant=signal(1,function() return 0.1 end)
assert(constant.crestDb>=0);near(constant.crestDb,0)
local clipped=signal(1,function(i) return i%2==0 and 1.1 or -1.1 end)
assert(clipped.samplesAtFullScale==16000)
local changing=signal(1,function(i) return i<8000 and 0.1 or 0.5 end)
assert(changing.activeVariationDb>10)
-- Envelope: when total frames are provided, a bounded peak-over-time array is produced.
local withEnvelope=engine.new(8000,1,16000)
for first=0,15999,137 do
  local n=math.min(137,16000-first); local samples={}
  for i=0,n-1 do samples[#samples+1]=0.5*math.sin(2*math.pi*1000*(first+i)/8000) end
  engine.add(withEnvelope,samples,n)
end
local enveloped=engine.finish(withEnvelope)
assert(type(enveloped.envelope)=='table' and #enveloped.envelope>0 and #enveloped.envelope<=480,'bounded envelope produced')
assert(enveloped.envelope[1]<0,'envelope values are in dBFS')
assert(signal(1,function(i) return 0.5*math.sin(2*math.pi*1000*i/8000) end).envelope==nil,'no envelope without total frames')
assert(not pcall(function() engine.add(engine.new(8000,1),{0/0},1) end))

-- Real action tested against API doubles; any unlisted API (including a project write) fails.
local function run(options)
  options=options or {}
  local callbacks, exit_fn, output, messages, releases, reads={},nil,nil,{},0,{}
  local tick=10
  os.getenv=function() return '/test-only' end
  os.time=function() return 1000 end
  io.open=function(file,mode)
    assert(file=='/test-only/Cadenzai/reaper-bridge/levels.json' and mode=='wb')
    return {write=function(_,s) output=s;return true end,close=function() return true end}
  end
  local project='project'
  reaper=setmetatable({
    RecursiveCreateDirectory=function() end,
    EnumProjects=function() return project,'' end,
    GetExtState=function(_,key) return key=='heartbeat' and '1000' or 'project-session' end,
    CountSelectedTracks2=function() return 1 end,
    GetSelectedTrack2=function() return 'track' end,
    GetMasterTrack=function() return 'master' end,
    CountSelectedMediaItems=function() return options.noItem and 0 or 1 end,
    GetSelectedMediaItem=function() return 'item' end,
    GetMediaItem_Track=function() return 'track' end,
    GetActiveTake=function() return 'take' end,
    TakeIsMIDI=function() return options.midi or false end,
    GetMediaItemTakeInfo_Value=function(_,key) return key=='D_PLAYRATE' and 1 or 0 end,
    GetTakeNumStretchMarkers=function() return 0 end,
    GetMediaItemInfo_Value=function(_,key) return key=='D_POSITION' and 10 or key=='D_LENGTH' and 2 or 0 end,
    GetMediaItemTake_Source=function() return 'source' end,
    GetMediaSourceType=function() return options.reverse and 'SECTION' or 'WAV' end,
    GetMediaSourceLength=function() return 2,false end,
    GetMediaSourceSampleRate=function() return options.offline and 0 or 8000 end,
    GetMediaSourceNumChannels=function() return 1 end,
    GetSet_LoopTimeRange2=function(_,set) assert(set==false); return 10.25,options.empty and 10.25 or 11.25 end,
    CreateTakeAudioAccessor=function() return 'accessor' end,
    GetAudioAccessorStartTime=function() return 0 end,
    GetAudioAccessorEndTime=function() return 2 end,
    GetProjectStateChangeCount=function() return options.changed and #reads>0 and 2 or 1 end,
    GetSetMediaItemTakeInfo_String=function(_,_,_,set) assert(set==false);return true,'take-id' end,
    GetTrackName=function() return true,'Vocal' end,
    GetTrackGUID=function() return 'track-id' end,
    GetTakeName=function() return 'Test tone' end,
    genGuid=function() return 'test-report' end,
    time_precise=function() tick=tick+0.004;return tick end,
    new_array=function(size) local b={};b.clear=function() for i=1,size do b[i]=0 end end;return b end,
    ValidatePtr2=function() return true end,
    AudioAccessorStateChanged=function() return false end,
    GetAudioAccessorSamples=function(_,rate,channels,start,count,buffer)
      assert(rate==8000 and channels==1)
      reads[#reads+1]=start
      if options.readError then return -1 end
      for i=1,count do buffer[i]=0.5*math.sin(2*math.pi*1000*(math.floor(start*rate)+i-1)/rate) end
      return 1
    end,
    DestroyAudioAccessor=function() releases=releases+1 end,
    atexit=function(fn) exit_fn=fn end,
    defer=function(fn) callbacks[#callbacks+1]=fn end,
    ShowMessageBox=function(message) messages[#messages+1]=message end,
  },{__index=function(_,key) error('Unexpected API: '..key) end})
  dofile('reaper/Cadenzai_Analyze_Levels.lua')
  if options.cancel then
    if exit_fn then exit_fn() end
  else
    while #callbacks>0 do local fn=table.remove(callbacks,1);fn() end
    if exit_fn then exit_fn() end
  end
  return output,messages,releases,reads
end
local output,messages,releases,reads=run()
assert(#messages==0 and releases==1);near(reads[1],0.25)
assert(output:find('"status":"ready"',1,true));assert(output:find('"envelope":[',1,true),'ready report includes a loudness envelope');print(output)
-- With no time selection, the whole item (position 10, length 2) is measured.
local whole,wmsgs,wrel,wreads=run({empty=true})
assert(#wmsgs==0 and wrel==1 and whole:find('"status":"ready"',1,true),'empty selection measures the whole item')
assert(whole:find('"startSeconds":10,',1,true) and whole:find('"endSeconds":12,',1,true),'whole-item range spans the full item')
near(wreads[1],0)
for _,options in ipairs({{noItem=true},{midi=true},{reverse=true},{offline=true}}) do
  local notice,errs=run(options);assert(#errs==0 and notice:find('"kind":"notice"',1,true))
  assert(not notice:find('.lua:',1,true))
  if options.offline then assert(notice:find('offline',1,true)) end
end
for _,options in ipairs({{readError=true},{changed=true},{cancel=true}}) do
  local report,_,freed=run(options);assert(freed==1 and (report:find('"kind":"notice"',1,true) or report:find('"status":"error"',1,true)))
end
print('Analytical sine, silence, stereo, variation, overload and read-only action lifecycle tests passed.')
