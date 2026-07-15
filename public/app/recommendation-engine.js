(function () {
"use strict";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const interpolate = (intensity, low, mid, high) => intensity <= 5
  ? low + (mid - low) * ((intensity - 1) / 4)
  : mid + (high - mid) * ((intensity - 5) / 5);

const profile = (label, keywords, eq, comp, fx, rationale) => ({ label, keywords, eq, comp, fx, rationale });

const PRESETS = {
  cleanNatural: profile("Clean & Natural", ["clean", "natural", "controlled"],
    { hpf: 80, slope: "18 dB/oct", moves: [["Low-Mid Cleanup", 250, -1.5, 1.1], ["Presence", 3800, 1.8, .9], ["Air", 10000, 1.5, .7]], deEss: [6800, 2.2] },
    { ratio: 2, attack: 20, release: 110, reduction: 2.5, threshold: -16 },
    { reverb: "Very short plate", reverbMix: 10, decay: 1, delay: "Barely-there slap", delayMix: 10, delayTime: "1/16", pitch: "None", width: "Narrow-natural", saturation: 2 },
    ["Trim rumble and low-mid buildup without thinning the voice.", "Gentle control preserves natural phrase movement.", "Minimal ambience keeps the vocal realistic and close."]),
  aggressiveRap: profile("Aggressive Rap", ["aggressive", "rap", "punchy", "upfront"],
    { hpf: 100, slope: "24 dB/oct", moves: [["Mud Cut", 280, -3.5, 1.2], ["Presence", 4800, 3.5, .9], ["Air", 11000, 2, .7]], deEss: [7200, 3.8] },
    { ratio: 5, attack: 6, release: 70, reduction: 6.5, threshold: -22 },
    { reverb: "Short plate", reverbMix: 12, decay: 1.1, delay: "Tight stereo slap", delayMix: 13, delayTime: "1/8", pitch: "Optional subtle doubler", width: "Focused", saturation: 9 },
    ["Remove mud and push articulation through dense drums.", "Firm compression keeps the lead locked in front.", "Tight space adds edge without softening delivery."]),
  choppedScrewed: profile("Chopped & Screwed", ["chopped", "screwed", "slowed", "slow"],
    { hpf: 70, slope: "12 dB/oct", moves: [["Low-Mid Control", 320, -1.8, 1], ["Presence", 3000, 1, 1], ["Air", 9000, 1, .8]], deEss: [6100, 2] },
    { ratio: 3.5, attack: 24, release: 140, reduction: 4, threshold: -19 },
    { reverb: "Dark hall", reverbMix: 24, decay: 2.8, delay: "Heavy filtered echo", delayMix: 24, delayTime: "1/2", pitch: "-4 semitones blend", width: "Wide", saturation: 6 },
    ["Keep the vocal heavy while protecting articulation.", "Slower control preserves dragged movement.", "Dark ambience supports the warped atmosphere."]),
  autotuneVibe: profile("Autotune Vibe", ["autotune", "melodic", "tuned"],
    { hpf: 85, slope: "18 dB/oct", moves: [["Low-Mid Cleanup", 300, -2.2, 1.1], ["Presence", 5000, 2.8, .9], ["Air", 12000, 3.2, .7]], deEss: [7600, 3] },
    { ratio: 4, attack: 12, release: 85, reduction: 5, threshold: -20 },
    { reverb: "Bright plate", reverbMix: 18, decay: 1.7, delay: "Stereo ping-pong", delayMix: 20, delayTime: "1/8 dotted", pitch: "Tuned lead", width: "Wide stereo", saturation: 5 },
    ["Bright presence keeps tuned phrases glossy and clear.", "Balanced control connects melodic phrases.", "Delay and width support a modern lead."]),
  smoothRnB: profile("Smooth R&B", ["r&b", "smooth", "warm", "silky"],
    { hpf: 70, slope: "18 dB/oct", moves: [["Warmth", 280, 1.4, .9], ["Presence", 4000, 1.8, .9], ["Air", 11000, 3.2, .7]], deEss: [6900, 2.6] },
    { ratio: 3.5, attack: 20, release: 105, reduction: 4, threshold: -18 },
    { reverb: "Lush plate / hall", reverbMix: 22, decay: 2.1, delay: "Stereo dotted delay", delayMix: 18, delayTime: "1/4 dotted", pitch: "Optional subtle doubler", width: "Wide but smooth", saturation: 4 },
    ["Preserve warmth while adding polished air.", "Soft compression protects breath and phrasing.", "Lush ambience creates a premium intimate space."]),
  gospelChoir: profile("Gospel / Big Choir Lead", ["gospel", "church", "choir", "soulful"],
    { hpf: 90, slope: "18 dB/oct", moves: [["Low-Mid Cut", 300, -2, 1.1], ["Presence", 3500, 2.5, .9], ["Air", 10000, 2, .7]], deEss: [7000, 2.8] },
    { ratio: 3, attack: 18, release: 100, reduction: 4, threshold: -18 },
    { reverb: "Lush hall", reverbMix: 28, decay: 2.4, delay: "Dotted delay", delayMix: 16, delayTime: "1/4 dotted", pitch: "None", width: "Wide stereo", saturation: 4 },
    ["Keep power while clearing low-mid buildup.", "Moderate control preserves the natural swell.", "Hall depth places the lead in a larger room."]),
  lofiBedroom: profile("Lo-Fi / Bedroom Pop", ["lo-fi", "lofi", "bedroom", "cassette", "indie"],
    { hpf: 120, slope: "12 dB/oct", moves: [["Low-Mid Boost", 400, 1.5, 1.2], ["Presence Cut", 5000, -1.5, .9], ["Top Roll-Off", 8000, -2, .7]], deEss: [6500, 1.8] },
    { ratio: 2.5, attack: 30, release: 130, reduction: 3, threshold: -14 },
    { reverb: "Small room / spring", reverbMix: 18, decay: .9, delay: "Slapback", delayMix: 12, delayTime: "1/8", pitch: "Tape flutter", width: "Narrow stereo", saturation: 5 },
    ["Rolled highs and fuller mids create cassette warmth.", "Light control keeps the take human.", "Short room ambience avoids modern polish."]),
  drillTrap: profile("Drill / Dark Trap", ["drill", "dark trap", "sinister"],
    { hpf: 110, slope: "24 dB/oct", moves: [["Low-Mid Cut", 260, -4, 1.3], ["Presence", 5000, 3, .9], ["Air", 12000, 1.5, .7]], deEss: [7500, 4] },
    { ratio: 6, attack: 5, release: 60, reduction: 7, threshold: -24 },
    { reverb: "Dark short plate", reverbMix: 10, decay: .9, delay: "Ping-pong slap", delayMix: 14, delayTime: "1/8", pitch: "Optional octave-down layer", width: "Focused", saturation: 9 },
    ["Aggressive filtering and presence cut through dark 808s.", "Fast compression keeps the delivery punchy.", "Dry effects preserve tension and focus."])
};

const PRESET_OPTIONS = Object.entries(PRESETS).map(([key, value]) => ({ key, label: value.label }));

const PLUGIN_MAP = {
  "FL Studio": { cleanup: "Fruity Parametric EQ 2", eq: "Fruity Parametric EQ 2", compression: "Fruity Limiter", deesser: "Maximus", saturation: "Fruity Waveshaper", delay: "Fruity Delay 3", reverb: "Fruity Reeverb 2" },
  "Logic Pro": { cleanup: "Channel EQ", eq: "Channel EQ", compression: "Compressor", deesser: "DeEsser 2", saturation: "Phat FX", delay: "Stereo Delay", reverb: "ChromaVerb" },
  "Pro Tools": { cleanup: "EQ III", eq: "EQ III 7-Band", compression: "Dyn3 Compressor", deesser: "Dyn3 De-Esser", saturation: "Lo-Fi", delay: "Mod Delay III", reverb: "D-Verb" },
  "Ableton": { cleanup: "EQ Eight", eq: "EQ Eight", compression: "Compressor", deesser: "Multiband Dynamics", saturation: "Saturator", delay: "Echo", reverb: "Hybrid Reverb" },
  "REAPER": { cleanup: "ReaEQ", eq: "ReaEQ + ReaFIR", compression: "ReaComp", deesser: "ReaFIR (Dynamic)", saturation: "JS: LOSER/Saturation", delay: "ReaDelay", reverb: "ReaVerb / ReaVerbate" },
  "Other": { cleanup: "Stock parametric EQ", eq: "Parametric EQ", compression: "Digital compressor", deesser: "Dynamic EQ / de-esser", saturation: "Tape saturator", delay: "Stereo delay", reverb: "Plate reverb" }
};

function selectProfile(style = "") {
  const text = style.toLowerCase();
  return Object.values(PRESETS).find(item => item.keywords.some(keyword => text.includes(keyword))) || PRESETS.cleanNatural;
}

function generateChain({ style, daw, intensity = 5, analysis = null }) {
  const selected = selectProfile(style);
  const factor = intensity / 5;
  const eqMoves = selected.eq.moves.map(([label, frequency, gain, q]) => ({ label, frequency, gain: gain * factor, q }));
  const plugins = PLUGIN_MAP[daw] || PLUGIN_MAP.Other;
  const findings = new Map((analysis?.findings || []).map(item => [item.type, item]));
  const decisions = [];

  if (findings.has("low_mid_buildup")) {
    eqMoves[0].gain = Math.min(eqMoves[0].gain, -2.5);
    decisions.push({ stage: "eq", purpose: "corrective", becauseOf: [findings.get("low_mid_buildup").id], explanation: "Low-mid reduction strengthened from the recording analysis." });
  }
  let deEssAmount = selected.eq.deEss[1] * Math.max(.85, intensity / 6);
  if (findings.has("sibilance_candidate")) {
    deEssAmount = Math.max(3.5, deEssAmount);
    decisions.push({ stage: "deesser", purpose: "corrective", becauseOf: [findings.get("sibilance_candidate").id], explanation: "De-essing strengthened because the recording contains elevated high-frequency energy." });
  }
  if (findings.has("clipping")) decisions.push({ stage: "cleanup", purpose: "corrective", becauseOf: [findings.get("clipping").id], explanation: "Lower clip gain or re-record before processing; downstream plugins cannot restore clipped peaks." });
  decisions.push({ stage: "tone-and-space", purpose: analysis ? "hybrid" : "creative", becauseOf: [], explanation: "Tone, dynamics, and ambience follow the selected style, intent, and intensity." });

  const comp = {
    ratio: clamp(selected.comp.ratio * (.8 + intensity / 10), 2, 8),
    threshold: selected.comp.threshold - interpolate(intensity, 0, 3, 8),
    attack: clamp(selected.comp.attack - interpolate(intensity, 0, 2, 6), 2, 35),
    release: Math.round(clamp(selected.comp.release - interpolate(intensity, 0, 8, 20), 45, 180)),
    reduction: clamp(selected.comp.reduction * factor, 2, 10),
    makeup: interpolate(intensity, 1, 2.5, 4.5)
  };
  const wet = interpolate(intensity, 10, 20, 35);
  const fx = {
    reverbType: selected.fx.reverb,
    reverbMix: clamp(selected.fx.reverbMix * .45 + wet * .55, 10, 35),
    decay: selected.fx.decay + interpolate(intensity, 0, .3, 1),
    delayType: selected.fx.delay,
    delayMix: clamp(selected.fx.delayMix * .5 + wet * .5, 10, 35),
    delayTime: selected.fx.delayTime,
    pitch: selected.fx.pitch,
    width: selected.fx.width,
    saturation: clamp(selected.fx.saturation * factor, 0, 18)
  };

  const hpf = Math.round(selected.eq.hpf + interpolate(intensity, 0, 5, 15));
  const steps = {
    cleanup: { name: "Subtractive Cleanup", role: "Cleanup", required: true, certainty: "Technical", plugin: plugins.cleanup, alternative: "TDR SlickEQ / stock EQ", why: "Clear rumble and capture problems before downstream processors react.", listen: "The low end tightens without thinning the voice.", settings: [["High-pass", `${hpf} Hz · ${selected.eq.slope}`], ["Headroom", findings.has("clipping") ? "Reduce clip gain before processing" : "Maintain safe input headroom"]] },
    eq: { name: "Corrective & Tone EQ", role: "EQ", required: true, certainty: analysis ? "Measured" : "Technical", plugin: plugins.eq, alternative: "TDR Nova (free)", why: selected.rationale[0], listen: "Clarity improves without brittle presence or a hollow chest tone.", settings: [["High-pass", `${hpf} Hz · ${selected.eq.slope}`], ...eqMoves.map(move => [move.label, `${move.frequency} Hz · ${move.gain > 0 ? "+" : ""}${move.gain.toFixed(1)} dB · Q ${move.q}`])] },
    compression: { name: "Leveling Compression", role: "Comp", required: true, certainty: "Creative", plugin: plugins.compression, alternative: "TDR Kotelnikov / ReaComp", why: selected.rationale[1], listen: "Phrasing stays expressive with no audible pumping.", settings: [["Ratio", `${comp.ratio.toFixed(1)}:1`], ["Threshold", `${comp.threshold.toFixed(1)} dB`], ["Attack / release", `${comp.attack.toFixed(0)} ms / ${comp.release} ms`], ["Target reduction", `${comp.reduction.toFixed(1)} dB`]] },
    deesser: { name: "De-ess", role: "De-ess", required: false, certainty: findings.has("sibilance_candidate") ? "Measured" : "Technical", plugin: plugins.deesser, alternative: "TDR Nova dynamic band", why: "Control sibilance without removing intelligibility or creating a lisp.", listen: "S sounds soften while consonants remain natural.", settings: [["Band", `${(selected.eq.deEss[0] / 1000).toFixed(1)} kHz`], ["Target reduction", `${deEssAmount.toFixed(1)} dB`]] },
    saturation: { name: "Harmonic Saturation", role: "Sat", required: false, certainty: "Creative", plugin: plugins.saturation, alternative: "Melda MSaturator (free)", why: "Add density and low-level translation without relying on extra top-end EQ.", listen: "The vocal reads more easily without audible distortion.", settings: [["Drive", `${fx.saturation.toFixed(1)}%`], ["Mix", "Start near 20%"]] },
    delay: { name: "Delay Throws", role: "Delay", required: false, certainty: "Creative", plugin: plugins.delay, alternative: "Melda MDelay (free)", why: selected.rationale[2], listen: "Repeats support phrase endings without masking the next line.", settings: [["Type", fx.delayType], ["Time", fx.delayTime], ["Mix", `${fx.delayMix.toFixed(1)}%`]] },
    reverb: { name: "Reverb Space", role: "Reverb", required: true, certainty: "Creative", plugin: plugins.reverb, alternative: "OrilRiver / stock reverb", why: "Place the vocal in the song's emotional world while protecting intelligibility.", listen: "The voice has depth but remains clearly in front.", settings: [["Type", fx.reverbType], ["Decay", `${fx.decay.toFixed(1)} s`], ["Mix", `${fx.reverbMix.toFixed(1)}%`]] }
  };

  return {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    profile: selected.label,
    style,
    daw,
    intensity,
    eq: { hpf, slope: selected.eq.slope, moves: eqMoves, deEssFrequency: selected.eq.deEss[0], deEssAmount },
    compression: comp,
    fx,
    steps,
    decisions,
    analysisId: analysis?.analysisId || null
  };
}

function chainToText(chain, order) {
  return [`Cadenzai · Vocal Architect`, `Profile: ${chain.profile}`, `DAW: ${chain.daw}`, `Intensity: ${chain.intensity}/10`, "", ...order.flatMap((key, index) => {
    const step = chain.steps[key];
    return [`${index + 1}. ${step.name} · ${step.plugin}`, ...step.settings.map(([label, value]) => `   ${label}: ${value}`), `   Why: ${step.why}`, ""];
  })].join("\n").trim();
}

window.CadenzaiRecommendation = { PRESETS, PRESET_OPTIONS, PLUGIN_MAP, generateChain, chainToText };
})();
