import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAnalyzeHandler, createCursorHandler, createApplyEqHandler, readPendingRequest, writeAnalyzeRequest, writeEqRequest, readEqResult, sanitizeBands, PENDING_REQUEST_MS } from '../server/reaperRequest';
import { localRequestOnly } from '../server/reaper';

const folder = await mkdtemp(path.join(os.tmpdir(), 'cadenzai-request-test-'));
const requestFile = path.join(folder, 'request.json');
try {
  // --- request-file module round trip and validation ---
  assert.equal(await readPendingRequest(requestFile), null, 'missing request reads as none');
  await writeAnalyzeRequest('abc-123', 5000, requestFile);
  const pending = await readPendingRequest(requestFile);
  assert.equal(pending?.requestId, 'abc-123');
  assert.equal(pending?.requestedAt, 5000);
  await writeFile(requestFile, JSON.stringify({ version: 1, kind: 'other', requestId: 'x', requestedAt: 1 }));
  assert.equal(await readPendingRequest(requestFile), null, 'only the analyze-selection command is accepted');
  await writeFile(requestFile, JSON.stringify({ version: 1, kind: 'analyze-selection', requestId: 'bad id!', requestedAt: 1 }));
  assert.equal(await readPendingRequest(requestFile), null, 'malformed id charset is rejected');
  await writeFile(requestFile, 'x'.repeat(5000));
  assert.equal(await readPendingRequest(requestFile), null, 'oversize request is rejected');
  await assert.rejects(() => writeAnalyzeRequest('bad id!', 1, requestFile), 'the server never writes a malformed id');
  await rm(requestFile, { force: true });

  // --- POST /api/reaper/analyze via a real HTTP boundary ---
  let connectionStatus = 'connected';
  let levelsStatus: string | null = null;
  let clock = 100000;
  const app = express();
  let port = 0;
  app.use((req, res, next) => localRequestOnly(port)(req, res, next));
  app.post('/api/reaper/analyze', createAnalyzeHandler({
    readConnection: async () => ({ status: connectionStatus }),
    readLevels: async () => ({ levels: levelsStatus ? { status: levelsStatus } : null }),
    requestFile,
    now: () => clock,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  port = (server.address() as { port: number }).port;
  const url = 'http://127.0.0.1:' + port + '/api/reaper/analyze';
  const host = '127.0.0.1:' + port;
  const post = (headers: Record<string, string> = {}) =>
    fetch(url, { method: 'POST', headers: { Host: host, Origin: 'http://' + host, ...headers } });
  try {
    connectionStatus = 'disconnected';
    assert.equal((await post()).status, 409, 'rejects when REAPER is not connected');

    connectionStatus = 'connected';
    const first = await post();
    assert.equal(first.status, 200, 'accepts when connected and idle');
    const body = await first.json() as { requestId: string };
    assert.match(body.requestId, /^[A-Za-z0-9-]+$/);
    assert.equal((await readPendingRequest(requestFile))?.requestId, body.requestId, 'request file is written');

    assert.equal((await post()).status, 409, 'rejects a duplicate while a request is pending');

    clock += PENDING_REQUEST_MS + 1;
    assert.equal((await post()).status, 200, 'a stale pending request no longer blocks a new one');

    await rm(requestFile, { force: true });
    clock += PENDING_REQUEST_MS + 1;
    levelsStatus = 'running';
    assert.equal((await post()).status, 409, 'rejects while an analysis is already running');
    levelsStatus = null;

    assert.equal((await post({ Origin: 'https://untrusted.example' })).status, 403, 'rejects cross-origin requests');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  console.log('REAPER analyze request channel: module round-trip, concurrency/pending guards, stale expiry and origin rejection tests passed.');

  // --- POST /api/reaper/cursor (navigation only) ---
  const cursorFile = path.join(folder, 'cursor.json');
  let cursorConn = 'connected';
  const capp = express();
  let cport = 0;
  capp.use((req, res, next) => localRequestOnly(cport)(req, res, next));
  capp.use(express.json());
  capp.post('/api/reaper/cursor', createCursorHandler({ readConnection: async () => ({ status: cursorConn }), cursorFile, now: () => 555 }));
  const cserver = capp.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => cserver.once('listening', resolve));
  cport = (cserver.address() as { port: number }).port;
  const curl = 'http://127.0.0.1:' + cport + '/api/reaper/cursor';
  const chost = '127.0.0.1:' + cport;
  const cpost = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(curl, { method: 'POST', headers: { Host: chost, Origin: 'http://' + chost, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await cpost({ timeSeconds: 12.5 })).status, 200, 'valid cursor move accepted');
    const written = JSON.parse(await readFile(cursorFile, 'utf8')) as { kind: string; timeSeconds: number };
    assert.equal(written.kind, 'move-cursor');
    assert.equal(written.timeSeconds, 12.5);
    assert.equal((await cpost({ timeSeconds: -5 })).status, 400, 'negative time rejected');
    assert.equal((await cpost({ timeSeconds: 'x' })).status, 400, 'non-numeric time rejected');
    cursorConn = 'disconnected';
    assert.equal((await cpost({ timeSeconds: 1 })).status, 409, 'rejected when REAPER is not connected');
    cursorConn = 'connected';
    assert.equal((await cpost({ timeSeconds: 1 }, { Origin: 'https://untrusted.example' })).status, 403, 'cross-origin rejected');
  } finally {
    await new Promise<void>((resolve, reject) => cserver.close(error => error ? reject(error) : resolve()));
  }
  console.log('REAPER cursor move: valid/invalid time, disconnected and origin guards passed.');

  // --- draw-to-EQ (Gate 2): band sanitize + request/result module round trip ---
  assert.equal(sanitizeBands([]), null, 'empty band set rejected');
  assert.equal(sanitizeBands([{ f: 300, g: -4, q: 1.2 }])?.length, 1, 'a valid band is accepted');
  assert.equal(sanitizeBands([{ f: 5, g: 0, q: 1 }]), null, 'frequency below range rejected');
  assert.equal(sanitizeBands([{ f: 300, g: 99, q: 1 }]), null, 'gain above range rejected');
  assert.equal(sanitizeBands([{ f: 300, g: 0, q: 50 }]), null, 'Q above range rejected');
  assert.equal(sanitizeBands(new Array(17).fill({ f: 300, g: 0, q: 1 })), null, 'too many bands rejected');
  const eqFile = path.join(folder, 'eq-request.json');
  await writeEqRequest('eq-abc-123', '{TRK-1}', [{ f: 300, g: -4, q: 1.2 }], 7000, eqFile);
  const eqRaw = JSON.parse(await readFile(eqFile, 'utf8')) as { kind: string; trackId: string; bands: { g: number }[] };
  assert.equal(eqRaw.kind, 'apply-eq');
  assert.equal(eqRaw.trackId, '{TRK-1}');
  assert.equal(eqRaw.bands[0].g, -4);
  await assert.rejects(() => writeEqRequest('eq-abc-123', 'bad id!', [{ f: 300, g: -4, q: 1.2 }], 1, eqFile), 'malformed track id is never written');
  const eqResultFile = path.join(folder, 'eq-result.json');
  assert.equal(await readEqResult(eqResultFile), null, 'missing result reads as none');
  await writeFile(eqResultFile, JSON.stringify({ version: 1, kind: 'apply-eq-result', requestId: 'eq-abc-123', status: 'applied', message: 'ok', trackName: 'Lead', bandCount: 1, updatedAt: 7000 }));
  assert.equal((await readEqResult(eqResultFile, 7000))?.status, 'applied');
  await writeFile(eqResultFile, JSON.stringify({ version: 1, kind: 'apply-eq-result', requestId: 'eq-abc-123', status: 'nope', message: 'x', trackName: 'y', bandCount: 1, updatedAt: 7000 }));
  assert.equal(await readEqResult(eqResultFile, 7000), null, 'an invalid status is rejected');

  // --- POST /api/reaper/apply-eq via a real HTTP boundary ---
  let eqConn = 'connected';
  const eapp = express();
  let eport = 0;
  eapp.use((req, res, next) => localRequestOnly(eport)(req, res, next));
  eapp.use(express.json());
  eapp.post('/api/reaper/apply-eq', createApplyEqHandler({ readConnection: async () => ({ status: eqConn }), eqFile, now: () => 8000 }));
  const eserver = eapp.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => eserver.once('listening', resolve));
  eport = (eserver.address() as { port: number }).port;
  const eurl = 'http://127.0.0.1:' + eport + '/api/reaper/apply-eq';
  const ehost = '127.0.0.1:' + eport;
  const epost = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(eurl, { method: 'POST', headers: { Host: ehost, Origin: 'http://' + ehost, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await epost({ trackId: '{TRK}', bands: [{ f: 300, g: -4, q: 1.2 }] })).status, 200, 'valid apply accepted');
    assert.equal((JSON.parse(await readFile(eqFile, 'utf8')) as { trackId: string }).trackId, '{TRK}', 'the request file is written');
    assert.equal((await epost({ trackId: 'bad!', bands: [{ f: 300, g: -4, q: 1.2 }] })).status, 400, 'invalid track rejected');
    assert.equal((await epost({ trackId: '{TRK}', bands: [] })).status, 400, 'empty bands rejected');
    assert.equal((await epost({ trackId: '{TRK}', bands: [{ f: 1, g: 0, q: 1 }] })).status, 400, 'out-of-range band rejected');
    eqConn = 'disconnected';
    assert.equal((await epost({ trackId: '{TRK}', bands: [{ f: 300, g: -4, q: 1.2 }] })).status, 409, 'rejected when REAPER is not connected');
    eqConn = 'connected';
    assert.equal((await epost({ trackId: '{TRK}', bands: [{ f: 300, g: -4, q: 1.2 }] }, { Origin: 'https://untrusted.example' })).status, 403, 'cross-origin rejected');
  } finally {
    await new Promise<void>((resolve, reject) => eserver.close(error => error ? reject(error) : resolve()));
  }
  console.log('REAPER apply-EQ channel: band sanitize, module round-trip, validation, disconnected and origin guards passed.');
} finally {
  await rm(folder, { recursive: true, force: true });
}
