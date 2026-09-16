import assert from 'node:assert/strict';
import worker from '../worker.js';

let assetRequests = 0;
const assets = {
  fetch: async () => {
    assetRequests += 1;
    return new Response('public asset');
  },
};
const configured = {
  ASSETS: assets,
  CF_ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
  CF_ACCESS_AUD: 'test-audience',
  OWNER_EMAILS: 'owner@example.com',
};

for (const pathname of ['/internal', '/internal/', '/internal/index.html', '/internal/api/session', '/INTERNAL/index.html', '/internal/missing.js']) {
  const request = new Request(`https://example.test${pathname}`);
  const unconfigured = await worker.fetch(request, { ASSETS: assets });
  assert.equal(unconfigured.status, 503, `${pathname}: missing configuration must fail closed`);
  const anonymous = await worker.fetch(request, configured);
  assert.equal(anonymous.status, 401, `${pathname}: anonymous requests must be denied`);
  assert.match(anonymous.headers.get('cache-control'), /no-store/);
  assert.equal(anonymous.headers.get('x-frame-options'), 'DENY');
  const malformed = await worker.fetch(new Request(request, {
    headers: { 'Cf-Access-Jwt-Assertion': 'invalid-token' },
  }), configured);
  assert.equal(malformed.status, 401);
}
assert.equal(assetRequests, 0, 'private assets must never be fetched before authentication');

const write = await worker.fetch(new Request('https://example.test/internal/api/session', { method: 'POST' }), configured);
assert.equal(write.status, 405);
assert.equal(assetRequests, 0);

const publicResponse = await worker.fetch(new Request('https://example.test/'), configured);
assert.equal(publicResponse.status, 200);
assert.equal(await publicResponse.text(), 'public asset');
assert.equal(assetRequests, 1);
console.log('Owner authentication denial and public asset routing checks passed');
