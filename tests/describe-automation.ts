import assert from 'node:assert/strict';
import { planAutomation } from '../src/lib/describeAutomation';

// Empty and unmatched descriptions produce no plan.
assert.equal(planAutomation(''), null, 'empty -> no plan');
assert.equal(planAutomation('do something cool'), null, 'unrelated -> no plan');

// Swell-type intents.
assert.equal(planAutomation('swell into the end')?.kind, 'volume-swell');
assert.equal(planAutomation('build it up here')?.kind, 'volume-swell');
assert.equal(planAutomation('fade in')?.kind, 'volume-swell');
assert.equal(planAutomation('make it grow')?.kind, 'volume-swell');

// Fade-type intents.
assert.equal(planAutomation('fade out')?.kind, 'volume-fade');
assert.equal(planAutomation('fade the ending')?.kind, 'volume-fade');
assert.equal(planAutomation('let it taper off')?.kind, 'volume-fade');

const swell = planAutomation('swell');
assert.ok(swell && swell.title === 'Volume swell' && swell.what.length > 0, 'swell plan has title and description');

console.log('time-selection automation parser: swell/fade intents, misses tests passed.');
