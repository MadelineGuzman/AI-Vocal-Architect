import assert from 'node:assert/strict';
import { planEffect } from '../src/lib/describeEffect';

// Empty and unmatched descriptions produce no plan.
assert.equal(planEffect('', 'Vox'), null, 'empty description -> no plan');
assert.equal(planEffect('   ', 'Vox'), null, 'whitespace -> no plan');
assert.equal(planEffect('make me a sandwich', 'Vox'), null, 'unrelated description -> no plan');

// Each supported intent maps to the right stock effect.
assert.equal(planEffect('add an echo to this', 'Vox')?.fx, 'ReaDelay');
assert.equal(planEffect('a little delay here', 'Vox')?.fx, 'ReaDelay');
assert.equal(planEffect('give this some reverb', 'Vox')?.fx, 'ReaVerbate');
assert.equal(planEffect('make it sound bigger and more spacious', 'Vox')?.fx, 'ReaVerbate');
assert.equal(planEffect('glue this together', 'Vox')?.fx, 'ReaComp');
assert.equal(planEffect('tighten it up', 'Vox')?.fx, 'ReaComp');

// The plan names the target track so the UI can show what it affects.
const plan = planEffect('add an echo', 'Lead Vox');
assert.ok(plan && plan.what.includes('Lead Vox'), 'plan names the track');
assert.ok(plan && plan.title === 'Echo' && plan.knobs.length > 0, 'plain intent has a base title and knob guidance');

// A vibe in the description sharpens the title + knob targets to that style.
assert.equal(planEffect('slappy echo', 'Vox')?.style, 'slappy');
assert.equal(planEffect('slappy echo', 'Vox')?.title, 'Slappy echo');
assert.equal(planEffect('give it a big lush reverb', 'Vox')?.style, 'big');
assert.equal(planEffect('just a subtle reverb', 'Vox')?.style, 'subtle');
assert.equal(planEffect('hard compression', 'Vox')?.style, 'hard');
assert.equal(planEffect('gentle comp', 'Vox')?.style, 'gentle');
// A plain intent with no vibe keeps the base plan (no style).
assert.equal(planEffect('add some reverb', 'Vox')?.style, undefined);
// Vibe-specific knobs differ from the default knobs.
assert.notEqual(planEffect('slappy echo', 'Vox')?.knobs, planEffect('add an echo', 'Vox')?.knobs);

console.log('describe-to-effect parser: intent matches, misses, track naming, and vibe-specific styles tests passed.');
