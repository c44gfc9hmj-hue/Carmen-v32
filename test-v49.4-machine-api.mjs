// v49.4 secure machine-callable API — same runDiscovery path as the PWA.
import { readFileSync } from 'node:fs';
import { API_ACTION_CATALOG } from './investigation-planner.js';
import worker from './worker.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

const workerSrc = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
const appSrc = readFileSync(new URL('./app.js', import.meta.url), 'utf8');

console.log('--- machine API is a thin wrapper around the real PWA pipeline ---');
{
  assert(/async function runDiscovery\(/.test(workerSrc), 'runDiscovery is the real discovery function');
  assert(/const discovery = await runDiscovery\(/.test(workerSrc), 'handleCarmenApi calls runDiscovery');
  assert(/async function searchWeb\(/.test(workerSrc), 'PWA GET /search still uses searchWeb');
  assert(/searchWeb[\s\S]*runDiscovery\(/.test(workerSrc), 'searchWeb also calls runDiscovery');
  assert(/if \(u\.pathname === '\/search' && req\.method === 'GET'\) return searchWeb\(req\);/.test(workerSrc), 'PWA GET /search is unchanged');
  assert(/if \(u\.pathname === '\/dive' && req\.method === 'POST'\) return deepDiveHandler/.test(workerSrc), 'PWA POST /dive is unchanged');
  assert(/if \(u\.pathname === '\/analyze' && req\.method === 'POST'\) return analyze/.test(workerSrc), 'PWA POST /analyze is unchanged');
  assert(/\/api\/v1\/machine\/search/.test(workerSrc), 'machine search endpoint exists');
  assert(/\/api\/v1\/openapi\.json/.test(workerSrc), 'OpenAPI route exists');
  assert(/CARMEN_API_KEY/.test(workerSrc), 'machine auth uses CARMEN_API_KEY');
  assert(/Provider secret is not a Carmen machine credential/.test(workerSrc), 'provider API_KEY is rejected as machine credential');
  assert(/External action denied/.test(workerSrc), 'external actions are denied');
  assert(!/mockDiscovery|fakeRunDiscovery|simulateDiscovery/.test(workerSrc), 'no mock discovery implementation');
  assert(/base \+ '\/search\?'/.test(appSrc), 'PWA still calls GET /search');
  assert(API_ACTION_CATALOG.some(a => a.path === '/api/v1/machine/search'), 'catalog documents machine search');
  assert(API_ACTION_CATALOG.some(a => a.path === '/api/v1/machine/dive'), 'catalog documents machine dive');
}

function urlsFrom(payload) {
  const items = payload.results || payload.structuredResults || [];
  return items.map(r => r.sourceUrl || r.url).filter(Boolean).sort();
}

console.log('--- unauthenticated docs / openapi / capabilities ---');
{
  const spec = await worker.fetch(new Request('https://test/api/v1/openapi.json'), {});
  const openapi = await spec.json();
  assert(spec.status === 200 && openapi.openapi === '3.0.3', 'GET /api/v1/openapi.json');
  assert(openapi.paths['/api/v1/machine/search'], 'spec includes machine search');
  assert(openapi.paths['/api/v1/machine/investigations/{id}'].post, 'spec includes POST inspect for durable state');
  assert(openapi.paths['/api/v1/machine/investigations/{id}/confirm-identity'].post, 'spec includes confirm-identity');
  assert(openapi.components.securitySchemes.CarmenApiKey, 'spec documents X-Carmen-Api-Key');
  assert(openapi.components.securitySchemes.BearerAuth, 'spec documents Bearer auth');
  assert(openapi.security[0].BearerAuth, 'Bearer is listed first for ChatGPT Actions');
  assert(openapi.components.schemas && openapi.components.schemas.DiscoveryEnvelope, 'spec includes response schemas');
  assert(openapi.components.schemas.EvidenceItem, 'spec includes EvidenceItem');
  assert(openapi.components.schemas.SearchRequest, 'spec includes SearchRequest');
  assert(openapi.paths['/api/v1/machine/search'].post['x-openai-isConsequential'] === false, 'search is non-consequential');
  assert(openapi.paths['/api/v1/machine/search'].post.requestBody.content['application/json'].schema.$ref, 'search body uses $ref');
  assert(openapi.paths['/api/v1/machine/search'].post.responses['200'].content['application/json'].schema, 'search 200 has JSON schema');
  assert(openapi.paths['/api/v1/machine/search'].post.responses['401'].content['application/json'].schema, 'search 401 has JSON schema');
  assert(/investigationState/.test(JSON.stringify(openapi)), 'spec documents investigationState continuity');
  assert(/investigationStateJson/.test(JSON.stringify(openapi)), 'spec documents investigationStateJson fallback');
  assert(/CARMEN_API_KEY/.test(JSON.stringify(openapi)), 'spec names CARMEN_API_KEY not provider secrets as the assistant key');
  let descOk = true;
  for (const [path, ops] of Object.entries(openapi.paths)) {
    for (const op of Object.values(ops)) {
      if (op && typeof op === 'object') {
        if (op.summary && op.summary.length > 300) descOk = false;
        if (op.description && op.description.length > 300) descOk = false;
      }
    }
  }
  assert(descOk, 'ChatGPT Action summary/description stay under 300 chars');

  const caps = await worker.fetch(new Request('https://test/api/v1/machine/capabilities'), {});
  const cbody = await caps.json();
  assert(caps.status === 200 && cbody.capabilities.readOnly === true, 'capabilities are read-only');
  assert(cbody.machineAuthConfigured === false, 'capabilities report machineAuthConfigured=false when secret absent');
  assert(cbody.capabilities.agentContract && Array.isArray(cbody.capabilities.agentContract.sequence), 'capabilities include agentContract sequence');
  const health = await worker.fetch(new Request('https://test/api/v1/health'), { CARMEN_API_KEY: 'carmen-machine-secret' });
  const hbody = await health.json();
  assert(hbody.machineAuthConfigured === true, 'health reports machineAuthConfigured when CARMEN_API_KEY is present');
  assert(!JSON.stringify(hbody).includes('carmen-machine-secret'), 'health does not echo the machine key');
  assert(cbody.capabilities.denied.includes('external-action'), 'capabilities deny external actions');
  assert(cbody.capabilities.pipelineFunction === 'runDiscovery', 'capabilities name runDiscovery');
}

console.log('--- auth rejects provider secrets and wrong keys; accepts CARMEN_API_KEY ---');
{
  const env = { CARMEN_API_KEY: 'carmen-machine-secret', API_KEY: 'openrouter-provider-secret' };
  const denied = await worker.fetch(new Request('https://test/api/v1/machine/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'Drea Morgan', fixture: 'drea-intersection' }),
  }), env);
  assert(denied.status === 401, 'missing machine key → 401');

  const provider = await worker.fetch(new Request('https://test/api/v1/machine/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer openrouter-provider-secret' },
    body: JSON.stringify({ query: 'Drea Morgan', fixture: 'drea-intersection' }),
  }), env);
  const pbody = await provider.json();
  assert(provider.status === 401, 'OpenRouter/API_KEY as bearer → 401');
  assert(/Provider secret/.test(pbody.error || ''), 'explicit provider-secret rejection');

  const wrong = await worker.fetch(new Request('https://test/api/v1/machine/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-carmen-api-key': 'nope' },
    body: JSON.stringify({ query: 'Drea Morgan', fixture: 'drea-intersection' }),
  }), env);
  assert(wrong.status === 401, 'wrong machine key → 401');

  const okHeader = await worker.fetch(new Request('https://test/api/v1/machine/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-carmen-api-key': 'carmen-machine-secret' },
    body: JSON.stringify({ query: 'Drea Morgan bondage', subject: 'Drea Morgan', topic: 'bondage', type: 'person', adult: 'on', fixture: 'drea-intersection' }),
  }), env);
  const okBody = await okHeader.json();
  assert(okHeader.status === 200 && okBody.samePipelineAsIphoneUi === true, 'X-Carmen-Api-Key accepted');
  assert(okBody.pipeline && okBody.pipeline.function === 'runDiscovery', 'response names runDiscovery');
  assert(okBody.pipeline.mock === false && okBody.pipeline.browserTestSimulation === false, 'not a mock or browser-test simulation');
  assert(okBody.capabilities && okBody.capabilities.readOnly === true, 'response includes read-only capabilities');
  assert(okBody.identityState, 'response includes identityState');
  assert(okBody.relationships, 'response includes relationships');
  assert(okBody.retrievalLanes, 'response includes retrievalLanes');
  assert(okBody.investigationState && okBody.investigationId, 'response includes investigation state');
  assert(typeof okBody.investigationStateJson === 'string' && okBody.investigationStateJson.includes(okBody.investigationId), 'response includes investigationStateJson echo');

  const okBearer = await worker.fetch(new Request('https://test/api/v1/machine/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer carmen-machine-secret' },
    body: JSON.stringify({ query: 'Drea Morgan bondage', subject: 'Drea Morgan', fixture: 'drea-intersection', investigationId: okBody.investigationId }),
  }), env);
  assert(okBearer.status === 200, 'Authorization Bearer accepted');
}

console.log('--- machine search executes the same runDiscovery path as GET /search ---');
{
  const env = { CARMEN_API_KEY: 'carmen-machine-secret' };
  const pwa = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Drea Morgan bondage') + '&entity=Drea%20Morgan&topic=bondage&type=person&adult=on&fixture=drea-intersection'), {});
  const pwaBody = await pwa.json();
  assert(pwa.status === 200, 'PWA GET /search 200');

  const api = await worker.fetch(new Request('https://test/api/v1/machine/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-carmen-api-key': 'carmen-machine-secret' },
    body: JSON.stringify({
      query: 'Drea Morgan bondage',
      subject: 'Drea Morgan',
      topic: 'bondage',
      type: 'person',
      adult: 'on',
      fixture: 'drea-intersection',
    }),
  }), env);
  const apiBody = await api.json();
  assert(api.status === 200, 'machine search 200');
  assert(apiBody.samePipelineAsIphoneUi === true, 'machine search claims same pipeline');
  const pwaUrls = urlsFrom(pwaBody);
  const apiUrls = urlsFrom(apiBody);
  assert(pwaUrls.length > 0 && apiUrls.length > 0, 'both surfaces returned results');
  const overlap = apiUrls.filter(u => pwaUrls.includes(u));
  assert(overlap.length > 0, 'machine API and PWA /search share result URLs from the same fixture path');
  assert(JSON.stringify(pwaBody.corpusDiagnosis && pwaBody.corpusDiagnosis.status) === JSON.stringify(apiBody.corpusDiagnosis && apiBody.corpusDiagnosis.status), 'corpus diagnosis matches across PWA and machine API');
}

console.log('--- Deep Dive machine route uses dive lens + runDiscovery ---');
{
  const env = { CARMEN_API_KEY: 'carmen-machine-secret' };
  const created = await worker.fetch(new Request('https://test/api/v1/investigations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-carmen-api-key': 'carmen-machine-secret' },
    body: JSON.stringify({ adult: 'on' }),
  }), env);
  const c = await created.json();
  const dive = await worker.fetch(new Request('https://test/api/v1/machine/dive', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-carmen-api-key': 'carmen-machine-secret' },
    body: JSON.stringify({
      lens: 'bondage',
      query: 'Drea Morgan bondage',
      subject: 'Drea Morgan',
      topic: 'bondage',
      type: 'person',
      adult: 'on',
      fixture: 'drea-intersection',
      investigationId: c.investigationId,
    }),
  }), env);
  const dbody = await dive.json();
  assert(dive.status === 200, 'machine dive 200');
  assert(dbody.intent === 'dive-bondage' || (dbody.intent && dbody.intent.mode === 'dive-bondage') || dbody.action === 'dive-bondage', 'dive action/intent is bondage lens');
  assert(dbody.pipeline && dbody.pipeline.function === 'runDiscovery', 'dive uses runDiscovery');
  assert(Array.isArray(dbody.results), 'dive returns structured results');

  const state = await worker.fetch(new Request('https://test/api/v1/machine/investigations/' + c.investigationId, {
    headers: { 'x-carmen-api-key': 'carmen-machine-secret' },
  }), env);
  const sbody = await state.json();
  assert(state.status === 200 && sbody.investigationState, 'GET investigation state while isolate still holds it');
  assert(sbody.identityState, 'state includes identityState');
  assert(sbody.capabilities.readOnly === true, 'state is read-only contract');

  const results = await worker.fetch(new Request('https://test/api/v1/machine/investigations/' + c.investigationId + '/results', {
    headers: { 'x-carmen-api-key': 'carmen-machine-secret' },
  }), env);
  const rbody = await results.json();
  assert(results.status === 200 && Array.isArray(rbody.results), 'GET investigation results');

  const missing = await worker.fetch(new Request('https://test/api/v1/machine/investigations/inv_not_in_store', {
    headers: { 'x-carmen-api-key': 'carmen-machine-secret' },
  }), env);
  const mbody = await missing.json();
  assert(missing.status === 404 && /not in this Worker isolate/i.test(mbody.error || ''), 'GET unknown id is 404, not a new empty investigation');

  const inspected = await worker.fetch(new Request('https://test/api/v1/machine/investigations/' + dbody.investigationId, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-carmen-api-key': 'carmen-machine-secret' },
    body: JSON.stringify({ investigationState: dbody.investigationState, investigationId: dbody.investigationId }),
  }), env);
  const ibody = await inspected.json();
  assert(inspected.status === 200 && ibody.investigationState && ibody.investigationState.investigationId === dbody.investigationId, 'POST inspect reconstructs client-held state');

  const viaJson = await worker.fetch(new Request('https://test/api/v1/machine/dive', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-carmen-api-key': 'carmen-machine-secret' },
    body: JSON.stringify({
      lens: 'people',
      query: 'Drea Morgan',
      subject: 'Drea Morgan',
      adult: 'on',
      fixture: 'drea-intersection',
      investigationId: dbody.investigationId,
      investigationStateJson: JSON.stringify(dbody.investigationState),
    }),
  }), env);
  const vj = await viaJson.json();
  assert(viaJson.status === 200 && vj.investigationId === dbody.investigationId, 'dive accepts investigationStateJson string');

  const viaStringState = await worker.fetch(new Request('https://test/api/v1/machine/investigations/' + dbody.investigationId, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-carmen-api-key': 'carmen-machine-secret' },
    body: JSON.stringify({ investigationId: dbody.investigationId, investigationState: JSON.stringify(dbody.investigationState) }),
  }), env);
  const vs = await viaStringState.json();
  assert(viaStringState.status === 200 && vs.investigationState && vs.investigationState.investigationId === dbody.investigationId, 'POST inspect accepts investigationState as JSON string');
}

console.log('--- analyze + explicit external-action denial ---');
{
  const env = { CARMEN_API_KEY: 'carmen-machine-secret' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html><title>Public page</title><body>Interview transcript</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
  try {
    const analyzed = await worker.fetch(new Request('https://test/api/v1/machine/investigations/inv_test/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-carmen-api-key': 'carmen-machine-secret' },
      body: JSON.stringify({ url: 'https://example.com/interview', title: 'Interview', kind: 'webpage' }),
    }), env);
    const abody = await analyzed.json();
    assert(analyzed.status === 200, 'machine analyze 200 on same analyze path');
    assert(abody.investigationId && abody.investigationState, 'analyze returns investigationId and investigationState');
  } finally {
    globalThis.fetch = originalFetch;
  }

  for (const path of ['/api/v1/machine/message', '/api/v1/investigations/inv_x/post', '/api/v1/machine/purchase']) {
    const res = await worker.fetch(new Request('https://test' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-carmen-api-key': 'carmen-machine-secret' },
      body: '{}',
    }), env);
    const body = await res.json();
    assert(res.status === 403 && body.error === 'External action denied', path + ' denied');
  }
}

console.log('--- PWA GET /search remains usable without a machine key ---');
{
  const env = { CARMEN_API_KEY: 'carmen-machine-secret' };
  const pwa = await worker.fetch(new Request('https://test/search?q=test&fixture=provider-blocked'), env);
  assert(pwa.status === 200, 'PWA GET /search does not require CARMEN_API_KEY');
}

console.log('\n' + passed + ' passed,', failed + ' failed');
if (failed) process.exit(1);
