import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAnalyzeHandler, createCursorHandler, createApplyEqHandler, createApplyFxHandler, createApplyAutomationHandler, createTransportHandler, createApplyChainHandler, readPendingRequest, writeAnalyzeRequest, writeEqRequest, readEqResult, writeFxRequest, readFxResult, writeAutomationRequest, readAutomationResult, writeChainRequest, readChainResult, sanitizeChainFx, sanitizeBands, PENDING_REQUEST_MS } from '../server/reaperRequest';
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

  // --- describe-to-effect: apply-fx request/result module round trip ---
  const fxFile = path.join(folder, 'fx-request.json');
  await writeFxRequest('fx-abc-123', '{TRK-1}', 'ReaDelay', 9000, fxFile);
  const fxRaw = JSON.parse(await readFile(fxFile, 'utf8')) as { kind: string; fx: string; trackId: string };
  assert.equal(fxRaw.kind, 'apply-effect');
  assert.equal(fxRaw.fx, 'ReaDelay');
  assert.equal(fxRaw.trackId, '{TRK-1}');
  await assert.rejects(() => writeFxRequest('fx-abc-123', '{TRK-1}', 'EvilPlugin', 1, fxFile), 'an effect outside the allow-list is never written');
  const fxResultFile = path.join(folder, 'fx-result.json');
  assert.equal(await readFxResult(fxResultFile), null, 'missing result reads as none');
  await writeFile(fxResultFile, JSON.stringify({ version: 1, kind: 'apply-effect-result', requestId: 'fx-abc-123', status: 'applied', message: 'ok', fxName: 'ReaDelay', trackName: 'Lead', updatedAt: 9000 }));
  assert.equal((await readFxResult(fxResultFile, 9000))?.fxName, 'ReaDelay');

  // --- POST /api/reaper/apply-fx via a real HTTP boundary ---
  let fxConn = 'connected';
  const fapp = express();
  let fport = 0;
  fapp.use((req, res, next) => localRequestOnly(fport)(req, res, next));
  fapp.use(express.json());
  fapp.post('/api/reaper/apply-fx', createApplyFxHandler({ readConnection: async () => ({ status: fxConn }), fxFile, now: () => 9000 }));
  const fserver = fapp.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => fserver.once('listening', resolve));
  fport = (fserver.address() as { port: number }).port;
  const furl = 'http://127.0.0.1:' + fport + '/api/reaper/apply-fx';
  const fhost = '127.0.0.1:' + fport;
  const fpost = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(furl, { method: 'POST', headers: { Host: fhost, Origin: 'http://' + fhost, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await fpost({ trackId: '{TRK}', fx: 'ReaComp' })).status, 200, 'a whitelisted effect is accepted');
    assert.equal((JSON.parse(await readFile(fxFile, 'utf8')) as { fx: string }).fx, 'ReaComp', 'the request file is written');
    assert.equal((await fpost({ trackId: '{TRK}', fx: 'EvilPlugin' })).status, 400, 'a non-whitelisted effect is rejected');
    assert.equal((await fpost({ trackId: 'bad!', fx: 'ReaComp' })).status, 400, 'an invalid track is rejected');
    fxConn = 'disconnected';
    assert.equal((await fpost({ trackId: '{TRK}', fx: 'ReaComp' })).status, 409, 'rejected when REAPER is not connected');
    fxConn = 'connected';
    assert.equal((await fpost({ trackId: '{TRK}', fx: 'ReaComp' }, { Origin: 'https://untrusted.example' })).status, 403, 'cross-origin rejected');
  } finally {
    await new Promise<void>((resolve, reject) => fserver.close(error => error ? reject(error) : resolve()));
  }
  console.log('REAPER apply-FX channel: effect allow-list, module round-trip, validation, disconnected and origin guards passed.');

  // --- time-selection automation: apply-automation request/result round trip ---
  const autoFile = path.join(folder, 'auto-request.json');
  await writeAutomationRequest('auto-abc-123', '{TRK-1}', 'volume-swell', 9500, autoFile);
  const autoRaw = JSON.parse(await readFile(autoFile, 'utf8')) as { kind: string; auto: string; trackId: string };
  assert.equal(autoRaw.kind, 'apply-automation');
  assert.equal(autoRaw.auto, 'volume-swell');
  assert.equal(autoRaw.trackId, '{TRK-1}');
  await assert.rejects(() => writeAutomationRequest('auto-abc-123', '{TRK-1}', 'delete-everything', 1, autoFile), 'an automation outside the allow-list is never written');
  const autoResultFile = path.join(folder, 'auto-result.json');
  assert.equal(await readAutomationResult(autoResultFile), null, 'missing result reads as none');
  await writeFile(autoResultFile, JSON.stringify({ version: 1, kind: 'apply-automation-result', requestId: 'auto-abc-123', status: 'applied', message: 'ok', trackName: 'Lead', updatedAt: 9500 }));
  assert.equal((await readAutomationResult(autoResultFile, 9500))?.status, 'applied');

  // --- POST /api/reaper/apply-automation via a real HTTP boundary ---
  let autoConn = 'connected';
  const aapp = express();
  let aport = 0;
  aapp.use((req, res, next) => localRequestOnly(aport)(req, res, next));
  aapp.use(express.json());
  aapp.post('/api/reaper/apply-automation', createApplyAutomationHandler({ readConnection: async () => ({ status: autoConn }), automationFile: autoFile, now: () => 9500 }));
  const aserver = aapp.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => aserver.once('listening', resolve));
  aport = (aserver.address() as { port: number }).port;
  const aurl = 'http://127.0.0.1:' + aport + '/api/reaper/apply-automation';
  const ahost = '127.0.0.1:' + aport;
  const apost = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(aurl, { method: 'POST', headers: { Host: ahost, Origin: 'http://' + ahost, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await apost({ trackId: '{TRK}', auto: 'volume-fade' })).status, 200, 'a whitelisted automation is accepted');
    assert.equal((JSON.parse(await readFile(autoFile, 'utf8')) as { auto: string }).auto, 'volume-fade', 'the request file is written');
    assert.equal((await apost({ trackId: '{TRK}', auto: 'nuke-it' })).status, 400, 'a non-whitelisted automation is rejected');
    assert.equal((await apost({ trackId: 'bad!', auto: 'volume-fade' })).status, 400, 'an invalid track is rejected');
    autoConn = 'disconnected';
    assert.equal((await apost({ trackId: '{TRK}', auto: 'volume-fade' })).status, 409, 'rejected when REAPER is not connected');
    autoConn = 'connected';
    assert.equal((await apost({ trackId: '{TRK}', auto: 'volume-fade' }, { Origin: 'https://untrusted.example' })).status, 403, 'cross-origin rejected');
  } finally {
    await new Promise<void>((resolve, reject) => aserver.close(error => error ? reject(error) : resolve()));
  }
  console.log('REAPER apply-automation channel: move allow-list, module round-trip, validation, disconnected and origin guards passed.');

  // --- POST /api/reaper/transport (fire-and-forget transport control) ---
  const transportFile = path.join(folder, 'transport.json');
  let transConn = 'connected';
  const tapp = express();
  let tport = 0;
  tapp.use((req, res, next) => localRequestOnly(tport)(req, res, next));
  tapp.use(express.json());
  tapp.post('/api/reaper/transport', createTransportHandler({ readConnection: async () => ({ status: transConn }), transportFile, now: () => 12000 }));
  const tserver = tapp.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => tserver.once('listening', resolve));
  tport = (tserver.address() as { port: number }).port;
  const turl = 'http://127.0.0.1:' + tport + '/api/reaper/transport';
  const thost = '127.0.0.1:' + tport;
  const tpost = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(turl, { method: 'POST', headers: { Host: thost, Origin: 'http://' + thost, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await tpost({ action: 'record' })).status, 200, 'a whitelisted transport action is accepted');
    const written = JSON.parse(await readFile(transportFile, 'utf8')) as { kind: string; action: string };
    assert.equal(written.kind, 'transport');
    assert.equal(written.action, 'record');
    assert.equal((await tpost({ action: 'play' })).status, 200, 'play is accepted');
    assert.equal((await tpost({ action: 'delete-take' })).status, 200, 'the reversible delete-take action is accepted');
    assert.equal((JSON.parse(await readFile(transportFile, 'utf8')) as { action: string }).action, 'delete-take');
    assert.equal((await tpost({ action: 'delete-everything' })).status, 400, 'a non-whitelisted action is rejected');
    assert.equal((await tpost({ action: 42 })).status, 400, 'a non-string action is rejected');
    transConn = 'disconnected';
    assert.equal((await tpost({ action: 'stop' })).status, 409, 'rejected when REAPER is not connected');
    transConn = 'connected';
    assert.equal((await tpost({ action: 'stop' }, { Origin: 'https://untrusted.example' })).status, 403, 'cross-origin rejected');
  } finally {
    await new Promise<void>((resolve, reject) => tserver.close(error => error ? reject(error) : resolve()));
  }
  console.log('REAPER transport channel: action allow-list, file write, validation, disconnected and origin guards passed.');

  // --- build-the-chain: apply-chain module + validation ---
  assert.deepEqual(sanitizeChainFx(['ReaComp', 'ReaDelay', 'ReaVerbate']), ['ReaComp', 'ReaDelay', 'ReaVerbate']);
  assert.equal(sanitizeChainFx(['ReaComp', 'EvilPlugin']), null, 'a non-whitelisted effect in the rack is rejected');
  assert.equal(sanitizeChainFx([]), null, 'an empty rack is rejected');
  const chainFile = path.join(folder, 'chain-request.json');
  await writeChainRequest('chain-abc-123', '{TRK-1}', { hpf: 80, bands: [{ f: 300, g: -2, q: 1 }], fx: ['ReaComp', 'ReaVerbate'], profile: 'Chopped & Screwed' }, 11000, chainFile);
  const chainRaw = JSON.parse(await readFile(chainFile, 'utf8')) as { kind: string; hpf: number; fx: string[]; profile: string };
  assert.equal(chainRaw.kind, 'apply-chain');
  assert.equal(chainRaw.hpf, 80);
  assert.deepEqual(chainRaw.fx, ['ReaComp', 'ReaVerbate']);
  assert.equal(chainRaw.profile, 'Chopped & Screwed');
  await assert.rejects(() => writeChainRequest('chain-abc-123', '{TRK-1}', { hpf: 80, bands: [{ f: 300, g: -2, q: 1 }], fx: ['Nope'], profile: 'x' }, 1, chainFile), 'a non-whitelisted rack is never written');
  const chainResultFile = path.join(folder, 'chain-result.json');
  assert.equal(await readChainResult(chainResultFile), null, 'missing result reads as none');
  await writeFile(chainResultFile, JSON.stringify({ version: 1, kind: 'apply-chain-result', requestId: 'chain-abc-123', status: 'applied', message: 'ok', trackName: 'Lead', bandCount: 3, fxCount: 3, updatedAt: 11000 }));
  assert.equal((await readChainResult(chainResultFile, 11000))?.fxCount, 3);

  // --- POST /api/reaper/apply-chain via a real HTTP boundary ---
  let chainConn = 'connected';
  const capp2 = express();
  let cport2 = 0;
  capp2.use((req, res, next) => localRequestOnly(cport2)(req, res, next));
  capp2.use(express.json());
  capp2.post('/api/reaper/apply-chain', createApplyChainHandler({ readConnection: async () => ({ status: chainConn }), chainFile, now: () => 11000 }));
  const cserver2 = capp2.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => cserver2.once('listening', resolve));
  cport2 = (cserver2.address() as { port: number }).port;
  const curl2 = 'http://127.0.0.1:' + cport2 + '/api/reaper/apply-chain';
  const chost2 = '127.0.0.1:' + cport2;
  const cpost2 = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(curl2, { method: 'POST', headers: { Host: chost2, Origin: 'http://' + chost2, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const good = { trackId: '{TRK}', hpf: 75, bands: [{ f: 320, g: -1.8, q: 1 }, { f: 3000, g: 1, q: 1 }], fx: ['ReaComp', 'ReaDelay', 'ReaVerbate'], profile: 'Chopped & Screwed' };
    assert.equal((await cpost2(good)).status, 200, 'a valid chain is accepted');
    assert.deepEqual((JSON.parse(await readFile(chainFile, 'utf8')) as { fx: string[] }).fx, ['ReaComp', 'ReaDelay', 'ReaVerbate']);
    assert.equal((await cpost2({ ...good, fx: ['ReaComp', 'EvilPlugin'] })).status, 400, 'a non-whitelisted rack is rejected');
    assert.equal((await cpost2({ ...good, bands: [] })).status, 400, 'empty bands rejected');
    assert.equal((await cpost2({ ...good, hpf: 9 })).status, 400, 'out-of-range high-pass rejected');
    assert.equal((await cpost2({ ...good, trackId: 'bad!' })).status, 400, 'invalid track rejected');
    chainConn = 'disconnected';
    assert.equal((await cpost2(good)).status, 409, 'rejected when REAPER is not connected');
    chainConn = 'connected';
    assert.equal((await cpost2(good, { Origin: 'https://untrusted.example' })).status, 403, 'cross-origin rejected');
  } finally {
    await new Promise<void>((resolve, reject) => cserver2.close(error => error ? reject(error) : resolve()));
  }
  console.log('REAPER build-the-chain channel: rack allow-list, module round-trip, validation, disconnected and origin guards passed.');
} finally {
  await rm(folder, { recursive: true, force: true });
}
