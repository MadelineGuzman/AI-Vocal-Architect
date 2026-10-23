import { useSessionStore } from '../store/sessionStore';
import { pushCommand } from './relayClient';

// Single choke-point for every producer-directed REAPER command the UI sends.
// It routes by session role so the same components work locally and remotely:
//   local/hosting → POST straight to the loopback bridge (unchanged behaviour,
//                   result files echo back so callers can confirm the write);
//   joined        → queue the command on the relay; the engineer's bridge runs
//                   and re-validates it. No result echo comes back over the
//                   relay, so remote callers get requestId: null and should show
//                   "sent to the session" rather than waiting for a confirmation.
//
// The endpoint must be one the relay allow-lists (see relay-worker RELAY_ENDPOINTS);
// the local path accepts any /api/reaper/* the server mounts.
export interface SendResult {
  remote: boolean;
  ok: boolean;
  requestId: string | null;
  error: string | null;
}

export async function sendReaperCommand(endpoint: string, body: unknown): Promise<SendResult> {
  const { role, session } = useSessionStore.getState();

  if (role === 'joined' && session) {
    try {
      await pushCommand(session, endpoint, body);
      return { remote: true, ok: true, requestId: null, error: null };
    } catch (e) {
      return { remote: true, ok: false, requestId: null, error: e instanceof Error ? e.message : 'Could not reach the session.' };
    }
  }

  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { requestId?: string; error?: string };
    return { remote: false, ok: res.ok, requestId: data.requestId ?? null, error: res.ok ? null : (data.error ?? 'The local bridge rejected that command.') };
  } catch {
    return { remote: false, ok: false, requestId: null, error: 'The local server could not be reached.' };
  }
}
