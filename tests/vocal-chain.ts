import assert from 'node:assert/strict';
import { selectProfile, generateChain, chainToText, PRESETS, PRESET_OPTIONS, CHAIN_ORDER } from '../src/lib/vocalChain';

// All 8 preset families ported.
assert.equal(PRESET_OPTIONS.length, 8, 'all preset families present');
assert.ok(PRESETS.choppedScrewed && PRESETS.choppedScrewed.label === 'Chopped & Screwed');

// Free-text vibe -> the right preset, by keyword.
assert.equal(selectProfile('make the chorus chopped and screwed').label, 'Chopped & Screwed');
assert.equal(selectProfile('give it that smooth r&b feel').label, 'Smooth R&B');
assert.equal(selectProfile('aggressive rap upfront').label, 'Aggressive Rap');
assert.equal(selectProfile('lo-fi bedroom cassette').label, 'Lo-Fi / Bedroom Pop');
assert.equal(selectProfile('totally unrelated words').label, 'Clean & Natural', 'unknown vibe falls back to Clean & Natural');

// generateChain builds the full DAW-aware chain.
const chain = generateChain({ style: 'chopped and screwed', daw: 'REAPER', intensity: 5 });
assert.equal(chain.profile, 'Chopped & Screwed');
assert.deepEqual(Object.keys(chain.steps).sort(), [...CHAIN_ORDER].sort(), 'every chain step is present');
assert.equal(chain.steps.reverb.plugin, 'ReaVerb / ReaVerbate', 'REAPER plugin names are used');
assert.ok(chain.steps.reverb.settings.some(([k, v]) => k === 'Type' && v === 'Dark hall'), 'chopped & screwed reverb is a dark hall');
assert.ok(typeof chain.eq.hpf === 'number' && chain.eq.hpf > 0);

// DAW selection changes the plugin names.
assert.equal(generateChain({ style: 'smooth r&b', daw: 'Pro Tools', intensity: 5 }).steps.compression.plugin, 'Dyn3 Compressor');

// Intensity scales the processing (more reduction, wetter) at higher settings.
const soft = generateChain({ style: 'aggressive rap', daw: 'REAPER', intensity: 2 });
const hard = generateChain({ style: 'aggressive rap', daw: 'REAPER', intensity: 9 });
assert.ok(hard.compression.reduction > soft.compression.reduction, 'higher intensity compresses more');
assert.ok(hard.fx.reverbMix >= soft.fx.reverbMix, 'higher intensity is no drier');

// Text export reads cleanly.
const text = chainToText(chain);
assert.ok(text.includes('Chopped & Screwed') && text.includes('Reverb Space'), 'text export names the profile and steps');

console.log('Vocal Architect port: presets, keyword matching, DAW-aware chain, intensity scaling and text export tests passed.');
