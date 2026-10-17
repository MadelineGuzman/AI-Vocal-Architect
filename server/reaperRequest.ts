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
