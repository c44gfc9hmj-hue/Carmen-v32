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
  assert(body.version === '46', 'version 46');
  assert(body.routes.includes('/retrieve'), 'routes include /retrieve');
  assert(body.routes.includes('/dive'), 'routes include /dive');
  assert(body.routes.includes('/learn'), 'routes include /learn');
  assert(body.routes.includes('/classify'), 'routes include /classify');
  assert(Array.isArray(body.features) && body.features.includes('dive-select'), 'features include dive-select');
  assert(body.features.includes('videos'), 'features include videos');
  assert(body.features.includes('expanded-research'), 'features include expanded-research');
  assert(body.features.includes('access-states'), 'features include access-states');
  assert(body.features.includes('adult-filter'), 'features include adult-filter');
  assert(body.features.includes('research-context'), 'features include research-context');
  assert(body.features.includes('discovery-graph'), 'features include discovery-graph');
  assert(body.features.includes('research-depth'), 'features include research-depth');
  assert(body.features.includes('relationship-follow'), 'features include relationship-follow');
  assert(body.features.includes('result-kinds'), 'features include result-kinds');
  assert(body.features.includes('interest-lenses'), 'features include interest-lenses');
  assert(body.features.includes('visual-identity'), 'features include visual-identity');
  assert(body.features.includes('selected-entity'), 'features include selected-entity');
  assert(body.features.includes('dive-workspace'), 'features include dive-workspace');
  assert(body.features.includes('entity-source-separation'), 'features include entity-source-separation');
  assert(body.provider === 'openrouter', 'provider openrouter');
  assert(body.model === 'openrouter/free', 'model openrouter/free');
  assert(body.configured === false, 'configured false without key'); }
console.log('--- /classify ---');
{ const { status, body } = await call('/classify?q=' + encodeURIComponent('Jordan Hale') + '&adult=on');
  assert(status === 200, 'classify 200');
  assert(body.classification && body.classification.type === 'person', 'classify returns person');
  assert(body.classification.adultContent === 'on', 'classify honors adult ON');
  assert(Array.isArray(body.lenses) && body.lenses.some(l => l.id === 'everything'), 'classify returns interest lenses');
  assert(body.lenses.some(l => l.id === 'credits'), 'adult ON person lenses include credits');
  assert(Array.isArray(body.paths), 'classify returns paths'); }
console.log('--- /retrieve success ---');
{ const { status, body } = await call('/retrieve?url=' + encodeURIComponent('https://example.com'));
  assert(status === 200, 'retrieve 200');
  assert(body.status === 'RETRIEVED', 'status RETRIEVED');
  assert(body.accessState === 'DIRECTLY_RETRIEVED' || body.accessState === 'PARTIALLY_RETRIEVED', 'accessState present');
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
console.log('--- /learn missing query ---');
{ const { status, body } = await call('/learn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
  assert(status === 400, 'learn 400 without query');
  assert(/learn|understand/i.test(body.error || ''), 'learn error is actionable'); }
console.log('--- /dive missing candidate ---');
{ const { status, body } = await call('/dive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
  assert(status === 400, 'dive 400 without subject'); }
console.log('--- /chat without key ---');
{ const { status, body } = await call('/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
  assert(status === 500, 'chat 500 without key');
  assert(/API_KEY|not configured/i.test(body.error || ''), 'clear config error'); }
console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
