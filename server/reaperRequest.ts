import { open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { bridgePath } from './reaper';

// The browser -> REAPER request channel. A single bounded file carries exactly
// one approved command ("analyze-selection") plus a correlation id. It never
// contains paths, Lua, shell, or project edits; REAPER acts only on the current
// in-REAPER selection and echoes the id back in levels.json.
const MAX_BYTES = 4096;
export const PENDING_REQUEST_MS = 8000;

export function requestPath() {
  return path.join(path.dirname(bridgePath()), 'request.json');
}

const object = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const isRequestId = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(x);

export interface PendingRequest { requestId: string; requestedAt: number; }

export function newRequestId(): string { return randomUUID(); }

export async function writeAnalyzeRequest(id: string, now = Date.now(), filename = requestPath()): Promise<PendingRequest> {
  if (!isRequestId(id)) throw new Error('Invalid request id');
  const body = JSON.stringify({ version: 1, kind: 'analyze-selection', requestId: id, requestedAt: now });
  await writeFile(filename, body, { encoding: 'utf8' });
  return { requestId: id, requestedAt: now };
}

export async function readPendingRequest(filename = requestPath()): Promise<PendingRequest | null> {
  try {
    const file = await open(filename, 'r');
    try {
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_BYTES) return null;
      const raw: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
      if (!object(raw) || raw.version !== 1 || raw.kind !== 'analyze-selection' || !isRequestId(raw.requestId) ||
          typeof raw.requestedAt !== 'number' || !Number.isFinite(raw.requestedAt)) return null;
      return { requestId: raw.requestId, requestedAt: raw.requestedAt };
    } finally { await file.close(); }
  } catch { return null; }
}

// Request handler for POST /api/reaper/analyze. Shared by the server and tests.
// Only effect on success is writing one request file for the running bridge.
export interface AnalyzeHandlerDeps {
  readConnection: () => Promise<{ status: string }>;
  readLevels: () => Promise<{ levels: { status: string } | null }>;
  requestFile?: string;
  now?: () => number;
}

export function createAnalyzeHandler(deps: AnalyzeHandlerDeps) {
  const requestFile = deps.requestFile ?? requestPath();
  const now = deps.now ?? Date.now;
  return async (_req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const at = now();
      const connection = await deps.readConnection();
      if (connection.status !== 'connected') {
        res.status(409).json({ error: 'REAPER is not connected. Start the Cadenzai bridge in REAPER, then try again.' });
        return;
      }
      const { levels } = await deps.readLevels();
      if (levels && levels.status === 'running') {
        res.status(409).json({ error: 'An analysis is already in progress. Wait for it to finish.' });
        return;
      }
      const pending = await readPendingRequest(requestFile);
      if (pending && at - pending.requestedAt >= 0 && at - pending.requestedAt < PENDING_REQUEST_MS) {
        res.status(409).json({ error: 'A request is already pending in REAPER. Wait a moment, then try again.' });
        return;
      }
      const requestId = newRequestId();
      await writeAnalyzeRequest(requestId, at, requestFile);
      res.json({ requestId });
    } catch {
      res.status(500).json({ error: 'The analysis request could not be sent. Check that REAPER and the bridge are running.' });
    }
  };
}

// Navigation only: ask the bridge to move REAPER's edit cursor to a time. This
// reads nothing and changes no audio, effects, routing, or project content — it
// is the producer clicking a spot, not Cadenzai editing anything.
export function cursorPath() {
  return path.join(path.dirname(bridgePath()), 'cursor.json');
}

export async function writeCursorRequest(timeSeconds: number, now = Date.now(), filename = cursorPath()): Promise<void> {
  if (!Number.isFinite(timeSeconds)) throw new Error('Invalid cursor time');
  const body = JSON.stringify({ version: 1, kind: 'move-cursor', timeSeconds, requestedAt: now });
  await writeFile(filename, body, { encoding: 'utf8' });
}

export function createCursorHandler(deps: { readConnection: () => Promise<{ status: string }>; cursorFile?: string; now?: () => number }) {
  const cursorFile = deps.cursorFile ?? cursorPath();
  const now = deps.now ?? Date.now;
  return async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const t = Number((req.body as { timeSeconds?: unknown } | undefined)?.timeSeconds);
      if (!Number.isFinite(t) || t < 0 || t > 1e7) { res.status(400).json({ error: 'Invalid cursor time.' }); return; }
      const connection = await deps.readConnection();
      if (connection.status !== 'connected') { res.status(409).json({ error: 'REAPER is not connected.' }); return; }
      await writeCursorRequest(t, now(), cursorFile);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'The move request could not be sent.' });
    }
  };
}

// --- Producer-directed EQ write-back (Gate 2) --------------------------------
// The one place Cadenzai changes the project, and only on an explicit click. The
// request carries the target track's GUID and a small set of bell bands
// (frequency / gain / Q) the producer drew — never paths, Lua, shell, or project
// structure. The running bridge adds a single, clearly named ReaEQ in one
// undoable step and echoes the outcome back in eq-result.json.
const isTrackId = (x: unknown): x is string => typeof x === 'string' && /^[{}0-9A-Za-z-]{1,64}$/.test(x);
const finiteIn = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;

export interface EqBand { f: number; g: number; q: number }

// Reject anything that is not a small, in-range set of bell bands. Returns a
// rounded copy on success, null on any malformed or out-of-range input.
export function sanitizeBands(x: unknown): EqBand[] | null {
  if (!Array.isArray(x) || x.length < 1 || x.length > 16) return null;
  const out: EqBand[] = [];
  for (const b of x) {
    if (!object(b)) return null;
    const f = Number((b as Record<string, unknown>).f), g = Number((b as Record<string, unknown>).g), q = Number((b as Record<string, unknown>).q);
    if (!finiteIn(f, 20, 24000) || !finiteIn(g, -36, 36) || !finiteIn(q, 0.1, 10)) return null;
    out.push({ f: Math.round(f * 100) / 100, g: Math.round(g * 100) / 100, q: Math.round(q * 1000) / 1000 });
  }
  return out;
}

export function eqRequestPath() { return path.join(path.dirname(bridgePath()), 'eq-request.json'); }
export function eqResultPath() { return path.join(path.dirname(bridgePath()), 'eq-result.json'); }

export async function writeEqRequest(id: string, trackId: string, bands: EqBand[], now = Date.now(), filename = eqRequestPath()): Promise<void> {
  if (!isRequestId(id)) throw new Error('Invalid request id');
  if (!isTrackId(trackId)) throw new Error('Invalid track id');
  if (!bands.length || bands.length > 16) throw new Error('Invalid band count');
  const body = JSON.stringify({ version: 1, kind: 'apply-eq', requestId: id, trackId, bands: bands.map(b => ({ f: b.f, g: b.g, q: b.q })), requestedAt: now });
  if (body.length > MAX_BYTES * 2) throw new Error('Request too large');
  await writeFile(filename, body, { encoding: 'utf8' });
}

export function createApplyEqHandler(deps: { readConnection: () => Promise<{ status: string }>; eqFile?: string; now?: () => number }) {
  const eqFile = deps.eqFile ?? eqRequestPath();
  const now = deps.now ?? Date.now;
  return async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const body = req.body as { trackId?: unknown; bands?: unknown } | undefined;
      const trackId = typeof body?.trackId === 'string' ? body.trackId : '';
      if (!isTrackId(trackId)) { res.status(400).json({ error: 'Invalid track.' }); return; }
      const bands = sanitizeBands(body?.bands);
      if (!bands) { res.status(400).json({ error: 'Invalid EQ bands.' }); return; }
      const connection = await deps.readConnection();
      if (connection.status !== 'connected') { res.status(409).json({ error: 'REAPER is not connected. Start the Cadenzai bridge, then try again.' }); return; }
      const requestId = newRequestId();
      await writeEqRequest(requestId, trackId, bands, now(), eqFile);
      res.json({ requestId });
    } catch {
      res.status(500).json({ error: 'The EQ could not be sent to REAPER.' });
    }
  };
}

export interface EqResult { requestId: string; status: 'applied' | 'error'; message: string; trackName: string; bandCount: number; updatedAt: number }

export async function readEqResult(filename = eqResultPath(), now = Date.now()): Promise<EqResult | null> {
  try {
    const file = await open(filename, 'r');
    try {
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_BYTES) return null;
      const raw: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
      if (!object(raw) || raw.version !== 1 || raw.kind !== 'apply-eq-result' || !isRequestId(raw.requestId) ||
          (raw.status !== 'applied' && raw.status !== 'error') || typeof raw.message !== 'string' || raw.message.length > 512 ||
          typeof raw.trackName !== 'string' || raw.trackName.length > 512 ||
          !finiteIn(raw.bandCount, 0, 64) || !finiteIn(raw.updatedAt, 1, now + 5000)) return null;
      return { requestId: raw.requestId, status: raw.status, message: raw.message, trackName: raw.trackName, bandCount: raw.bandCount, updatedAt: raw.updatedAt };
    } finally { await file.close(); }
  } catch { return null; }
}
