(function () {
"use strict";

const ANALYSIS_SCHEMA_VERSION = "0.1.0";
const ANALYZER_VERSION = "browser-dsp-0.1.0";

const db = value => value > 0 ? 20 * Math.log10(value) : -120;
const round = (value, digits = 1) => Number(value.toFixed(digits));
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function downmix(buffer) {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < mono.length; index++) mono[index] += data[index] / buffer.numberOfChannels;
  }
  return mono;
}

function percentile(values, amount) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * amount))];
}

function spectralBands(samples, sampleRate) {
  const frequencies = [100, 250, 500, 1000, 3000, 6000, 9000, 12000].filter(value => value < sampleRate * .45);
  const windowSize = Math.min(2048, samples.length);
  if (windowSize < 512) return null;
  const powers = Object.fromEntries(frequencies.map(value => [value, 0]));
  const windows = Math.min(12, Math.max(1, Math.floor(samples.length / windowSize)));

  for (let windowIndex = 0; windowIndex < windows; windowIndex++) {
    const start = Math.round(Math.max(0, samples.length - windowSize) * ((windowIndex + .5) / windows));
    for (const frequency of frequencies) {
      const omega = 2 * Math.PI * frequency / sampleRate;
      const coefficient = 2 * Math.cos(omega);
      let previous = 0;
      let previousTwo = 0;
      for (let index = 0; index < windowSize; index++) {
        const hann = .5 - .5 * Math.cos(2 * Math.PI * index / Math.max(1, windowSize - 1));
        const current = samples[start + index] * hann + coefficient * previous - previousTwo;
        previousTwo = previous;
        previous = current;
      }
      powers[frequency] += previousTwo ** 2 + previous ** 2 - coefficient * previous * previousTwo;
    }
  }
  const bands = {
    bass: powers[100] || 0,
    lowMid: (powers[250] || 0) + (powers[500] || 0),
    mid: (powers[1000] || 0) + (powers[3000] || 0),
    presence: powers[6000] || 0,
    high: (powers[9000] || 0) + (powers[12000] || 0)
  };
  const total = Object.values(bands).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(bands).map(([key, value]) => [key, round(value / total, 3)]));
}

const finding = (id, type, severity, confidence, summary, evidence) => ({ id, type, severity, confidence: round(confidence, 2), summary, evidence });

function analyzeAudioBuffer(buffer, fileName) {
  const samples = downmix(buffer);
  const frameSize = 1024;
  const frameValues = [];
  let peak = 0;
  let squares = 0;
  let clippedSamples = 0;
  let clippingEvents = 0;
  let clipping = false;

  for (const sample of samples) {
    const absolute = Math.abs(sample);
    peak = Math.max(peak, absolute);
    squares += sample ** 2;
    if (absolute >= .999) {
      clippedSamples++;
      if (!clipping) clippingEvents++;
      clipping = true;
    } else clipping = false;
  }
  for (let start = 0; start < samples.length; start += frameSize) {
    const end = Math.min(samples.length, start + frameSize);
    let sum = 0;
    for (let index = start; index < end; index++) sum += samples[index] ** 2;
    frameValues.push(Math.sqrt(sum / Math.max(1, end - start)));
  }

  const rms = Math.sqrt(squares / Math.max(1, samples.length));
  const peakDbfs = db(peak);
  const rmsDbfs = db(rms);
  const silenceThreshold = Math.pow(10, -50 / 20);
  const silenceRatio = frameValues.filter(value => value < silenceThreshold).length / Math.max(1, frameValues.length);
  const activeFrames = frameValues.filter(value => value >= silenceThreshold);
  const noiseFloorDbfs = db(percentile(activeFrames.length ? activeFrames : frameValues, .2));
  const bands = spectralBands(samples, buffer.sampleRate);
  const findings = [];
  const limitations = [];
  const tooQuiet = rmsDbfs < -50;
  const tooShort = buffer.duration < 1;

  if (tooShort) limitations.push("Audio shorter than one second limits diagnosis confidence.");
  if (tooQuiet) limitations.push("Signal level is too low for confident tonal findings.");
  if (buffer.numberOfChannels > 1) limitations.push("Channels were downmixed for analysis; channel-specific issues may be hidden.");
  if (clippingEvents) findings.push(finding("finding-clipping", "clipping", clippingEvents > 5 ? "severe" : "moderate", .98, `${clippingEvents} clipping event${clippingEvents === 1 ? "" : "s"} detected.`, { clippedSamples, clippingEvents }));
  else if (peakDbfs > -3) findings.push(finding("finding-headroom", "headroom", "minor", .96, `Peak level is ${peakDbfs.toFixed(1)} dBFS, leaving limited recording headroom.`, { peakDbfs: round(peakDbfs) }));
  if (!tooQuiet && !tooShort && bands?.lowMid > .42) findings.push(finding("finding-low-mid", "low_mid_buildup", "moderate", .76, "Low-mid energy is elevated relative to the analyzed vocal spectrum.", { share: bands.lowMid, rangeHz: [200, 600] }));
  if (!tooQuiet && !tooShort && bands?.presence > .24) findings.push(finding("finding-harshness", "harshness_candidate", "minor", .64, "Upper-presence energy may sound forward or harsh; confirm by ear.", { share: bands.presence, rangeHz: [4000, 7000] }));
  if (!tooQuiet && !tooShort && bands?.high > .18) findings.push(finding("finding-sibilance", "sibilance_candidate", "moderate", .67, "High-frequency energy suggests possible sibilance; confirm on consonant events.", { share: bands.high, rangeHz: [7000, 12000] }));
  if (!findings.length) findings.push(finding("finding-baseline", "baseline", "info", .82, "No high-priority recording defects were detected by the current analyzer.", {}));
  const penalty = Math.min(45, clippingEvents * 6) + (tooQuiet ? 25 : 0) + (tooShort ? 15 : 0) + findings.filter(item => item.severity === "moderate").length * 6;

  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    analyzerVersion: ANALYZER_VERSION,
    analysisId: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `analysis-${Date.now()}`,
    createdAt: new Date().toISOString(),
    source: { fileName, durationSeconds: round(buffer.duration, 2), sampleRateHz: buffer.sampleRate, channels: buffer.numberOfChannels },
    measurements: { peakDbfs: round(peakDbfs), rmsDbfs: round(rmsDbfs), crestFactorDb: round(peakDbfs - rmsDbfs), clippedSamples, clippingEvents, noiseFloorDbfs: round(noiseFloorDbfs), silenceRatio: round(silenceRatio, 3), spectralBands: bands },
    qualityScore: Math.round(clamp(100 - penalty, 0, 100)),
    findings,
    limitations
  };
}

async function decodeAudioFile(file, existingContext) {
  const context = existingContext || new (window.AudioContext || window.webkitAudioContext)();
  await context.resume();
  const bytes = await file.arrayBuffer();
  const buffer = await context.decodeAudioData(bytes.slice(0));
  return { context, bytes, buffer };
}

window.CadenzaiAnalysis = { ANALYSIS_SCHEMA_VERSION, ANALYZER_VERSION, analyzeAudioBuffer, decodeAudioFile };
})();
