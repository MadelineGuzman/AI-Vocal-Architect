import { create } from 'zustand';
import {
  type RelaySession,
  createSession,
  decodeJoinCode,
  fetchState,
  revokeSession,
  DEFAULT_RELAY_BASE,
} from '../lib/relayClient';

// Remote-collaboration session state (Layer 2).
//   local    — no remote session; everything talks to the local bridge (default).
//   hosting  — this is the engineer's machine; it publishes local state to the
//              relay and runs the artist's drained commands on the local bridge.
//   joined   — this is the artist's device; it reads state from the relay and
//              sends commands to the relay queue. No local bridge here.
// Persisted under a NEW key so it never collides with existing cadenzai.* keys.
export type SessionRole = 'local' | 'hosting' | 'joined';

const KEY = 'veia.session.v1';

interface Persisted {
  role: SessionRole;
  session: RelaySession | null;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { role: 'local', session: null };
    const p = JSON.parse(raw) as Persisted;
    if ((p.role === 'hosting' || p.role === 'joined') && p.session?.relayBase && p.session.sessionId && p.session.token) return p;
  } catch { /* storage unavailable or malformed */ }
  return { role: 'local', session: null };
}

function save(p: Persisted): void {
  try {
    if (p.role === 'local') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(p));
  } catch { /* storage unavailable */ }
}

interface SessionState {
  role: SessionRole;
  session: RelaySession | null;
  busy: boolean;
  error: string | null;
  startHosting: (relayBase?: string) => Promise<void>;
  join: (code: string) => Promise<void>;
  leave: () => Promise<void>;
  clearError: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => {
  const initial = load();
  return {
    role: initial.role,
    session: initial.session,
    busy: false,
    error: null,
    clearError: () => set({ error: null }),

    startHosting: async (relayBase = DEFAULT_RELAY_BASE) => {
      if (get().busy) return;
      set({ busy: true, error: null });
      try {
        const session = await createSession(relayBase);
        save({ role: 'hosting', session });
        set({ role: 'hosting', session, busy: false });
      } catch (e) {
        set({ busy: false, error: e instanceof Error ? e.message : 'Could not start the session.' });
      }
    },

    join: async (code) => {
      if (get().busy) return;
      set({ busy: true, error: null });
      try {
        const session = decodeJoinCode(code);
        // Probe the relay with the token so a bad code fails here, not later.
        await fetchState(session);
        save({ role: 'joined', session });
        set({ role: 'joined', session, busy: false });
      } catch (e) {
        const msg = e instanceof Error && e.message === 'unauthorized'
          ? 'That code was rejected — it may have expired or been typed wrong.'
          : e instanceof Error && e.message === 'state-unavailable'
            ? 'Could not reach that session. Check the relay is up and the code is right.'
            : 'That join code could not be read.';
        set({ busy: false, error: msg });
      }
    },

    leave: async () => {
      const { session, role } = get();
      // Hosting ends the session for everyone; joining just detaches this device.
      if (session && role === 'hosting') await revokeSession(session);
      save({ role: 'local', session: null });
      set({ role: 'local', session: null, error: null });
    },
  };
});
