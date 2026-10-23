import { createRelayApp } from './server';
import { RelayStore } from './sessions';

// Run the Cadenzai relay standalone for local proof. In production this logic
// deploys to a Cloudflare Durable Object (or any small host); do not run the
// relay behind the bridge's loopback guard — its gate is the session token.
const store = new RelayStore();
setInterval(() => store.sweep(), 10 * 60 * 1000).unref();

const port = Number(process.env.RELAY_PORT || 3100);
createRelayApp(store).listen(port, () => console.log(`Cadenzai relay on http://localhost:${port}`));
