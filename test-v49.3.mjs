// v49.3 ChatGPT-access / adult-first / live-stress tests.
import { readFileSync } from 'node:fs';
import {
  PLANNER_VERSION,
  PLANNER_BUILD,
  parseInvestigationIntent,
  buildTopicMap,
  evidenceForResult,
  isQueryEchoTitle,
  classifyAccountOwnership,
  competingIdentityCandidates,
  moreLikeThisQueries,
  findMoreQueries,
  findDifferentQueries,
  findSimilarQueries,
  searchThisVisualQueries,
  moreFromThisSourceQueries,
  moreFromThisPersonQueries,
  moreOnThisTopicQueries,
  applyIdentityFeedback,
  applyInvestigationAction,
  createInvestigationState,
  knownSiteAccessStatus,
  classifyProviderFailure,
  corpusDiagnosis,
  serializeEvidenceItem,
  API_ACTION_CATALOG,
  DETERMINISTIC_FIXTURES,
  ADULT_SOURCE_CLASSES,
  OWNERSHIP_CLASSES,
  distinctFindMoreIntents,
} from './investigation-planner.js';
import { classifyQuery, uniqueAdd, scoreResult, applyResearchFilter } from './worker.js';
import worker from './worker.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

const workerSrc = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
const appSrc = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');

console.log('--- v49.3 version / API contracts ---');
{
  assert(PLANNER_VERSION === '49.5' || PLANNER_VERSION === '49.4' || PLANNER_VERSION === '49.3', 'PLANNER_VERSION current');
  assert(/49\.(3|4|5)/.test(PLANNER_BUILD), 'PLANNER_BUILD');
  assert(/const VERSION = '49\.[345]'/.test(appSrc), 'frontend VERSION');
  assert(/carmen-build" content="49\.[345]"/.test(html), 'html build');

  assert(/handleCarmenApi/.test(workerSrc), 'worker has ChatGPT API handler');
  assert(/\/api\/v1/.test(workerSrc), 'worker routes /api/v1');
  assert(API_ACTION_CATALOG.length >= 20, 'API catalog documents the investigation actions');
  assert(/data-findmore="similar"/.test(appSrc) && /data-findmore="visual"/.test(appSrc) && /data-findmore="topic"/.test(appSrc), 'Find similar / Search this visual / More on this topic controls');
  assert(/rejectedImages/.test(appSrc), 'frontend sends rejectedImages');
  assert(/moreFromThisPerson/.test(appSrc), 'frontend more-from-this-person is a distinct mode');
}

console.log('--- v49.3 query echo never rejects a person name ---');
{
  assert(isQueryEchoTitle('Drea Morgan', 'Drea Morgan') === false, 'person-name title is not query echo');
  assert(isQueryEchoTitle('Drea Morgan', 'Drea Morgan bondage', { subject: 'Drea Morgan' }) === false, 'identity title vs stuffed query is not echo');
  assert(isQueryEchoTitle('Drea Morgan bondage', 'Drea Morgan bondage') === true, 'stuffed subject+topic title remains echo');
}

console.log('--- v49.3 independent subject / topic / intersection ---');
{
  const intent = parseInvestigationIntent('Drea Morgan bondage', { entity: 'Drea Morgan', topic: 'bondage', adult: 'on' });
  const profile = evidenceForResult({
    title: 'Drea Morgan - IAFD',
    url: 'https://www.iafd.com/person.rme/perfid=dreamorgan',
    snippet: 'Performer bio and filmography.',
  }, intent, { subject: 'Drea Morgan', context: 'bondage', type: 'person' });
  assert(profile.subjectEvidence === 'strong', 'IAFD is strong subject evidence');
  assert(profile.topicEvidence === 'none', 'IAFD profile is not topic evidence');
  assert(profile.intersection !== 'strong', 'identity-only is not intersection');
  assert(profile.role === 'SUBJECT_EVIDENCE', 'labeled SUBJECT_EVIDENCE not discarded');
  const topicOnly = evidenceForResult({
    title: 'Bondage (BDSM)',
    url: 'https://en.wikipedia.org/wiki/Bondage_BDSM',
    snippet: 'Bondage is a practice of consensual restraint.',
  }, intent, { subject: 'Drea Morgan', context: 'bondage' });
  assert(topicOnly.topicEvidence !== 'none', 'glossary is topic evidence');
  assert(topicOnly.subjectEvidence === 'none', 'glossary is not subject evidence');
  assert(topicOnly.intersection === 'none', 'topic-only is not intersection');
  const real = evidenceForResult({
    title: 'Drea Morgan metal bondage photoset at House of Gord',
    url: 'https://www.houseofgord.com/dreamorgan-cinch',
    snippet: 'Drea Morgan in a metal bondage feature with cinch straps.',
  }, intent, { subject: 'Drea Morgan', context: 'bondage', type: 'person' });
  assert(real.subjectEvidence !== 'none' && real.topicEvidence !== 'none', 'real page has independent subject and topic evidence');
  assert(real.role === 'INTERSECTION' || real.intersection === 'strong' || real.intersection === 'weak', 'real page is intersection');
}

console.log('--- v49.3 ownership classes ---');
{
  assert(OWNERSHIP_CLASSES.includes('CONFIRMED CREATOR-OWNED') && OWNERSHIP_CLASSES.includes('DIRECTORY CLAIM'), 'ownership class enum');
  const dir = classifyAccountOwnership({ url: 'https://www.indexxx.com/m/drea-morgan', title: 'Drea Morgan OnlyFans listed' }, 'Drea Morgan');
  assert(dir.kind === 'directory listing', 'directory kind preserved');
  assert(dir.ownershipClass === 'DIRECTORY CLAIM', 'directory is DIRECTORY CLAIM, never confirmed');
  const of = classifyAccountOwnership({ url: 'https://onlyfans.com/dreamorgan', title: 'Drea Morgan official' }, 'Drea Morgan');
  assert(of.ownershipClass !== 'CONFIRMED CREATOR-OWNED', 'title-only OnlyFans is not CONFIRMED');
  assert(of.ownershipClass === 'LIKELY CREATOR-OWNED' || of.ownershipClass === 'UNVERIFIED' || of.ownershipClass === 'UNKNOWN', 'unverified OF claim stays unverified/likely');
  const lf = classifyAccountOwnership({ url: 'https://www.loyalfans.com/servedrea', title: 'Drea Morgan LoyalFans' }, 'Drea Morgan', { userConfirmed: true });
  assert(lf.ownershipClass === 'CONFIRMED CREATOR-OWNED' || lf.ownershipClass === 'LIKELY CREATOR-OWNED', 'identity-grade LoyalFans can confirm or likely');
}

console.log('--- v49.3 adult source classes are a catalog, not a tiny list ---');
{
  const ids = ADULT_SOURCE_CLASSES.map(c => c.id);
  assert(ids.includes('premium-subscription') && ids.includes('creator-store') && ids.includes('major-video-platform'), 'premium / stores / tubes');
  assert(ids.includes('fetish-publisher') && ids.includes('community-social') && ids.includes('archival'), 'fetish / community / archival');
  assert(ADULT_SOURCE_CLASSES.some(c => c.seeds.includes('fetlife.com')), 'FetLife seed');
  assert(ADULT_SOURCE_CLASSES.some(c => c.seeds.includes('pornhub.com')), 'Pornhub seed');
  assert(ADULT_SOURCE_CLASSES.some(c => c.seeds.includes('loyalfans.com')), 'LoyalFans seed');
  assert(!ADULT_SOURCE_CLASSES.some(c => /drea morgan|riley reid/i.test(JSON.stringify(c))), 'source classes are not a hardcoded person list');
}

console.log('--- v49.3 find-everything branches are source classes, not query clones ---');
{
  const intent = parseInvestigationIntent('find everything related to Drea Morgan bondage', { entity: 'Drea Morgan', topic: 'bondage', adult: 'on', type: 'person', findEverything: true });
  const map = buildTopicMap(intent, { subject: 'Drea Morgan', type: 'person', context: 'bondage', adultContent: 'on' });
  const qs = map.branches.flatMap(b => b.queries);
  const uniq = new Set(qs.map(q => q.toLowerCase()));
  assert(qs.length === uniq.size, 'no duplicate query variants across branches');
  assert(map.branches.every(b => b.queries.length > 0), 'no empty manufactured branches');
}

console.log('--- v49.3 find-more intents are semantically distinct ---');
{
  const intent = { subject: 'Drea Morgan', topic: 'bondage', identityFeedback: { confirmed: ['Drea Morgan'] } };
  const seed = { url: 'https://www.houseofgord.com/x', domain: 'houseofgord.com', title: 'metal cinch feature', mediaKind: 'image' };
  const more = findMoreQueries(intent, []);
  const like = moreLikeThisQueries(intent, seed);
  const diff = findDifferentQueries(intent, { excludeHosts: ['pinterest.com'] });
  const sim = findSimilarQueries(intent, seed);
  const vis = searchThisVisualQueries(intent, seed);
  const src = moreFromThisSourceQueries(intent, seed);
  const per = moreFromThisPersonQueries(intent);
  const top = moreOnThisTopicQueries(intent);
  const lanes = [more, like, diff, sim, vis, src, per, top].map(a => a[0] && a[0].lane);
  assert(new Set(lanes).size === 8, 'eight distinct find-more lanes');
  assert(!like.some(q => /metal cinch feature/.test(q.q)), 'more like this does not stuff the seed title');
  assert(distinctFindMoreIntents().length === 8, 'intent catalog');
}

console.log('--- v49.3 identity feedback changes ranking ---');
{
  const rows = [
    { title: 'Ashley Anderson actress', url: 'https://en.wikipedia.org/wiki/Ashley_Anderson', score: 40, domain: 'en.wikipedia.org' },
    { title: 'Ashley Anderson realtor', url: 'https://example-realtor.com/ashley-anderson', score: 38, domain: 'example-realtor.com' },
  ];
  const rejected = applyIdentityFeedback(rows, { rejectedPeople: ['Ashley Anderson realtor'], rejectedHosts: ['example-realtor.com'] }, { subject: 'Ashley Anderson', type: 'person' });
  assert(!rejected.some(r => /realtor/.test(r.url)), 'rejected identity/host is dropped from subsequent ranking');
  const confirmed = applyIdentityFeedback(rows, { confirmed: ['Ashley Anderson actress'] }, { subject: 'Ashley Anderson', type: 'person' });
  const wiki = confirmed.find(r => /wikipedia/.test(r.url));
  assert(wiki && wiki.score > 40, 'positive confirmation strengthens matching identity');
}

console.log('--- v49.3 investigation reset keeps saved collections ---');
{
  const s = createInvestigationState({ subject: 'Drea Morgan', topic: 'bondage' });
  s.savedEvidence = [{ url: 'https://www.loyalfans.com/servedrea', title: 'kept' }];
  const next = applyInvestigationAction(s, 'reset');
  assert(!next.subject, 'hard reset clears subject');
  assert(next.savedEvidence.length === 1, 'saved collections survive reset');
  const child = applyInvestigationAction(s, 'branch', { topic: 'premium accounts', foundThrough: 'branch' });
  assert(child.investigationId !== s.investigationId, 'branch gets a new id');
  assert(child.parentInvestigationId === s.investigationId, 'branch records parent');
}

console.log('--- v49.3 known-site blocked is not nonexistent ---');
{
  const st = knownSiteAccessStatus({ status: 'RETRIEVAL_FAILED', accessState: 'BLOCKED', inaccessible: true });
  assert(/KNOWN DOMAIN/.test(st.label) && /ACCESS BLOCKED/.test(st.label), 'blocked known site stays a known domain');
  assert(!/does not exist/i.test(st.label), 'never says the entity does not exist');
  const hog = classifyQuery('House of Gord');
  const official = scoreResult('House of Gord', { title: 'House of Gord', url: 'https://www.houseofgord.com/', snippet: 'Metal bondage studio' }, hog);
  const gov = scoreResult('House of Gord', { title: 'U.S. House of Representatives', url: 'https://www.house.gov/', snippet: 'The House of Representatives' }, hog);
  const tv = scoreResult('House of Gord', { title: 'House (TV series)', url: 'https://house.fandom.com/wiki/House', snippet: 'American medical drama' }, hog);
  assert(official.score > gov.score && official.score > tv.score, 'known domain outranks house.gov and the TV show');
  assert(gov.score <= 10 || /unrelated to resolved known site/.test(gov.reason || ''), 'house.gov is not treated as House of Gord');
}

console.log('--- v49.3 provider failure classification ---');
{
  const t = classifyProviderFailure({ error: 'timeout', timedOut: true });
  assert(t.failureReason === 'timeout', 'timeout is timeout, not Carmen pass');
  const b = classifyProviderFailure({ status: 403, accessState: 'BLOCKED' });
  assert(b.failureReason === 'blocked', '403 is blocked');
  const fail = corpusDiagnosis([], { Bing: { error: 'timeout', status: 500 }, DuckDuckGo: { error: 'timeout' } }, {});
  assert(fail.status === 'search_failed', 'all-provider failure is search_failed');
}

console.log('--- v49.3 serialize evidence fields ---');
{
  const row = serializeEvidenceItem({
    title: 'Drea Morgan | LoyalFans',
    url: 'https://www.loyalfans.com/servedrea',
    evidence: { subjectEvidence: 'strong', topicEvidence: 'none', intersection: 'none', role: 'SUBJECT_EVIDENCE', isEvidence: true },
    publisher: 'UNKNOWN',
    host: 'loyalfans.com',
    creator: 'UNKNOWN',
    originalSource: 'UNKNOWN',
    ownershipClass: 'LIKELY CREATOR-OWNED',
    confidence: 'medium',
    source: 'DuckDuckGo',
  }, { investigationId: 'inv_test', subject: 'Drea Morgan', topic: 'premium accounts', intent: 'premium-accounts' });
  for (const k of ['investigationId', 'subject', 'topic', 'intent', 'sourceUrl', 'canonicalUrl', 'host', 'publisher', 'creator', 'originalSource', 'identityEvidence', 'topicEvidence', 'ownershipClass', 'isEvidenceItem']) {
    assert(row[k] !== undefined, 'serialized field ' + k);
  }
}

console.log('--- v49.3 competing candidates carry candidateId ---');
{
  const c = competingIdentityCandidates([
    { title: 'Ashley Anderson actress', url: 'https://en.wikipedia.org/wiki/Ashley_Anderson', sourceClass: 'ENCYCLOPEDIA', resultKind: 'IDENTITY_MATCH' },
    { title: 'Ashley Anderson realtor', url: 'https://example-realtor.com/ashley-anderson', sourceClass: 'PUBLIC_PROFILE', resultKind: 'WEAK_MATCH' },
  ], { type: 'person', subject: 'Ashley Anderson' });
  assert(c.ambiguous === true, 'Ashley Anderson is evidence-based ambiguous');
  assert(c.candidates.every(x => x.candidateId && Array.isArray(x.sourceDomains)), 'candidates have candidateId + sourceDomains');
  const drea = competingIdentityCandidates([
    { title: 'Drea Morgan - IAFD', url: 'https://www.iafd.com/person.rme/perfid=dreamorgan', sourceClass: 'DATABASE', resultKind: 'IDENTITY_MATCH', evidence: { subjectEvidence: 'strong' } },
    { title: 'Drea Morgan | LoyalFans', url: 'https://www.loyalfans.com/servedrea', sourceClass: 'ADULT_PLATFORM', resultKind: 'IDENTITY_MATCH' },
    { title: 'Drea Morgan metal bondage photoset', url: 'https://www.houseofgord.com/dreamorgan-cinch', sourceClass: 'ADULT_PLATFORM', resultKind: 'IDENTITY_MATCH' },
  ], { type: 'person', subject: 'Drea Morgan' });
  assert(drea.ambiguous === false, 'same person across IAFD/LoyalFans/House of Gord is not dumped as ambiguous');
}

console.log('--- v49.3 /api docs + health ---');
{
  const docs = await worker.fetch(new Request('https://test/api'), {});
  const d = await docs.json();
  assert(docs.status === 200 && Array.isArray(d.actions), 'GET /api documents actions');
  assert(d.samePipelineAsIphoneUi === true, 'API claims same pipeline');
  assert(d.safety && d.safety.noSecrets && d.safety.noAutonomousExternalActions, 'API safety contract');
  const health = await worker.fetch(new Request('https://test/health'), {});
  const h = await health.json();
  assert((h.version === '49.5' || h.version === '49.4' || h.version === '49.3') && /49\.(3|4|5)/.test(h.build || ''), 'health current');
  assert((h.features || []).includes('v49.3-chatgpt-access'), 'feature flag');
  assert((h.routes || []).includes('/api'), 'health lists /api');
}

console.log('--- v49.3 API new investigation + fixture search ---');
{
  const created = await worker.fetch(new Request('https://test/api/v1/investigations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'new-investigation', adult: 'on' }),
  }), {});
  const cbody = await created.json();
  assert(created.status === 200 && cbody.investigationId, 'POST new investigation');
  const search = await worker.fetch(new Request('https://test/api/v1/investigations/' + cbody.investigationId + '/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: 'Drea Morgan bondage',
      subject: 'Drea Morgan',
      topic: 'bondage',
      type: 'person',
      adult: 'on',
      fixture: 'drea-intersection',
      investigationId: cbody.investigationId,
    }),
  }), {});
  const sbody = await search.json();
  assert(search.status === 200, 'fixture search 200');
  assert(sbody.samePipelineAsIphoneUi === true, 'search uses the real pipeline');
  assert(!((sbody.results || []).some(r => /reddit\.com\/search/i.test(r.sourceUrl || r.url || ''))), 'fixture Reddit search pages dropped');
  const echo = (sbody.results || []).filter(r => /Drea Morgan bondage/.test(r.title) && /example\.com/.test(r.sourceUrl || r.url || ''));
  assert(echo.length === 0, 'fixture query-echo dropped by uniqueAdd');
  const roles = (sbody.results || []).map(r => r.role);
  assert(roles.includes('SUBJECT_EVIDENCE') || (sbody.evidenceSummary && (sbody.evidenceSummary.bestSubjectEvidence || []).length), 'subject evidence kept');
}

console.log('--- v49.3 fixture provider-blocked is not a PASS ---');
{
  const res = await worker.fetch(new Request('https://test/api/v1/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'search', query: 'Drea Morgan', subject: 'Drea Morgan', type: 'person', adult: 'on', fixture: 'provider-blocked' }),
  }), {});
  const body = await res.json();
  assert(res.status === 200, 'blocked fixture still 200 structured');
  assert(body.corpusDiagnosis && body.corpusDiagnosis.status === 'search_failed', 'provider-blocked diagnoses search_failed');
  assert(!(body.ok === true && body.corpusDiagnosis.status === 'ok'), 'never labels provider-blocked as Carmen PASS');
}

console.log('--- v49.3 fixture premium accounts distinguish directory vs platform ---');
{
  const res = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('premium accounts') + '&entity=Drea%20Morgan&premium=1&type=person&adult=on&fixture=premium-accounts'), {});
  const body = await res.json();
  assert(res.status === 200, 'premium fixture /search 200');
  const items = body.results || [];
  const dir = items.find(r => /indexxx/.test(r.url || ''));
  const lf = items.find(r => /loyalfans/.test(r.url || ''));
  if (dir) assert(dir.ownershipClass === 'DIRECTORY CLAIM' || dir.accountOwnership === 'directory listing', 'Indexxx OnlyFans mention is directory claim');
  if (lf) assert(lf.ownershipClass !== 'DIRECTORY CLAIM', 'LoyalFans handle is not a directory');
  assert(body.intent && body.intent.premiumAccounts, 'premium intent');
}

console.log('--- v49.3 fixture House of Gord known site ---');
{
  const res = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('House of Gord') + '&adult=on&fixture=site-blocked'), {});
  const body = await res.json();
  assert(body.classification && body.classification.type === 'website', 'House of Gord is website');
  assert((body.results || []).some(r => /houseofgord\.com/i.test(r.url || '')), 'known domain remains a lead when blocked');
  const lead = (body.results || []).find(r => /houseofgord\.com/i.test(r.url || ''));
  if (lead && lead.knownSiteStatus) assert(/KNOWN DOMAIN/.test(lead.knownSiteStatus), 'blocked known site labeled KNOWN DOMAIN');
}

console.log('--- v49.3 confirm/reject API persist ---');
{
  const created = await worker.fetch(new Request('https://test/api/v1/investigations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), {});
  const c = await created.json();
  const conf = await worker.fetch(new Request('https://test/api/v1/investigations/' + c.investigationId + '/confirm-identity', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Drea Morgan', subject: 'Drea Morgan', query: 'Drea Morgan', type: 'person', adult: 'on', fixture: 'drea-intersection', investigationId: c.investigationId }),
  }), {});
  const cb = await conf.json();
  assert((cb.identityFeedback && cb.identityFeedback.confirmed || []).includes('Drea Morgan') || (cb.investigationState && cb.investigationState.confirmed || []).includes('Drea Morgan'), 'confirm persists');
}

console.log('--- v49.3 Analyze still accepts webpage ---');
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html><title>Public page</title><body>Hello</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  try {
    const res = await worker.fetch(new Request('https://test/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/interview', title: 'Interview', kind: 'webpage' }),
    }), {});
    assert(res.status === 200, 'Analyze webpage 200');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
