import express, { type Request } from 'express';
import { RelayStore } from './sessions';

// The Cadenzai collaboration relay as an HTTP app. PUBLIC-facing (the remote
// collaborator reaches it), so it is NOT behind the bridge's loopback guard —
// its gate is the per-session token, carried in the X-Relay-Token header. It
// stores and forwards data only; it never runs commands or touches REAPER.
export function createRelayApp(store = new RelayStore()) {
  const app = express();
  app.use(express.json({ limit: '512kb' }));

  // Permissive CORS for local proof. In production, restrict to your own origins.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Relay-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  const tokenOf = (req: Request) => String(req.headers['x-relay-token'] || '');

  // Engineer creates a session and shares the join link (sessionId + token).
  app.post('/relay/session', (_req, res) => res.json(store.create()));

  // Engineer publishes its local REAPER state (clips/transport) for the artist.
  app.put('/relay/session/:id/state', (req, res) => {
    const r = store.setState(req.params.id, tokenOf(req), (req.body as { state?: unknown })?.state);
    if (r === 'unauthorized') { res.status(403).json({ error: 'Unauthorized' }); return; }
    if (r === 'too-large') { res.status(413).json({ error: 'State too large' }); return; }
    res.json({ ok: true });
  });

  // Artist reads the published state to see the clips/transport.
  app.get('/relay/session/:id/state', (req, res) => {
    const r = store.getState(req.params.id, tokenOf(req));
    if (!r.ok) { res.status(403).json({ error: 'Unauthorized' }); return; }
    res.json({ state: r.state });
  });

  // Artist proposes a command (select/nudge/transport/effect). Allow-listed only.
  app.post('/relay/session/:id/command', (req, res) => {
    const body = req.body as { endpoint?: unknown; body?: unknown } | undefined;
    const r = store.pushCommand(req.params.id, tokenOf(req), body?.endpoint, body?.body);
    if (r === 'unauthorized') { res.status(403).json({ error: 'Unauthorized' }); return; }
    if (r === 'bad-endpoint') { res.status(400).json({ error: 'That command is not allowed over the relay.' }); return; }
    if (r === 'too-large') { res.status(413).json({ error: 'Command too large' }); return; }
    res.json({ ok: true });
  });

  // Engineer drains pending commands to run them locally through its bridge.
  app.get('/relay/session/:id/commands', (req, res) => {
    const r = store.drainCommands(req.params.id, tokenOf(req));
    if (!r.ok) { res.status(403).json({ error: 'Unauthorized' }); return; }
    res.json({ commands: r.commands });
  });

  // Engineer ends the session (revoke the link).
  app.post('/relay/session/:id/revoke', (req, res) => {
    res.json({ ok: store.revoke(req.params.id, tokenOf(req)) });
  });

  return app;
}
