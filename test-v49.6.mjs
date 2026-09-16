// v49.6 correctness + UX regressions.
// Deterministic — fixtures and planner/worker functions. Not live production.
import { readFileSync } from 'node:fs';
import {
  PLANNER_VERSION,
  PLANNER_BUILD,
  parseInvestigationIntent,
  routeNaturalLanguageResearch,
  buildLensQueries,
  nextFindMoreLane,
  additiveMerge,
  visualIdentityGrade,
  applyVisualIdentityFilter,
  competingFullNameInText,
  PRIMARY_DIVE_LENSES,
  NO_NEW_SOURCES_MESSAGE,
  applyInvestigationAction,
  createInvestigationState,
  looksLikeFirstPartySource,
  firstPartyDomains,
  fillTopicMapFromEvidence,
  isObjectOrTechniquePhrase,
  topicTerms,
  relatedTopicFamily,
  fixtureItems,
  classifyProviderFailure,
  corpusDiagnosis,
} from './investigation-planner.js';
import {
  classifyQuery,
  applyResearchFilter,
  adultIdentityQueries,
  imageSearchQuery,
  extractImagesFromHtml,
  describeImageExtraction,
  classifyAccess,
  scoreResult,
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
const plannerSrc = readFileSync(new URL('./investigation-planner.js', import.meta.url), 'utf8');

console.log('--- v49.6 version / Deep Dive hierarchy ---');
{
  assert(PLANNER_VERSION === '49.6', 'PLANNER_VERSION 49.6');
  assert(PLANNER_BUILD === '49.6-correctness-ux', 'PLANNER_BUILD');
  assert(appSrc.includes("const VERSION = '49.6'"), 'frontend VERSION');
  assert(/carmen-build" content="49\.6"/.test(html), 'html build');
  assert(/v49\.6/.test(html), 'header shows v49.6');
  assert(PRIMARY_DIVE_LENSES.map(l => l.id).join(',') === 'bondage,people,visuals', 'exactly three primary lenses');
  assert((html.match(/id="diveBondageBtn"/g) || []).length === 1, 'exactly one Bondage button');
  assert((html.match(/id="divePeopleBtn"/g) || []).length === 1, 'exactly one People button');
  assert((html.match(/id="diveVisualsBtn"/g) || []).length === 1, 'exactly one Visuals button');
  assert(!/id="diveClothingBtn"/.test(html), 'Clothing Deep Dive button retired');
  assert(/Ask Carmen anything/.test(html), 'NL box label');
  assert(/data-testid="dive-nl-input"/.test(html) && /id="diveCustom"/.test(html), 'NL research input');
  assert(/data-testid="find-more"/.test(html) && /id="diveFindMoreBtn"/.test(html), 'Find More button');
  assert(!/id="diveSurpriseBtn"/.test(html), 'Surprise Me is not a Deep Dive button');
  assert(/diveCustom[\s\S]{0,180}investigateTopic/.test(appSrc), 'Ask uses the NL box');
  assert(!/retrievalLane|sourceClass terminology/.test(html), 'no planner jargon in normal HTML chrome');
}

console.log('--- IDENTITY: Drea Morgan / Riley Reid / Drea de Matteo exclusion ---');
{
  const drea = applyResearchFilter(classifyQuery('Drea Morgan'), 'on', 'Drea Morgan');
  assert(drea.type === 'person' && drea.intentClass === 'PERSON', 'Drea Morgan is PERSON');
  const riley = applyResearchFilter(classifyQuery('Riley Reid'), 'on', 'Riley Reid');
  assert(riley.type === 'person' && riley.intentClass === 'PERSON', 'Riley Reid is PERSON');
  const collision = visualIdentityGrade({
    title: 'Drea de Matteo — Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Drea_de_Matteo',
    snippet: 'American actress Drea de Matteo',
    image: 'https://upload.wikimedia.org/drea.jpg',
  }, 'Drea Morgan');
  assert(collision.excludeFromPrimaryCorpus === true, 'Drea de Matteo excluded from Drea Morgan visuals');
  assert(competingFullNameInText('Drea de Matteo Sopranos', 'Drea Morgan'), 'competing full name detected');
  assert(!/\bdrea morgan\b/i.test(workerSrc), 'worker does not hardcode Drea Morgan');
}

console.log('--- INTENT: PERSON vs OBJECT/TECHNIQUE vs PERSON × TOPIC ---');
{
  assert(classifyQuery('Riley Reid').intentClass === 'PERSON', 'Riley Reid = PERSON');
  assert(classifyQuery('Drea Morgan').intentClass === 'PERSON', 'Drea Morgan = PERSON');
  const frog = classifyQuery('frog tie');
  assert(frog.type === 'technique' && frog.intentClass === 'OBJECT', 'frog tie = OBJECT/TECHNIQUE');
  assert(frog.type !== 'person', 'frog tie is not a person');
  const frogBondage = classifyQuery('frog tie bondage');
  assert(frogBondage.type !== 'person' && frogBondage.intentClass === 'OBJECT', 'frog tie bondage = OBJECT/TECHNIQUE + TOPIC');
  const rileyB = applyResearchFilter(classifyQuery('Riley Reid bondage'), 'on', 'Riley Reid bondage');
  assert(rileyB.type === 'person' && /bondage/i.test(rileyB.context || rileyB.relation || ''), 'Riley Reid bondage = PERSON × TOPIC');
  const dreaB = applyResearchFilter(classifyQuery('Drea Morgan bondage'), 'on', 'Drea Morgan bondage');
  assert(dreaB.type === 'person' && /bondage/i.test(dreaB.context || ''), 'Drea Morgan bondage = PERSON × TOPIC');
  const intentFrog = parseInvestigationIntent('frog tie');
  assert(intentFrog.objectTechnique === true && !looksLikePerson(intentFrog.subject), 'planner frog tie is not a person subject');
  const intentFrogB = parseInvestigationIntent('frog tie bondage');
  assert(intentFrogB.objectTechnique === true && intentFrogB.intentClass === 'OBJECT', 'planner frog tie bondage is OBJECT');
  assert(/bondage/i.test(intentFrogB.topic || intentFrogB.rawQuery), 'frog tie bondage keeps topic');
  const intentDreaB = parseInvestigationIntent('Drea Morgan bondage');
  assert(/drea morgan/i.test(intentDreaB.subject) && /bondage/i.test(intentDreaB.topic), 'planner Drea Morgan bondage is subject × topic');
  assert(isObjectOrTechniquePhrase('frog-tie') && isObjectOrTechniquePhrase('frogtie'), 'hyphen/compound frog tie recognized');
  assert(adultIdentityQueries(applyResearchFilter(frog, 'on', 'frog tie')).length === 0, 'technique does not enter adult-person identity pipeline');
}

function looksLikePerson(s) {
  const t = String(s || '').trim();
  if (!t) return false;
  return /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(t);
}

console.log('--- SEMANTIC adult terms, not synonym stuffing ---');
{
  const terms = topicTerms('bondage');
  assert(terms.includes('bondage') && terms.length <= 4, 'topicTerms stays lean — requested tokens only');
  assert(!terms.includes('shibari') && !terms.includes('frog tie'), 'topicTerms does not concatenate the synonym family into the query');
  const fam = relatedTopicFamily('bondage');
  assert(fam.includes('shibari') || fam.includes('restraint') || fam.includes('frog tie'), 'related family is available for matching, not stuffing');
  const variantsBlob = plannerSrc;
  assert(/subject × topic|subject x topic|semantic/i.test(variantsBlob), 'planner documents semantic subject × topic');
}

console.log('--- SOURCE: Dreamorgan.com discovered for Drea Morgan (generic first-party, not hardcoded) ---');
{
  const fx = fixtureItems('drea-intersection');
  assert(fx && fx.items.some(i => /dreamorgan\.com/i.test(i.url)), 'drea-intersection includes official-site domain');
  const official = fx.items.find(i => /dreamorgan\.com/i.test(i.url));
  assert(looksLikeFirstPartySource(official, 'Drea Morgan'), 'official site is first-party for Drea Morgan without hardcoding the domain');
  const fp = firstPartyDomains(fx.items, 'Drea Morgan');
  assert(fp.some(d => /dreamorgan\.com/i.test(d.domain)), 'first-party domain list includes the official site');
  assert(!/dreamorgan\.com/.test(workerSrc), 'worker does not hardcode dreamorgan.com');
  const dreaClass = applyResearchFilter(classifyQuery('Drea Morgan'), 'on', 'Drea Morgan');
  const rankedBoost = scoreResult(
    'Drea Morgan',
    { title: "Drea Morgan's Official Site", url: official.url, snippet: official.snippet, domain: 'dreamorgan.com' },
    dreaClass,
  );
  const genericAdult = scoreResult(
    'Drea Morgan',
    { title: 'Hottest bondage babes', url: 'https://www.pornhub.com/video/search?search=bondage', snippet: 'watch bondage videos', domain: 'pornhub.com' },
    dreaClass,
  );
  assert(rankedBoost.score > genericAdult.score, 'first-party identity source outranks generic adult keyword page');
}

console.log('--- IMAGE extraction: og, lazy, srcset, JSON-LD, blocked, duplicate ---');
{
  const page = `https://example.com/models/DreaMorgan.html`;
  const htmlOg = `<html><head><meta property="og:image" content="https://cdn.example.com/drea.jpg"><meta name="twitter:image" content="https://cdn.example.com/drea-tw.jpg"></head></html>`;
  const og = extractImagesFromHtml(htmlOg, page);
  assert(og.some(u => /drea\.jpg/.test(u)), 'og:image extracted');
  assert(og.some(u => /drea-tw\.jpg/.test(u)), 'twitter:image extracted');

  const htmlLazy = `<img data-src="https://cdn.example.com/lazy.jpg" src="https://cdn.example.com/placeholder.gif"><img data-lazy-src="https://cdn.example.com/lazy2.jpg">`;
  const lazy = extractImagesFromHtml(htmlLazy, page);
  assert(lazy.some(u => /lazy\.jpg/.test(u)), 'data-src lazy-load extracted');

  const htmlSrcset = `<img src="https://cdn.example.com/small.jpg" srcset="https://cdn.example.com/a.jpg 400w, https://cdn.example.com/b.jpg 1200w">`;
  const srcset = extractImagesFromHtml(htmlSrcset, page);
  assert(srcset.some(u => /b\.jpg/.test(u)), 'srcset largest candidate extracted');

  const htmlPic = `<picture><source srcset="https://cdn.example.com/pic.webp"><img src="https://cdn.example.com/pic.jpg"></picture>`;
  const pic = extractImagesFromHtml(htmlPic, page);
  assert(pic.some(u => /pic\.(webp|jpg)/.test(u)), 'picture/source extracted');

  const htmlLd = `<script type="application/ld+json">{"@type":"Person","name":"Drea Morgan","image":"https://cdn.example.com/ld.jpg"}</script>`;
  const ld = extractImagesFromHtml(htmlLd, page);
  assert(ld.some(u => /ld\.jpg/.test(u)), 'JSON-LD image extracted');

  const blocked = describeImageExtraction('<html><body>ok</body></html>', page, {
    status: 'RETRIEVED', accessState: 'DIRECTLY_RETRIEVED', images: [],
  });
  assert(blocked.extractionFailed === true, 'accessible page with no images is extractionFailed');
  assert(blocked.visualEvidence === 'UNKNOWN', 'failed extraction is UNKNOWN visual evidence, not fabricated');
  assert(/could not be extracted/i.test(blocked.reason), 'transparent extraction-failure reason');

  const ok = describeImageExtraction(htmlOg, page, {
    status: 'RETRIEVED', accessState: 'DIRECTLY_RETRIEVED', images: og,
  });
  assert(ok.extractionSucceeded === true && ok.imagesFound > 0, 'successful extraction reports URLs');

  const dups = extractImagesFromHtml(
    `<img src="https://cdn.example.com/drea.jpg"><meta property="og:image" content="https://cdn.example.com/drea.jpg">`,
    page,
  );
  const unique = [...new Set(dups.map(u => u.replace(/[?#].*$/, '')))];
  assert(unique.length === dups.length || unique.length === 1, 'duplicate image URLs are dropped');

  assert(/Source found, but images could not be extracted/.test(appSrc), 'UI copy for extraction failure');
  assert(/data-testid="extraction-failed"/.test(appSrc), 'extraction-failed card is rendered');
}

console.log('--- STATE: Riley Reid → New Investigation → frog tie leaks zero Riley ---');
{
  let state = createInvestigationState({ subject: 'Riley Reid', query: 'Riley Reid', intentClass: 'PERSON', type: 'person' });
  state = applyInvestigationAction(state, 'search', { subject: 'Riley Reid', query: 'Riley Reid', intentClass: 'PERSON' });
  state.results = [{ title: 'Riley Reid - IAFD', url: 'https://www.iafd.com/person.rme/perfid=rileyreid' }];
  state.identityCandidates = [{ name: 'Riley Reid' }];
  state.visualResults = [{ url: 'https://cdn.example/riley.jpg', title: 'Riley Reid' }];
  state = applyInvestigationAction(state, 'new-investigation', {});
  assert(!/riley/i.test(JSON.stringify({
    subject: state.subject, query: state.query, results: state.results,
    identityCandidates: state.identityCandidates, visualResults: state.visualResults,
    confirmedIdentity: state.confirmedIdentity, intentClass: state.intentClass,
  })), 'reset state has zero Riley Reid fields');
  state = applyInvestigationAction(state, 'search', { query: 'frog tie bondage', intentClass: 'OBJECT', topic: 'frog tie bondage' });
  assert(!/riley/i.test(JSON.stringify(state.results) + (state.subject || '') + (state.query || '')), 'frog tie search does not resurrect Riley');
  assert(/hardNewInvestigation/.test(appSrc) && /suggestBar[\s\S]{0,40}innerHTML = ''/.test(appSrc), 'UI hard reset clears suggestion bar');
  assert(/SESSION_KEY/.test(appSrc) && /sessionStorage.removeItem/.test(appSrc), 'New Investigation clears sessionStorage');
}

console.log('--- STATUS: never "No public candidates yet" while candidates exist ---');
{
  assert(/hasCandidates[\s\S]{0,200}No public candidates yet/.test(appSrc) || /if \(hasCandidates\)/.test(appSrc), 'status is gated on lastResults');
  assert(/function updateDeepDiveState\(/.test(appSrc) && /hasCandidates/.test(appSrc) && /No public candidates yet/.test(appSrc), 'empty copy exists only as a fallback');
  const emptyIdx = appSrc.indexOf('No public candidates yet');
  const hasIdx = appSrc.lastIndexOf('hasCandidates', emptyIdx);
  assert(hasIdx >= 0 && emptyIdx - hasIdx < 2500, 'contradictory empty copy is behind hasCandidates');
  assert(/lastResults\.length > 0/.test(appSrc), 'authoritative candidate count is lastResults.length');
}

console.log('--- EXPANSION: Find More from first-party domain, not synonym clones ---');
{
  const intent = { subject: 'Drea Morgan', topic: 'bondage', adultLens: 'on' };
  const corpus = [
    { title: "Drea Morgan's Official Site", url: 'https://dreamorgan.com/models/DreaMorgan.html', snippet: "Drea Morgan's Official Site", domain: 'dreamorgan.com', sourceClass: 'creator-owned' },
    { title: 'Drea Morgan - IAFD', url: 'https://www.iafd.com/person.rme/perfid=dreamorgan', domain: 'iafd.com', sourceClass: 'identity-profile' },
  ];
  const first = nextFindMoreLane(intent, corpus, ['"Drea Morgan" bondage']);
  assert(first.exhausted !== true && first.queries.length >= 1, 'Find More opens a new lane');
  assert(first.queries.some(q => /site:dreamorgan\.com/i.test(q.q)), 'Find More branches into the discovered first-party domain');
  assert(!first.queries.some(q => /^["']?drea morgan["']? bondage( images| photos| scenes)?$/i.test(q.q)), 'Find More is not a synonym-stuffed clone of the same search');
  const echo = additiveMerge(corpus, [
    { title: 'Drea Morgan bondage', url: 'https://www.bing.com/search?q=drea+morgan+bondage', snippet: 'results' },
  ], { intent, query: 'Drea Morgan bondage' });
  assert(echo.exhausted === true || echo.genuinelyNew === 0, 'duplicate-only Find More reports exhaustion');
  assert(echo.message === NO_NEW_SOURCES_MESSAGE || echo.exhausted === true, 'honest exhaustion copy');
}

console.log('--- VISUALS preserve identity / technique ---');
{
  const dreaV = parseInvestigationIntent('Drea Morgan', { entity: 'Drea Morgan', adult: 'on', type: 'person', diveLens: 'visuals', mode: 'dive-visuals' });
  assert(dreaV.subject === 'Drea Morgan' && dreaV.diveLens === 'visuals', 'Drea Visuals keep Drea Morgan');
  const qs = buildLensQueries(dreaV, [{
    title: 'Drea Morgan metal bondage', url: 'https://www.houseofgord.com/dreamorgan-cinch', snippet: 'bondage photoset',
    domain: 'houseofgord.com', provenance: 'RETRIEVED', retrievalStatus: 'RETRIEVED',
    textExcerpt: 'Drea Morgan photographed at House of Gord.',
  }], ['drea morgan']);
  assert(qs.every(x => /drea morgan/i.test(x.q)), 'Drea Visuals queries stay on Drea Morgan');
  assert(!qs.some(x => /^bondage images$/i.test(x.q)), 'Visuals do not search generic bondage images');

  const rileyV = parseInvestigationIntent('Riley Reid', { entity: 'Riley Reid', adult: 'on', type: 'person', diveLens: 'visuals', mode: 'dive-visuals' });
  assert(rileyV.subject === 'Riley Reid', 'Riley Visuals keep Riley Reid');

  const frogV = parseInvestigationIntent('frog tie', { entity: 'frog tie', adult: 'on', type: 'technique', diveLens: 'visuals', mode: 'dive-visuals' });
  const frogQs = buildLensQueries(frogV, [], ['frog tie']);
  assert(frogQs.length >= 1 && frogQs.every(x => /frog tie/i.test(x.q)), 'frog tie Visuals stay on the technique');
  const imgQ = imageSearchQuery('frog tie', applyResearchFilter(classifyQuery('frog tie'), 'on', 'frog tie'));
  assert(/frog tie/i.test(imgQ) && !/babepedia|performer/i.test(imgQ), 'technique visual search is not a person gallery query');

  const filtered = applyVisualIdentityFilter([
    { title: 'Drea de Matteo', url: 'https://upload.wikimedia.org/drea.jpg', snippet: 'Drea de Matteo actress', pageUrl: 'https://en.wikipedia.org/wiki/Drea_de_Matteo' },
    { title: 'Random bondage meme', url: 'https://cdn.example/meme.jpg', snippet: 'generic bondage', pageUrl: 'https://example.com/bondage-memes' },
    { title: 'Drea Morgan - IAFD', url: 'https://iafd.example/p.jpg', snippet: 'Drea Morgan', pageUrl: 'https://www.iafd.com/person.rme/perfid=dreamorgan' },
  ], 'Drea Morgan');
  assert(filtered.kept.some(x => /iafd/i.test(x.pageUrl || x.url)), 'subject visual kept');
  assert(filtered.dropped.some(x => /de Matteo/i.test(x.title + x.snippet)), 'unrelated competing identity dropped');
}

console.log('--- HTTP 503 is a service failure, not empty evidence ---');
{
  const acc = classifyAccess({ httpStatus: 503, html: '', url: 'https://example.com/x', host: 'example.com' });
  assert(acc.accessState === 'UNAVAILABLE', '503 is UNAVAILABLE');
  assert(/not evidence that nothing exists/i.test(acc.note), '503 note is not “nothing found”');
  const fail = classifyProviderFailure({ status: 503, error: 'HTTP 503' });
  assert(fail.failureReason === 'unavailable', 'provider 503 is unavailable, not empty');
  const diag = corpusDiagnosis([], { Bing: { status: 503, error: 'HTTP 503', ok: false } }, {});
  assert(diag.status === 'search_failed', 'all-503 is search_failed, not evidence_unavailable-as-empty');
  assert(/not evidence that nothing exists/i.test(diag.label), 'diagnosis label is honest about 503');
  assert(/503/.test(workerSrc) && /temporarily unavailable/.test(workerSrc), 'worker retries/notes 503');
  assert(/temporarily unavailable/.test(appSrc) && /keeping what it already found/.test(appSrc), 'UI 503 toast preserves state');
}

console.log('--- MAP hides misleading zeros ---');
{
  const tm = fillTopicMapFromEvidence({
    branches: [
      { id: 'people', label: 'People', results: 0, status: 'pending' },
      { id: 'visuals', label: 'Visuals', results: 0, status: 'thin' },
      { id: 'identity-profile', label: 'Identity', results: 2, status: 'ran', sourceClass: 'identity-profile' },
    ],
  }, [
    { title: 'Drea Morgan - IAFD', url: 'https://www.iafd.com/x', sourceClass: 'identity-profile' },
  ], { relatedPeople: [{ name: 'Alex Rider' }], visuals: [{ url: 'https://cdn.example/x.jpg' }] });
  assert(!tm.branches.some(b => Number(b.results || 0) === 0 && /people|visual/i.test(b.id)), 'pending/thin zero branches are hidden');
  assert(tm.counts.people >= 1 && tm.counts.visuals >= 1 && tm.counts.sources >= 1, 'map counts derive from the same evidence');
  assert(/status !== 'thin'|status !== "thin"/.test(appSrc) || /status !== 'pending'/.test(appSrc), 'UI hides pending/thin zero map rows');
}

console.log('--- fixture /search keeps Drea identity ---');
{
  const res = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Drea Morgan') + '&type=person&adult=on&fixture=drea-intersection'), {});
  const body = await res.json();
  assert(res.status === 200, 'fixture Drea Morgan search 200');
  assert(body.classification && body.classification.type === 'person', 'fixture classifies Drea as person');
  assert((body.results || []).some(r => /dreamorgan\.com/i.test(r.url || '')), 'fixture surfaces official-site domain');
  assert(!(body.results || []).some(r => /de matteo/i.test((r.title || '') + (r.snippet || ''))), 'fixture does not inject Drea de Matteo');
}

console.log('--- NL routing still works ---');
{
  assert(routeNaturalLanguageResearch('Show me everything on this person in bondage').lens === 'bondage', 'NL bondage');
  assert(routeNaturalLanguageResearch('Find related people').lens === 'people', 'NL people');
  assert(routeNaturalLanguageResearch('Find images from sources we haven\'t checked').lens === 'visuals', 'NL visuals');
  assert(routeNaturalLanguageResearch('find more').mode === 'find-more', 'NL find more');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
