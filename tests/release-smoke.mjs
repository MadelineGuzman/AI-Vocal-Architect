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
    globalThis: { crypto: { randomUUID: () => "test-analysis-id" } },
    console,
    Date,
    Math,
    Float32Array,
    Map,
    Object,
    Array,
    Number,
    String
  })
  vm.runInContext(read(relative), context, { filename: relative })
  return context.window
}

const recommendation = loadBrowserModule("public/app/recommendation-engine.js").CadenzaiRecommendation
assert.ok(recommendation)

for (const preset of recommendation.PRESET_OPTIONS) {
  for (const intensity of [1, 5, 10]) {
    const chain = recommendation.generateChain({ style: preset.label, daw: "REAPER", intensity })
    assert.equal(chain.intensity, intensity)
    assert.equal(Object.keys(chain.steps).length, 7)
    assert.ok(Number.isFinite(chain.compression.ratio))
    assert.ok(Number.isFinite(chain.compression.threshold))
    assert.ok(Number.isFinite(chain.fx.reverbMix))
    assert.match(recommendation.chainToText(chain, Object.keys(chain.steps)), /Cadenzai/)
  }
}

const analysis = loadBrowserModule("public/app/audio-analysis.js").CadenzaiAnalysis
assert.ok(analysis)

const sampleRate = 48000
const samples = new Float32Array(sampleRate)
for (let index = 0; index < samples.length; index++) samples[index] = Math.sin(2 * Math.PI * 220 * index / sampleRate) * 0.25
const buffer = {
  length: samples.length,
  duration: 1,
  sampleRate,
  numberOfChannels: 1,
  getChannelData: () => samples
}
const report = analysis.analyzeAudioBuffer(buffer, "smoke.wav")
assert.equal(report.analysisId, "test-analysis-id")
assert.equal(report.source.fileName, "smoke.wav")
assert.ok(report.qualityScore >= 0 && report.qualityScore <= 100)
assert.ok(Number.isFinite(report.measurements.peakDbfs))

const indexHtml = read("public/index.html")
for (const asset of ["./styles.css", "./assets/logo-mark.svg", "./app/state.js", "./app/recommendation-engine.js", "./app/audio-analysis.js", "./app/app.js"]) {
  assert.ok(indexHtml.includes(asset), `Missing asset reference: ${asset}`)
  assert.ok(fs.existsSync(path.join(root, "public", asset.replace(/^\.\//, ""))), `Missing asset file: ${asset}`)
}

const worker = read("worker.js")
assert.doesNotMatch(worker, /unsafe-inline/)
assert.match(worker, /run_worker_first|serveInternal/)

console.log("Cadenzai release smoke checks passed")
