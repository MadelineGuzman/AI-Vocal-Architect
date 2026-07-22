(function () {
"use strict";

// Hum-to-Spark melody analyzer. Pure and deterministic: takes a decoded audio
// buffer of a sung/hummed idea and returns an honest musical read — key, a note
// sequence, and a section-*trait* inference with evidence and limitations.
// It never fabricates certainty: sparse or silent input yields low confidence,
// not a confident verdict. Raw-audio persistence and the Spark record are the
// caller's job (state.js); this module only measures.

const MELODY_SCHEMA_VERSION = "0.1.0";
const MELODY_ANALYZER_VERSION = "melody-dsp-0.1.0";

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Krumhansl-Schmuckler tonal hierarchy profiles.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Analysis is done at ~16 kHz — ample for vocal f0 (< 1 kHz) and much cheaper.
const TARGET_RATE = 16000;
const FRAME_SIZE = 1024;
const HOP_SECONDS = 0.02;
const MIN_HZ = 70;
const MAX_HZ = 1000;
const YIN_THRESHOLD = 0.15;
const MIN_NOTE_SECONDS = 0.08;
const MIN_ANALYSIS_SECONDS = 3;
const MIN_VOICED_RATIO = 0.2;
const MIN_DISTINCT_PITCH_CLASSES = 3;

const round = (value, digits = 2) => Number(value.toFixed(digits));
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const mean = values => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const median = values => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function downmixMono(buffer) {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < mono.length; index++) mono[index] += data[index] / buffer.numberOfChannels;
  }
  return mono;
}

// Decimate with a short box average to suppress aliasing before downsampling.
function decimate(samples, factor) {
  if (factor <= 1) return samples;
  const length = Math.floor(samples.length / factor);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    let sum = 0;
    for (let offset = 0; offset < factor; offset++) sum += samples[index * factor + offset];
    output[index] = sum / factor;
  }
  return output;
}

function frameRms(samples, start, size) {
  let sum = 0;
  const end = Math.min(samples.length, start + size);
  for (let index = start; index < end; index++) sum += samples[index] ** 2;
  return Math.sqrt(sum / Math.max(1, end - start));
}

// YIN fundamental-frequency estimation for one frame. Returns 0 when unvoiced.
function yinPitch(samples, start, size, sampleRate) {
  const maxTau = Math.min(size - 1, Math.floor(sampleRate / MIN_HZ));
  const minTau = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const difference = new Float32Array(maxTau + 1);
  const comparisonLength = Math.min(size - maxTau, samples.length - start - maxTau);
  if (comparisonLength < 1) return 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let index = 0; index < comparisonLength; index++) {
      const delta = samples[start + index] - samples[start + index + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }
  const cumulative = new Float32Array(maxTau + 1);
  cumulative[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    runningSum += difference[tau];
    cumulative[tau] = runningSum > 0 ? difference[tau] * tau / runningSum : 1;
  }
  let chosen = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (cumulative[tau] < YIN_THRESHOLD) {
      while (tau + 1 <= maxTau && cumulative[tau + 1] < cumulative[tau]) tau++;
      chosen = tau;
      break;
    }
  }
  if (chosen === -1) return 0;
  // Parabolic interpolation around the chosen dip for sub-sample accuracy.
  const previous = chosen > minTau ? cumulative[chosen - 1] : cumulative[chosen];
  const next = chosen + 1 <= maxTau ? cumulative[chosen + 1] : cumulative[chosen];
  const denominator = 2 * (2 * cumulative[chosen] - previous - next);
  const shift = denominator !== 0 ? (next - previous) / denominator : 0;
  const period = chosen + clamp(shift, -1, 1);
  return period > 0 ? sampleRate / period : 0;
}

const freqToMidi = freq => 69 + 12 * Math.log2(freq / 440);

// Per-frame pitch track with a small median filter to reject octave jumps and jitter.
function trackPitch(samples, sampleRate) {
  const hop = Math.max(1, Math.round(sampleRate * HOP_SECONDS));
  const frames = [];
  let peakRms = 0;
  for (let start = 0; start + FRAME_SIZE <= samples.length; start += hop) {
    const rms = frameRms(samples, start, FRAME_SIZE);
    peakRms = Math.max(peakRms, rms);
    const freq = yinPitch(samples, start, FRAME_SIZE, sampleRate);
    frames.push({ time: start / sampleRate, freq, rms, midi: freq > 0 ? freqToMidi(freq) : null });
  }
  const voicingFloor = peakRms * 0.15;
  for (const frame of frames) if (frame.rms < voicingFloor) frame.midi = null;
  const smoothed = frames.map((frame, index) => {
    if (frame.midi === null) return frame;
    const window = [];
    for (let offset = -2; offset <= 2; offset++) {
      const neighbour = frames[index + offset];
      if (neighbour && neighbour.midi !== null) window.push(neighbour.midi);
    }
    return { ...frame, midi: window.length ? median(window) : frame.midi };
  });
  return { frames: smoothed, hop, voicedRatio: smoothed.filter(frame => frame.midi !== null).length / Math.max(1, smoothed.length) };
}

// Group consecutive frames of the same semitone into notes, dropping fragments.
function segmentNotes(frames) {
  const notes = [];
  let current = null;
  const flush = endTime => {
    if (!current) return;
    const duration = endTime - current.startSec;
    if (duration >= MIN_NOTE_SECONDS) {
      const midi = Math.round(median(current.midis));
      notes.push({ midi, pitchClass: PITCH_CLASSES[((midi % 12) + 12) % 12], startSec: round(current.startSec, 3), durSec: round(duration, 3) });
    }
    current = null;
  };
  for (const frame of frames) {
    if (frame.midi === null) { flush(frame.time); continue; }
    const semitone = Math.round(frame.midi);
    if (current && Math.abs(semitone - current.semitone) <= 0) current.midis.push(frame.midi);
    else { flush(frame.time); current = { semitone, startSec: frame.time, midis: [frame.midi] }; }
  }
  if (frames.length) flush(frames[frames.length - 1].time + HOP_SECONDS);
  // Merge immediately adjacent same-pitch notes split by a dropped frame.
  const merged = [];
  for (const note of notes) {
    const last = merged[merged.length - 1];
    if (last && last.midi === note.midi && note.startSec - (last.startSec + last.durSec) <= HOP_SECONDS * 2) {
      last.durSec = round(note.startSec + note.durSec - last.startSec, 3);
    } else merged.push({ ...note });
  }
  return merged;
}

function pitchClassHistogram(notes) {
  const histogram = new Array(12).fill(0);
  for (const note of notes) histogram[((note.midi % 12) + 12) % 12] += note.durSec;
  return histogram;
}

function correlate(histogram, profile, rotation) {
  const rotated = profile.map((_, index) => profile[(index - rotation + 12) % 12]);
  const histMean = mean(histogram);
  const profMean = mean(rotated);
  let numerator = 0;
  let histVar = 0;
  let profVar = 0;
  for (let index = 0; index < 12; index++) {
    const a = histogram[index] - histMean;
    const b = rotated[index] - profMean;
    numerator += a * b;
    histVar += a * a;
    profVar += b * b;
  }
  const denominator = Math.sqrt(histVar * profVar);
  return denominator > 0 ? numerator / denominator : 0;
}

function detectKey(notes, eligible) {
  const distinctPitchClasses = new Set(notes.map(note => ((note.midi % 12) + 12) % 12)).size;
  if (!eligible || notes.length < 3 || distinctPitchClasses < MIN_DISTINCT_PITCH_CLASSES) return { value: null, confidence: 0, method: "krumhansl-schmuckler" };
  const histogram = pitchClassHistogram(notes);
  const candidates = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    candidates.push({ label: `${PITCH_CLASSES[tonic]} major`, score: correlate(histogram, MAJOR_PROFILE, tonic) });
    candidates.push({ label: `${PITCH_CLASSES[tonic]} minor`, score: correlate(histogram, MINOR_PROFILE, tonic) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const [best, runnerUp] = candidates;
  // Confidence blends how decisively the best key wins with how much evidence exists.
  const margin = clamp((best.score - runnerUp.score) / 0.35, 0, 1);
  const evidence = clamp(notes.length / 8, 0, 1) * clamp(distinctPitchClasses / 5, 0, 1);
  return { value: best.label, confidence: round(clamp(best.score, 0, 1) * (0.4 + 0.6 * margin) * (0.5 + 0.5 * evidence)), method: "krumhansl-schmuckler" };
}

// Free hums rarely carry a reliable pulse; only report tempo when onsets are regular.
function estimateTempo(notes, eligible) {
  if (!eligible || notes.length < 6) return { value: null, confidence: 0, method: "note-onset-regularity" };
  const intervals = [];
  for (let index = 1; index < notes.length; index++) intervals.push(notes[index].startSec - notes[index - 1].startSec);
  const usable = intervals.filter(value => value >= 0.15 && value <= 2);
  if (usable.length < 5) return { value: null, confidence: 0, method: "note-onset-regularity" };
  const medianInterval = median(usable);
  if (medianInterval <= 0) return { value: null, confidence: 0, method: "note-onset-regularity" };
  const spread = mean(usable.map(value => Math.abs(value - medianInterval))) / medianInterval;
  const regularity = clamp(1 - spread, 0, 1);
  if (regularity < 0.85 || usable.some(value => Math.abs(value - medianInterval) / medianInterval > 0.2)) return { value: null, confidence: 0, method: "note-onset-regularity" };
  let bpm = 60 / medianInterval;
  while (bpm < 60) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return { value: Math.round(bpm), confidence: round(regularity * clamp(usable.length / 8, 0, 1) * 0.75), method: "note-onset-regularity" };
}

// Autocorrelation of the interval sequence: does a short motif repeat?
function repetitionScore(notes) {
  if (notes.length < 6) return { score: 0, motifLength: 0 };
  const intervals = [];
  for (let index = 1; index < notes.length; index++) intervals.push(notes[index].midi - notes[index - 1].midi);
  if (intervals.every(value => value === 0)) return { score: 0, motifLength: 0 };
  const length = intervals.length;
  let best = 0;
  let bestLag = 0;
  for (let lag = 2; lag <= Math.floor(length / 2); lag++) {
    let matches = 0;
    let compared = 0;
    for (let index = 0; index + lag < length; index++) {
      compared++;
      if (intervals[index] === intervals[index + lag]) matches++;
    }
    const ratio = compared ? matches / compared : 0;
    if (ratio > best) { best = ratio; bestLag = lag; }
  }
  return { score: round(best), motifLength: bestLag };
}

function contourStats(notes, durationSeconds) {
  const midis = notes.flatMap(note => Array.from({ length: Math.max(1, Math.round(note.durSec / HOP_SECONDS)) }, () => note.midi));
  const sortedMidis = [...midis].sort((a, b) => a - b);
  const low = sortedMidis[Math.floor((sortedMidis.length - 1) * 0.05)];
  const high = sortedMidis[Math.ceil((sortedMidis.length - 1) * 0.95)];
  const rangeSemitones = high - low;
  const avg = mean(midis);
  const registerPosition = high > low ? (avg - low) / (high - low) : 0.5;
  return {
    noteCount: notes.length,
    rangeSemitones,
    density: round(notes.length / Math.max(1, durationSeconds)),
    registerPosition: round(registerPosition),
    repetition: repetitionScore(notes)
  };
}

// Trait heuristic v0.1 — maps measurable contour features to honest trait language.
function inferTrait(stats, notes, durationSeconds, voicedRatio) {
  const limitations = ["A short clip can show traits, not confirm song structure."];
  if (durationSeconds < 3) limitations.push("Under three seconds of audio limits confidence.");
  if (voicedRatio < 0.2) limitations.push("Little pitched singing was detected; try humming a clear melody.");

  const distinctMidis = new Set(notes.map(note => note.midi)).size;
  if (durationSeconds < MIN_ANALYSIS_SECONDS || voicedRatio < MIN_VOICED_RATIO || notes.length < 3 || distinctMidis < 2 || stats.rangeSemitones <= 1) {
    return { inference: "inconclusive", confidence: 0, evidence: ["Not enough pitched notes to read a melodic shape."], limitations };
  }

  const signals = [];
  const rangeSignal = clamp((stats.rangeSemitones - 4) / 8, 0, 1);
  if (stats.rangeSemitones >= 8) signals.push(`Wide melodic range (${stats.rangeSemitones} semitones)`);
  else if (stats.rangeSemitones <= 3) signals.push(`Narrow, contained range (${stats.rangeSemitones} semitones)`);

  const registerSignal = clamp(stats.registerPosition, 0, 1);
  if (stats.registerPosition >= 0.6) signals.push("Sits high in the take's range");
  else if (stats.registerPosition <= 0.4) signals.push("Stays low/mid in the take's range");

  const repetitionSignal = clamp(stats.repetition.score, 0, 1);
  if (stats.repetition.score >= 0.5) signals.push(`A ${stats.repetition.motifLength}-note motif repeats`);

  const densitySignal = clamp((stats.density - 1.5) / 3, 0, 1);

  // Weighted vote toward "chorus-like"; 0.5 is neutral.
  const chorusScore = 0.28 * rangeSignal + 0.24 * registerSignal + 0.30 * repetitionSignal + 0.18 * densitySignal;
  const dataSufficiency = clamp(notes.length / 8, 0, 1) * clamp(durationSeconds / 5, 0, 1);

  // Realistic contour scores rarely exceed ~0.7, so map decisiveness against a
  // 0.25 span rather than the full range or a strong read reads as weak.
  let inference;
  let strength;
  if (chorusScore >= 0.55) { inference = "chorus-like"; strength = clamp((chorusScore - 0.5) / 0.25, 0, 1); }
  else if (chorusScore <= 0.4) { inference = "verse-like"; strength = clamp((0.5 - chorusScore) / 0.25, 0, 1); }
  else { inference = "inconclusive"; strength = 0.2; }

  const confidence = round(clamp(strength, 0, 1) * (0.35 + 0.65 * dataSufficiency));
  const evidence = signals.length ? signals : ["Melodic shape is present but not strongly typed either way."];
  return { inference, confidence, evidence, limitations };
}

function analyzeMelodyBuffer(buffer) {
  const durationSeconds = round(buffer.duration, 2);
  const mono = downmixMono(buffer);
  const factor = Math.max(1, Math.round(buffer.sampleRate / TARGET_RATE));
  const sampleRate = buffer.sampleRate / factor;
  const samples = decimate(mono, factor);
  const { frames, voicedRatio } = trackPitch(samples, sampleRate);
  const noteSequence = segmentNotes(frames);
  const stats = noteSequence.length ? contourStats(noteSequence, durationSeconds) : { noteCount: 0, rangeSemitones: 0, density: 0, registerPosition: 0.5, repetition: { score: 0, motifLength: 0 } };
  const distinctPitchClasses = new Set(noteSequence.map(note => note.pitchClass)).size;
  const eligible = durationSeconds >= MIN_ANALYSIS_SECONDS && voicedRatio >= MIN_VOICED_RATIO && stats.rangeSemitones > 1 && distinctPitchClasses >= MIN_DISTINCT_PITCH_CLASSES;
  const read = inferTrait(stats, noteSequence, durationSeconds, voicedRatio);

  return {
    schemaVersion: MELODY_SCHEMA_VERSION,
    analyzerVersion: MELODY_ANALYZER_VERSION,
    durationSeconds,
    voicedRatio: round(voicedRatio),
    musical: {
      key: detectKey(noteSequence, eligible),
      tempo: estimateTempo(noteSequence, eligible),
      noteSequence
    },
    stats,
    read
  };
}

async function decodeAudioBlob(blob, existingContext) {
  const context = existingContext || new (window.AudioContext || window.webkitAudioContext)();
  await context.resume();
  const bytes = await blob.arrayBuffer();
  const buffer = await context.decodeAudioData(bytes.slice(0));
  return { context, buffer };
}

window.CadenzaiMelody = { MELODY_SCHEMA_VERSION, MELODY_ANALYZER_VERSION, PITCH_CLASSES, analyzeMelodyBuffer, decodeAudioBlob };
})();
