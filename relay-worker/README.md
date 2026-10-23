# Cadenzai collaboration relay (Cloudflare Worker + Durable Object)

The Worker version of the relay in [`../relay/`](../relay/). It's the secure hub
for remote collaboration: it holds per-session **state** (the engineer's published
clips/transport) and a **queue** of the artist's allow-listed commands. It never
executes anything and never touches REAPER — the engineer's own Cadenzai drains
the queue and runs each command locally through the loopback bridge.

One Durable Object instance per session holds `token`, `state`, and `commands[]`
in DO storage. The per-session **token** (returned at creation, carried in the
`X-Relay-Token` header) is the gate on every op. Only the endpoints in
`RELAY_ENDPOINTS` may be queued. Idle sessions expire after 2h via a DO alarm.

## Endpoints
- `POST /relay/session` → `{ sessionId, token }`
- `PUT  /relay/session/:id/state` (X-Relay-Token) → publish state (≤256 KB)
- `GET  /relay/session/:id/state` (X-Relay-Token) → read state
- `POST /relay/session/:id/command` (X-Relay-Token) → queue `{ endpoint, body }` (allow-listed; ≤8 KB)
- `GET  /relay/session/:id/commands` (X-Relay-Token) → drain the queue
- `POST /relay/session/:id/revoke` (X-Relay-Token) → end the session

## Deploy
1. `cd relay-worker && npm install`
2. Set `ALLOWED_ORIGINS` in `src/index.ts` to the Cadenzai origin(s).
3. `npx wrangler login` (once), then `npm run deploy`.
4. Note the printed `*.workers.dev` URL — that's the relay URL Cadenzai will use.

SQLite-backed Durable Objects are the free-tier backend; for a 2-person session
this stays within Cloudflare's free limits.
