// v49.6 live / browser acceptance. Hits the running Worker (test-server or production).
import { classifyQuery, applyResearchFilter, classifyAccess } from './worker.js';
import worker from './worker.js';

const ORIGIN = process.env.CARMEN_ORIGIN || 'http://127.0.0.1:8080';
let passed = 0, failed = 0, notes = {};
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

async function getJson(path, ms = 90000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(ORIGIN + path, { headers: { accept: 'application/json' }, signal: ctrl.signal });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 400) }; }
    return { status: r.status, body };
  } finally { clearTimeout(t); }
}

console.log('--- live origin', ORIGIN, '---');

{
  const h = await getJson('/health', 15000);
  assert(h.status === 200, 'health 200');
  assert(h.body.version === '49.7' || h.body.version === '49.6', 'deployed version current');
  assert(/49\.7-retrieval-engine|49\.6-correctness-ux/.test(h.body.build || ''), 'deployed build current');
  notes.version = h.body.version;
  notes.build = h.body.build;
}

{
  const drea = applyResearchFilter(classifyQuery('Drea Morgan'), 'on', 'Drea Morgan');
  assert(drea.type === 'person' && drea.intentClass === 'PERSON', 'A classifier: Drea Morgan is PERSON');
  const live = await getJson('/search?q=' + encodeURIComponent('Drea Morgan') + '&type=person&adult=on');
  assert(live.status === 200, 'A live Drea Morgan search 200');
  const results = live.body.results || [];
  notes.dreaCount = results.length;
  notes.dreaVisuals = (live.body.visuals || live.body.visualCorpus || []).length;
  notes.dreaDreamorgan = results.some(r => /dreamorgan\.com/i.test(r.url || r.domain || ''));
  notes.dreaExtraction = (live.body.extractionFailures || []).filter(f => /dreamorgan/i.test(f.url || f.domain || ''));
  notes.dreaDeMatteo = results.filter(r => /de matteo/i.test((r.title || '') + (r.snippet || ''))).length;
  assert(live.body.classification && live.body.classification.type === 'person', 'B classification PERSON');
  assert(!(live.body.classification && live.body.classification.type === 'technique'), 'Drea is not a technique');
  assert(notes.dreaDeMatteo === 0, 'Drea de Matteo excluded unless requested');
  const visualUrls = (live.body.visuals || live.body.visualCorpus || []).filter(v => v && /^https?:/i.test(v.url || v.src || ''));
  notes.dreaUsableVisuals = visualUrls.length;
  notes.duplicateVisuals = visualUrls.length - new Set(visualUrls.map(v => String(v.url || v.src).replace(/[?#].*$/, ''))).size;
  const unrelated = (live.body.visuals || []).filter(v => /de matteo|generic bondage|meme/i.test((v.title || '') + (v.snippet || '') + (v.pageUrl || '')));
  notes.unrelatedVisuals = unrelated.length;
  console.log('  RECORD Drea Morgan results=' + notes.dreaCount + ' visuals=' + notes.dreaUsableVisuals + ' dreamorgan=' + notes.dreaDreamorgan + ' extractionFailures=' + (live.body.extractionFailures || []).length);
}

{
  const fx = await getJson('/search?q=' + encodeURIComponent('Drea Morgan') + '&type=person&adult=on&fixture=drea-intersection', 20000);
  assert(fx.status === 200, 'fixture Drea Morgan 200');
  assert((fx.body.results || []).some(r => /dreamorgan\.com/i.test(r.url || '')), 'F fixture treats official site as a source');
}

{
  const frogC = classifyQuery('frog tie bondage');
  assert(frogC.type !== 'person' && frogC.intentClass === 'OBJECT', 'L frog tie bondage = OBJECT/TECHNIQUE + TOPIC');
  const live = await getJson('/search?q=' + encodeURIComponent('frog tie bondage') + '&adult=on');
  assert(live.status === 200, 'J live frog tie bondage 200');
  notes.frogCount = (live.body.results || []).length;
  notes.frogType = live.body.classification && live.body.classification.type;
  notes.frogIntent = live.body.classification && live.body.classification.intentClass;
  assert(live.body.classification && live.body.classification.type !== 'person', 'K frog tie is not a person search');
  const blob = JSON.stringify(live.body).toLowerCase();
  assert(!/\briley reid\b/.test(blob), 'K zero Riley Reid state in frog-tie payload');
  notes.rileyLeak = /\briley reid\b/.test(blob) ? 'FAIL' : 0;
  console.log('  RECORD frog tie results=' + notes.frogCount + ' type=' + notes.frogType + ' intent=' + notes.frogIntent);
}

{
  const riley = await getJson('/search?q=' + encodeURIComponent('Riley Reid bondage') + '&type=person&adult=on');
  assert(riley.status === 200, 'O Riley Reid bondage 200');
  assert(riley.body.classification && riley.body.classification.type === 'person', 'P PERSON × TOPIC');
  assert(/bondage/i.test((riley.body.classification && (riley.body.classification.context || riley.body.classification.relation)) || ''), 'P keeps bondage topic');
}

{
  const acc = classifyAccess({ httpStatus: 503, html: '', url: 'https://example.com/x', host: 'example.com' });
  assert(acc.accessState === 'UNAVAILABLE', 'Q 503 is UNAVAILABLE');
  assert(/not evidence that nothing exists/i.test(acc.note), 'Q 503 is not “nothing found”');
  notes.http503 = acc.accessState + ' · ' + acc.note;
}

{
  const vis = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Drea Morgan') + '&entity=' + encodeURIComponent('Drea Morgan') + '&type=person&adult=on&diveLens=visuals&mode=dive-visuals&fixture=drea-intersection'), {});
  const body = await vis.json();
  assert(vis.status === 200, 'E Drea Visuals fixture 200');
  assert(body.classification && /drea morgan/i.test(body.classification.subject || body.query || ''), 'E Visuals preserve Drea Morgan identity');
}

console.log('\nACCEPTANCE');
console.log(JSON.stringify({
  version: notes.version,
  build: notes.build,
  dreaCount: notes.dreaCount,
  dreaVisuals: notes.dreaUsableVisuals,
  dreamorgan: notes.dreaDreamorgan,
  dreamorganExtraction: notes.dreaExtraction,
  frogCount: notes.frogCount,
  rileyLeak: notes.rileyLeak,
  duplicateVisuals: notes.duplicateVisuals,
  unrelatedVisuals: notes.unrelatedVisuals,
  http503: notes.http503,
}, null, 2));
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
