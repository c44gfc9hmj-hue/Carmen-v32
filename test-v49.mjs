// v49 investigation loop: keep subject, compose entity+topic, dive UX, trail.
import { readFileSync } from 'node:fs';
import { composeInvestigationQuery, diveSeedQuery, classifyQuery, applyResearchFilter, extraContext } from './worker.js';
import worker from './worker.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

const workerSrc = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const appSrc = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');

console.log('--- v49 source / UX contracts ---');
{
  assert(/49\.[345678]/.test(readFileSync(new URL('./VERSION', import.meta.url), 'utf8')), 'VERSION current');
  assert(/const VERSION = '49\.[0-9]'/.test(appSrc), 'frontend VERSION 49.x');

  assert(/carmen-build" content="49\.[345678]"/.test(html), 'html build current');
  assert(/What are you curious about\?/.test(html), 'home curiosity prompt');
  assert(/id="diveSearchQuery"/.test(html), 'persistent dive search');
  assert(/id="diveStream"/.test(html), 'dive stream');
  assert(/id="howGotHereBtn"/.test(html), 'How I got here');
  assert(/id="surpriseMeBtn"/.test(html), 'home Surprise me');
  assert(/data-divetab="overview"/.test(html) && /data-divetab="posts"/.test(html) && /data-divetab="images"/.test(html) && /data-divetab="sources"/.test(html), 'dive tabs');
  assert(/(More investigation options|Ask Carmen anything)/.test(html) && /<\/details>/.test(html), 'planner is optional details');
  assert(/keepSubject/.test(appSrc) && /investigateTopic/.test(appSrc), 'client keeps subject in dive search');
  assert(/foundThrough/.test(appSrc) && /parentId/.test(appSrc), 'saves keep foundThrough/parentId');
  assert(/That’s the one/.test(appSrc) && /Not this one/.test(appSrc), 'interactive identity');
  assert(/cannot currently inspect the actual video frames/.test(appSrc), 'video analysis honesty');
  assert(/composeInvestigationQuery/.test(workerSrc) && /opts\.entity/.test(workerSrc), 'worker entity/topic');
  assert(/v49-investigation-loop/.test(workerSrc), 'health still lists v49-investigation-loop');
}

console.log('--- v49 composeInvestigationQuery ---');
{
  assert(composeInvestigationQuery('bondage', 'Drea Morgan', 'bondage') === 'Drea Morgan bondage', 'topic-only becomes entity + topic');
  assert(composeInvestigationQuery('Drea Morgan bondage', 'Drea Morgan', 'bondage') === 'Drea Morgan bondage', 'already composed stays composed');
  assert(composeInvestigationQuery('transmission problems', 'Toyota 4Runner', 'transmission problems') === 'Toyota 4Runner transmission problems', 'vehicle + problem');
  assert(composeInvestigationQuery('lawsuits', 'Elon Musk', 'lawsuits') === 'Elon Musk lawsuits', 'person + lawsuits');
  assert(composeInvestigationQuery('', 'Riley Reid', '') === 'Riley Reid', 'entity only');
  assert(composeInvestigationQuery('bondage', '', 'bondage') === 'bondage', 'no entity leaves topic');
}

console.log('--- v49 diveSeedQuery keeps subject ---');
{
  const cls = { subject: 'Drea Morgan', type: 'person', context: 'bondage' };
  assert(diveSeedQuery(cls, 'bondage', 'Drea Morgan', '') === 'Drea Morgan bondage', 'dive seed does not drop the subject');
  assert(diveSeedQuery(cls, 'Drea Morgan bondage', 'Drea Morgan', '') === 'Drea Morgan bondage', 'already composed original stays');
  assert(diveSeedQuery(cls, 'Drea Morgan', 'Drea Morgan', '') === 'Drea Morgan bondage', 'bare original name still carries the active topic');
}

console.log('--- v49 /search entity+topic does not classify as topic-only ---');
{
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response('<a class="result__a" href="https://www.example.com/drea-morgan-bondage">Drea Morgan discussion</a><a class="result__snippet">public snippet</a>', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  try {
    const res = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('bondage') + '&entity=' + encodeURIComponent('Drea Morgan') + '&topic=bondage&type=person&adult=on'), {});
    const body = await res.json();
    assert(res.status === 200, 'entity+topic /search 200');
    assert(body.classification && body.classification.subject === 'Drea Morgan', 'classification.subject stays the entity');
    assert(body.classification.type === 'person', 'type stays person, not generic topic');
    assert(/bondage/i.test(extraContext(body.classification) || ''), 'context is the topic');
    assert(body.investigationContext && body.investigationContext.keptSubject === true, 'investigationContext.keptSubject');
    const decoded = calls.map(u => { try { return decodeURIComponent(u); } catch { return u; } });
    assert(decoded.some(u => /Drea Morgan/i.test(u) && /bondage/i.test(u)), 'retrieval actually queried entity + topic');
    assert(!decoded.every(u => /bondage/i.test(u) && !/Drea Morgan/i.test(u)), 'not every query is the topic alone');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('--- v49 vehicle + problem uses hint, not person default ---');
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 200 });
  try {
    const res = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('transmission problems') + '&entity=' + encodeURIComponent('Toyota 4Runner') + '&topic=' + encodeURIComponent('transmission problems') + '&type=vehicle&adult=off'), {});
    const body = await res.json();
    assert(body.classification.subject === 'Toyota 4Runner', 'vehicle subject kept');
    assert(body.classification.type === 'vehicle', 'type is vehicle — not hardcoded person');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('--- v49 health ---');
{
  const res = await worker.fetch(new Request('https://test/health'), {});
  const body = await res.json();
  assert(body.version === '49.8' || body.version === '49.7' || body.version === '49.6' || body.version === '49.5' || body.version === '49.4' || body.version === '49.3', 'health version current');
  assert(/49.(3|4|5|6|7|8)/.test(body.build || ''), 'health build current');
  assert((body.features || []).includes('v49-dive-context-search'), 'feature flag dive-context-search');
  assert((body.features || []).includes('v49.2-topic-map-retrieval'), 'feature flag topic-map-retrieval');
  assert((body.features || []).includes('v49.3-chatgpt-access'), 'feature flag chatgpt-access');
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
