import assert from 'node:assert/strict';
import express from 'express';
import { RelayStore, isAllowedEndpoint, MAX_COMMANDS } from '../relay/sessions';
import { createRelayApp } from '../relay/server';

// --- pure session logic ---
let n = 0;
const store = new RelayStore(() => 1000, () => 'id-' + (++n));
const { sessionId, token } = store.create();
assert.ok(sessionId && token, 'a session has an id and a token');

// Auth: the token is the gate.
assert.equal(store.getState(sessionId, 'wrong').ok, false, 'the wrong token is rejected');
assert.equal(store.setState('nope', token, {}), 'unauthorized', 'an unknown session is rejected');

// State round-trip + size cap.
assert.equal(store.setState(sessionId, token, { clips: [{ id: '{A}', name: 'Hook' }] }), 'ok');
const got = store.getState(sessionId, token);
assert.ok(got.ok && (got.state as { clips: unknown[] }).clips.length === 1, 'the published state round-trips');
assert.equal(store.setState(sessionId, token, { big: 'x'.repeat(300 * 1024) }), 'too-large', 'oversize state is rejected');

// Commands: endpoint allow-list + queue.
assert.ok(isAllowedEndpoint('/api/reaper/nudge-item') && !isAllowedEndpoint('/api/reaper/analyze'));
assert.equal(store.pushCommand(sessionId, token, '/etc/passwd', {}), 'bad-endpoint', 'a non-allow-listed endpoint is rejected');
assert.equal(store.pushCommand(sessionId, token, '/api/reaper/nudge-item', { itemId: '{A}', deltaSeconds: -0.05 }), 'ok');
assert.equal(store.pushCommand(sessionId, token, '/api/reaper/select-item', { itemId: '{A}' }), 'ok');
const drained = store.drainCommands(sessionId, token);
assert.ok(drained.ok && drained.commands.length === 2, 'the engineer drains both commands');
assert.ok(drained.ok && drained.commands[0].endpoint === '/api/reaper/nudge-item');
assert.ok(store.drainCommands(sessionId, token).ok && (store.drainCommands(sessionId, token) as { commands: unknown[] }).commands.length === 0, 'draining clears the queue');

// Queue cap.
for (let i = 0; i < MAX_COMMANDS + 20; i++) store.pushCommand(sessionId, token, '/api/reaper/transport', { action: 'play' });
const capped = store.drainCommands(sessionId, token);
assert.ok(capped.ok && capped.commands.length === MAX_COMMANDS, 'the command queue is capped');

// Revoke + sweep.
assert.equal(store.revoke(sessionId, token), true);
assert.equal(store.getState(sessionId, token).ok, false, 'a revoked session is gone');
const swTest = new RelayStore(() => 0, () => 'sw-' + (++n));
const sw = swTest.create();
assert.equal(swTest.size(), 1);
// now jumps far past the TTL on the next access via sweep
(swTest as unknown as { now: () => number }).now = () => 9 * 60 * 60 * 1000;
assert.equal(swTest.sweep(), 1, 'an idle session is swept');
assert.ok(sw.sessionId);

// --- HTTP round trip over a real boundary ---
const app = createRelayApp();
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const port = (server.address() as { port: number }).port;
const base = 'http://127.0.0.1:' + port + '/relay';
try {
  const created = await (await fetch(base + '/session', { method: 'POST' })).json() as { sessionId: string; token: string };
  assert.ok(created.sessionId && created.token && created.token.length >= 32, 'a real session gets a long, high-entropy token');
  const H = { 'Content-Type': 'application/json', 'X-Relay-Token': created.token };

  // No token → 403.
  assert.equal((await fetch(`${base}/session/${created.sessionId}/state`)).status, 403, 'state read without the token is refused');

  // Engineer publishes state; artist reads it.
  assert.equal((await fetch(`${base}/session/${created.sessionId}/state`, { method: 'PUT', headers: H, body: JSON.stringify({ state: { transport: { playing: true } } }) })).status, 200);
  const stateBack = await (await fetch(`${base}/session/${created.sessionId}/state`, { headers: { 'X-Relay-Token': created.token } })).json() as { state: { transport: { playing: boolean } } };
  assert.equal(stateBack.state.transport.playing, true, 'the artist sees the engineer’s published state');

  // Artist proposes a command; engineer drains it.
  assert.equal((await fetch(`${base}/session/${created.sessionId}/command`, { method: 'POST', headers: H, body: JSON.stringify({ endpoint: '/api/reaper/select-item', body: { itemId: '{IT-2}' } }) })).status, 200);
  assert.equal((await fetch(`${base}/session/${created.sessionId}/command`, { method: 'POST', headers: H, body: JSON.stringify({ endpoint: '/api/reaper/analyze', body: {} }) })).status, 400, 'a non-allow-listed command is refused');
  const cmds = await (await fetch(`${base}/session/${created.sessionId}/commands`, { headers: { 'X-Relay-Token': created.token } })).json() as { commands: { endpoint: string; body: { itemId: string } }[] };
  assert.equal(cmds.commands.length, 1);
  assert.equal(cmds.commands[0].endpoint, '/api/reaper/select-item');
  assert.equal(cmds.commands[0].body.itemId, '{IT-2}');
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
console.log('Cadenzai relay: sessions, token auth, state sync, allow-listed command queue, caps, revoke/sweep and HTTP round-trip tests passed.');
