// Phase 2 retrieval + health tests (no external AI key required)
import worker from './worker.js';
const env = { API_KEY: undefined, ASSETS: { async fetch() { return new Response('ok'); } } };
async function call(path, init = {}) {
  const req = new Request('https://test' + path, init);
  const res = await worker.fetch(req, env);
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}
console.log('--- /health ---');
{ const { status, body } = await call('/health');
  assert(status === 200, 'health 200');
  assert(body.version === '37', 'version 37');
  assert(body.routes.includes('/retrieve'), 'routes include /retrieve');
  assert(body.provider === 'not-configured', 'provider not-configured without key'); }
console.log('--- /retrieve success ---');
{ const { status, body } = await call('/retrieve?url=' + encodeURIComponent('https://example.com'));
  assert(status === 200, 'retrieve 200');
  assert(body.status === 'RETRIEVED', 'status RETRIEVED');
  assert(body.title && body.title.includes('Example'), 'title present');
  assert(typeof body.textExcerpt === 'string', 'textExcerpt present');
  assert(body.fingerprint, 'fingerprint present'); }
console.log('--- /retrieve private blocked ---');
{ const { status, body } = await call('/retrieve?url=' + encodeURIComponent('http://127.0.0.1/'));
  assert(status === 422, 'private returns 422');
  assert(body.status === 'RETRIEVAL_FAILED', 'RETRIEVAL_FAILED');
  assert(/private|unsafe/i.test(body.error || ''), 'blocked message'); }
console.log('--- /retrieve missing url ---');
{ const { status, body } = await call('/retrieve');
  assert(status === 400, 'missing url 400'); }
console.log('--- /chat without key ---');
{ const { status, body } = await call('/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
  assert(status === 500, 'chat 500 without key');
  assert(/API_KEY|not configured/i.test(body.error || ''), 'clear config error'); }
console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
