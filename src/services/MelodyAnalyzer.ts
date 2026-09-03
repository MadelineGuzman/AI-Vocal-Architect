import { MelodyAnalysis, MelodyNote } from '../types';

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const TARGET_RATE = 16000;
const FRAME_SIZE = 1024;
const HOP_SECONDS = 0.02;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const downmix = (buffer: AudioBuffer) => {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < mono.length; index++) mono[index] += data[index] / buffer.numberOfChannels;
  }
  const factor = Math.max(1, Math.round(buffer.sampleRate / TARGET_RATE));
  if (factor === 1) return { samples: mono, sampleRate: buffer.sampleRate };
  const samples = new Float32Array(Math.floor(mono.length / factor));
  for (let index = 0; index < samples.length; index++) {
    let sum = 0;
    for (let offset = 0; offset < factor; offset++) sum += mono[index * factor + offset];
    samples[index] = sum / factor;
  }
  return { samples, sampleRate: buffer.sampleRate / factor };
};

const pitchForFrame = (samples: Float32Array, start: number, sampleRate: number) => {
  let rms = 0;
  for (let index = 0; index < FRAME_SIZE; index++) rms += samples[start + index] ** 2;
  rms = Math.sqrt(rms / FRAME_SIZE);
  if (rms < 0.01) return null;

  const minLag = Math.floor(sampleRate / 1000);
  const maxLag = Math.min(FRAME_SIZE - 2, Math.floor(sampleRate / 70));
  let bestLag = 0;
  let bestCorrelation = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let correlation = 0;
    let energyA = 0;
    let energyB = 0;
    const count = FRAME_SIZE - lag;
    for (let index = 0; index < count; index++) {
      const a = samples[start + index];
      const b = samples[start + index + lag];
      correlation += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    const normalized = correlation / Math.sqrt(energyA * energyB || 1);
    if (normalized > bestCorrelation) {
      bestCorrelation = normalized;
      bestLag = lag;
    }
  }
  if (bestCorrelation < 0.75 || !bestLag) return null;
  return 69 + 12 * Math.log2((sampleRate / bestLag) / 440);
};

const extractNotes = (buffer: AudioBuffer) => {
  const { samples, sampleRate } = downmix(buffer);
  const hop = Math.max(1, Math.round(sampleRate * HOP_SECONDS));
  const frames: Array<{ time: number; midi: number | null }> = [];
  for (let start = 0; start + FRAME_SIZE < samples.length; start += hop) {
    frames.push({ time: start / sampleRate, midi: pitchForFrame(samples, start, sampleRate) });
  }
  const voicedRatio = frames.filter(frame => frame.midi !== null).length / Math.max(1, frames.length);
  const notes: MelodyNote[] = [];
  let current: { start: number; midis: number[]; rounded: number } | null = null;
  const flush = (end: number) => {
    if (!current || end - current.start < 0.08) { current = null; return; }
    const midi = Math.round(median(current.midis));
    notes.push({ midi, pitchClass: PITCH_CLASSES[((midi % 12) + 12) % 12], startSec: Number(current.start.toFixed(3)), durSec: Number((end - current.start).toFixed(3)) });
    current = null;
  };
  frames.forEach(frame => {
    if (frame.midi === null) { flush(frame.time); return; }
    const rounded = Math.round(frame.midi);
    if (current?.rounded === rounded) current.midis.push(frame.midi);
    else { flush(frame.time); current = { start: frame.time, midis: [frame.midi], rounded }; }
  });
  if (frames.length) flush(frames[frames.length - 1].time + HOP_SECONDS);
  return { notes, voicedRatio };
};

const correlation = (histogram: number[], profile: number[], tonic: number) => {
  const rotated = profile.map((_, index) => profile[(index - tonic + 12) % 12]);
  const histMean = mean(histogram);
  const profileMean = mean(rotated);
  let numerator = 0;
  let aSquare = 0;
  let bSquare = 0;
  for (let index = 0; index < 12; index++) {
    const a = histogram[index] - histMean;
    const b = rotated[index] - profileMean;
    numerator += a * b;
    aSquare += a * a;
    bSquare += b * b;
  }
  return numerator / Math.sqrt(aSquare * bSquare || 1);
};

export const analyzeMelody = (buffer: AudioBuffer): MelodyAnalysis => {
  const { notes, voicedRatio } = extractNotes(buffer);
  const durationSeconds = Number(buffer.duration.toFixed(2));
  const distinct = new Set(notes.map(note => note.pitchClass)).size;
  const eligible = durationSeconds >= 3 && voicedRatio >= 0.2 && notes.length >= 3 && distinct >= 3;
  const histogram = new Array(12).fill(0);
  notes.forEach(note => { histogram[((note.midi % 12) + 12) % 12] += note.durSec; });
  const candidates = PITCH_CLASSES.flatMap((pitch, tonic) => [
    { value: `${pitch} major`, score: correlation(histogram, MAJOR_PROFILE, tonic) },
    { value: `${pitch} minor`, score: correlation(histogram, MINOR_PROFILE, tonic) },
  ]).sort((a, b) => b.score - a.score);
  const key = eligible ? { value: candidates[0].value, confidence: Number(clamp(candidates[0].score, 0, 1).toFixed(2)) } : { value: null, confidence: 0 };
  const intervals = notes.slice(1).map((note, index) => note.startSec - notes[index].startSec).filter(value => value >= 0.15 && value <= 2);
  const pulse = intervals.length >= 5 ? median(intervals) : 0;
  const regularity = pulse ? clamp(1 - mean(intervals.map(value => Math.abs(value - pulse))) / pulse, 0, 1) : 0;
  let bpm = pulse ? 60 / pulse : 0;
  while (bpm && bpm < 60) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  const tempo = eligible && regularity >= 0.85 ? { value: Math.round(bpm), confidence: Number((regularity * 0.75).toFixed(2)) } : { value: null, confidence: 0 };
  const range = notes.length ? Math.max(...notes.map(note => note.midi)) - Math.min(...notes.map(note => note.midi)) : 0;
  const density = notes.length / Math.max(1, durationSeconds);
  const limitations = ['A short clip can show traits, not confirm song structure.'];
  if (durationSeconds < 3) limitations.push('Record at least three seconds for a stronger read.');
  if (voicedRatio < 0.2) limitations.push('Little pitched singing was detected; hum a clearer melody.');
  let inference: MelodyAnalysis['read']['inference'] = 'inconclusive';
  if (eligible && range >= 8 && density >= 1.5) inference = 'chorus-like';
  else if (eligible && range <= 5) inference = 'verse-like';
  const evidence = eligible
    ? [`${notes.length} stable notes detected`, `${range}-semitone melodic range`, `${Math.round(voicedRatio * 100)}% pitched audio`]
    : ['Not enough stable pitched notes to classify the melodic shape.'];
  return {
    analyzerVersion: 'melody-dsp-0.2.0', durationSeconds, voicedRatio: Number(voicedRatio.toFixed(2)), key, tempo, notes,
    read: { inference, confidence: eligible ? Number(clamp((notes.length / 12) * voicedRatio, 0, 0.9).toFixed(2)) : 0, evidence, limitations },
  };
};

export const decodeAudio = async (blob: Blob) => {
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(await blob.arrayBuffer());
  } finally {
    await context.close();
  }
};
