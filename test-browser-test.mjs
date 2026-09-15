// Browser-test access surface — routing only. Does not change retrieval.
import worker from './worker.js';
import { PLANNER_VERSION, PLANNER_BUILD } from './investigation-planner.js';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

const INDEX = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const APP = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');

const env = {
  ASSETS: {
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === '/' || u.pathname === '/index.html') {
        return new Response(INDEX, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      if (u.pathname === '/app.js') {
        return new Response(APP, { status: 200, headers: { 'content-type': 'application/javascript; charset=utf-8' } });
      }
      return new Response('Not found ' + u.pathname, { status: 404 });
    },
  },
};

console.log('--- browser-test surface ---');
{
  const health = await worker.fetch(new Request('https://carmen.test/health'), env);
  const h = await health.json();
  assert(health.status === 200 && h.ok === true, 'GET /health 200');
  assert(h.version === PLANNER_VERSION && h.build === PLANNER_BUILD, 'health still reports v49.4');
  assert(h.browserTest && h.browserTest.available === true, 'health.browserTest.available');
  assert(Array.isArray(h.testRoutes) && h.testRoutes.includes('/test') && h.testRoutes.includes('/browser-test'), 'health.testRoutes');
  assert((h.routes || []).includes('/test') && (h.routes || []).includes('/browser-test'), 'health.routes lists test surfaces');
  assert(h.environment && h.environment.secretsExposed === false, 'health.environment hides secrets');
}

{
  const docs = await worker.fetch(new Request('https://carmen.test/api'), env);
  const d = await docs.json();
  assert(docs.status === 200 && d.browserTest && d.browserTest.available === true, 'GET /api browserTest');
  assert(d.samePipelineAsIphoneUi === true, 'API still same pipeline');
  assert(d.browserTest.primary === '/test', 'primary /test');
  assert((d.testRoutes || []).includes('/api/v1/browser-test-session'), 'session route advertised');
}

{
  const sess = await worker.fetch(new Request('https://carmen.test/api/v1/browser-test-session'), env);
  const s = await sess.json();
  assert(sess.status === 200 && s.ok && s.sessionId, 'session issued');
  assert(s.ui === '/test' && s.sameUiAsIphone === true, 'session points at real UI');
  assert(!(JSON.stringify(s).toLowerCase().includes('sk-') || JSON.stringify(s).includes('OPENROUTER')), 'session does not leak keys');
}

{
  const page = await worker.fetch(new Request('https://carmen.test/test'), env);
  const html = await page.text();
  assert(page.status === 200, '/test 200');
  assert(/carmen-browser-test/i.test(html), '/test marks browser-test meta');
  assert(/<base href="\/">/i.test(html), '/test injects base href=/ so assets load from origin root');
  assert(html.includes('diveBondageBtn') && html.includes('Bondage'), '/test HTML has Bondage control');
  assert(html.includes('divePeopleBtn') && html.includes('People'), '/test HTML has People control');
  assert(html.includes('diveClothingBtn') && html.includes('Clothing'), '/test HTML has Clothing control');
  assert(page.headers.get('x-carmen-browser-test') === '1', '/test sets diagnostic header');
  assert(page.headers.get('x-carmen-version') === PLANNER_VERSION, '/test version header');
}

{
  const alias = await worker.fetch(new Request('https://carmen.test/browser-test'), env);
  const html = await alias.text();
  assert(alias.status === 200 && html.includes('diveBondageBtn'), '/browser-test serves same UI');
}

{
  const asset = await worker.fetch(new Request('https://carmen.test/test/app.js'), env);
  const js = await asset.text();
  assert(asset.status === 200 && js.includes("const VERSION = '49.4'"), '/test/app.js is the real frontend');
}

{
  const root = await worker.fetch(new Request('https://carmen.test/'), env);
  assert(root.status === 200 || root.status === 404, 'root path still handled (not intercepted as browser-test rewrite of /)');
}

console.log('\n' + passed + ' passed,', failed + ' failed');
if (failed) process.exit(1);
