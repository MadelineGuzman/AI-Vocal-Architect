import { open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Request, Response, NextFunction } from 'express';
import type { ReaperSnapshot, ReaperState } from '../src/types/reaper';

const MAX_BYTES = 128 * 1024;
const STALE_MS = 4000;
export function bridgePath() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'Cadenzai', 'reaper-bridge', 'state.json');
}
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
const string = (value: unknown, max = 1024): value is string => typeof value === 'string' && value.length <= max;
export function validateSnapshot(value: unknown, now = Date.now()): ReaperSnapshot {
  if (!record(value) || value.version !== 1 || !string(value.sessionId, 128) || !value.sessionId ||
      !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1 ||
      typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) || value.updatedAt <= 0 || value.updatedAt > now + 5000 ||
      !record(value.project) || !string(value.project.sessionId, 128) || !value.project.sessionId ||
      !string(value.project.name) || typeof value.project.saved !== 'boolean' ||
      !Array.isArray(value.tracks) || value.tracks.length > 512) throw new Error('Invalid bridge snapshot');
  const ids = new Set<string>();
  const tracks = value.tracks.map(track => {
    if (!record(track) || !string(track.id, 128) || !track.id || ids.has(track.id) || !string(track.name) ||
        !Number.isSafeInteger(track.number) || Number(track.number) < 0 || typeof track.isMaster !== 'boolean') {
      throw new Error('Invalid track');
    }
    ids.add(track.id);
    return { id: track.id, name: track.name, number: Number(track.number), isMaster: track.isMaster };
  });
  let transport: { playing: boolean; recording: boolean; looping: boolean } | undefined;
  if (value.transport !== undefined) {
    const t = value.transport;
    if (!record(t) || typeof t.playing !== 'boolean' || typeof t.recording !== 'boolean' || typeof t.looping !== 'boolean') throw new Error('Invalid transport');
    transport = { playing: t.playing, recording: t.recording, looping: t.looping };
  }
  // Explicit projection prevents unknown fields (including paths) escaping to the browser.
  return { version: 1, sessionId: value.sessionId, sequence: Number(value.sequence), updatedAt: value.updatedAt,
    revision: Number.isSafeInteger(value.revision) ? Number(value.revision) : undefined,
    project: { sessionId: value.project.sessionId, name: value.project.name, saved: value.project.saved }, tracks, transport };
}

export function createReaperReader(filename = bridgePath(), clock = Date.now) {
  let last: ReaperSnapshot | null = null;
  return async (): Promise<ReaperState> => {
    const now = clock();
    let failure: 'missing' | 'invalid' | null = null;
    try {
      const file = await open(filename, 'r');
      try {
        const buffer = Buffer.alloc(MAX_BYTES + 1);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_BYTES) throw new Error('Snapshot too large');
        const candidate = validateSnapshot(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')), now);
        if (last && candidate.sessionId === last.sessionId && candidate.sequence < last.sequence) throw new Error('Out-of-order snapshot');
        last = candidate;
      } finally { await file.close(); }
    } catch (error) {
      failure = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid';
    }
    // A short overlapping write is tolerated, but never refreshes the last snapshot's heartbeat.
    if (last && now - last.updatedAt <= STALE_MS) {
      return { status: 'connected', snapshot: last, message: 'Read-only connection' };
    }
    if (failure === 'invalid') return { status: 'error', snapshot: last, message: 'Bridge data unavailable. Restart the REAPER bridge.' };
    if (last) return { status: 'disconnected', snapshot: last, message: 'Connection lost — showing last known selection' };
    return { status: 'waiting', snapshot: null, message: 'Start the Cadenzai bridge in REAPER' };
  };
}

export function localRequestOnly(port: number) {
  const hosts = new Set(['localhost:' + port, '127.0.0.1:' + port, '[::1]:' + port]);
  const origins = new Set([...hosts].map(host => 'http://' + host));
  return (req: Request, res: Response, next: NextFunction) => {
    if (!hosts.has(req.headers.host || '') || (req.headers.origin && !origins.has(req.headers.origin)) ||
        req.headers['sec-fetch-site'] === 'cross-site') {
      res.status(403).json({ error: 'Local requests only' }); return;
    }
    next();
  };
}
