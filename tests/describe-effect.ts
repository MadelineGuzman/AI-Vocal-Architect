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
assert.ok(plan && plan.title === 'Echo' && plan.knobs.length > 0, 'plan has a title and knob guidance');

console.log('describe-to-effect parser: intent matches, misses, and track naming tests passed.');
