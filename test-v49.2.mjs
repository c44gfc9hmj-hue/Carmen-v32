// v49.2 investigation / topic-map planner tests.
import { readFileSync } from 'node:fs';
import {
  parseInvestigationIntent,
  resolveKnownEntity,
  buildTopicMap,
  plannerLaneQueries,
  evidenceForResult,
  isQueryEchoTitle,
  isRedditSearchPage,
  isActualRedditEvidence,
  annotateProvenance,
  classifyAccountOwnership,
  mergeInvestigationEvidence,
  sourceDiversityReport,
  corpusDiagnosis,
  competingIdentityCandidates,
  findMoreQueries,
  moreLikeThisQueries,
  findDifferentQueries,
  surpriseHeuristic,
  imageQueryInherits,
  analyzePayloadKind,
  videoFrameHonesty,
  canonicalizeUrl,
  PLANNER_VERSION,
  PLANNER_BUILD,
  KNOWN_SITE_ENTITIES,
  ADULT_SOURCE_CLASSES,
} from './investigation-planner.js';
import {
  classifyQuery,
  uniqueAdd,
  composeInvestigationQuery,
  extraContext,
  scoreResult,
  rankResults,
  applyResearchFilter,
} from './worker.js';
import worker from './worker.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

const workerSrc = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
const appSrc = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const plannerSrc = readFileSync(new URL('./investigation-planner.js', import.meta.url), 'utf8');

console.log('--- v49.2 version / source contracts ---');
{
  assert(PLANNER_VERSION === '49.2', 'PLANNER_VERSION 49.2');
  assert(PLANNER_BUILD === '49.2-topic-map-retrieval', 'PLANNER_BUILD');
  assert(/49\.2/.test(readFileSync(new URL('./VERSION', import.meta.url), 'utf8')), 'VERSION file');
  assert(appSrc.includes("const VERSION = '49.2'"), 'frontend VERSION');
  assert(/carmen-build" content="49\.2"/.test(html), 'html build');
  assert(/carmen-v49\.2-topic-map-retrieval/.test(readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8')), 'sw cache');
  assert(/from '\.\/investigation-planner\.js'/.test(workerSrc), 'worker imports planner');
  assert(/hardNewInvestigation/.test(appSrc) && /renderTopicMap/.test(appSrc), 'frontend topic map + hard reset');
  assert(/findEverything/.test(appSrc) && /rejectedPeople/.test(appSrc) && /confirmedIdentity/.test(appSrc), 'frontend planner params');
  assert(/data-findmore="different"/.test(appSrc), 'Find different is a distinct control');
  assert(/\/analyze/.test(appSrc), 'Analyze POSTs to /analyze');
  assert(/id="newInvestigationBtn"/.test(html) && /id="topicMap"/.test(html), 'New investigation + topic map chrome');
  assert(!KNOWN_SITE_ENTITIES.some(e => /drea|riley|chanta|peachjars|sensi pearl/i.test(JSON.stringify(e))), 'known-entity registry is not a hardcoded person list');
}

console.log('--- v49.2 known site / House of Gord ---');
{
  const ent = resolveKnownEntity('House of Gord');
  assert(!!ent && ent.domain === 'houseofgord.com', 'House of Gord resolves to houseofgord.com');
  assert(ent.type === 'website', 'House of Gord is a website entity');
  const cls = classifyQuery('House of Gord');
  assert(cls.type === 'website', 'classifyQuery(House of Gord) is website');
  assert(cls.resolvedDomain === 'houseofgord.com' || /houseofgord/.test(cls.reason || ''), 'classification mentions the domain');
  const intent = parseInvestigationIntent('House of Gord bondage', { adult: 'on' });
  assert(intent.knownEntity && intent.knownEntity.domain === 'houseofgord.com', 'intent captures known entity');
  assert(/bondage/i.test(intent.topic || ''), 'House of Gord + bondage keeps the topic');
  const map = buildTopicMap(intent, { subject: 'House of Gord', type: 'website', context: 'bondage', adultContent: 'on' });
  const ids = map.branches.map(b => b.id);
  assert(ids.includes('site') && ids.includes('products-content') && ids.includes('people'), 'ecosystem branches: site/products/people');
  const qs = plannerLaneQueries(map, { limit: 20 }).map(x => x.q).join(' ');
  assert(/site:houseofgord\.com/.test(qs), 'planner queries include site:houseofgord.com');
}

console.log('--- v49.2 subject × topic evidence ---');
{
  const intent = parseInvestigationIntent('Drea Morgan bondage', { entity: 'Drea Morgan', topic: 'bondage', adult: 'on' });
  assert(intent.mode === 'intersection' || intent.topic === 'bondage', 'Drea + bondage is intersection');
  const profile = evidenceForResult({
    title: 'Drea Morgan - IAFD',
    url: 'https://www.iafd.com/person.rme/perfid=dreamorgan',
    snippet: 'Performer bio and filmography.',
  }, intent, { subject: 'Drea Morgan', context: 'bondage', type: 'person' });
  assert(profile.subjectEvidence === 'strong', 'IAFD profile is strong subject evidence');
  assert(profile.intersection !== 'strong', 'identity-only profile is not Drea+bondage intersection');
  const echo = evidenceForResult({
    title: 'Drea Morgan bondage',
    url: 'https://example.com/results',
    snippet: 'Search results for Drea Morgan bondage',
  }, intent, { subject: 'Drea Morgan', context: 'bondage' });
  assert(echo.echo === true, 'query-echo title flagged');
  assert(echo.intersection !== 'strong', 'query-echo is never strong intersection');
  const real = evidenceForResult({
    title: 'Drea Morgan metal bondage photoset at House of Gord',
    url: 'https://www.houseofgord.com/dreamorgan-cinch',
    snippet: 'Drea Morgan in a metal bondage feature with cinch straps.',
  }, intent, { subject: 'Drea Morgan', context: 'bondage', type: 'person' });
  assert(real.subjectEvidence !== 'none' && real.topicEvidence !== 'none', 'real page has independent subject and topic evidence');
  assert(real.intersection === 'strong' || real.intersection === 'weak', 'real page can count as intersection');
}

console.log('--- v49.2 scoreResult does not promote echo/profile as strong ∩ ---');
{
  const cls = applyResearchFilter(classifyQuery('Drea Morgan bondage', 'person'), 'on', 'Drea Morgan bondage');
  cls.subject = 'Drea Morgan';
  cls.context = 'bondage';
  cls.adultContent = 'on';
  const echoScore = scoreResult('Drea Morgan bondage', {
    title: 'Drea Morgan bondage',
    url: 'https://example.com/q',
    snippet: 'Drea Morgan bondage',
  }, cls);
  assert(echoScore.intersection !== true, 'echo title is not scored as intersection');
  const profileScore = scoreResult('Drea Morgan bondage', {
    title: 'Drea Morgan',
    url: 'https://www.iafd.com/person.rme/perfid=dreamorgan',
    snippet: 'Adult performer profile and credits.',
  }, cls);
  assert(profileScore.intersection !== true, 'identity-only profile is not scored as intersection');
}

console.log('--- v49.2 find everything / premium / adult lanes ---');
{
  const intent = parseInvestigationIntent('find everything related to Drea Morgan bondage', { entity: 'Drea Morgan', topic: 'bondage', adult: 'on', type: 'person' });
  assert(intent.findEverything === true, 'find everything intent');
  const map = buildTopicMap(intent, { subject: 'Drea Morgan', type: 'person', context: 'bondage', adultContent: 'on' });
  const ids = map.branches.map(b => b.id);
  assert(ids.includes('identity') || ids.includes('identity-profile'), 'identity branch');
  assert(ids.some(id => /premium|major-platform|onlyfans/.test(id) || map.branches.some(b => b.sourceClass === 'major-platform')), 'major platform branch');
  assert(map.branches.some(b => b.sourceClass === 'premium-subscription'), 'premium branch');
  assert(map.branches.some(b => b.sourceClass === 'fetish-publisher'), 'fetish publisher branch');
  assert(ADULT_SOURCE_CLASSES.some(c => c.seeds.includes('onlyfans.com')), 'OnlyFans seed');
  assert(ADULT_SOURCE_CLASSES.some(c => c.seeds.includes('fansly.com')), 'Fansly seed');
  assert(ADULT_SOURCE_CLASSES.some(c => c.seeds.includes('houseofgord.com')), 'House of Gord seed in fetish class');
  const prem = parseInvestigationIntent('all premium accounts for Drea Morgan', { entity: 'Drea Morgan', adult: 'on', type: 'person' });
  assert(prem.premiumAccounts === true, 'premium accounts intent');
  const pmap = buildTopicMap(prem, { subject: 'Drea Morgan', type: 'person', adultContent: 'on' });
  assert(pmap.branches.some(b => /onlyfans/i.test(b.id + b.label)), 'OnlyFans lane in premium map');
}

console.log('--- v49.2 provenance / ownership ---');
{
  const p = annotateProvenance({ url: 'https://www.pinterest.com/pin/123', title: 'pin' });
  assert(p.host === 'pinterest.com', 'host is host');
  assert(p.creator === 'UNKNOWN', 'creator is UNKNOWN unless stated');
  assert(p.reposter === 'pinterest.com', 'pinterest is a reposter');
  const dir = classifyAccountOwnership({ url: 'https://www.indexxx.com/m/drea-morgan', title: 'Drea Morgan links' }, 'Drea Morgan');
  assert(dir.kind === 'directory listing', 'directory is not proof of ownership');
  const of = classifyAccountOwnership({ url: 'https://onlyfans.com/dreamorgan', title: 'Drea Morgan official' }, 'Drea Morgan');
  assert(of.kind === 'official account' || of.kind === 'creator-owned account' || of.kind === 'unknown', 'platform account classified, never silently a directory');
  assert(of.kind !== 'directory listing', 'onlyfans.com/handle is not a directory listing');
}

console.log('--- v49.2 merge / diversity / diagnosis ---');
{
  const merged = mergeInvestigationEvidence(
    [{ url: 'https://www.iafd.com/person.rme/perfid=x', title: 'A' }],
    [{ url: 'https://iafd.com/person.rme/perfid=x?utm_source=x', title: 'A dup' }, { url: 'https://babepedia.com/babe/X', title: 'B' }]
  );
  assert(merged.length === 2, 'canonical URL merge keeps prior and adds new');
  const report = sourceDiversityReport([
    { url: 'https://www.youtube.com/watch?v=1', title: 'yt' },
    { url: 'https://www.pinterest.com/pin/1', title: 'pin' },
    { url: 'https://www.bing.com/search?q=x', title: 'bing' },
    { url: 'https://obscure-mirror.example/x', title: 'mirror' },
  ], { adultOn: true });
  assert(report.shouldOpenMoreAdultLanes === true, 'generic-heavy adult lens opens more adult lanes');
  const thin = corpusDiagnosis([{ evidence: { subjectEvidence: 'strong', topicEvidence: 'none', intersection: 'none' } }], {}, { subject: 'Drea Morgan', topic: 'bondage' });
  assert(thin.status === 'evidence_unavailable' || thin.status === 'thin_corpus' || thin.status === 'ok', 'diagnosis is a labeled status, not a silent skip');
  const failed = corpusDiagnosis([], { Bing: { error: 'timeout', status: 500 }, DuckDuckGo: { error: 'timeout' } }, {});
  assert(failed.status === 'search_failed', 'provider failure is search_failed, not thin corpus');
}

console.log('--- v49.2 find more / like this / different are distinct ---');
{
  const intent = { subject: 'Drea Morgan', topic: 'bondage' };
  const more = findMoreQueries(intent, []);
  const like = moreLikeThisQueries(intent, { url: 'https://www.houseofgord.com/x', domain: 'houseofgord.com', title: 'metal cinch feature' });
  const diff = findDifferentQueries(intent, { excludeHosts: ['pinterest.com', 'youtube.com'] });
  assert(more[0].lane === 'find-more', 'find more lane');
  assert(like[0].lane === 'more-like-this', 'more like this lane');
  assert(diff[0].lane === 'find-different', 'find different lane');
  assert(diff.some(q => /-site:pinterest\.com/.test(q.q)), 'find different excludes seen hosts');
  assert(JSON.stringify(more) !== JSON.stringify(like), 'intents are not relabeled copies');
}

console.log('--- v49.2 image inherit / analyze / video honesty / surprise ---');
{
  const img = imageQueryInherits(
    { subject: 'Drea Morgan', topic: 'bondage', adultLens: 'on' },
    { subject: 'Drea Morgan', context: 'bondage', adultContent: 'on' },
    { confirmed: ['Drea Morgan'], rejectedHosts: ['pinterest.com'] }
  );
  assert(/Drea Morgan/.test(img.q) && /bondage/.test(img.q), 'image query inherits subject + topic');
  assert(img.identityConfirmed === true && img.inherit.negativeFeedback === true, 'identity feedback inherited');
  assert(/-site:pinterest\.com/.test(img.q), 'rejected hosts appear as negatives');
  assert(analyzePayloadKind({ url: 'https://example.com/article', title: 'Page' }) === 'webpage', 'webpage payload kind');
  assert(analyzePayloadKind({ url: 'https://www.reddit.com/r/x/comments/abc/hi' }) === 'reddit', 'reddit payload kind');
  assert(analyzePayloadKind({ imageDataUrl: 'data:image/jpeg;base64,xx' }) === 'image', 'image payload kind');
  assert(analyzePayloadKind({ kind: 'video', url: 'https://youtube.com/watch?v=1' }) === 'video', 'video payload kind');
  const frames = videoFrameHonesty();
  assert(frames.framesInspected === false && frames.timestamps === 'UNKNOWN', 'video frames UNKNOWN until real analysis');
  const empty = surpriseHeuristic([]);
  assert(!empty.pick && /hidden preference model/.test(empty.reason), 'surprise is transparent when empty');
  const picked = surpriseHeuristic([{ kind: 'save', title: 'Drea Morgan interview' }]);
  assert(picked.pick && /Drea Morgan interview/.test(picked.reason), 'surprise prefers explicit interaction');
}

console.log('--- v49.2 uniqueAdd reddit/echo ---');
{
  const results = [], seen = new Set();
  assert(uniqueAdd(results, seen, { title: 'Reddit public search', url: 'https://www.reddit.com/search/?q=x' }) === false, 'search page dropped');
  assert(isActualRedditEvidence('https://www.reddit.com/r/x/comments/abc/hi') === true, 'comment URL is actual evidence');
}

console.log('--- v49.2 /search mocked: House of Gord + Drea intersection flags ---');
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (/houseofgord|gord/i.test(u)) {
      return new Response('<a class="result__a" href="https://www.houseofgord.com/">House of Gord official site</a><a class="result__snippet">Metal bondage studio houseofgord.com</a>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response(
      '<a class="result__a" href="https://www.iafd.com/person.rme/perfid=dreamorgan">Drea Morgan</a><a class="result__snippet">Performer profile</a>' +
      '<a class="result__a" href="https://www.houseofgord.com/drea-morgan-bondage">Drea Morgan metal bondage feature</a><a class="result__snippet">Drea Morgan in a bondage photoset</a>' +
      '<a class="result__a" href="https://www.reddit.com/search/?q=drea">Reddit public search</a><a class="result__snippet">search</a>',
      { status: 200, headers: { 'content-type': 'text/html' } }
    );
  };
  try {
    const hog = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('House of Gord') + '&adult=on'), {});
    const hogBody = await hog.json();
    assert(hog.status === 200, 'House of Gord /search 200');
    assert(hogBody.classification && hogBody.classification.type === 'website', 'House of Gord type is website');
    assert(hogBody.topicMap && hogBody.topicMap.knownEntity && hogBody.topicMap.knownEntity.domain === 'houseofgord.com', 'topic map known entity');
    assert((hogBody.results || []).some(r => /houseofgord\.com/i.test(r.url || '')), 'known site is injected as a lead even if indexes hide it');
    const drea = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('bondage') + '&entity=' + encodeURIComponent('Drea Morgan') + '&topic=bondage&type=person&adult=on'), {});
    const body = await drea.json();
    assert(drea.status === 200, 'Drea+bondage /search 200');
    assert(body.classification.subject === 'Drea Morgan', 'subject stays Drea Morgan');
    assert(!((body.results || []).some(r => isRedditSearchPage(r.url, r.title))), 'no Reddit search pages in results');
    const everything = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('find everything related to Drea Morgan') + '&entity=' + encodeURIComponent('Drea Morgan') + '&type=person&adult=on&findEverything=1'), {});
    const ev = await everything.json();
    assert(ev.intent && ev.intent.findEverything === true, 'findEverything intent in payload');
    assert(ev.topicMap && Array.isArray(ev.topicMap.branches) && ev.topicMap.branches.length >= 4, 'find everything returns a topic map');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('--- v49.2 Analyze accepts webpage without 500 ---');
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html><title>Public page</title><body>Drea Morgan interview about bondage work.</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  try {
    const res = await worker.fetch(new Request('https://test/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/interview', title: 'Interview', snippet: 'Public interview', kind: 'webpage' }),
    }), {});
    const body = await res.json();
    assert(res.status === 200, 'Analyze webpage 200, not 500');
    assert(!body.error, 'Analyze webpage has no error field');
    assert(body.kind === 'webpage' || Array.isArray(body.sourceFacts), 'Analyze returns evidence-object payload');
    const vid = await worker.fetch(new Request('https://test/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=abc', title: 'Clip', kind: 'video' }),
    }), {});
    const vbody = await vid.json();
    assert(vid.status === 200, 'Analyze video 200');
    assert(vbody.videoFrames && vbody.videoFrames.timestamps === 'UNKNOWN', 'video frames UNKNOWN');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('--- v49.2 health ---');
{
  const res = await worker.fetch(new Request('https://test/health'), {});
  const body = await res.json();
  assert(body.version === '49.2', 'health version');
  assert(body.build === '49.2-topic-map-retrieval', 'health build');
  for (const f of ['v49.2-topic-map-retrieval', 'v49.2-subject-topic-intersection', 'v49.2-adult-source-classes', 'v49.2-premium-accounts', 'v49.2-known-entity', 'v49.2-merge-not-replace', 'v49.2-reddit-posts-only', 'v49.2-analyze-any-evidence']) {
    assert((body.features || []).includes(f), 'feature ' + f);
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
