import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = relative => fs.readFileSync(path.join(root, relative), "utf8")

function loadBrowserModule(relative) {
  const context = vm.createContext({
    window: {},
    globalThis: {},
    console,
    Math,
    Float32Array,
    Array,
    Object,
    Number,
    String
  })
  vm.runInContext(read(relative), context, { filename: relative })
  return context.window
}

const melody = loadBrowserModule("public/app/melody-analysis.js").CadenzaiMelody
assert.ok(melody, "melody module should expose CadenzaiMelody")

const SR = 48000

// Build a fake decoded buffer from a list of {midi, seconds} notes rendered as sine tones.
function bufferFromNotes(notes, { gain = 0.3 } = {}) {
  const segments = notes.map(note => Math.round(note.seconds * SR))
  const total = segments.reduce((sum, value) => sum + value, 0)
  const samples = new Float32Array(total)
  let cursor = 0
  notes.forEach((note, index) => {
    const freq = note.midi === null ? 0 : 440 * Math.pow(2, (note.midi - 69) / 12)
    for (let i = 0; i < segments[index]; i++) {
      // Short fades avoid click transients that would fragment note segmentation.
      const t = i / SR
      const env = Math.min(1, i / (SR * 0.01), (segments[index] - i) / (SR * 0.01))
      samples[cursor++] = note.midi === null ? 0 : Math.sin(2 * Math.PI * freq * t) * gain * env
    }
  })
  return { length: samples.length, duration: total / SR, sampleRate: SR, numberOfChannels: 1, getChannelData: () => samples }
}

function silenceBuffer(seconds) {
  const samples = new Float32Array(Math.round(seconds * SR))
  return { length: samples.length, duration: seconds, sampleRate: SR, numberOfChannels: 1, getChannelData: () => samples }
}

// 1. Versioned, well-formed output.
{
  const report = melody.analyzeMelodyBuffer(silenceBuffer(2))
  assert.equal(report.analyzerVersion, "melody-dsp-0.1.0")
  assert.equal(report.schemaVersion, "0.1.0")
  assert.ok(report.musical && report.read, "report has musical + read sections")
}

// 2. Key detection on a clear C-major melody (tonic held longest → C major, tonic pitch class C).
{
  const cMajor = [
    { midi: 60, seconds: 0.6 }, { midi: 62, seconds: 0.3 }, { midi: 64, seconds: 0.4 },
    { midi: 65, seconds: 0.3 }, { midi: 67, seconds: 0.5 }, { midi: 64, seconds: 0.3 },
    { midi: 60, seconds: 0.7 }
  ]
  const report = melody.analyzeMelodyBuffer(bufferFromNotes(cMajor))
  assert.ok(report.musical.noteSequence.length >= 5, `expected several notes, got ${report.musical.noteSequence.length}`)
  assert.ok(report.musical.key.value, "a key should be detected")
  assert.ok(report.musical.key.value.startsWith("C"), `expected C tonic, got ${report.musical.key.value}`)
  assert.ok(report.musical.key.confidence > 0, "key confidence should be positive")
}

// 3. Wide, repeated, high melody reads as "chorus-like".
{
  const motif = [{ midi: 72, seconds: 0.3 }, { midi: 76, seconds: 0.3 }, { midi: 79, seconds: 0.4 }]
  const chorus = [...motif, ...motif, ...motif]
  const report = melody.analyzeMelodyBuffer(bufferFromNotes(chorus))
  assert.equal(report.read.inference, "chorus-like", `evidence: ${JSON.stringify(report.read)}`)
  assert.ok(report.read.confidence > 0.2, "chorus-like read should carry some confidence")
  assert.ok(report.read.evidence.length > 0, "read should include evidence")
}

// 4. A flat monotone drone must NOT produce a confident chorus verdict.
{
  const drone = [{ midi: 57, seconds: 3 }]
  const report = melody.analyzeMelodyBuffer(bufferFromNotes(drone))
  assert.notEqual(report.read.inference, "chorus-like", "a monotone should not read as chorus-like")
  assert.ok(report.read.confidence < 0.5, "a monotone should be low confidence")
}

// 5. Silence refuses to diagnose and always states a limitation.
{
  const report = melody.analyzeMelodyBuffer(silenceBuffer(3))
  assert.equal(report.musical.noteSequence.length, 0, "silence yields no notes")
  assert.equal(report.read.inference, "inconclusive")
  assert.equal(report.read.confidence, 0)
  assert.ok(report.read.limitations.length > 0, "silence must report limitations")
  assert.equal(report.musical.key.value, null, "no key from silence")
}

// 6. Rearticulated monotone input is still inconclusive and cannot invent key/tempo.
{
  const monotone = [
    { midi: 60, seconds: 0.4 }, { midi: null, seconds: 0.1 },
    { midi: 60, seconds: 0.4 }, { midi: null, seconds: 0.1 },
    { midi: 60, seconds: 0.4 }, { midi: null, seconds: 0.1 },
    { midi: 60, seconds: 0.4 }, { midi: null, seconds: 0.1 },
    { midi: 60, seconds: 0.4 }, { midi: null, seconds: 0.1 },
    { midi: 60, seconds: 0.5 }
  ]
  const report = melody.analyzeMelodyBuffer(bufferFromNotes(monotone))
  assert.equal(report.read.inference, "inconclusive")
  assert.equal(report.read.confidence, 0)
  assert.equal(report.musical.key.value, null)
  assert.equal(report.musical.tempo.value, null)
}

// 7. A pitched clip below the supported duration cannot receive a section verdict.
{
  const short = [{ midi: 60, seconds: 0.25 }, { midi: 64, seconds: 0.25 }, { midi: 67, seconds: 0.25 }]
  const report = melody.analyzeMelodyBuffer(bufferFromNotes(short))
  assert.equal(report.read.inference, "inconclusive")
  assert.equal(report.read.confidence, 0)
  assert.equal(report.musical.key.value, null)
  assert.equal(report.musical.tempo.value, null)
}

console.log("Cadenzai melody analysis checks passed")
