import { randomUUID } from 'node:crypto';

// Cadenzai collaboration relay (Layer 2), session logic. The relay is the shared
// hub a remote collaborator reaches; it holds per-session STATE (the engineer's
// published clips/transport) and a QUEUE of the artist's proposed commands. It
// NEVER touches REAPER and never executes anything: the engineer's own Cadenzai
// drains the queue and runs each command locally through the loopback-only bridge,
// where it is re-validated and the producer stays in control. Security here rests
// on: a long per-session token (the join secret), a fixed allow-list of command
// endpoints, and hard size/queue caps. Deploy target: a Cloudflare Durable Object
// (this logic ports directly); in-memory here for local proof + tests.

// Only these endpoints may ride the relay — the safe, bounded command surface. A
// malicious client or a compromised relay still cannot carry anything else, and
// the engineer's local server re-validates every one before it reaches REAPER.
export const RELAY_ENDPOINTS: ReadonlySet<string> = new Set([
  '/api/reaper/select-item',
  '/api/reaper/nudge-item',
  '/api/reaper/transport',
  '/api/reaper/cursor',
  '/api/reaper/apply-fx',
  '/api/reaper/apply-eq',
  '/api/reaper/apply-automation',
  '/api/reaper/apply-chain',
]);

export const MAX_COMMANDS = 200;
export const MAX_STATE_BYTES = 256 * 1024;
export const MAX_COMMAND_BYTES = 8 * 1024;
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // sessions idle longer than this are swept

export interface RelayCommand { id: string; endpoint: string; body: unknown; at: number }
interface Session { id: string; token: string; state: unknown; commands: RelayCommand[]; createdAt: number; lastSeen: number }

export function isAllowedEndpoint(x: unknown): x is string { return typeof x === 'string' && RELAY_ENDPOINTS.has(x); }
export function tooBig(value: unknown, max: number): boolean { try { return JSON.stringify(value ?? null).length > max; } catch { return true; } }

export type SetStateResult = 'ok' | 'unauthorized' | 'too-large';
export type PushResult = 'ok' | 'unauthorized' | 'bad-endpoint' | 'too-large';

export class RelayStore {
  private sessions = new Map<string, Session>();
  constructor(private now: () => number = Date.now, private gen: () => string = randomUUID) {}

  create(): { sessionId: string; token: string } {
    const sessionId = this.gen();
    // A long, high-entropy join secret.
    const token = (this.gen() + this.gen()).replace(/-/g, '');
    const t = this.now();
    this.sessions.set(sessionId, { id: sessionId, token, state: null, commands: [], createdAt: t, lastSeen: t });
    return { sessionId, token };
  }

  private auth(sessionId: string, token: string): Session | null {
    const s = this.sessions.get(sessionId);
    if (!s || !token || s.token !== token) return null;
    s.lastSeen = this.now();
    return s;
  }

  setState(sessionId: string, token: string, state: unknown): SetStateResult {
    const s = this.auth(sessionId, token);
    if (!s) return 'unauthorized';
    if (tooBig(state, MAX_STATE_BYTES)) return 'too-large';
    s.state = state;
    return 'ok';
  }

  getState(sessionId: string, token: string): { ok: true; state: unknown } | { ok: false } {
    const s = this.auth(sessionId, token);
    return s ? { ok: true, state: s.state } : { ok: false };
  }

  pushCommand(sessionId: string, token: string, endpoint: unknown, body: unknown): PushResult {
    const s = this.auth(sessionId, token);
    if (!s) return 'unauthorized';
    if (!isAllowedEndpoint(endpoint)) return 'bad-endpoint';
    if (tooBig(body, MAX_COMMAND_BYTES)) return 'too-large';
    s.commands.push({ id: this.gen(), endpoint, body, at: this.now() });
    if (s.commands.length > MAX_COMMANDS) s.commands.splice(0, s.commands.length - MAX_COMMANDS);
    return 'ok';
  }

  drainCommands(sessionId: string, token: string): { ok: true; commands: RelayCommand[] } | { ok: false } {
    const s = this.auth(sessionId, token);
    if (!s) return { ok: false };
    const commands = s.commands;
    s.commands = [];
    return { ok: true, commands };
  }

  revoke(sessionId: string, token: string): boolean {
    const s = this.auth(sessionId, token);
    if (!s) return false;
    this.sessions.delete(sessionId);
    return true;
  }

  // Drop idle sessions so the hub never leaks memory.
  sweep(): number {
    const cutoff = this.now() - SESSION_TTL_MS;
    let removed = 0;
    for (const [id, s] of this.sessions) if (s.lastSeen < cutoff) { this.sessions.delete(id); removed++; }
    return removed;
  }

  size(): number { return this.sessions.size; }
}
