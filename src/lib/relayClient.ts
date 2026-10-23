// Client for the Veia collaboration relay (relay-worker/, or the Node relay in
// relay/ for local dev — identical HTTP API). The relay is a dumb, secure hub:
// the engineer (host) publishes STATE and drains a QUEUE of the artist's
// allow-listed commands, which the engineer's own local bridge re-validates and
// runs. Nothing here touches REAPER; this module only moves JSON over HTTP.
//
// Security model lives on the relay (token gate, endpoint allow-list, caps).
// This client just carries the per-session token in the X-Relay-Token header.

export interface RelaySession {
  relayBase: string; // origin of the relay, e.g. https://relay.syzygyint.com
  sessionId: string;
  token: string; // the join secret — gate on every op
}

export interface RelayCommand {
  id: string;
  endpoint: string;
  body: unknown;
  at: number;
}

// Default relay origin. Overridable in the Host panel (localhost:3100 is the
// Node relay for dev; the Worker's custom domain is the shipped default).
export const DEFAULT_RELAY_BASE =
  typeof location !== 'undefined' && location.hostname === 'localhost'
    ? 'http://localhost:3100'
    : 'https://relay.syzygyint.com';

function trimBase(base: string): string {
  return base.replace(/\/+$/, '');
}

async function relayFetch(base: string, path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const { token, headers, ...rest } = init;
  return fetch(trimBase(base) + path, {
    ...rest,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Relay-Token': token } : {}),
      ...headers,
    },
  });
}

// Engineer: open a new session. Returns the id + token to share as a join code.
export async function createSession(relayBase: string): Promise<RelaySession> {
  const res = await relayFetch(relayBase, '/relay/session', { method: 'POST' });
  if (!res.ok) throw new Error('The relay could not open a session (' + res.status + ').');
  const { sessionId, token } = (await res.json()) as { sessionId?: string; token?: string };
  if (!sessionId || !token) throw new Error('The relay returned an unexpected response.');
  return { relayBase: trimBase(relayBase), sessionId, token };
}

// Engineer: publish the current local REAPER snapshot for the artist to see.
export async function publishState(s: RelaySession, state: unknown): Promise<void> {
  await relayFetch(s.relayBase, `/relay/session/${s.sessionId}/state`, { method: 'PUT', token: s.token, body: JSON.stringify({ state }) });
}

// Artist: read the latest published snapshot.
export async function fetchState<T = unknown>(s: RelaySession): Promise<T | null> {
  const res = await relayFetch(s.relayBase, `/relay/session/${s.sessionId}/state`, { token: s.token });
  if (res.status === 403) throw new Error('unauthorized');
  if (!res.ok) throw new Error('state-unavailable');
  const { state } = (await res.json()) as { state?: T };
  return state ?? null;
}

// Artist: queue one allow-listed command for the engineer's bridge to run.
export async function pushCommand(s: RelaySession, endpoint: string, body: unknown): Promise<void> {
  const res = await relayFetch(s.relayBase, `/relay/session/${s.sessionId}/command`, { method: 'POST', token: s.token, body: JSON.stringify({ endpoint, body }) });
  if (!res.ok) {
    const msg = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(msg?.error || 'The relay rejected that command.');
  }
}

// Engineer: drain and clear the artist's queued commands.
export async function drainCommands(s: RelaySession): Promise<RelayCommand[]> {
  const res = await relayFetch(s.relayBase, `/relay/session/${s.sessionId}/commands`, { token: s.token });
  if (!res.ok) throw new Error('drain-failed');
  const { commands } = (await res.json()) as { commands?: RelayCommand[] };
  return commands ?? [];
}

// Either side: end the session (wipes relay state + queue).
export async function revokeSession(s: RelaySession): Promise<void> {
  try { await relayFetch(s.relayBase, `/relay/session/${s.sessionId}/revoke`, { method: 'POST', token: s.token }); } catch { /* best effort */ }
}

// --- Join code: one paste-able string carrying {relayBase, sessionId, token}. ---
// base64url of compact JSON. Not encryption — the token IS the secret, so share
// the code only with the collaborator (e.g. a Discord DM), like a meeting link.
export function encodeJoinCode(s: RelaySession): string {
  const json = JSON.stringify({ r: s.relayBase, s: s.sessionId, t: s.token });
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeJoinCode(code: string): RelaySession {
  const b64 = code.trim().replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(escape(atob(b64)));
  const o = JSON.parse(json) as { r?: string; s?: string; t?: string };
  if (!o.r || !o.s || !o.t) throw new Error('That join code is incomplete.');
  return { relayBase: o.r, sessionId: o.s, token: o.t };
}
