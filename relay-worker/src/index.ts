import { DurableObject } from 'cloudflare:workers';

// Cadenzai collaboration relay — Cloudflare Worker + Durable Object version of
// the Node relay in relay/ (relay/sessions.ts + relay/server.ts). One Durable
// Object instance per session holds the engineer's published STATE and the
// artist's QUEUE of allow-listed commands. It never executes anything and never
// touches REAPER; the engineer's own Cadenzai drains the queue and runs each
// command locally through the loopback bridge, where it is re-validated. Security
// = a long per-session token (the join secret, gate on every op), a fixed command
// allow-list, size/queue caps, and idle-session expiry via a DO alarm.
//
// Keep RELAY_ENDPOINTS and the caps IN SYNC with relay/sessions.ts.

const RELAY_ENDPOINTS: ReadonlySet<string> = new Set([
  '/api/reaper/select-item',
  '/api/reaper/nudge-item',
  '/api/reaper/transport',
  '/api/reaper/cursor',
  '/api/reaper/apply-fx',
  '/api/reaper/apply-eq',
  '/api/reaper/apply-automation',
  '/api/reaper/apply-chain',
]);
const MAX_COMMANDS = 200;
const MAX_STATE_BYTES = 256 * 1024;
const MAX_COMMAND_BYTES = 8 * 1024;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // idle sessions expire after this

// ⚠️ SET THIS before production: the exact origin(s) Cadenzai is served from,
// e.g. 'http://localhost:3000' for local dev and your deployed Cadenzai URL.
// Do NOT ship '*'. The session token is the real gate, but a tight origin list
// is good defense in depth.
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  'http://localhost:3000',
]);

interface Env { RELAY: DurableObjectNamespace }
interface Command { id: string; endpoint: string; body: unknown; at: number }

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : ([...ALLOWED_ORIGINS][0] ?? '*');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'Content-Type, X-Relay-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
}
function json(data: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
}
function tooBig(value: unknown, max: number): boolean { try { return JSON.stringify(value ?? null).length > max; } catch { return true; } }

// --- Worker: routing, session creation, CORS. Forwards to the per-session DO. ---
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

    const parts = new URL(request.url).pathname.split('/').filter(Boolean); // ['relay','session',...]
    if (parts[0] !== 'relay' || parts[1] !== 'session') return json({ error: 'Not found' }, 404, origin);

    // POST /relay/session  → create a session (new id + long token).
    if (parts.length === 2 && request.method === 'POST') {
      const sessionId = crypto.randomUUID();
      const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
      const stub = env.RELAY.get(env.RELAY.idFromName(sessionId));
      await stub.fetch('https://do/init', { method: 'POST', headers: { 'X-Relay-Token': token } });
      return json({ sessionId, token }, 200, origin);
    }

    // /relay/session/:id/<op>  → forward to that session's Durable Object.
    const sessionId = parts[2];
    const op = parts[3];
    if (!sessionId || !op) return json({ error: 'Not found' }, 404, origin);

    const stub = env.RELAY.get(env.RELAY.idFromName(sessionId));
    const doRequest = new Request('https://do/' + op, {
      method: request.method,
      headers: { 'X-Relay-Token': request.headers.get('X-Relay-Token') || '', 'Content-Type': 'application/json' },
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
    });
    const res = await stub.fetch(doRequest);
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
  },
};

// --- Durable Object: one per session. Holds token, state, and the command queue. ---
export class RelaySession extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const op = new URL(request.url).pathname.slice(1); // init | state | command | commands | revoke
    const token = request.headers.get('X-Relay-Token') || '';
    const stored = await this.ctx.storage.get<string>('token');

    // First contact: store the token (once).
    if (op === 'init' && request.method === 'POST') {
      if (!stored) { await this.ctx.storage.put('token', token); await this.touch(); }
      return Response.json({ ok: true });
    }

    // The token is the gate on every other op.
    if (!stored || !token || token !== stored) return Response.json({ error: 'Unauthorized' }, { status: 403 });
    await this.touch();

    if (op === 'state' && request.method === 'PUT') {
      const { state } = await request.json<{ state?: unknown }>();
      if (tooBig(state, MAX_STATE_BYTES)) return Response.json({ error: 'State too large' }, { status: 413 });
      await this.ctx.storage.put('state', state ?? null);
      return Response.json({ ok: true });
    }
    if (op === 'state' && request.method === 'GET') {
      return Response.json({ state: (await this.ctx.storage.get('state')) ?? null });
    }
    if (op === 'command' && request.method === 'POST') {
      const { endpoint, body } = await request.json<{ endpoint?: unknown; body?: unknown }>();
      if (typeof endpoint !== 'string' || !RELAY_ENDPOINTS.has(endpoint)) return Response.json({ error: 'That command is not allowed over the relay.' }, { status: 400 });
      if (tooBig(body, MAX_COMMAND_BYTES)) return Response.json({ error: 'Command too large' }, { status: 413 });
      const commands = (await this.ctx.storage.get<Command[]>('commands')) ?? [];
      commands.push({ id: crypto.randomUUID(), endpoint, body, at: Date.now() });
      if (commands.length > MAX_COMMANDS) commands.splice(0, commands.length - MAX_COMMANDS);
      await this.ctx.storage.put('commands', commands);
      return Response.json({ ok: true });
    }
    if (op === 'commands' && request.method === 'GET') {
      const commands = (await this.ctx.storage.get<Command[]>('commands')) ?? [];
      await this.ctx.storage.put('commands', []);
      return Response.json({ commands });
    }
    if (op === 'revoke' && request.method === 'POST') {
      await this.ctx.storage.deleteAll();
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  // Reschedule expiry on every touch; the alarm wipes an idle session.
  private async touch(): Promise<void> { await this.ctx.storage.setAlarm(Date.now() + SESSION_TTL_MS); }
  async alarm(): Promise<void> { await this.ctx.storage.deleteAll(); }
}
