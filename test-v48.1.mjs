// v48.1 reserved retrieval, metrics, and focus-mode tests.
// Network is mocked so these assert the production request path, not live providers.
import { readFileSync } from 'node:fs';
import { uniqueAdd, redditBlocked, isRedditHost, adultIdentityQueries, adultIdentityCombinedQuery, buildResearchMetrics, resetFetchBudget, reservedRedditLane, reservedAdultIdentityLane, classifyQuery, applyResearchFilter, rankResults, unwrap, parseBing } from './worker.js';
import worker from './worker.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

const workerSrc = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const appSrc = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');

console.log('--- v48.1 source actually invokes reserved lanes ---');
{
  assert(/await reservedAdultIdentityLane\(/.test(workerSrc), 'runDiscovery calls reservedAdultIdentityLane');
  assert(/await reservedRedditLane\(/.test(workerSrc), 'runDiscovery calls reservedRedditLane');
  assert(/researchMetrics:\s*buildResearchMetrics/.test(workerSrc), 'search payload attaches buildResearchMetrics');
  assert(workerSrc.indexOf('await reservedAdultIdentityLane(') < workerSrc.indexOf('await runVariant('), 'adult identity lane is scheduled before generic web variants');
  assert(/redditIndexedWeb\(/.test(workerSrc) && /redditPullpush\(/.test(workerSrc) && /redditWayback\(/.test(workerSrc), 'indexed/pullpush/wayback helpers exist');
  assert(/results\.length === before/.test(workerSrc), 'DDG retries Lite when this query added nothing');
  assert(/iafd\.com\/results\.asp/.test(workerSrc), 'adult identity lane fetches IAFD directly');
  assert(/babepedia\.com\/babe\//.test(workerSrc), 'adult identity lane fetches Babepedia directly');
  assert(/archive\.org\/wayback\/available/.test(workerSrc), 'Wayback uses the availability API');
  assert(/elapsedMs: Date\.now\(\) - startedAt/.test(workerSrc), 'metrics include retrieval elapsedMs');
}

console.log('--- v48.1 uniqueAdd preserves Reddit indexed results ---');
{
  const results = [], seen = new Set();
  const kept = uniqueAdd(results, seen, {
    title: 'Community discussion about a public figure',
    url: 'https://www.reddit.com/r/example/comments/abc123/hello/',
    source: 'DuckDuckGo',
    snippet: 'Indexed Reddit thread',
  });
  assert(kept === true, 'indexed Reddit URL is not dropped');
  assert(results.length === 1, 'indexed Reddit row stored');
  assert(/^Reddit \(indexed\)/.test(results[0].source), 'source relabeled as Reddit (indexed)');
  assert(results[0].retrievalLane === 'indexed-reddit', 'indexed retrievalLane set');
  assert(results[0].accessState === 'PUBLIC_ALTERNATIVE', 'indexed Reddit is a public alternative');
  uniqueAdd(results, seen, {
    title: 'Direct Reddit thread',
    url: 'https://www.reddit.com/r/example/comments/zzz999/direct/',
    source: 'Reddit · r/example',
    retrievalLane: 'direct-reddit',
  });
  assert(results.length === 2, 'direct Reddit is also kept');
  assert(results[1].retrievalLane === 'direct-reddit', 'direct Reddit provenance preserved');
}

console.log('--- v48.1 redditBlocked ---');
{
  assert(redditBlocked({ Reddit: { status: 403, ok: false } }) === true, '403 is blocked');
  assert(redditBlocked({ Reddit: { status: 200, ok: true } }) === false, '200 is not blocked');
  assert(redditBlocked({ Reddit: { error: 'timeout' } }) === true, 'error is blocked');
  assert(isRedditHost('www.reddit.com') && isRedditHost('old.reddit.com'), 'reddit hosts detected');
}

console.log('--- v48.1 adult identity queries ---');
{
  const on = applyResearchFilter(classifyQuery('Jordan Hale', 'person'), 'on', 'Jordan Hale');
  const qs = adultIdentityQueries(on);
  assert(qs.length >= 6, 'adult person gets identity source queries');
  assert(qs.every(x => x.lane === 'adult-identity'), 'queries tagged adult-identity');
  assert(qs.some(x => /site:iafd\.com/.test(x.q)), 'includes IAFD');
  assert(qs.some(x => /site:babepedia\.com/.test(x.q)), 'includes Babepedia');
  const combined = adultIdentityCombinedQuery(on);
  assert(/site:iafd\.com/.test(combined) && /site:freeones\.com/.test(combined), 'combined query covers identity hosts');
  const off = applyResearchFilter(classifyQuery('Jordan Hale', 'person'), 'off', 'Jordan Hale');
  assert(adultIdentityQueries(off).length === 0, 'adult OFF does not run identity lane queries');
  const skill = applyResearchFilter(classifyQuery('welding a steel frame', 'skill'), 'on', 'welding a steel frame');
  assert(adultIdentityQueries(skill).length === 0, 'non-person does not run adult identity lane');
}

console.log('--- v48.1 researchMetrics payload ---');
{
  const metrics = buildResearchMetrics([
    { title: 'IAFD', url: 'https://www.iafd.com/person.rme/perfid=x', source: 'Bing', retrievalLane: 'adult-identity', sourceLane: 'adult-identity' },
    { title: 'Thread', url: 'https://www.reddit.com/r/x/comments/1/hi/', source: 'Reddit (indexed · DuckDuckGo)', retrievalLane: 'indexed-reddit' },
  ], {
    Reddit: { status: 403, ok: false },
    ReservedReddit: { ran: true, reason: 'direct Reddit blocked/failed', fallbacks: ['ddg-indexed'], added: 1 },
    AdultIdentityLane: { ran: true, sites: ['iafd.com'], added: 1 },
    RedditIndexedDDG: { status: 200, ok: true, added: 1 },
  });
  assert(metrics.version === '48.1', 'metrics version 48.1');
  assert(metrics.resultCount === 2, 'metrics resultCount');
  assert(metrics.reservedLanes.reddit === true, 'metrics reserved reddit true');
  assert(metrics.reservedLanes.adultIdentity === true, 'metrics reserved adult identity true');
  assert(metrics.fallbackUsage.redditIndexed === true, 'metrics reddit indexed fallback');
  assert(metrics.redditProvenance.includes('Reddit (indexed · DuckDuckGo)'), 'metrics keep reddit provenance labels');
  assert(!JSON.stringify(metrics).includes('sk-'), 'metrics are non-sensitive');
}

console.log('--- v48.1 Research Focus UI ---');
{
  assert(/id="focusBlock"/.test(html), 'Research Focus block present');
  assert(/>Person</.test(html) && />Visuals</.test(html) && />Position</.test(html) && />Tutorial</.test(html) && />Clothing</.test(html) && />URL</.test(html) && />Topic</.test(html), 'seven focus chips present');
  const subjectBlock = html.slice(html.indexOf('id="subjectChips"'), html.indexOf('id="subjectChips"') + 900);
  assert(!/data-subject="technique"/.test(subjectBlock), 'SEARCH chips do not include Technique');
  assert(!/data-subject="skill"/.test(subjectBlock), 'SEARCH chips do not include Skill');
  assert(!/data-subject="product"/.test(subjectBlock), 'SEARCH chips do not include Product');
  const learnBlock = html.slice(html.indexOf('id="learnChips"'), html.indexOf('id="learnChips"') + 900);
  assert(/data-learn="person"/.test(learnBlock) && /data-learn="visuals"/.test(learnBlock), 'LEARN uses the same seven focuses');
  assert(!/data-learn="technique"/.test(learnBlock), 'LEARN does not keep Technique');
  assert(!/data-learn="skill"/.test(learnBlock), 'LEARN does not keep Skill');
  assert(!/data-learn="product"/.test(learnBlock), 'LEARN does not keep Product');
  assert(appSrc.includes("const VERSION = '48.1'"), 'frontend version 48.1');
}

console.log('--- v48.1 rankResults keeps reserved lanes in the window ---');
{
  const cls = applyResearchFilter(classifyQuery('Jordan Hale', 'person'), 'on', 'Jordan Hale');
  const rows = [];
  for (let i = 0; i < 24; i++) {
    rows.push({ title: 'Jordan Hale interview video ' + i, url: 'https://www.youtube.com/watch?v=abcDEFxxxx' + String(i).padStart(2, '0'), source: 'Bing Videos', snippet: 'video' });
  }
  rows.push({ title: 'Jordan Hale - IAFD', url: 'https://www.iafd.com/person.rme/perfid=jh/gender=f/jordan-hale.htm', source: 'Bing', snippet: 'performer database', retrievalLane: 'adult-identity', sourceLane: 'adult-identity' });
  rows.push({ title: 'Jordan Hale discussion', url: 'https://www.reddit.com/r/example/comments/abc123/jordan_hale/', source: 'Reddit (indexed · Bing)', snippet: 'thread', retrievalLane: 'indexed-reddit' });
  const ranked = rankResults('Jordan Hale', rows, cls);
  assert(ranked.length <= 20, 'ranked window still capped');
  assert(ranked.some(r => /iafd\.com/i.test(r.url)), 'adult identity result survives the ranked window');
  assert(ranked.some(r => /reddit\.com/i.test(r.url)), 'indexed Reddit result survives the ranked window');
}

console.log('--- v48.1 unwrap Bing ck/a and parseBing cite ---');
{
  const encoded = Buffer.from('https://www.reddit.com/r/example/comments/abc123/hello/').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const wrapped = 'https://www.bing.com/ck/a?!&&p=1&u=a1' + encoded;
  assert(unwrap(wrapped) === 'https://www.reddit.com/r/example/comments/abc123/hello/', 'unwrap decodes Bing ck/a a1 payload');
  const results = [], seen = new Set();
  const html = '<li class="b_algo"><h2>Jordan Hale IAFD</h2><a href="https://www.bing.com/ck/a?u=https://www.bing.com/">x</a><cite>https://www.iafd.com › person.rme</cite><p>database</p></li>';
  parseBing(html, results, seen);
  assert(results.length === 1, 'parseBing cite fallback stores a result');
  assert(/iafd\.com/i.test(results[0].url), 'parseBing cite reconstructs the identity host');
}

console.log('--- v48.1 mocked /search path actually runs reserved helpers ---');
{
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    if (/reddit\.com\/.*search|api\.reddit\.com/.test(href)) {
      return new Response('forbidden', { status: 403 });
    }
    if (/iafd\.com\/results\.asp/.test(href)) {
      return new Response('<a href="/person.rme/id=jh">Jordan Hale</a>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (/babepedia\.com\/babe\//.test(href)) {
      return new Response('<title>Jordan Hale - Babepedia</title>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (/archive\.org\/wayback\/available/.test(href)) {
      return new Response(JSON.stringify({ archived_snapshots: { closest: { available: true, url: 'https://web.archive.org/web/20200101000000/https://www.reddit.com/r/example/' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (/html\.duckduckgo|lite\.duckduckgo/.test(href)) {
      const reddit = decodeURIComponent(href).includes('site:reddit.com');
      const identity = decodeURIComponent(href).includes('site:iafd.com');
      const target = identity
        ? 'https://www.iafd.com/person.rme/perfid=jh/gender=f/jordan-hale.htm'
        : (reddit ? 'https://www.reddit.com/r/example/comments/abc123/jordan_hale/' : 'https://www.example.com/jordan-hale');
      const title = identity ? 'Jordan Hale - IAFD' : (reddit ? 'Jordan Hale discussion' : 'Jordan Hale profile');
      return new Response(`<a class="result__a" href="${target}">${title}</a><a class="result__snippet">public snippet</a>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (/bing\.com\/search/.test(href)) {
      const decoded = decodeURIComponent(href);
      const reddit = decoded.includes('site:reddit.com');
      const identity = decoded.includes('site:iafd.com');
      const wayback = /web\.archive\.org/.test(decoded);
      const target = wayback
        ? 'https://web.archive.org/web/20200101000000/https://www.reddit.com/r/example/comments/abc123/jordan_hale/'
        : identity
          ? 'https://www.iafd.com/person.rme/perfid=jh/gender=f/jordan-hale.htm'
          : (reddit ? 'https://www.reddit.com/r/example/comments/def456/jordan_hale_ama/' : 'https://news.example.com/jordan-hale-interview');
      const title = wayback ? 'Archived Reddit thread' : (identity ? 'Jordan Hale IAFD' : (reddit ? 'Jordan Hale AMA' : 'Jordan Hale interview'));
      return new Response(`<li class="b_algo"><h2>${title}</h2><a href="${target}">x</a><p>public snippet</p></li>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (/pullpush\.io/.test(href)) {
      return new Response(JSON.stringify({ data: [{ title: 'Jordan Hale archive post', permalink: '/r/example/comments/pp123/jordan_hale_archive/', selftext: 'pullpush hit' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (/wikipedia\.org/.test(href)) {
      return new Response(JSON.stringify({ query: { search: [] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (/bing\.com\/images|bing\.com\/videos|images\.search\.yahoo/.test(href)) {
      return new Response('', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('', { status: 200 });
  };
  try {
    resetFetchBudget(28);
    const res = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Jordan Hale') + '&adult=on&type=person'), {});
    const body = await res.json();
    assert(res.status === 200, 'mocked /search 200');
    assert(body.researchMetrics && typeof body.researchMetrics === 'object', '/search returns researchMetrics');
    assert(body.researchMetrics.resultCount === body.count, 'metrics resultCount matches results');
    assert(body.researchMetrics.reservedLanes, 'metrics include reservedLanes');
    const decodedCalls = calls.map(u => { try { return decodeURIComponent(u); } catch { return u; } });
    assert(decodedCalls.some(u => /site:reddit\.com/i.test(u)), 'production search actually requested site:reddit.com');
    assert(decodedCalls.some(u => /site:reddit\.com/i.test(u) && !/photoset/i.test(u)), 'reserved reddit query is the subject, not an intersection dump');
    assert(decodedCalls.some(u => /iafd\.com\/results\.asp/i.test(u) || /babepedia\.com\/babe\//i.test(u)), 'production search actually fetched identity sources directly');
    assert(body.researchMetrics.elapsedMs >= 0, 'metrics include elapsedMs');
    assert(body.researchMetrics.reservedLanes.adultIdentity === true, 'adult identity lane ran on adult person search');
    const redditRows = (body.results || []).filter(r => /reddit\.com/i.test(r.url || '') || /Reddit/i.test(r.source || ''));
    assert(redditRows.length > 0, 'Reddit indexed results were retained');
    assert(redditRows.every(r => /Reddit/i.test(r.source || '')), 'Reddit provenance labels survive into the result set');
    const identityRows = (body.results || []).filter(r => r.retrievalLane === 'adult-identity' || r.sourceLane === 'adult-identity' || /iafd\.com/i.test(r.url || ''));
    assert(identityRows.length > 0, 'adult identity source results present');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
