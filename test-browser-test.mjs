// Browser-test access surface. Routing + real-UI selectors. Does not change retrieval.
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

function count(hay, needle) {
  return hay.split(needle).length - 1;
}

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
  assert(d.browserTest.selectors && d.browserTest.selectors.searchInput === '[data-testid="search-input"]', 'docs list real DOM selectors');
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
  assert(!/location\.replace\s*\(\s*["']\//.test(html), '/test does not JS-redirect away from the UI');
  assert(!/http-equiv=["']refresh["']/i.test(html), '/test has no meta-refresh human gesture');
  assert(!/Opening the real Carmen application/i.test(html), '/test is not a Continue stub');
  assert(/carmen-browser-test/i.test(html), '/test marks browser-test meta');
  assert(/<base href="\/">/i.test(html), '/test has base href=/ so assets load from origin root');
  assert(html.includes('diveBondageBtn') && html.includes('Bondage'), '/test HTML has Bondage control');
  assert(html.includes('divePeopleBtn') && html.includes('People'), '/test HTML has People control');
  assert(html.includes('diveClothingBtn') && html.includes('Clothing'), '/test HTML has Clothing control');
  assert(count(html, 'data-testid="dive-bondage"') === 1, 'exactly one dive-bondage testid');
  assert(count(html, 'data-testid="dive-people"') === 1, 'exactly one dive-people testid');
  assert(count(html, 'data-testid="dive-clothing"') === 1, 'exactly one dive-clothing testid');
  assert(count(html, 'data-testid="search-input"') === 1, 'exactly one search-input testid');
  assert(count(html, 'data-testid="search-submit"') === 1, 'exactly one search-submit testid');
  assert(count(html, 'data-testid="deep-dive"') === 1, 'exactly one deep-dive testid');
  assert(count(html, 'data-testid="new-investigation"') === 1, 'exactly one new-investigation testid');
  assert(count(html, 'data-testid="save"') === 1, 'exactly one save/keep testid');
  assert(count(html, 'data-testid="how-i-got-here"') === 1, 'exactly one how-i-got-here testid');
  assert(count(html, 'data-testid="find-more"') === 1, 'exactly one find-more testid');
  assert(html.includes('src="/app.js"'), '/test loads real /app.js');
  assert(page.headers.get('x-carmen-browser-test') === '1', '/test sets diagnostic header');
  assert(page.headers.get('x-carmen-version') === PLANNER_VERSION, '/test version header');
  assert(page.headers.get('location') == null, '/test does not send a Location redirect');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert(dup.length === 0, 'no duplicate IDs in /test HTML' + (dup.length ? ' (' + dup.join(',') + ')' : ''));
}

{
  const slash = await worker.fetch(new Request('https://carmen.test/test/'), env);
  const html = await slash.text();
  assert(slash.status === 200 && html.includes('data-testid="search-input"') && !/location\.replace/.test(html), '/test/ also serves the real UI');
}

{
  const alias = await worker.fetch(new Request('https://carmen.test/browser-test'), env);
  const html = await alias.text();
  assert(alias.status === 200 && html.includes('diveBondageBtn') && html.includes('data-testid="search-input"'), '/browser-test serves same UI');
}

{
  const asset = await worker.fetch(new Request('https://carmen.test/test/app.js'), env);
  const js = await asset.text();
  assert(asset.status === 200 && js.includes("const VERSION = '49.4'"), '/test/app.js is the real frontend');
  assert(js.includes('function setAgentState'), 'frontend exposes agent-observable state');
  assert(js.includes("data-testid=\"result-card\""), 'result cards carry stable testids');
}

{
  const root = await worker.fetch(new Request('https://carmen.test/'), env);
  assert(root.status === 200 || root.status === 404, 'root path still handled (not intercepted as browser-test rewrite of /)');
}

console.log('\n' + passed + ' passed,', failed + ' failed');
if (failed) process.exit(1);
