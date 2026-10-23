import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import express from 'express';
import { request } from 'node:http';
import { createReaperReader, localRequestOnly, validateSnapshot } from '../server/reaper';
import { validateLevelReport } from '../server/reaperLevels';

const folder = await mkdtemp(path.join(os.tmpdir(), 'cadenzai-reaper-test-'));
const filename = path.join(folder, 'state.json');
let now = 100000;
const reader = createReaperReader(filename, () => now);
const sample = { version: 1, sessionId: 'bridge-a', sequence: 1, updatedAt: now,
  project: { sessionId: 'project-a', name: 'Test song', saved: true },
  tracks: [{ id: '{A}', name: 'Vocal "lead" — Café', number: 1, isMaster: false }] };
try {
  assert.equal((await reader()).status, 'waiting');
  await writeFile(filename, JSON.stringify(sample));
  assert.equal((await reader()).status, 'connected');
  assert.equal((await reader()).snapshot?.tracks[0].name, sample.tracks[0].name);
  await writeFile(filename, '{');
  assert.equal((await reader()).status, 'connected', 'overlapping write should retain fresh data');
  now += 5000;
  assert.equal((await reader()).status, 'error', 'invalid writes must not extend heartbeat');
  await writeFile(filename, JSON.stringify(sample));
  assert.equal((await reader()).status, 'disconnected');
  const fresh = { ...sample, updatedAt: now, sequence: 2, tracks: [] };
  await writeFile(filename, JSON.stringify(fresh));
  assert.equal((await reader()).status, 'connected');
  assert.equal((await reader()).snapshot?.tracks.length, 0);
  assert.throws(() => validateSnapshot({ ...sample, version: 2 }, now));
  assert.throws(() => validateSnapshot({ ...sample, updatedAt: now+6000 }, now));
  assert.throws(() => validateSnapshot({ ...sample, tracks: [sample.tracks[0], sample.tracks[0]] }, now));
  assert.throws(() => validateSnapshot({ ...sample, tracks: [{ ...sample.tracks[0], name: {} }] }, now));
  assert.equal('privatePath' in validateSnapshot({ ...sample, privatePath: 'secret' }, now), false);
  assert.throws(() => validateSnapshot({ ...sample, transport: { playing: 'x', recording: false, looping: false } }, now), 'invalid transport rejected');
  assert.equal(validateSnapshot({ ...sample, transport: { playing: true, recording: false, looping: true } }, now).transport?.looping, true);
  assert.throws(() => validateSnapshot({ ...sample, clips: [{ id: '{A}', start: 0, len: 1, name: 'x', color: 'not-a-color' }] }, now), 'invalid clip colour rejected');
  assert.throws(() => validateSnapshot({ ...sample, clips: [{ id: '{A}', start: 0, len: -1, name: 'x', color: '#ff8000' }] }, now), 'negative clip length rejected');
  assert.equal(validateSnapshot({ ...sample, clips: [{ id: '{A}', start: 2.5, len: 1, name: 'Hook', color: '#ff8000' }] }, now).clips?.[0].name, 'Hook');
  now += 5000;
  await writeFile(filename, 'x'.repeat(131073));
  assert.equal((await reader()).status, 'error');
  await rm(filename);
  assert.equal((await reader()).status, 'disconnected');

  // Exercise the HTTP boundary, not just a mocked middleware call.
  const app = express();
  let port = 0;
  app.use((req, res, next) => localRequestOnly(port)(req, res, next));
  app.get('/api/reaper/state', async (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await reader()); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  port = (server.address() as { port: number }).port;
  const url = 'http://127.0.0.1:' + port + '/api/reaper/state';
  try {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).status, 'disconnected');
    assert.equal((await fetch(url, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const hostileHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(url, { headers: { Host: 'untrusted.example:' + port } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(hostileHost, 403);
    assert.equal((await fetch(url, { headers: { Origin: 'http://127.0.0.1:' + port } })).status, 200);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }

  const lua = spawnSync('lua', ['tests/reaper-bridge.lua'], { encoding: 'utf8' });
  if (lua.error && (lua.error as NodeJS.ErrnoException).code === 'ENOENT') {
    console.log('Lua runtime not installed: real Lua bridge tests skipped. Run with Lua before release.');
  } else {
    assert.equal(lua.status, 0, lua.stderr);
    const lines = lua.stdout.trim().split(/\r?\n/);
    const escaped = JSON.parse(lines[0]);
    assert.equal(escaped.tracks[0].name, 'Vocal "lead"\nBack\\line — Café');
    assert.ok(escaped.transport && typeof escaped.transport.looping === 'boolean', 'the Lua bridge publishes transport state');
    validateSnapshot(escaped, escaped.updatedAt);
    console.log(lines[1]);

    // The continuous bridge also performs the read-only analysis on request.
    const analyze = spawnSync('lua', ['tests/reaper-bridge-analyze.lua'], { encoding: 'utf8' });
    assert.equal(analyze.status, 0, analyze.stderr);
    const analyzeLines = analyze.stdout.trim().split(/\r?\n/);
    const report = validateLevelReport(JSON.parse(analyzeLines[0]), 1000000);
    assert.equal(report.status, 'ready');
    assert.equal(report.requestId, 'req-test-00000001');
    assert.ok(report.metrics?.samplePeakDbfs !== undefined, 'analysis produced metrics');
    console.log(analyzeLines[1]);

    // The continuous bridge also moves the edit cursor on a navigation request.
    const cursor = spawnSync('lua', ['tests/reaper-bridge-cursor.lua'], { encoding: 'utf8' });
    assert.equal(cursor.status, 0, cursor.stderr);
    console.log(cursor.stdout.trim());

    // The continuous bridge also applies a producer-directed EQ on request.
    const applyEq = spawnSync('lua', ['tests/reaper-bridge-apply-eq.lua'], { encoding: 'utf8' });
    assert.equal(applyEq.status, 0, applyEq.stderr);
    const applyLines = applyEq.stdout.trim().split(/\r?\n/);
    const eqResult = JSON.parse(applyLines[0]) as { status: string; requestId: string; bandCount: number };
    assert.equal(eqResult.status, 'applied');
    assert.equal(eqResult.requestId, 'eq-test-00000001');
    assert.equal(eqResult.bandCount, 2);
    console.log(applyLines[1]);

    // The continuous bridge also adds a producer-directed stock effect on request.
    const applyFx = spawnSync('lua', ['tests/reaper-bridge-apply-fx.lua'], { encoding: 'utf8' });
    assert.equal(applyFx.status, 0, applyFx.stderr);
    const fxLines = applyFx.stdout.trim().split(/\r?\n/);
    const fxResult = JSON.parse(fxLines[0]) as { status: string; requestId: string; fxName: string };
    assert.equal(fxResult.status, 'applied');
    assert.equal(fxResult.requestId, 'fx-test-00000001');
    assert.equal(fxResult.fxName, 'ReaDelay');
    console.log(fxLines[1]);

    // The continuous bridge also writes a producer-directed automation on request.
    const applyAuto = spawnSync('lua', ['tests/reaper-bridge-apply-automation.lua'], { encoding: 'utf8' });
    assert.equal(applyAuto.status, 0, applyAuto.stderr);
    const autoLines = applyAuto.stdout.trim().split(/\r?\n/);
    const autoResult = JSON.parse(autoLines[0]) as { status: string; requestId: string };
    assert.equal(autoResult.status, 'applied');
    assert.equal(autoResult.requestId, 'auto-test-00000001');
    console.log(autoLines[1]);

    // The continuous bridge also runs allow-listed transport actions on request.
    const transport = spawnSync('lua', ['tests/reaper-bridge-transport.lua'], { encoding: 'utf8' });
    assert.equal(transport.status, 0, transport.stderr);
    console.log(transport.stdout.trim());

    // The continuous bridge also builds a full vocal chain (EQ + FX rack) on request.
    const chain = spawnSync('lua', ['tests/reaper-bridge-apply-chain.lua'], { encoding: 'utf8' });
    assert.equal(chain.status, 0, chain.stderr);
    const chainLines = chain.stdout.trim().split(/\r?\n/);
    const chainResult = JSON.parse(chainLines[0]) as { status: string; requestId: string; bandCount: number; fxCount: number };
    assert.equal(chainResult.status, 'applied');
    assert.equal(chainResult.requestId, 'chain-test-00000001');
    assert.equal(chainResult.bandCount, 2);
    assert.equal(chainResult.fxCount, 2);
    console.log(chainLines[1]);

    // The continuous bridge also publishes the focused track's clips…
    const clipsRun = spawnSync('lua', ['tests/reaper-bridge-clips.lua'], { encoding: 'utf8' });
    assert.equal(clipsRun.status, 0, clipsRun.stderr);
    console.log(clipsRun.stdout.trim());

    // …and selects/highlights the clip the artist tapped (navigation only).
    const selectRun = spawnSync('lua', ['tests/reaper-bridge-select-item.lua'], { encoding: 'utf8' });
    assert.equal(selectRun.status, 0, selectRun.stderr);
    console.log(selectRun.stdout.trim());
  }
  console.log('REAPER snapshot, expiry, recovery, size, schema, Unicode and HTTP origin tests passed.');
} finally { await rm(folder, { recursive: true, force: true }); }
