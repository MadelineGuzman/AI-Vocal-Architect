-- Unweighted sample-domain metrics plus a read-only frequency view.
-- Never label RMS as LUFS or sample peak as true peak. The spectrum is a
-- relative tone curve for comparison, not a calibrated absolute measurement.
local M = {}
local function db(amplitude) if amplitude <= 0 then return nil end return 20 * math.log(amplitude, 10) end

-- Iterative radix-2 FFT (in place). re/im are 1-indexed; n must be a power of 2.
local function fft(re, im, n)
  local j = 1
  for i = 1, n - 1 do
    if i < j then re[i], re[j] = re[j], re[i]; im[i], im[j] = im[j], im[i] end
    local m = math.floor(n / 2)
    while m >= 1 and j > m do j = j - m; m = math.floor(m / 2) end
    j = j + m
  end
  local len = 2
  while len <= n do
    local half = math.floor(len / 2)
    local ang = -2 * math.pi / len
    local wre, wim = math.cos(ang), math.sin(ang)
    for i = 1, n, len do
      local cre, cim = 1.0, 0.0
      for k = 0, half - 1 do
        local a = i + k
        local b = a + half
        local tre = cre * re[b] - cim * im[b]
        local tim = cre * im[b] + cim * re[b]
        re[b] = re[a] - tre; im[b] = im[a] - tim
        re[a] = re[a] + tre; im[a] = im[a] + tim
        local ncre = cre * wre - cim * wim
        cim = cre * wim + cim * wre; cre = ncre
      end
    end
    len = len * 2
  end
end

-- One windowed FFT frame accumulated into the running power spectrum.
local function process_window(s)
  local re, im, hann = {}, {}, s.hann
  for i = 1, s.fftSize do re[i] = s.fftBuf[i] * hann[i]; im[i] = 0 end
  fft(re, im, s.fftSize)
  local power = s.fftPower
  for k = 1, math.floor(s.fftSize / 2) + 1 do power[k] = power[k] + (re[k] * re[k] + im[k] * im[k]) end
  s.fftWindows = s.fftWindows + 1
end

function M.new(rate, channels, totalFrames)
  assert(rate > 0 and (channels == 1 or channels == 2))
  -- Optional downsampled peak-over-time envelope (loudness waveform), <=480 bins.
  local binCount, bins = 0, {}
  if totalFrames and totalFrames > 0 then
    binCount = math.max(1, math.min(480, math.floor(totalFrames)))
    for i = 1, binCount do bins[i] = 0 end
  end
  -- Frequency view accumulators.
  local fftSize = 2048
  local hann, fftPower = {}, {}
  for i = 1, fftSize do hann[i] = 0.5 - 0.5 * math.cos(2 * math.pi * (i - 1) / (fftSize - 1)) end
  for i = 1, math.floor(fftSize / 2) + 1 do fftPower[i] = 0 end
  return { rate=rate, channels=channels, peak=0, sum=0, count=0, atFullScale=0,
    windowFrames=math.max(1, math.floor(rate * 0.4)), frames=0, windowSum=0, windows={},
    binCount=binCount, total=totalFrames or 0, bins=bins, frameIndex=0,
    fftSize=fftSize, hann=hann, fftBuf={}, fftFill=0, fftPower=fftPower, fftWindows=0 }
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
    local framePeak, monoSum = 0, 0
    for channel=1,s.channels do
      local sample=samples[frame*s.channels+channel]
      assert(type(sample)=='number' and sample==sample and math.abs(sample)~=math.huge, 'Invalid audio sample')
      local mag=math.abs(sample)
      if mag>framePeak then framePeak=mag end
      monoSum=monoSum+sample
      s.peak=math.max(s.peak,mag)
      s.sum=s.sum+sample*sample
      s.windowSum=s.windowSum+sample*sample
      s.count=s.count+1
      if mag>=1 then s.atFullScale=s.atFullScale+1 end
    end
    -- Feed the frequency view a mono sample.
    s.fftFill=s.fftFill+1
    s.fftBuf[s.fftFill]=monoSum/s.channels
    if s.fftFill==s.fftSize then process_window(s); s.fftFill=0 end
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
  -- Log-spaced relative tone curve for the frequency view / overlap.
  local spectrum
  if s.fftWindows>0 then
    local fLow=25
    local fHigh=math.min(s.rate*0.485,20000)
    local B=48
    local ratio=(fHigh/fLow)^(1/B)
    local half=math.floor(s.fftSize/2)
    spectrum={}
    for b=1,B do
      local flo=fLow*ratio^(b-1)
      local fhi=fLow*ratio^b
      local center=math.sqrt(flo*fhi)
      local k0=math.max(1, math.floor(flo*s.fftSize/s.rate)+1)
      local k1=math.min(half+1, math.floor(fhi*s.fftSize/s.rate)+1)
      local sum,cnt=0,0
      if k1>=k0 then
        for k=k0,k1 do sum=sum+s.fftPower[k]; cnt=cnt+1 end
      else
        local kn=math.max(1, math.min(half+1, math.floor(center*s.fftSize/s.rate)+1))
        sum=s.fftPower[kn]; cnt=1
      end
      local p=sum/cnt/s.fftWindows/(s.fftSize*s.fftSize)
      local d=p>0 and 10*math.log(p,10) or -120
      if d<-120 then d=-120 end
      spectrum[b]={ f=math.floor(center+0.5), db=math.floor(d*10+0.5)/10 }
    end
  end
  return { samplePeakDbfs=peakDb, rmsDbfs=rmsDb, crestDb=peakDb and rmsDb and math.max(0,peakDb-rmsDb) or nil,
    activeVariationDb=#s.windows>=2 and percentile(0.9)-percentile(0.1) or nil,
    activeWindows=#s.windows, samplesAtFullScale=s.atFullScale, sampleCount=s.count,
    silent=s.peak==0, envelope=envelope, spectrum=spectrum }
end
return M
