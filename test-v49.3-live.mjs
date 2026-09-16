// Live / preview acceptance for v49.3. Distinguishes PASS / FAIL / BLOCKED / THIN CORPUS / UNKNOWN.
const BASE = process.env.CARMEN_BASE || 'http://127.0.0.1:8080';

let passed = 0, failed = 0, blocked = 0, thin = 0, unknown = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS', msg); }
  else { failed++; console.log('  FAIL', msg); }
}
function noteBlocked(msg) { blocked++; console.log('  BLOCKED', msg); }
function noteThin(msg) { thin++; console.log('  THIN CORPUS', msg); }
function noteUnknown(msg) { unknown++; console.log('  UNKNOWN', msg); }

async function getJson(path, init) {
  const r = await fetch(BASE + path, { headers: { accept: 'application/json', ...(init && init.headers || {}) }, ...init });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: r.status, body };
}

function providerBlocked(body) {
  const diag = body && body.corpusDiagnosis;
  if (diag && diag.status === 'search_failed') return true;
  const p = body && (body.providerStatuses || body.providers) || {};
  const entries = Object.values(p).filter(v => v && typeof v === 'object');
  if (!entries.length) return false;
  const bad = entries.filter(v => v.failureReason === 'timeout' || v.failureReason === 'blocked' || v.error || (v.status && v.status >= 400) || v.ok === false);
  const ok = entries.filter(v => v.ok === true || (typeof v.added === 'number' && v.added > 0));
  return bad.length > 0 && ok.length === 0 && !(body.results || []).length;
}

console.log('--- live health + API docs ---');
{
  try {
    const { status, body } = await getJson('/health');
    assert(status === 200 && body.ok === true, 'GET /health 200');
    assert(body.version === '49.5' || body.version === '49.4' || body.version === '49.3', 'live version current');
    assert(/49\.(3|4|5)/.test(body.build || ''), 'live build');
    const docs = await getJson('/api');
    assert(docs.status === 200 && Array.isArray(docs.body.actions), 'GET /api docs');
  } catch (e) {
    console.log('  FAIL health unreachable: ' + e.message);
    process.exit(1);
  }
}

const names = [
  'Riley Reid', 'Chanta Rose', 'Sensi Pearl', 'Drea Morgan', 'Jolla PR',
  'Ashley Anderson', 'Layla London', 'Lana Rhoades', 'Gali Diva',
  'Princess Yummy', 'Cadey Mercury', 'Teresa Ferrer', 'Mandy Flores',
];

console.log('--- live 13-name sweep ---');
for (const name of names) {
  try {
    const extra = name === 'Jolla PR' ? '' : '&type=person&adult=on';
    const { status, body } = await getJson('/search?q=' + encodeURIComponent(name) + extra);
    if (status !== 200) { assert(false, name + ' HTTP ' + status); continue; }
    if (providerBlocked(body)) { noteBlocked(name + ' providers failed — not a Carmen PASS'); continue; }
    if (body.corpusDiagnosis && body.corpusDiagnosis.status === 'thin_corpus') noteThin(name);
    else if (body.corpusDiagnosis && body.corpusDiagnosis.status === 'identity_unresolved') noteUnknown(name + ' identity unresolved');
    else assert(Array.isArray(body.results), name + ' has results array');
    console.log('  RECORD ' + name + ' type=' + (body.classification && body.classification.type) + ' count=' + ((body.results || []).length) + ' ambiguous=' + !!body.identityAmbiguous + ' diagnosis=' + (body.corpusDiagnosis && body.corpusDiagnosis.status));
  } catch (e) {
    assert(false, name + ' threw ' + e.message);
  }
}

const cases = [
  ['A Drea Morgan', '/search?q=Drea%20Morgan&type=person&adult=on'],
  ['B Drea × bondage', '/search?q=bondage&entity=Drea%20Morgan&topic=bondage&type=person&adult=on'],
  ['C premium accounts', '/search?q=premium%20accounts&entity=Drea%20Morgan&premium=1&type=person&adult=on'],
  ['D find everything', '/search?q=' + encodeURIComponent('find everything related to Drea Morgan') + '&entity=Drea%20Morgan&findEverything=1&type=person&adult=on'],
  ['E House of Gord', '/search?q=' + encodeURIComponent('House of Gord') + '&adult=on'],
  ['F House of Gord × bondage', '/search?q=' + encodeURIComponent('House of Gord bondage') + '&topic=bondage&adult=on'],
  ['G Ashley Anderson', '/search?q=' + encodeURIComponent('Ashley Anderson') + '&type=person'],
  ['H Reddit', '/search?q=' + encodeURIComponent('Drea Morgan site:reddit.com') + '&type=person&adult=on'],
  ['I 4Runner transmission', '/search?q=' + encodeURIComponent('transmission problems') + '&entity=Toyota%204Runner&topic=' + encodeURIComponent('transmission problems') + '&type=vehicle&adult=off'],
  ['J Elon Musk lawsuits', '/search?q=lawsuits&entity=Elon%20Musk&topic=lawsuits&type=person&adult=off'],
];

console.log('--- live cross tests ---');
for (const [label, path] of cases) {
  try {
    const { status, body } = await getJson(path);
    if (status !== 200) { assert(false, label + ' HTTP ' + status); continue; }
    if (providerBlocked(body)) { noteBlocked(label); continue; }
    assert(Array.isArray(body.results), label + ' results array');
    if (label.startsWith('E ') || label.startsWith('F ')) {
      assert(body.classification && body.classification.type === 'website', label + ' website');
    }
    if (label.startsWith('D ')) assert(body.intent && body.intent.findEverything, 'D findEverything');
    if (label.startsWith('C ')) assert(body.intent && body.intent.premiumAccounts, 'C premium');
    if (label.startsWith('I ')) assert(body.classification && body.classification.type === 'vehicle', 'I vehicle');
    if (label.startsWith('H ')) assert(!(body.results || []).some(r => /reddit\.com\/search/i.test(r.url || '')), 'H no reddit search pages');
  } catch (e) {
    assert(false, label + ' threw ' + e.message);
  }
}

console.log('--- live API fixture fallbacks ---');
{
  const blockedFx = await getJson('/api/v1/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'Drea Morgan', subject: 'Drea Morgan', adult: 'on', type: 'person', fixture: 'provider-blocked' }),
  });
  assert(blockedFx.status === 200, 'fixture provider-blocked reachable');
  assert(blockedFx.body.corpusDiagnosis && blockedFx.body.corpusDiagnosis.status === 'search_failed', 'fixture search_failed is not PASS');
  const dreaFx = await getJson('/api/v1/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'Drea Morgan bondage', subject: 'Drea Morgan', topic: 'bondage', adult: 'on', type: 'person', fixture: 'drea-intersection' }),
  });
  assert(dreaFx.status === 200, 'fixture drea-intersection reachable');
}

console.log('--- live Analyze ---');
{
  try {
    const r = await fetch(BASE + '/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/', title: 'Example Domain', kind: 'webpage' }),
    });
    assert(r.status === 200, 'Analyze webpage 200');
  } catch (e) {
    assert(false, 'Analyze threw ' + e.message);
  }
}

console.log(`\nLive: ${passed} passed, ${failed} failed, ${blocked} blocked, ${thin} thin corpus, ${unknown} unknown`);
if (failed) process.exit(1);
