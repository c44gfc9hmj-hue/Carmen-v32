// v50 machine-API auth + ChatGPT MCP/OAuth. Does not change search/dive behavior.
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import worker from './worker.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

const workerSrc = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
const appSrc = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const publicApp = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const publicHtml = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const deploySrc = readFileSync(new URL('./.github/workflows/deploy.yml', import.meta.url), 'utf8');
const apiMd = readFileSync(new URL('./API.md', import.meta.url), 'utf8');
const gptMd = readFileSync(new URL('./CHATGPT.md', import.meta.url), 'utf8');
const SECRET = 'carmen-machine-secret-test-only';
const PROVIDER = 'openrouter-provider-secret';
const env = { CARMEN_API_KEY: SECRET, API_KEY: PROVIDER };

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

console.log('--- secret never in frontend / docs as a value ---');
{
  assert(!/CARMEN_API_KEY\s*=/.test(appSrc) && !/CARMEN_API_KEY\s*=/.test(publicApp), 'app.js does not assign CARMEN_API_KEY');
  assert(!appSrc.includes(SECRET) && !publicApp.includes(SECRET), 'frontend does not contain the test secret');
  assert(!html.includes('CARMEN_API_KEY') && !publicHtml.includes('CARMEN_API_KEY'), 'HTML does not mention CARMEN_API_KEY');
  assert(!/x-carmen-api-key/i.test(appSrc) && !/x-carmen-api-key/i.test(publicApp), 'PWA does not send x-carmen-api-key');
  assert(/CARMEN_API_KEY/.test(deploySrc), 'deploy.yml names CARMEN_API_KEY');
  assert(!/secrets\.API_KEY/.test(deploySrc.split('Configure CARMEN_API_KEY')[1] || ''), 'CARMEN_API_KEY step does not reuse secrets.API_KEY');
  assert(/wrangler secret put CARMEN_API_KEY/.test(deploySrc), 'deploy puts CARMEN_API_KEY on the Worker');
  assert(/token_urlsafe/.test(deploySrc), 'deploy generates a Worker key if GitHub secret is empty');
  assert(/test-v50-auth\.mjs/.test(deploySrc), 'deploy runs test-v50-auth');
  assert(/GitHub →/.test(apiMd) || /Settings → Secrets/.test(apiMd), 'API.md documents GitHub UI secret steps');
  assert(/chatgptCanInvokeFromThisGrokSession/.test(gptMd) || /cannot log into ChatGPT/.test(gptMd), 'CHATGPT.md is honest about this environment');
  assert(/\/mcp/.test(gptMd), 'CHATGPT.md documents MCP');
  assert(/oauth/i.test(gptMd), 'CHATGPT.md documents OAuth for ChatGPT MCP');
}

console.log('--- unauthenticated machine search is 401 when key is configured ---');
{
  const denied = await worker.fetch(new Request('https://test/api/v1/machine/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'Drea Morgan', fixture: 'drea-intersection' }),
  }), env);
  const body = await denied.json();
  assert(denied.status === 401, 'unauthenticated search → 401');
  assert(body.error === 'Unauthorized', '401 error is Unauthorized');
  assert(denied.headers.get('www-authenticate') && /Bearer/i.test(denied.headers.get('www-authenticate')), '401 includes WWW-Authenticate Bearer');
  assert(!JSON.stringify(body).includes(SECRET), '401 body does not leak the secret');
  assert(!JSON.stringify(body).includes(PROVIDER), '401 body does not leak API_KEY');

  const provider = await worker.fetch(new Request('https://test/api/v1/machine/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + PROVIDER },
    body: JSON.stringify({ query: 'Drea Morgan', fixture: 'drea-intersection' }),
  }), env);
  const pbody = await provider.json();
  assert(provider.status === 401, 'provider API_KEY as bearer → 401');
  assert(/Provider secret/.test(pbody.error || ''), 'explicit provider-secret rejection');

  const wrong = await worker.fetch(new Request('https://test/api/v1/machine/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-carmen-api-key': 'nope' },
    body: JSON.stringify({ query: 'Drea Morgan', fixture: 'drea-intersection' }),
  }), env);
  assert(wrong.status === 401, 'wrong machine key → 401');
}

console.log('--- authenticated machine search succeeds; PWA does not need the key ---');
{
  const ok = await worker.fetch(new Request('https://test/api/v1/machine/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + SECRET },
    body: JSON.stringify({ query: 'Drea Morgan bondage', subject: 'Drea Morgan', topic: 'bondage', type: 'person', adult: 'on', fixture: 'drea-intersection' }),
  }), env);
  const body = await ok.json();
  assert(ok.status === 200 && body.samePipelineAsIphoneUi === true, 'authenticated search 200 same pipeline');
  assert(body.pipeline && body.pipeline.function === 'runDiscovery', 'runDiscovery');
  assert(!JSON.stringify(body).includes(SECRET), 'search envelope does not echo the secret');

  const pwa = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Drea Morgan bondage') + '&entity=Drea%20Morgan&topic=bondage&type=person&adult=on&fixture=drea-intersection'), env);
  assert(pwa.status === 200, 'PWA GET /search works without sending CARMEN_API_KEY');
  const pwaBody = await pwa.json();
  assert(!JSON.stringify(pwaBody).includes(SECRET), 'PWA search does not echo the secret');
  assert(/u\.pathname === '\/dive' && req\.method === 'POST'\) return deepDiveHandler/.test(workerSrc), 'PWA POST /dive is not gated by CARMEN_API_KEY');
  assert(/u\.pathname === '\/analyze' && req\.method === 'POST'\) return analyze/.test(workerSrc), 'PWA POST /analyze is not gated by CARMEN_API_KEY');
}

console.log('--- public surfaces stay public and never return the secret ---');
{
  for (const path of ['/api/v1/health', '/api/v1/machine/capabilities', '/api/v1/openapi.json', '/api/v1/chatgpt-setup', '/privacy', '/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server']) {
    const res = await worker.fetch(new Request('https://test' + path), env);
    const text = await res.text();
    assert(res.status === 200, path + ' public 200');
    assert(!text.includes(SECRET), path + ' does not contain the secret');
  }
  const health = await worker.fetch(new Request('https://test/api/v1/health'), env);
  const h = await health.json();
  assert(h.machineAuthConfigured === true, 'health machineAuthConfigured true');
  assert(h.secretsExposed === false, 'health secretsExposed false');
  const spec = await worker.fetch(new Request('https://test/api/v1/openapi.json'), env);
  const openapi = await spec.json();
  const dumped = JSON.stringify(openapi);
  assert(openapi.paths['/api/v1/machine/search'].post.responses['401'], 'OpenAPI documents 401');
  assert(openapi.paths['/mcp'], 'OpenAPI documents /mcp');
  assert(/CARMEN_API_KEY/.test(dumped), 'OpenAPI names CARMEN_API_KEY');
  assert(!dumped.includes(SECRET), 'OpenAPI does not contain the secret value');
  assert(/investigationGuardMs|24s|stage=initial/.test(dumped), 'OpenAPI mentions progressive/time limits');
  const setup = await worker.fetch(new Request('https://test/api/v1/chatgpt-setup'), env);
  const s = await setup.json();
  assert(s.chatgptCanInvokeFromThisGrokSession === false, 'setup is honest: this Grok session cannot invoke ChatGPT');
  assert(s.secretName === 'CARMEN_API_KEY' && s.secretsExposed === false, 'setup names the secret, does not return it');
  assert(s.chatgptProductPaths.some(p => p.kind === 'developer-mode-mcp'), 'setup documents MCP');
}

console.log('--- MCP: initialize/tools/list require auth when key is set; tools/call uses runDiscovery ---');
{
  const unauth = await worker.fetch(new Request('https://test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }),
  }), env);
  const u = await unauth.json();
  assert(unauth.status === 401, 'MCP initialize without key → 401');
  assert(u.error && u.error.code === -32001, 'MCP 401 is JSON-RPC -32001');
  assert(/resource_metadata/.test(unauth.headers.get('www-authenticate') || ''), 'MCP 401 has resource_metadata');

  const init = await worker.fetch(new Request('https://test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + SECRET },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }),
  }), env);
  const initBody = await init.json();
  assert(init.status === 200 && initBody.result && initBody.result.protocolVersion, 'MCP initialize with key');

  const listed = await worker.fetch(new Request('https://test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + SECRET },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  }), env);
  const tools = await listed.json();
  const names = ((tools.result && tools.result.tools) || []).map(t => t.name);
  for (const n of ['carmen_search', 'carmen_candidates', 'carmen_confirm', 'carmen_dive', 'carmen_find_more', 'carmen_ask', 'carmen_diagnostics', 'carmen_inspect']) {
    assert(names.includes(n), 'MCP tool ' + n);
  }

  const call = await worker.fetch(new Request('https://test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + SECRET },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'carmen_search', arguments: { query: 'Drea Morgan bondage', subject: 'Drea Morgan', topic: 'bondage', type: 'person', adult: 'on', fixture: 'drea-intersection' } },
    }),
  }), env);
  const called = await call.json();
  assert(call.status === 200 && called.result && called.result.content, 'MCP tools/call search 200');
  const inner = JSON.parse(called.result.content[0].text);
  assert(inner.samePipelineAsIphoneUi === true && inner.investigationId, 'MCP search is the real pipeline');
  assert(!JSON.stringify(called).includes(SECRET), 'MCP result does not leak the secret');
}

console.log('--- OAuth: ChatGPT MCP discovery + PKCE token + JWT tools/call ---');
{
  const meta = await worker.fetch(new Request('https://test/.well-known/oauth-protected-resource'), env);
  const m = await meta.json();
  assert(m.authorization_servers && m.resource && /\/mcp$/.test(m.resource), 'protected resource metadata');
  const as = await worker.fetch(new Request('https://test/.well-known/oauth-authorization-server'), env);
  const asBody = await as.json();
  assert(asBody.authorization_endpoint && asBody.token_endpoint && asBody.registration_endpoint, 'AS metadata');
  assert((asBody.code_challenge_methods_supported || []).includes('S256'), 'PKCE S256');

  const reg = await worker.fetch(new Request('https://test/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'], token_endpoint_auth_method: 'none' }),
  }), env);
  const client = await reg.json();
  assert(reg.status === 201 && client.client_id, 'DCR 201');

  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const authorize = await worker.fetch(new Request('https://test/oauth/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirect,
      state: 'st1',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      key: SECRET,
    }).toString(),
    redirect: 'manual',
  }), env);
  assert(authorize.status === 302, 'authorize 302');
  const loc = authorize.headers.get('location') || '';
  assert(loc.startsWith(redirect), 'redirects to ChatGPT');
  const code = new URL(loc).searchParams.get('code');
  assert(code && !loc.includes(SECRET), 'code issued; secret not in redirect');

  const tokenRes = await worker.fetch(new Request('https://test/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
      client_id: client.client_id,
      code_verifier: verifier,
    }).toString(),
  }), env);
  const token = await tokenRes.json();
  assert(tokenRes.status === 200 && token.access_token && token.token_type, 'token endpoint issues access_token');
  assert(!JSON.stringify(token).includes(SECRET), 'token response does not include CARMEN_API_KEY');

  const viaJwt = await worker.fetch(new Request('https://test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token.access_token },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }),
  }), env);
  const jwtList = await viaJwt.json();
  assert(viaJwt.status === 200 && jwtList.result && Array.isArray(jwtList.result.tools), 'MCP tools/list accepts OAuth access token');
}

console.log('--- open when key unset (local/tests) ---');
{
  const open = await worker.fetch(new Request('https://test/api/v1/machine/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'Drea Morgan', fixture: 'drea-intersection' }),
  }), {});
  assert(open.status === 200, 'without CARMEN_API_KEY, machine routes stay open for local tests');
}

console.log('\n' + passed + ' passed,', failed + ' failed');
if (failed) process.exit(1);
