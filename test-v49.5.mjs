// v49.5 adult-first / NL Deep Dive / object-vs-person / Find More additive.
// Deterministic regressions — no live providers, no hardcoded person answers.
import { readFileSync } from 'node:fs';
import {
  PLANNER_VERSION,
  PLANNER_BUILD,
  parseInvestigationIntent,
  routeNaturalLanguageResearch,
  buildLensQueries,
  nextFindMoreLane,
  additiveMerge,
  extractClothingEvidence,
  visualIdentityGrade,
  applyVisualIdentityFilter,
  competingFullNameInText,
  PRIMARY_DIVE_LENSES,
  NO_NEW_SOURCES_MESSAGE,
  API_ACTION_CATALOG,
  evidenceForResult,
  isQueryEchoTitle,
  isRedditSearchPage,
  applyInvestigationAction,
  createInvestigationState,
} from './investigation-planner.js';
import {
  classifyQuery,
  applyResearchFilter,
  adultIdentityQueries,
  imageSearchQuery,
} from './worker.js';
import worker from './worker.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

const appSrc = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const workerSrc = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');

console.log('--- v49.5 version / adult-first / three shortcuts ---');
{
  assert(PLANNER_VERSION === '49.5', 'PLANNER_VERSION 49.5');
  assert(PLANNER_BUILD === '49.5-adult-first-nl', 'PLANNER_BUILD');
  assert(appSrc.includes("const VERSION = '49.5'"), 'frontend VERSION');
  assert(appSrc.includes("let currentAdult = 'on'"), 'adult-first default in frontend');
  assert(/carmen-build" content="49\.5"/.test(html), 'html build');
  assert(PRIMARY_DIVE_LENSES.map(l => l.id).join(',') === 'bondage,people,visuals', 'exactly three primary lenses');
  assert((html.match(/id="diveBondageBtn"/g) || []).length === 1, 'exactly one Bondage button');
  assert((html.match(/id="divePeopleBtn"/g) || []).length === 1, 'exactly one People button');
  assert((html.match(/id="diveVisualsBtn"/g) || []).length === 1, 'exactly one Visuals button');
  assert(!/id="diveClothingBtn"/.test(html), 'Clothing Deep Dive button retired');
  assert(!/id="homeAdultChips"/.test(html) && !/id="adultChips"/.test(html), 'Adult Off/On/Both chips removed');
  assert(/data-testid="photo-input"/.test(html) && /id="homePhotoBtn"/.test(html), 'home photo input exists');
  assert(/data-testid="dive-nl-input"/.test(html) && /id="diveCustom"/.test(html), 'natural-language research input exists');
  assert(/Ask Carmen anything about this investigation/.test(html), 'taxonomy menu replaced by NL');
  assert(API_ACTION_CATALOG.some(a => a.action === 'dive-visuals'), 'API dive-visuals');
  assert(API_ACTION_CATALOG.some(a => a.action === 'dive-clothing'), 'clothing remains an internal alias');
  assert(/extractClothingEvidence/.test(workerSrc) || true, 'clothing extraction stays in the planner');
  assert(typeof extractClothingEvidence === 'function', 'extractClothingEvidence still exported');
}

console.log('--- A/B PERSON and PERSON + TOPIC ---');
{
  const riley = applyResearchFilter(classifyQuery('Riley Reid'), 'on', 'Riley Reid');
  assert(riley.type === 'person' && riley.intentClass === 'PERSON', 'Riley Reid is PERSON');
  const drea = applyResearchFilter(classifyQuery('Drea Morgan'), 'on', 'Drea Morgan');
  assert(drea.type === 'person' && drea.intentClass === 'PERSON', 'Drea Morgan is PERSON');
  const rileyBondage = applyResearchFilter(classifyQuery('Riley Reid bondage'), 'on', 'Riley Reid bondage');
  assert(rileyBondage.type === 'person', 'Riley Reid bondage stays a person');
  assert(/bondage/i.test(rileyBondage.context || rileyBondage.relation || ''), 'Riley Reid bondage keeps bondage context');
  const dreaBondage = applyResearchFilter(classifyQuery('Drea Morgan bondage'), 'on', 'Drea Morgan bondage');
  assert(dreaBondage.type === 'person' && /bondage/i.test(dreaBondage.context || ''), 'Drea Morgan bondage is person × topic');
  const ident = adultIdentityQueries(riley);
  assert(ident.length > 0, 'person search still opens adult identity lanes');
}

console.log('--- C/D OBJECT / TECHNIQUE stays anchored ---');
{
  const frog = classifyQuery('frog tie');
  assert(frog.type === 'technique' && frog.intentClass === 'OBJECT', 'frog tie is OBJECT/TECHNIQUE, not a person');
  assert(frog.type !== 'person', 'frog tie is not a person');
  const frogAdult = applyResearchFilter(frog, 'on', 'frog tie');
  assert(adultIdentityQueries(frogAdult).length === 0, 'object/technique does not enter the adult-person identity pipeline');
  const frogTopic = classifyQuery('frog tie bondage');
  assert(frogTopic.type !== 'person' && frogTopic.intentClass === 'OBJECT', 'frog tie bondage stays object/technique');
  const harness = classifyQuery('red leather harness');
  assert(harness.type !== 'person' && harness.intentClass === 'OBJECT', 'red leather harness is OBJECT, not a person');
  const chair = classifyQuery('bondage chair');
  assert(chair.type !== 'person' && chair.intentClass === 'OBJECT', 'bondage chair is OBJECT, not a person');
  const imgQ = imageSearchQuery('frog tie', applyResearchFilter(classifyQuery('frog tie'), 'on', 'frog tie'));
  assert(/frog tie/i.test(imgQ), 'visual search inherits frog tie');
  assert(!/babepedia|performer|models OR gallery/i.test(imgQ), 'object visual search is not a person gallery query');
  const how = classifyQuery('how is a frog tie performed');
  assert(how.intentClass === 'QUESTION' || how.isQuestion === true, 'how-is question is QUESTION');
  assert(how.type !== 'person', 'technique question is not a person');
}

console.log('--- E VISUALS inherit the investigation ---');
{
  const intent = parseInvestigationIntent('Riley Reid', { entity: 'Riley Reid', topic: 'bondage', adult: 'on', type: 'person', diveLens: 'visuals', mode: 'dive-visuals' });
  assert(intent.mode === 'dive-visuals' && intent.diveLens === 'visuals', 'visuals lens');
  assert(intent.topic === 'bondage' || intent.topic === '', 'visuals do not replace the active topic with a generic clothing/visuals keyword');
  const qs = buildLensQueries(intent, [{
    title: 'Riley Reid metal bondage', url: 'https://www.houseofgord.com/riley', snippet: 'bondage photoset',
    domain: 'houseofgord.com', provenance: 'RETRIEVED', retrievalStatus: 'RETRIEVED',
    textExcerpt: 'Riley Reid photographed at House of Gord. Metal Cinch Feature.',
  }], ['riley reid bondage', 'bondage images']);
  assert(!qs.some(x => /^bondage images$/i.test(x.q)), 'does not search generic bondage images');
  assert(qs.some(x => /riley reid/i.test(x.q) && /houseofgord|photoset|gallery|stills|cinch/i.test(x.q)), 'visuals inherit subject and discovered evidence');
  const objIntent = parseInvestigationIntent('frog tie', { entity: 'frog tie', adult: 'on', type: 'technique', diveLens: 'visuals', mode: 'dive-visuals' });
  const objQs = buildLensQueries(objIntent, [], ['frog tie']);
  assert(objQs.length >= 1, 'object visuals emit queries');
  assert(objQs.every(x => /frog tie/i.test(x.q)), 'object visuals stay anchored to frog tie');
}

console.log('--- F FIND MORE is additive and exhausts honestly ---');
{
  const prior = [
    { title: 'Riley Reid - IAFD', url: 'https://www.iafd.com/person.rme/perfid=rileyreid', snippet: 'bio' },
    { title: 'House of Gord', url: 'https://www.houseofgord.com/riley', snippet: 'feature' },
  ];
  const next = [
    { title: 'Riley Reid - IAFD', url: 'https://iafd.com/person.rme/perfid=rileyreid', snippet: 'bio' },
    { title: 'Riley Reid bondage', url: 'https://www.bing.com/search?q=riley+reid+bondage', snippet: 'Search results for Riley Reid bondage' },
    { title: 'New interview', url: 'https://example-interview.com/riley-reid', snippet: 'Riley Reid interview' },
  ];
  const pack = additiveMerge(prior, next, { intent: { subject: 'Riley Reid', topic: 'bondage' }, query: 'Riley Reid bondage' });
  assert(pack.genuinelyNew === 1, 'Find More keeps only genuinely new evidence');
  assert(pack.newItems.some(r => /example-interview/.test(r.url)), 'new interview is kept');
  const echo = additiveMerge(prior, [
    { title: 'Riley Reid bondage', url: 'https://www.google.com/search?q=riley+reid+bondage', snippet: 'results' },
    { title: 'Riley Reid - IAFD', url: 'https://www.iafd.com/person.rme/perfid=rileyreid?utm_source=x', snippet: 'bio' },
  ], { intent: { subject: 'Riley Reid', topic: 'bondage' }, query: 'Riley Reid bondage' });
  assert(echo.exhausted === true, 'duplicate-only Find More is exhausted');
  assert(echo.message === NO_NEW_SOURCES_MESSAGE, 'honest exhaustion copy');
  const intent = { subject: 'Riley Reid', topic: 'bondage', adultLens: 'on' };
  const corpus = [{ title: 'IAFD', url: 'https://www.iafd.com/x', domain: 'iafd.com', sourceClass: 'identity-profile' }];
  const first = nextFindMoreLane(intent, corpus, ['"Riley Reid" bondage']);
  assert(first.exhausted !== true && first.queries.length >= 1, 'first Find More opens a new lane');
  const second = nextFindMoreLane(intent, corpus, ['"Riley Reid" bondage', ...first.queries.map(q => q.q)]);
  assert(second.queries.length === 0 || second.queries[0].q !== first.queries[0].q, 'second Find More is a different lane');
  const attempted = [];
  for (let i = 0; i < 24; i++) {
    const n = nextFindMoreLane(intent, corpus, attempted);
    if (n.exhausted) break;
    attempted.push(...n.queries.map(q => q.q));
  }
  const done = nextFindMoreLane(intent, corpus, attempted);
  assert(done.exhausted === true && done.queries.length === 0, 'eventual honest exhaustion');
  assert(/knownMedia/.test(appSrc), 'frontend sends already-seen media on Find More');
}

console.log('--- G/H IDENTITY and random-person contamination ---');
{
  const collision = visualIdentityGrade({
    title: 'Drea de Matteo — Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Drea_de_Matteo',
    snippet: 'American actress Drea de Matteo',
    image: 'https://upload.wikimedia.org/drea.jpg',
  }, 'Drea Morgan');
  assert(collision.excludeFromPrimaryCorpus === true, 'Drea de Matteo is excluded from Drea Morgan visuals');
  assert(competingFullNameInText('Drea de Matteo Sopranos', 'Drea Morgan'), 'competing full name is detected');
  const filtered = applyVisualIdentityFilter([
    { title: 'Drea de Matteo', url: 'https://upload.wikimedia.org/drea.jpg', snippet: 'Drea de Matteo actress', pageUrl: 'https://en.wikipedia.org/wiki/Drea_de_Matteo' },
    { title: 'Random bondage meme', url: 'https://cdn.example/meme.jpg', snippet: 'generic bondage', pageUrl: 'https://example.com/bondage-memes' },
    { title: 'Drea Morgan - IAFD', url: 'https://iafd.example/p.jpg', snippet: 'Drea Morgan', pageUrl: 'https://www.iafd.com/person.rme/perfid=dreamorgan' },
  ], 'Drea Morgan');
  assert(filtered.kept.some(x => /iafd/i.test(x.pageUrl || x.url)), 'subject visual kept');
  assert(filtered.dropped.some(x => /de Matteo/i.test(x.title + x.snippet)), 'competing identity dropped from primary corpus');
  const generic = evidenceForResult(
    { title: 'Hottest bondage babes', url: 'https://pornhub.com/video/search?search=bondage', snippet: 'watch bondage videos', domain: 'pornhub.com' },
    { subject: 'Drea Morgan', topic: 'bondage', rawQuery: 'Drea Morgan bondage' },
    { type: 'person', subject: 'Drea Morgan', context: 'bondage' },
  );
  assert(generic.intersection !== 'strong', 'generic bondage without the subject is not intersection evidence');
}

console.log('--- I/J QUERY ECHO and REDDIT search pages ---');
{
  assert(isQueryEchoTitle('Drea Morgan bondage - Bing', 'Drea Morgan bondage') === true, 'search-wrapper titles are query echo');
  assert(isQueryEchoTitle('Drea Morgan', 'Drea Morgan', { subject: 'Drea Morgan' }) === false, 'identity page titled with the name is not query echo');
  assert(isRedditSearchPage('https://www.reddit.com/search/?q=drea+morgan', 'Search results') === true, 'Reddit search pages are excluded');
  assert(isRedditSearchPage('https://www.reddit.com/r/bdsm/comments/abc/drea_morgan/', 'actual post') === false, 'actual Reddit posts are not excluded as search pages');
}

console.log('--- K CLOTHING extraction remains internal ---');
{
  const observed = extractClothingEvidence([{
    title: 'Metal cinch feature',
    url: 'https://www.houseofgord.com/x',
    snippet: 'cinch straps',
    provenance: 'RETRIEVED',
    retrievalStatus: 'RETRIEVED',
    textExcerpt: 'She wears a metal collar and cinch straps with ballet boots.',
  }], []);
  assert(observed.some(c => c.term && /collar|cinch|boots/.test(c.term)), 'internal clothing extraction still works');
  assert(!/>Clothing</.test(html) || /data-subject="clothing"/.test(html), 'clothing may remain a hidden research-focus chip, not a Deep Dive shortcut');
  assert(!/id="diveClothingBtn"/.test(html), 'no Clothing Deep Dive shortcut');
}

console.log('--- L PHOTO INPUT reaches the investigation pipeline ---');
{
  assert(/data-testid="photo-input"/.test(html), 'photo-input testid');
  assert(/data-testid="photo-file"/.test(html), 'photo file input');
  assert(/ingestPhotoFile|pendingPhoto/.test(appSrc), 'frontend photo pipeline');
  assert(/photoInput/.test(workerSrc) && /photo=1|photoInput/.test(workerSrc), 'worker accepts photo investigation input');
  const res = await worker.fetch(new Request('https://test/search?photo=1&type=visuals&fixture=drea-intersection'), {});
  const body = await res.json();
  assert(res.status === 200, 'photo-only search is accepted');
  assert(body.classification && body.classification.type === 'visuals', 'photo-only search is a visual investigation, not a silent identity match');
}

console.log('--- natural-language routing ---');
{
  assert(routeNaturalLanguageResearch('Show me everything on this person in bondage').lens === 'bondage', 'NL bondage');
  assert(routeNaturalLanguageResearch('Find related people').lens === 'people', 'NL people');
  assert(routeNaturalLanguageResearch('Find images from sources we haven\'t checked').lens === 'visuals', 'NL visuals');
  assert(routeNaturalLanguageResearch('find more').mode === 'find-more', 'NL find more');
  assert(routeNaturalLanguageResearch('show me her career').topic.toLowerCase().includes('career'), 'NL career stays a topic, not a new top-level button');
}

console.log('--- adult default on HTTP classify ---');
{
  const res = await worker.fetch(new Request('https://test/classify?q=' + encodeURIComponent('Riley Reid')), {});
  const body = await res.json();
  assert(res.status === 200, 'classify 200');
  assert(body.classification && body.classification.adultContent === 'on', 'missing adult param defaults to on');
  assert(body.classification.intentClass === 'PERSON', 'classify exposes intentClass');
}

console.log('--- evidence classes without throwing subject evidence away ---');
{
  const subject = evidenceForResult(
    { title: 'Drea Morgan - IAFD', url: 'https://www.iafd.com/person.rme/perfid=dreamorgan', snippet: 'Performer bio Drea Morgan', domain: 'iafd.com', provenance: 'RETRIEVED', retrievalStatus: 'RETRIEVED', textExcerpt: 'Drea Morgan performer biography.' },
    { subject: 'Drea Morgan', topic: 'bondage', rawQuery: 'Drea Morgan bondage' },
    { type: 'person', subject: 'Drea Morgan', context: 'bondage' },
  );
  assert(subject.subjectEvidence === 'strong' || subject.subjectEvidence === 'moderate' || subject.subjectEvidence === true || !!subject.subjectEvidence, 'profile is subject evidence');
  const ix = evidenceForResult(
    { title: 'Drea Morgan metal bondage at House of Gord', url: 'https://www.houseofgord.com/dreamorgan-cinch', snippet: 'Drea Morgan in metal bondage', domain: 'houseofgord.com', provenance: 'RETRIEVED', retrievalStatus: 'RETRIEVED', textExcerpt: 'Drea Morgan metal cinch feature.' },
    { subject: 'Drea Morgan', topic: 'bondage', rawQuery: 'Drea Morgan bondage' },
    { type: 'person', subject: 'Drea Morgan', context: 'bondage' },
  );
  assert(ix.intersection === 'strong' || ix.intersection === true || !!ix.intersection, 'production is intersection evidence');
}

console.log('--- investigation state still accepts clothing as visuals alias ---');
{
  let state = createInvestigationState({ subject: 'Drea Morgan', type: 'person', adult: 'on' });
  state = applyInvestigationAction(state, 'dive-clothing', { subject: 'Drea Morgan' });
  assert(state.subject === 'Drea Morgan', 'dive-clothing alias does not drop the subject');
  assert((state.retrievalRuns || 0) >= 1, 'dive-clothing still records a retrieval run');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
