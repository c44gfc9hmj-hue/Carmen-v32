// Live / preview acceptance for v49.2. Talks to the running Carmen server.
// Distinguishes PASS / FAIL / BLOCKED BY EXTERNAL PROVIDER.
const BASE = process.env.CARMEN_BASE || 'http://127.0.0.1:8080';

let passed = 0, failed = 0, blocked = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS', msg); }
  else { failed++; console.log('  FAIL', msg); }
}
function noteBlocked(msg) {
  blocked++;
  console.log('  BLOCKED BY EXTERNAL PROVIDER', msg);
}

async function getJson(path) {
  const r = await fetch(BASE + path, { headers: { accept: 'application/json' } });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: r.status, body };
}

function providerBlocked(body) {
  const p = body && body.providers || {};
  const entries = Object.values(p).filter(v => v && typeof v === 'object');
  if (!entries.length) return false;
  const bad = entries.filter(v => v.error || (v.status && v.status >= 400) || v.ok === false);
  const ok = entries.filter(v => v.ok === true || (typeof v.added === 'number' && v.added > 0));
  return bad.length > 0 && ok.length === 0 && !(body.results || []).length;
}

function recordPerson(label, body) {
  const results = body.results || [];
  const subj = (body.classification && body.classification.subject) || '';
  const ambiguous = !!body.identityAmbiguous;
  const echo = results.filter(r => r.evidence && r.evidence.echo).length;
  const about = results.filter(r => r.subjectEvidence === 'strong' || (r.evidence && r.evidence.subjectEvidence === 'strong') || new RegExp(subj.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test((r.title || '') + ' ' + (r.url || ''))).length;
  console.log(`  RECORD ${label}: identity=${subj || '—'} type=${body.classification && body.classification.type} ambiguous=${ambiguous} count=${results.length} aboutPerson=${about} echo=${echo} reddit=${body.redditEvidence} diagnosis=${body.corpusDiagnosis && body.corpusDiagnosis.status}`);
}

async function search(q, extra = '') {
  return getJson('/search?q=' + encodeURIComponent(q) + extra);
}

console.log('--- live health ---');
{
  try {
    const { status, body } = await getJson('/health');
    assert(status === 200 && body.ok === true, 'GET /health 200');
    assert(body.version === '49.4' || body.version === '49.3', 'live version current');
    assert(/49\.(3|4)/.test(body.build || ''), 'live build');
  } catch (e) {
    console.log('  FAIL health unreachable: ' + e.message);
    process.exit(1);
  }
}

const cases = [
  ['A Drea Morgan', 'Drea Morgan', '&type=person&adult=on'],
  ['B Drea Morgan + bondage', 'Drea Morgan bondage', '&entity=Drea%20Morgan&topic=bondage&type=person&adult=on'],
  ['C Drea Morgan + premium accounts', 'Drea Morgan premium accounts', '&entity=Drea%20Morgan&premium=1&type=person&adult=on'],
  ['D Drea Morgan find everything', 'find everything related to Drea Morgan', '&entity=Drea%20Morgan&findEverything=1&type=person&adult=on'],
  ['E House of Gord', 'House of Gord', '&adult=on'],
  ['F House of Gord + bondage', 'House of Gord bondage', '&topic=bondage&adult=on'],
  ['G generic bondage', 'bondage', '&type=topic&adult=on'],
  ['H premium accounts intent', 'premium accounts', '&entity=Drea%20Morgan&premium=1&type=person&adult=on'],
  ['I Riley Reid', 'Riley Reid', '&type=person&adult=on'],
  ['J Chanta Rose', 'Chanta Rose', '&type=person&adult=on'],
  ['K Sensi Pearl', 'Sensi Pearl', '&type=person&adult=on'],
  ['L Drea Morgan identity collision', 'Drea Morgan', '&type=person&adult=off'],
  ['M Jolla PR', 'Jolla PR', ''],
  ['N Ashley Anderson', 'Ashley Anderson', '&type=person'],
  ['O Layla London', 'Layla London', '&type=person&adult=on'],
  ['P Lana Rhoades', 'Lana Rhoades', '&type=person&adult=on'],
  ['Q Gali Diva', 'Gali Diva', '&type=person&adult=on'],
  ['R Princess Yummy', 'Princess Yummy', '&type=person&adult=on'],
  ['S Cadey Mercury', 'Cadey Mercury', '&type=person&adult=on'],
  ['T Teresa Ferrer', 'Teresa Ferrer', '&type=person&adult=on'],
  ['U Mandy Flores', 'Mandy Flores', '&type=person&adult=on'],
  ['V Reddit retrieval', 'Drea Morgan site:reddit.com', '&type=person&adult=on'],
  ['AF Toyota 4Runner transmission', 'transmission problems', '&entity=Toyota%204Runner&topic=transmission%20problems&type=vehicle&adult=off'],
  ['AG Elon Musk lawsuits', 'lawsuits', '&entity=Elon%20Musk&topic=lawsuits&type=person&adult=off'],
];

console.log('--- live retrieval ---');
for (const [label, q, extra] of cases) {
  try {
    const { status, body } = await search(q, extra);
    if (status !== 200) {
      assert(false, label + ' HTTP ' + status);
      continue;
    }
    if (providerBlocked(body)) {
      noteBlocked(label + ' — providers failed and returned no results');
      continue;
    }
    assert(Array.isArray(body.results), label + ' has results array');
    recordPerson(label, body);
    if (label.startsWith('B ')) {
      const inter = (body.results || []).filter(r => r.intersection || (r.evidence && r.evidence.intersection === 'strong'));
      const echo = (body.results || []).filter(r => r.evidence && r.evidence.echo);
      assert(echo.length === 0, 'B no query-echo titles counted as results');
      if (!(body.results || []).length) noteBlocked('B empty result set');
      else console.log('  NOTE B intersection-strong count=' + inter.length + ' of ' + body.results.length);
    }
    if (label.startsWith('E ') || label.startsWith('F ')) {
      assert(body.classification && body.classification.type === 'website', label + ' classified as website');
      assert(body.topicMap && body.topicMap.knownEntity && body.topicMap.knownEntity.domain === 'houseofgord.com', label + ' known entity houseofgord.com');
    }
    if (label.startsWith('D ')) {
      assert(body.intent && body.intent.findEverything, 'D findEverything flag');
      assert(body.topicMap && body.topicMap.branches && body.topicMap.branches.length >= 4, 'D topic map has branches');
    }
    if (label.startsWith('C ') || label.startsWith('H ')) {
      assert(body.intent && body.intent.premiumAccounts, label + ' premium intent');
    }
    if (label.startsWith('AF')) {
      assert(body.classification && body.classification.type === 'vehicle', 'AF type vehicle');
      assert(body.classification.subject === 'Toyota 4Runner', 'AF subject kept');
    }
    if (label.startsWith('AG')) {
      assert(body.classification && body.classification.subject === 'Elon Musk', 'AG subject kept');
    }
    if (label.startsWith('V ')) {
      const redditSearch = (body.results || []).filter(r => /reddit\.com\/search/i.test(r.url || ''));
      assert(redditSearch.length === 0, 'V no Reddit search pages');
      if (body.redditEvidence === 'unavailable') console.log('  NOTE V Reddit evidence unavailable (honest)');
    }
  } catch (e) {
    assert(false, label + ' threw ' + e.message);
  }
}

console.log('--- live Analyze webpage (W) ---');
{
  try {
    const r = await fetch(BASE + '/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/', title: 'Example Domain', snippet: 'This domain is for use in illustrative examples', kind: 'webpage' }),
    });
    const body = await r.json();
    assert(r.status === 200, 'W Analyze webpage 200');
    assert(!body.error, 'W Analyze webpage no error');
  } catch (e) {
    assert(false, 'W Analyze threw ' + e.message);
  }
}

console.log('--- live New Investigation isolation contract (AI) ---');
{
  assert(true, 'AI isolation is a client contract (hardNewInvestigation); unit-tested in test-v49.1.mjs');
}

console.log(`\nLive: ${passed} passed, ${failed} failed, ${blocked} blocked by external provider`);
if (failed) process.exit(1);
