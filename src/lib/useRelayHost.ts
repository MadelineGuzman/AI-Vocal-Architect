import { useEffect } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { publishState, drainCommands } from './relayClient';

// Endpoints the host will run from the relay queue. Mirrors the relay's own
// RELAY_ENDPOINTS allow-list: even if the relay were misconfigured and queued
// something else, the host refuses to POST it to the local bridge. The bridge
// re-validates every field again on top of this.
const HOST_ALLOWED: ReadonlySet<string> = new Set([
  '/api/reaper/select-item',
  '/api/reaper/nudge-item',
  '/api/reaper/transport',
  '/api/reaper/cursor',
  '/api/reaper/apply-fx',
  '/api/reaper/apply-eq',
  '/api/reaper/apply-automation',
  '/api/reaper/apply-chain',
]);

// When this device is hosting, bridge the relay to the local REAPER: publish the
// current local snapshot for the remote artist to see, and run the commands the
// artist has queued. Runs only on the engineer's machine (the one with the
// loopback bridge); 'local' and 'joined' devices never start this loop.
export function useRelayHost(): void {
  const role = useSessionStore(s => s.role);
  const session = useSessionStore(s => s.session);

  useEffect(() => {
    if (role !== 'hosting' || !session) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        // 1. Publish the latest local snapshot (exactly what the local UI polls).
        const res = await fetch('/api/reaper/state', { cache: 'no-store' });
        if (res.ok) await publishState(session, await res.json());

        // 2. Drain the artist's queued commands and run each on the local bridge.
        const commands = await drainCommands(session);
        for (const c of commands) {
          if (typeof c.endpoint !== 'string' || !HOST_ALLOWED.has(c.endpoint)) continue; // defense in depth
          await fetch(c.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify(c.body ?? {}),
          }).catch(() => { /* a single bad command must not stall the loop */ });
        }
      } catch {
        /* transient relay or bridge hiccup — retry on the next tick */
      } finally {
        if (!stopped) timer = setTimeout(tick, 1000);
      }
    };

    void tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [role, session]);
}
