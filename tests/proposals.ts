import assert from 'node:assert/strict';
import { addProposal, removeProposal, sanitizeProposals, timeAgo, MAX_PROPOSALS, type Proposal } from '../src/lib/proposals';

const make = (id: string, over: Partial<Proposal> = {}): Proposal => ({
  id, label: 'Add slappy echo to Vox', from: 'Collaborator', trackName: 'Vox',
  endpoint: '/api/reaper/apply-fx', body: { trackId: '{T}', fx: 'ReaDelay' }, createdAt: 1000, ...over,
});

// addProposal puts newest first and caps the list.
let list: Proposal[] = [];
list = addProposal(list, make('a'));
list = addProposal(list, make('b'));
assert.equal(list[0].id, 'b', 'newest proposal is first');
assert.equal(list.length, 2);
let big: Proposal[] = [];
for (let i = 0; i < MAX_PROPOSALS + 10; i++) big = addProposal(big, make('x' + i));
assert.equal(big.length, MAX_PROPOSALS, 'the queue is capped');

// removeProposal drops exactly the approved/dismissed one.
assert.deepEqual(removeProposal(list, 'a').map(p => p.id), ['b']);
assert.deepEqual(removeProposal(list, 'nope').map(p => p.id), ['b', 'a'], 'removing a missing id is a no-op');

// sanitizeProposals keeps well-formed entries and rejects junk / unsafe endpoints.
const cleaned = sanitizeProposals([
  make('ok'),
  { id: 'bad-endpoint', label: 'x', from: 'c', trackName: 't', endpoint: 'https://evil.example/steal', createdAt: 1 },
  { nonsense: true },
  42,
  null,
]);
assert.equal(cleaned.length, 1, 'only the well-formed, same-origin-API proposal survives');
assert.equal(cleaned[0].id, 'ok');
assert.equal(sanitizeProposals('not an array').length, 0);
assert.equal(sanitizeProposals(JSON.parse('{"a":1}')).length, 0);

// timeAgo reads naturally.
assert.equal(timeAgo(1000, 1000), 'just now');
assert.equal(timeAgo(0, 120000), '2m ago');
assert.equal(timeAgo(0, 2 * 3600 * 1000), '2h ago');

console.log('Proposal queue (executable async intent): ordering, cap, removal, sanitize and time-ago tests passed.');
