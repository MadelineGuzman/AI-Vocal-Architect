-- Unweighted sample-domain metrics. Never label RMS as LUFS or sample peak as true peak.
local M = {}
local function db(amplitude) if amplitude <= 0 then return nil end return 20 * math.log(amplitude, 10) end
function M.new(rate, channels, totalFrames)
  assert(rate > 0 and (channels == 1 or channels == 2))
  -- Optional downsampled peak-over-time envelope (for the loudness strip),
  -- bounded to at most 240 bins regardless of recording length.
  local binCount, bins = 0, {}
  if totalFrames and totalFrames > 0 then
    binCount = math.max(1, math.min(240, math.floor(totalFrames)))
    for i = 1, binCount do bins[i] = 0 end
  end
  return { rate=rate, channels=channels, peak=0, sum=0, count=0, atFullScale=0,
    windowFrames=math.max(1, math.floor(rate * 0.4)), frames=0, windowSum=0, windows={},
    binCount=binCount, total=totalFrames or 0, bins=bins, frameIndex=0 }
end
local function flush(s)
  if s.frames == 0 then return end
  local rms = math.sqrt(s.windowSum / (s.frames * s.channels))
  local level = db(rms)
  -- Variation describes active windows only. Silence still contributes to overall RMS.
  if level and level > -60 and s.frames == s.windowFrames then s.windows[#s.windows+1] = level end
  s.frames, s.windowSum = 0, 0
end
function M.add(s, samples, frames)
  for frame=0,frames-1 do
    local framePeak=0
    for channel=1,s.channels do
      local sample=samples[frame*s.channels+channel]
      assert(type(sample)=='number' and sample==sample and math.abs(sample)~=math.huge, 'Invalid audio sample')
      local mag=math.abs(sample)
      if mag>framePeak then framePeak=mag end
      s.peak=math.max(s.peak,mag)
      s.sum=s.sum+sample*sample
      s.windowSum=s.windowSum+sample*sample
      s.count=s.count+1
      if mag>=1 then s.atFullScale=s.atFullScale+1 end
    end
    if s.binCount>0 then
      -- Even frame-to-bin mapping leaves no empty bins at the end.
      local bin=math.min(s.binCount, math.floor(s.frameIndex*s.binCount/s.total)+1)
      if framePeak>s.bins[bin] then s.bins[bin]=framePeak end
      s.frameIndex=s.frameIndex+1
    end
    s.frames=s.frames+1
    if s.frames==s.windowFrames then flush(s) end
  end
end
function M.finish(s)
  local rms = s.count > 0 and math.sqrt(s.sum/s.count) or 0
  local peakDb, rmsDb = db(s.peak), db(rms)
  table.sort(s.windows)
  local function percentile(p)
    local index=1+(#s.windows-1)*p
    local lower=math.floor(index)
    return s.windows[lower]+(s.windows[math.min(lower+1,#s.windows)]-s.windows[lower])*(index-lower)
  end
  local envelope
  if s.binCount>0 then
    envelope={}
    for i=1,s.binCount do
      local d=db(s.bins[i])
      envelope[i]=d and (math.floor(d*10+0.5)/10) or -100
    end
  end
  return { samplePeakDbfs=peakDb, rmsDbfs=rmsDb, crestDb=peakDb and rmsDb and math.max(0,peakDb-rmsDb) or nil,
    activeVariationDb=#s.windows>=2 and percentile(0.9)-percentile(0.1) or nil,
    activeWindows=#s.windows, samplesAtFullScale=s.atFullScale, sampleCount=s.count,
    silent=s.peak==0, envelope=envelope }
end
return M
