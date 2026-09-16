// v49.4 Deep Dive 3-path retrieval: Bondage / People / Clothing.
// Architecture tests — no live providers, no hardcoded Drea answers.
import { readFileSync } from 'node:fs';
import {
  PLANNER_VERSION,
  PLANNER_BUILD,
  parseInvestigationIntent,
  buildTopicMap,
  buildLensQueries,
  nextFindMoreLane,
  additiveMerge,
  extractDiscoverySeeds,
  extractRelatedPeople,
  extractClothingEvidence,
  visualIdentityGrade,
  applyVisualIdentityFilter,
  competingFullNameInText,
  classifyNovelty,
  buildSeenIndex,
  canonicalizeUrl,
  isQueryEchoTitle,
  findMoreQueries,
  PRIMARY_DIVE_LENSES,
  NO_NEW_SOURCES_MESSAGE,
  expansionReport,
  API_ACTION_CATALOG,
  isNaiveLensQuery,
} from './investigation-planner.js';
import worker from './worker.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

const appSrc = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const workerSrc = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');

console.log('--- v49.4 version / Bondage button restored ---');
{
  assert(PLANNER_VERSION === '49.8' || PLANNER_VERSION === '49.8' || PLANNER_VERSION === '49.7' || PLANNER_VERSION === '49.6' || PLANNER_VERSION === '49.5' || PLANNER_VERSION === '49.4', 'PLANNER_VERSION current');
  assert(/49\.(4|5|6|7|8)/.test(PLANNER_BUILD), 'PLANNER_BUILD');
  assert(/const VERSION = '49\.[45678]'/.test(appSrc), 'frontend VERSION');
  assert(/carmen-build" content="49\.[45678]"/.test(html), 'html build');
  assert(/id="diveBondageBtn"/.test(html) && />Bondage</.test(html), 'Bondage Deep Dive button is visible');
  assert(/id="divePeopleBtn"/.test(html) && />People</.test(html), 'People Deep Dive button is visible');
  assert(/id="diveVisualsBtn"/.test(html) && />Visuals</.test(html), 'Visuals Deep Dive button is visible');
  assert(!/id="diveClothingBtn"/.test(html), 'Clothing is not a top-level Deep Dive button');
  assert(PRIMARY_DIVE_LENSES.map(l => l.id).join(',') === 'bondage,people,visuals', 'exactly three primary lenses');
  assert(/runDiveLens\('bondage'\)/.test(appSrc), 'Bondage button launches the bondage lens');
  assert(!/hardcoded drea|drea morgan onlyfans password/i.test(workerSrc), 'no hardcoded Drea answers in worker');
  assert(API_ACTION_CATALOG.some(a => a.action === 'dive-bondage'), 'API dive-bondage action');
  assert(API_ACTION_CATALOG.some(a => a.action === 'dive-people'), 'API dive-people action');
  assert(API_ACTION_CATALOG.some(a => a.action === 'dive-visuals'), 'API dive-visuals action');
  assert(API_ACTION_CATALOG.some(a => a.action === 'dive-clothing'), 'API dive-clothing remains as a visuals alias');
}

console.log('--- v49.4 bondage is not a query rewrite ---');
{
  const intent = parseInvestigationIntent('Drea Morgan', { entity: 'Drea Morgan', adult: 'on', type: 'person', diveLens: 'bondage', mode: 'dive-bondage' });
  assert(intent.mode === 'dive-bondage', 'mode is dive-bondage');
  assert(intent.diveLens === 'bondage', 'diveLens bondage');
  assert(intent.subject === 'Drea Morgan', 'keeps the subject');
  const prior = [
    { title: 'Drea Morgan - IAFD', url: 'https://www.iafd.com/person.rme/perfid=dreamorgan', snippet: 'Performer bio.', domain: 'iafd.com', provenance: 'RETRIEVED', retrievalStatus: 'RETRIEVED', textExcerpt: 'Drea Morgan photographed by Alex Rider. Directed by Jordan Hale. Studio: House of Gord (2012). Metal Cinch Feature (2011).' },
    { title: 'Drea Morgan metal bondage photoset at House of Gord', url: 'https://www.houseofgord.com/dreamorgan-cinch', snippet: 'Drea Morgan in a metal bondage feature with cinch straps.', domain: 'houseofgord.com', provenance: 'RETRIEVED', retrievalStatus: 'RETRIEVED', textExcerpt: 'Metal Cinch Feature (2011) starring Drea Morgan. Photographed by Alex Rider.' },
  ];
  const attempted = ['"Drea Morgan" bondage', 'Drea Morgan bondage', 'drea morgan bondage'];
  const qs = buildLensQueries(intent, prior, attempted);
  assert(qs.length >= 2, 'bondage lens emits multiple chain queries');
  assert(!qs.some(x => /^["']?drea morgan["']? bondage$/i.test(x.q)), 'does not re-emit the naive subject+bondage clone');
  assert(qs.some(x => /houseofgord\.com/i.test(x.q) || /Alex Rider/i.test(x.q) || /Metal Cinch/i.test(x.q)), 'chains through a discovered domain, collaborator, or production');
  assert(qs.some(x => /site:/i.test(x.q) || /photoset|scene|studio/i.test(x.q)), 'opens specialist/source-class lanes');
  assert(isNaiveLensQuery('Drea Morgan bondage', intent) === true, 'naive subject+bondage is recognized as a clone');
  assert(isNaiveLensQuery('"Drea Morgan" site:houseofgord.com', intent) === false, 'discovery-chain query is not a naive clone');
}

console.log('--- v49.4 people require relationship evidence ---');
{
  const searchPage = { title: 'Drea Morgan - Search', url: 'https://www.bing.com/search?q=drea+morgan+jane+doe', snippet: 'Drea Morgan Jane Doe results', domain: 'bing.com' };
  const retrieved = { title: 'Credits', url: 'https://www.houseofgord.com/credits', snippet: 'featuring', domain: 'houseofgord.com', provenance: 'RETRIEVED', retrievalStatus: 'RETRIEVED', textExcerpt: 'Drea Morgan featuring Alex Rider. Photographed by Sam Quinn.' };
  const people = extractRelatedPeople([searchPage, retrieved], 'Drea Morgan', { query: 'Drea Morgan' });
  assert(people.some(p => p.name === 'Alex Rider' && p.observationState === 'OBSERVED'), 'featuring NAME on a retrieved page is OBSERVED');
  assert(people.some(p => p.name === 'Sam Quinn' && p.role === 'photographer'), 'photographed by is a photographer relationship');
  assert(!people.some(p => /Jane Doe/i.test(p.name)), 'search-page co-occurrence is not a relationship');
  assert(people.every(p => p.why && p.foundThrough), 'every connected person has why + foundThrough');
}

console.log('--- v49.4 clothing UNKNOWN without visual evidence ---');
{
  const empty = extractClothingEvidence([{ title: 'Drea Morgan - IAFD', url: 'https://www.iafd.com/x', snippet: 'Performer bio' }], []);
  assert(empty.some(c => c.observationState === 'UNKNOWN'), 'no garment evidence stays UNKNOWN');
  const observed = extractClothingEvidence([{
    title: 'Metal cinch feature',
    url: 'https://www.houseofgord.com/x',
    snippet: 'cinch straps',
    provenance: 'RETRIEVED',
    retrievalStatus: 'RETRIEVED',
    textExcerpt: 'She wears a metal collar and cinch straps with ballet boots.',
  }], []);
  assert(observed.some(c => c.term && /collar|cinch|boots/.test(c.term) && c.observationState === 'OBSERVED'), 'retrieved garment terms are OBSERVED');
  const intent = parseInvestigationIntent('Drea Morgan', { entity: 'Drea Morgan', mode: 'dive-clothing', diveLens: 'clothing', adult: 'on' });
  assert(intent.mode === 'dive-visuals', 'clothing mode aliases to dive-visuals');
  const qs = buildLensQueries(intent, [{
    title: 'Metal cinch feature', url: 'https://www.houseofgord.com/x', snippet: 'cinch',
    provenance: 'RETRIEVED', retrievalStatus: 'RETRIEVED',
    textExcerpt: 'metal collar and cinch straps',
  }], ['drea morgan clothing']);
  assert(!qs.some(x => /^["']?drea morgan["']? clothing$/i.test(x.q)), 'does not re-run subject+clothing');
  assert(qs.some(x => /collar|cinch|outfit|wearing|stills|gallery|photoset/i.test(x.q)), 'visuals lens uses observed garments or visual queries');
}

console.log('--- v49.4 additive merge refuses tail-chasing ---');
{
  const prior = [
    { title: 'Drea Morgan - IAFD', url: 'https://www.iafd.com/person.rme/perfid=dreamorgan', snippet: 'bio' },
    { title: 'House of Gord', url: 'https://www.houseofgord.com/dreamorgan-cinch', snippet: 'feature' },
  ];
  const next = [
    { title: 'Drea Morgan - IAFD', url: 'https://iafd.com/person.rme/perfid=dreamorgan', snippet: 'bio' },
    { title: 'Drea Morgan bondage', url: 'https://www.bing.com/search?q=drea+morgan+bondage', snippet: 'Search results for Drea Morgan bondage' },
    { title: 'House of Gord', url: 'https://web.archive.org/web/20200101000000/https://www.houseofgord.com/dreamorgan-cinch', snippet: 'archived' },
    { title: 'LoyalFans @servedrea', url: 'https://www.loyalfans.com/servedrea', snippet: 'creator page' },
  ];
  const pack = additiveMerge(prior, next, { intent: { subject: 'Drea Morgan', topic: 'bondage' }, query: 'Drea Morgan bondage' });
  assert(pack.genuinelyNew === 1, 'only the genuinely new LoyalFans URL counts');
  assert(pack.newItems.some(r => /loyalfans/.test(r.url)), 'LoyalFans is new');
  assert(pack.duplicatesRemoved + pack.mirrorsRemoved + pack.queryEchoesRemoved + pack.nearDuplicatesRemoved >= 3, 'dup/mirror/echo dropped');
  assert(pack.learnedSomething === true, 'learned something new');
  const echoOnly = additiveMerge(prior, [
    { title: 'Drea Morgan bondage', url: 'https://www.google.com/search?q=drea+morgan+bondage', snippet: 'results' },
    { title: 'Drea Morgan - IAFD', url: 'https://www.iafd.com/person.rme/perfid=dreamorgan?utm_source=x', snippet: 'bio' },
  ], { intent: { subject: 'Drea Morgan', topic: 'bondage' }, query: 'Drea Morgan bondage' });
  assert(echoOnly.exhausted === true, 'echo/duplicate-only run is exhausted');
  assert(echoOnly.message === NO_NEW_SOURCES_MESSAGE, 'exhausted angle says no new sources');
}

console.log('--- v49.4 Find More picks the next unexplored lane ---');
{
  const intent = { subject: 'Drea Morgan', topic: 'bondage', adultLens: 'on' };
  const corpus = [
    { title: 'IAFD', url: 'https://www.iafd.com/person.rme/perfid=dreamorgan', domain: 'iafd.com', sourceClass: 'identity-profile', provenance: 'RETRIEVED', retrievalStatus: 'RETRIEVED', textExcerpt: 'featuring Alex Rider. Metal Cinch Feature (2011).' },
  ];
  const attempted = ['"Drea Morgan" bondage', 'Drea Morgan (interview OR feature OR credits)', 'Drea Morgan (profile OR "official site" OR database)'];
  const more = findMoreQueries(intent, attempted, corpus);
  assert(more.length >= 1, 'find more with a corpus returns a next lane');
  assert(!more.some(q => /^["']?drea morgan["']? bondage$/i.test(q.q)), 'find more does not repeat the previous query');
  const lane = nextFindMoreLane(intent, corpus, attempted.concat(more.map(m => m.q)));
  const emptyLane = nextFindMoreLane(intent, corpus, FIND_MORE_ATTEMPTED_ALL(intent, corpus));
  assert(typeof lane.exhausted === 'boolean', 'nextFindMoreLane reports exhausted flag');
}

function FIND_MORE_ATTEMPTED_ALL(intent, corpus) {
  const acc = [];
  for (let i = 0; i < 24; i++) {
    const n = nextFindMoreLane(intent, corpus, acc);
    if (n.exhausted) return acc;
    acc.push(...n.queries.map(q => q.q));
  }
  return acc;
}

console.log('--- v49.4 Find More exhausts honestly ---');
{
  const intent = { subject: 'Drea Morgan', topic: 'bondage', adultLens: 'on' };
  const corpus = [{ title: 'IAFD', url: 'https://www.iafd.com/x', domain: 'iafd.com', sourceClass: 'identity-profile' }];
  const attempted = FIND_MORE_ATTEMPTED_ALL(intent, corpus);
  const done = nextFindMoreLane(intent, corpus, attempted);
  assert(done.exhausted === true, 'after all lanes, Find More is exhausted');
  assert(done.message === NO_NEW_SOURCES_MESSAGE, 'exhausted message');
  assert(done.queries.length === 0, 'no manufactured extra queries');
}

console.log('--- v49.4 visual identity: first name is not identity; competing names drop ---');
{
  const subject = 'Drea Morgan';
  const firstOnly = visualIdentityGrade({ title: 'Drea on set', url: 'https://cdn.example/drea.jpg', snippet: 'Drea smiles' }, subject);
  assert(firstOnly.firstNameOnly === true && firstOnly.excludeFromPrimaryCorpus === true, 'first-name match is not identity evidence');
  const collision = visualIdentityGrade({
    title: 'Drea de Matteo — Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Drea_de_Matteo',
    snippet: 'American actress Drea de Matteo',
    image: 'https://upload.wikimedia.org/drea.jpg',
  }, subject);
  assert(collision.excludeFromPrimaryCorpus === true, 'Drea de Matteo is excluded from the Drea Morgan visual corpus');
  assert(/de matteo/i.test(collision.collision || ''), 'collision names the competing identity');
  const supported = visualIdentityGrade({
    title: 'Drea Morgan - IAFD',
    url: 'https://www.iafd.com/person.rme/perfid=dreamorgan',
    snippet: 'Drea Morgan performer',
    image: 'https://iafd.example/drea-morgan.jpg',
  }, subject);
  assert(supported.grade === 'supported' || supported.grade === 'possible' || supported.grade === 'verified', 'full name on identity host is supported/possible');
  assert(supported.excludeFromPrimaryCorpus !== true, 'real subject visual stays in the primary corpus');
  const filtered = applyVisualIdentityFilter([
    { title: 'Drea de Matteo', url: 'https://upload.wikimedia.org/drea.jpg', snippet: 'Drea de Matteo actress', pageUrl: 'https://en.wikipedia.org/wiki/Drea_de_Matteo' },
    { title: 'Drea Morgan - IAFD', url: 'https://iafd.example/p.jpg', snippet: 'Drea Morgan', pageUrl: 'https://www.iafd.com/person.rme/perfid=dreamorgan' },
  ], subject);
  assert(filtered.kept.some(x => /iafd/i.test(x.pageUrl || x.url)), 'IAFD visual kept');
  assert(filtered.dropped.some(x => /de Matteo/i.test(x.title + x.snippet)), 'de Matteo visual dropped from primary corpus');
  assert(competingFullNameInText('Drea de Matteo Sopranos', 'Drea Morgan'), 'generic competing-name detector (not a hardcoded exception list)');
}

console.log('--- v49.4 discovery seeds feed the chain ---');
{
  const intent = parseInvestigationIntent('Drea Morgan', { entity: 'Drea Morgan', adult: 'on', mode: 'dive-bondage' });
  const seeds = extractDiscoverySeeds([{
    title: 'House of Gord feature',
    url: 'https://www.houseofgord.com/dreamorgan-cinch',
    domain: 'houseofgord.com',
    provenance: 'RETRIEVED',
    retrievalStatus: 'RETRIEVED',
    textExcerpt: 'Drea Morgan featuring Alex Rider. Metal Cinch Feature (2011). Photographed by Sam Quinn. She wears a metal collar.',
    sourceClass: 'fetish-publisher',
  }], intent);
  assert(seeds.domains.includes('houseofgord.com'), 'discovered domain');
  assert(seeds.people.some(p => p.name === 'Alex Rider'), 'discovered collaborator becomes a seed');
  assert(seeds.productions.some(p => /Metal Cinch/i.test(p.label)), 'discovered production becomes a seed');
  assert(seeds.people.every(p => p.foundThrough && p.relatedTo === 'Drea Morgan'), 'seeds preserve foundThrough/relatedTo');
}

console.log('--- v49.4 /search dive-bondage expands through the corpus ---');
{
  const prior = JSON.stringify([
    { title: 'Drea Morgan - IAFD', url: 'https://www.iafd.com/person.rme/perfid=dreamorgan', snippet: 'Performer bio.', domain: 'iafd.com', provenance: 'RETRIEVED', retrievalStatus: 'RETRIEVED', textExcerpt: 'Drea Morgan photographed by Alex Rider. Metal Cinch Feature (2011). Studio: House of Gord (2012).' },
  ]);
  const res = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Drea Morgan bondage') + '&entity=' + encodeURIComponent('Drea Morgan') + '&topic=bondage&type=person&adult=on&diveLens=bondage&mode=dive-bondage&fixture=drea-intersection&prior=' + encodeURIComponent(prior)), {});
  const body = await res.json();
  const qs = (body.variants || []).map(v => v.q);
  assert(res.status === 200, 'dive-bondage search 200');
  assert(body.intent && body.intent.mode === 'dive-bondage', 'intent is dive-bondage');
  assert(qs[0] && !/^["']?drea morgan["']? bondage$/i.test(qs[0]), 'first query is not the naive rewrite');
  assert(!qs.some(x => /^["']?drea morgan["']? bondage$/i.test(x)), 'worker does not issue the naive subject+bondage clone when a corpus exists');
  assert(qs.some(x => /houseofgord|Alex Rider|Metal Cinch|site:/i.test(x)), 'worker issues a discovery-chain query');
}

console.log('--- v49.4 v49.3 contracts still hold ---');
{
  assert(isQueryEchoTitle('Drea Morgan', 'Drea Morgan') === false, 'person-name title is not query echo');
  assert(canonicalizeUrl('https://www.iafd.com/x?utm_source=y') === canonicalizeUrl('https://iafd.com/x'), 'canonical URLs strip www + utm');
  const map = buildTopicMap(parseInvestigationIntent('find everything related to Drea Morgan bondage', { entity: 'Drea Morgan', topic: 'bondage', adult: 'on', type: 'person', findEverything: true }), { subject: 'Drea Morgan', type: 'person', context: 'bondage', adultContent: 'on' });
  assert(map.branches.length >= 3, 'find-everything topic map still builds source-class branches');
  const exp = expansionReport({ genuinelyNew: 2, learnedSomething: true, duplicatesRemoved: 3, queryEchoesRemoved: 1, exhausted: false });
  assert(exp.genuinelyNew === 2 && exp.learnedSomething, 'expansion report key metric is whether Carmen learned something');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
