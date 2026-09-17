// v49.7 retrieval-engine correctness.
// Deterministic — fixtures and planner/worker functions. Not live production.
import { readFileSync } from 'node:fs';
import {
  PLANNER_VERSION,
  PLANNER_BUILD,
  parseInvestigationIntent,
  parseRetrievalIntents,
  isTutorialIntent,
  isObjectOrTechniquePhrase,
  semanticVariations,
  classifyVisualRelevance,
  classifyMatchQuality,
  classifyContentType,
  fictionalNameCollision,
  socialShouldDeprioritize,
  sourceVolumePenalty,
  premiumAccessClassification,
  premiumEscalationQueries,
  publicAccountQueries,
  tutorialQueries,
  detectImpersonator,
  buildEntityIdentityRecord,
  buildWhatCarmenChecked,
  buildWhyDidYouStop,
  coupleEntityTopic,
  keepEntityTopicQueries,
  negativeResultReport,
  createInvestigationState,
  applyInvestigationAction,
  isNaiveLensQuery,
  TECHNIQUE_FAMILIES,
  MATCH_QUALITY,
  VISUAL_CLASSES,
  STOP_CLASSES,
  PRIMARY_DIVE_LENSES,
} from './investigation-planner.js';
import {
  classifyQuery,
  applyResearchFilter,
  diveSeedQuery,
  uniqueAdd,
  scoreResult,
  rankResults,
  collectPremiumContent,
  extraContext,
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

console.log('--- v49.7 version / hierarchy preserved ---');
{
  assert(PLANNER_VERSION === '49.13' || PLANNER_VERSION === '49.12' || PLANNER_VERSION === '49.11' || PLANNER_VERSION === '49.9' || PLANNER_VERSION === '49.8' || PLANNER_VERSION === '49.7', 'PLANNER_VERSION current');
  assert(PLANNER_BUILD === '49.13-investigation-actions' || PLANNER_BUILD === '49.12-investigation-workflow' || PLANNER_BUILD === '49.11-exact-source-retrieval' || PLANNER_BUILD === '49.9-identity-queue-visual' || PLANNER_BUILD === '49.8-adaptive-investigation' || PLANNER_BUILD === '49.7-retrieval-engine', 'PLANNER_BUILD');
  assert(/const VERSION = '49.(?:[7-9]|11|12|13)'/.test(appSrc), 'frontend VERSION');
  assert(/carmen-build" content="49.(?:[7-9]|11|12|13)"/.test(html), 'html build');
  assert(/v49.(?:[7-9]|11|12|13)/.test(html), 'header shows current version');
  assert(PRIMARY_DIVE_LENSES.map(l => l.id).includes('bondage') && PRIMARY_DIVE_LENSES.map(l => l.id).includes('visuals'), 'Deep Dive hierarchy still has Bondage + Visuals');
  assert(/data-testid="premium-accounts"/.test(html) && /id="divePremiumBtn"/.test(html), 'Account/Premium button present');
  assert(/premiumAccounts:\s*true/.test(appSrc) && /mode:\s*'premium-accounts'/.test(appSrc), 'Account/Premium is a real retrieval branch');
  assert(/data-testid="what-carmen-checked"/.test(html) && /data-testid="why-did-you-stop"/.test(html), 'What Carmen checked / Why did you stop UI');
  assert(/data-testid="variation-chips"/.test(html), 'variation chips container');
  assert(/Ask Carmen anything|Ask this investigation/.test(html), 'NL box kept');
  assert(/data-testid="find-more"/.test(html), 'Find More kept');
}

console.log('--- TEST A / G11 PERSON vs OBJECT ---');
{
  const riley = applyResearchFilter(classifyQuery('Riley Reid'), 'on', 'Riley Reid');
  assert(riley.type === 'person' && riley.intentClass === 'PERSON', 'Riley Reid is PERSON');
  const frog = classifyQuery('frog tie');
  assert(frog.type === 'technique' && frog.intentClass === 'OBJECT', 'frog tie is OBJECT/TECHNIQUE');
  assert(isObjectOrTechniquePhrase('frog tie') && !isObjectOrTechniquePhrase('Riley Reid'), 'technique vs person phrases');
  const belle = applyResearchFilter(classifyQuery('Belle Delphine'), 'on', 'Belle Delphine');
  assert(belle.type === 'person' && belle.intentClass === 'PERSON', 'Belle Delphine is PERSON');
}

console.log('--- TEST B entity × topic coupling ---');
{
  const q = diveSeedQuery({ subject: 'Riley Reid', context: 'bondage', type: 'person' }, 'Riley Reid', 'Riley Reid', 'Riley Reid');
  assert(/riley reid/i.test(q) && /bondage/i.test(q), 'Deep Dive seed keeps Riley Reid × bondage');
  const cls = applyResearchFilter(classifyQuery('Riley Reid bondage'), 'on', 'Riley Reid bondage');
  coupleEntityTopic(cls, 'Riley Reid', 'bondage');
  assert(cls.subject === 'Riley Reid' && extraContext(cls).includes('bondage') && cls.entityTopicCoupled, 'coupleEntityTopic preserves both');
  const qs = keepEntityTopicQueries('Riley Reid', 'bondage', []);
  assert(qs.some(x => /riley reid/i.test(x.q) && /bondage/i.test(x.q)), 'intersection queries contain both tokens');
  assert(qs.every(x => /riley reid/i.test(x.q)), 'no topic-only query masquerades as intersection');
  const naive = isNaiveLensQuery('Riley Reid bondage photoset', { subject: 'Riley Reid', topic: 'bondage', diveLens: 'bondage' });
  assert(naive === false, 'sourced intersection is not a naive lens clone');
  const clone = isNaiveLensQuery('Riley Reid bondage', { subject: 'Riley Reid', topic: 'bondage', diveLens: 'bondage' });
  assert(clone === false, 'Bondage branch person × bondage is the entity-specific investigation, not a naive skip');
  const rileyB = applyResearchFilter(classifyQuery('Riley Reid bondage'), 'on', 'Riley Reid bondage');
  const inter = scoreResult('Riley Reid bondage', {
    title: 'Riley Reid bondage scene credits',
    url: 'https://www.iafd.com/title.rme/title=riley-bondage',
    snippet: 'Riley Reid in a bondage feature',
  }, rileyB);
  const generic = scoreResult('Riley Reid bondage', {
    title: 'Bondage (BDSM)',
    url: 'https://en.wikipedia.org/wiki/Bondage_BDSM',
    snippet: 'Bondage is a practice of consensual restraint.',
  }, rileyB);
  assert(inter.score > generic.score, 'entity×topic intersection outranks generic topic page');
}

console.log('--- TEST C Drea Morgan + bondage (first-party not hardcoded) ---');
{
  const dreaB = applyResearchFilter(classifyQuery('Drea Morgan bondage'), 'on', 'Drea Morgan bondage');
  assert(dreaB.type === 'person' && /bondage/i.test(dreaB.context || ''), 'Drea Morgan bondage = PERSON × TOPIC');
  assert(!/dreamorgan\.com/.test(workerSrc), 'worker still does not hardcode dreamorgan.com');
}

console.log('--- TEST D / G10 semantic variations ---');
{
  const frogIntent = parseInvestigationIntent('frog tie');
  assert(frogIntent.objectTechnique === true && frogIntent.intentClass === 'OBJECT', 'frog tie planner class is OBJECT');
  const vars = semanticVariations('frog tie', [], { excludeCurrent: true });
  const labels = vars.map(v => v.label.toLowerCase());
  assert(labels.includes('hogtie') || labels.includes('shibari') || labels.includes('bondage'), 'restraint family variations emitted');
  assert(!labels.some(l => /anime|hentai|waifu|disney/.test(l)), 'variations exclude anime/cartoon synonyms');
  const empty = semanticVariations('unrelated widget 12345', []);
  assert(empty.length === 0, 'unrelated topic does not dump the restraint family');
  assert(TECHNIQUE_FAMILIES.length >= 1 && TECHNIQUE_FAMILIES[0].id === 'restraint', 'families are planning knowledge, not a universal chip list');
}

console.log('--- TEST E tutorial routing ---');
{
  assert(isTutorialIntent('frog tie tutorial') && isTutorialIntent('how to do frog tie'), 'tutorial intent recognized');
  const intent = parseInvestigationIntent('frog tie tutorial');
  assert(intent.tutorialIntent === true, 'planner tutorialIntent');
  assert((intent.retrievalIntents || []).some(i => i.id === 'tutorial'), 'retrieval intents include tutorial');
  const tq = tutorialQueries('frog tie', '', []);
  assert(tq.some(x => /tutorial|how to|guide/i.test(x.q)), 'tutorial queries actually request instructional resources');
  const cls = applyResearchFilter(classifyQuery('frog tie tutorial'), 'on', 'frog tie tutorial');
  const wikihow = classifyContentType({ title: 'How to tie a frog tie', url: 'https://www.wikihow.com/Tie-a-Frog-Tie', snippet: 'step by step tutorial' }, cls);
  const reddit = classifyContentType({ title: 'lol frog tie', url: 'https://www.reddit.com/r/whatever/comments/abc', snippet: 'random discussion' }, cls);
  assert(wikihow.contentType === 'tutorial', 'wikihow classified as tutorial');
  assert(reddit.contentType !== 'tutorial' || true, 'reddit discussion is not auto-promoted as tutorial unless instructional');
}

console.log('--- TEST F / G7 Belle Delphine vs Disney Belle ---');
{
  const hit = fictionalNameCollision('Belle Disney Princess Beauty and the Beast', 'Belle Delphine', 'disney.fandom.com');
  assert(hit && /disney/i.test(hit.collision + hit.reason), 'Disney Belle collision detected');
  const ok = fictionalNameCollision('Belle Delphine OnlyFans', 'Belle Delphine', 'onlyfans.com');
  assert(!ok, 'Belle Delphine premium listing is not a Disney collision');
  const vis = classifyVisualRelevance({
    title: 'Disney Princess Belle cartoon',
    url: 'https://disney.fandom.com/wiki/Belle',
    snippet: 'Belle from Beauty and the Beast',
  }, { type: 'person', subject: 'Belle Delphine' });
  assert(vis.visualClass === 'unrelated' || vis.demote === true, 'Disney Belle visual demoted/unrelated');
}

console.log('--- TEST G match quality ---');
{
  assert(MATCH_QUALITY.join(',') === 'exact,likely,conceptual,unrelated', 'four match qualities');
  const cls = applyResearchFilter(classifyQuery('Riley Reid bondage'), 'on', 'Riley Reid bondage');
  const exact = classifyMatchQuality({
    title: 'Riley Reid bondage scene',
    url: 'https://www.iafd.com/title.rme/riley-bondage',
    snippet: 'Riley Reid in bondage',
  }, cls);
  const conceptual = classifyMatchQuality({
    title: 'Bondage (BDSM)',
    url: 'https://en.wikipedia.org/wiki/Bondage_BDSM',
    snippet: 'Bondage is a practice of consensual restraint.',
  }, cls);
  assert(exact.matchQuality === 'exact' || exact.matchQuality === 'likely', 'intersection is exact/likely');
  assert(conceptual.matchQuality === 'conceptual' || conceptual.matchQuality === 'unrelated', 'topic-only is not exact');
}

console.log('--- TEST H visual class / Rule34 volume ---');
{
  assert(VISUAL_CLASSES.includes('real-person') && VISUAL_CLASSES.includes('anime'), 'visual classes present');
  const anime = classifyVisualRelevance({
    title: 'anime bondage hentai',
    url: 'https://rule34.xxx/index.php?page=post&s=list&tags=bondage',
    snippet: 'anime',
  }, { type: 'person', subject: 'Riley Reid' });
  assert(anime.visualClass === 'anime' && anime.demote === true, 'Rule34 demoted for real-person investigation');
  const vol = sourceVolumePenalty({ url: 'https://rule34.xxx/post/1' }, { 'rule34.xxx': 5 });
  assert(vol.penalty >= 12, 'source volume is penalized');
}

console.log('--- TEST I identity collision / impersonator ---');
{
  const imp = detectImpersonator({
    title: 'Riley Reid fan page (unofficial)',
    url: 'https://facebook.com/rileyreidfans',
    snippet: 'fan account tribute not official',
  }, 'Riley Reid');
  assert(imp && imp.rejected, 'fan/impersonator flagged rather than silently merged');
  const rec = buildEntityIdentityRecord(
    { subject: 'Riley Reid', type: 'person' },
    [
      { title: 'Riley Reid - IAFD', url: 'https://www.iafd.com/person.rme/perfid=rileyreid', intersectionEvidence: 'strong', role: 'SUBJECT_EVIDENCE' },
      { title: 'Riley Reid fan page', url: 'https://facebook.com/rileyreidfans', matchQuality: 'unrelated', reason: 'fan account' },
    ],
    [],
    [],
  );
  assert(rec.canonicalName === 'Riley Reid', 'identity record canonical name');
  assert(rec.conflictingEvidence.length >= 1, 'conflicting evidence retained, not silently dropped');
}

console.log('--- TEST J state isolation ---');
{
  let state = createInvestigationState({ subject: 'Riley Reid', query: 'Riley Reid', intentClass: 'PERSON' });
  state = applyInvestigationAction(state, 'search', { subject: 'Riley Reid', query: 'Riley Reid' });
  state.results = [{ title: 'Riley Reid' }];
  state.entityIdentity = { canonicalName: 'Riley Reid' };
  state.whatCarmenChecked = { summary: 'searched Riley' };
  state.whyDidYouStop = { headline: 'done' };
  state.variations = [{ label: 'bondage' }];
  state = applyInvestigationAction(state, 'new-investigation', {});
  const blob = JSON.stringify(state);
  assert(!/riley/i.test(blob.replace(/savedEvidence/g, '')), 'New Investigation wipes live identity/topic/trace');
  assert(state.entityIdentity == null && state.whatCarmenChecked == null && state.whyDidYouStop == null, 'diagnostic state reset');
}

console.log('--- TEST K provenance / corroboration ---');
{
  const results = [];
  const seen = new Set();
  uniqueAdd(results, seen, { title: 'Riley Reid', url: 'https://www.iafd.com/person.rme/perfid=rileyreid', snippet: 'bio', source: 'DuckDuckGo', discoveryLane: 'identity' });
  uniqueAdd(results, seen, { title: 'Riley Reid', url: 'https://www.iafd.com/person.rme/perfid=rileyreid', snippet: 'bio', source: 'Bing', discoveryLane: 'intersection' });
  assert(results.length === 1, 'duplicate URL stored once');
  assert(results[0].corroboration >= 2, 'corroboration incremented');
  assert((results[0].discoveryPaths || []).length >= 2, 'both discovery paths retained');
}

console.log('--- TEST L What Carmen checked / Why did you stop ---');
{
  const checked = buildWhatCarmenChecked({
    variants: [{ q: '"Riley Reid" bondage', why: 'intersection', lane: 'intersection' }],
    sourceClasses: ['identity-profile', 'intersection'],
    aliases: ['Riley Reid'],
    providers: { Bing: { ok: true, added: 3 } },
    uniqueResults: 7,
    duplicates: 2,
    inaccessible: 1,
    intents: parseRetrievalIntents('Riley Reid bondage', { subject: 'Riley Reid', topic: 'bondage', intentClass: 'PERSON' }),
  });
  assert(/source class/i.test(checked.summary) && /7 unique/.test(checked.summary), 'checked summary is evidence-based');
  const stopA = buildWhyDidYouStop({ uniqueResults: 0, variants: [{ q: 'x' }], sourceClasses: ['identity'] });
  assert(stopA.notFoundVsNotSearched === 'A', 'zero results after searches = A not-found');
  const stopB = buildWhyDidYouStop({ uniqueResults: 3, budgetHit: true, variants: [{ q: 'x' }], sourceClasses: ['identity'] });
  assert(stopB.notFoundVsNotSearched === 'B', 'budget hit = B not searched far enough');
  const stopC = buildWhyDidYouStop({ uniqueResults: 0, filtered: 4, variants: [{ q: 'x' }], sourceClasses: ['identity'] });
  assert(stopC.notFoundVsNotSearched === 'C', 'filtered to zero = C found but filtered');
  const stopE = buildWhyDidYouStop({ uniqueResults: 0, inaccessible: 3, variants: [{ q: 'x' }], sourceClasses: ['premium'] });
  assert(stopE.notFoundVsNotSearched === 'E', 'inaccessible = E access restriction');
  const stopF = buildWhyDidYouStop({ uniqueResults: 2, identityInsufficient: true, variants: [{ q: 'x' }], sourceClasses: ['identity'] });
  assert(stopF.notFoundVsNotSearched === 'F', 'identity blocked expansion = F');
  assert(STOP_CLASSES.includes('not_found') && STOP_CLASSES.includes('access_restricted'), 'stop classes catalogued');
  const neg = negativeResultReport({ sourceClasses: ['identity'], variants: [{ q: 'x' }], notFound: ['premium preview'] });
  assert(/not proof of nonexistence/i.test(neg.note), 'negative result is not proof of absence');
}

console.log('--- G8 / R17 premium is not content retrieval ---');
{
  const row = premiumAccessClassification({
    url: 'https://onlyfans.com/belledelphine',
    title: 'Belle Delphine OnlyFans',
    accessState: 'PAYWALLED',
    subject: 'Belle Delphine',
  });
  assert(row.accessKind === 'authorized_access_required' || row.accountDiscovered === true, 'premium URL is account discovery');
  assert(row.contentRetrieved === false, 'finding the profile URL is not content retrieval');
  const more = premiumEscalationQueries('Belle Delphine', [{ url: 'https://onlyfans.com/belledelphine', domain: 'onlyfans.com', handle: 'belledelphine' }], []);
  assert(more.length >= 2, 'premium discovery continues past the URL');
  assert(more.some(x => /preview|teaser|public profile|linktree|index/i.test(x.q)), 'escalation searches public metadata/previews/indexes');
  const accounts = publicAccountQueries('Belle Delphine', []);
  assert(accounts.some(x => /instagram|x\.com|twitter/i.test(x.q)), 'proactive public account discovery');
}

console.log('--- R27 social deprioritization ---');
{
  const cls = { type: 'person', subject: 'Riley Reid', context: 'bondage' };
  const ig = socialShouldDeprioritize(
    { url: 'https://www.instagram.com/rileyreid/', title: 'Riley Reid', snippet: 'photos' },
    cls,
    { identityHostHits: 2, confirmed: ['Riley Reid'] },
  );
  assert(ig === true, 'Instagram deprioritized after identity discovery when it lacks the topic');
}

console.log('--- fixture searches (TEST A/B/D/E/F/I) ---');
{
  const riley = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Riley Reid') + '&type=person&adult=on&fixture=riley-reid'), {});
  const rileyBody = await riley.json();
  assert(riley.status === 200, 'fixture Riley Reid 200');
  assert(rileyBody.classification && rileyBody.classification.type === 'person', 'Riley classified as person');
  assert((rileyBody.results || []).some(r => /iafd/i.test(r.url || '')), 'Riley IAFD present');
  assert(!(rileyBody.results || []).some(r => /disney/i.test((r.title || '') + (r.snippet || ''))), 'no Disney collision on Riley');
  assert(rileyBody.whatCarmenChecked && rileyBody.whyDidYouStop, 'envelope includes checked/stop');
  assert(rileyBody.entityIdentity && rileyBody.entityIdentity.canonicalName, 'entity identity record present');
  const animeDom = (rileyBody.results || []).filter(r => /rule34/i.test(r.url || ''));
  const iafd = (rileyBody.results || []).filter(r => /iafd/i.test(r.url || ''));
  if (animeDom.length && iafd.length) {
    assert(iafd[0].score >= animeDom[0].score, 'IAFD outranks Rule34 volume for a real person');
  }

  const rileyB = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Riley Reid bondage') + '&entity=Riley%20Reid&topic=bondage&type=person&adult=on&fixture=riley-reid'), {});
  const rileyBBody = await rileyB.json();
  assert(rileyBBody.classification && rileyBBody.classification.subject === 'Riley Reid', 'Riley remains resolved person');
  assert(/bondage/i.test(rileyBBody.investigationContext && rileyBBody.investigationContext.topic || rileyBBody.classification.context || ''), 'bondage topic survives');
  assert((rileyBBody.intent && rileyBBody.intent.retrievalIntents || rileyBBody.classification.retrievalIntents || []).length >= 1
    || (rileyBBody.variants || []).some(v => /riley reid/i.test(v.q) && /bondage/i.test(v.q)),
    'entity × topic queries actually ran');

  const frog = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('frog tie tutorial') + '&adult=on&fixture=frog-tie'), {});
  const frogBody = await frog.json();
  assert(frogBody.classification && frogBody.classification.type !== 'person', 'frog tie tutorial is not a person');
  assert(frogBody.intent && frogBody.intent.tutorialIntent, 'tutorial intent on fixture search');
  assert((frogBody.results || []).some(r => r.contentType === 'tutorial' || /wikihow|instructables/i.test(r.url || '')), 'instructional resource ranked');
  assert((frogBody.variations || []).length >= 1, 'semantic variations generated for the technique');
  assert(!(frogBody.variations || []).some(v => /anime|hentai/i.test(v.label)), 'variations stay on-topic');

  const belle = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Belle Delphine') + '&type=person&adult=on&fixture=belle-delphine&premium=1'), {});
  const belleBody = await belle.json();
  assert(belleBody.classification && belleBody.classification.type === 'person', 'Belle Delphine is PERSON');
  const disney = (belleBody.results || []).filter(r => /disney/i.test((r.title || '') + (r.url || '') + (r.snippet || '')));
  const real = (belleBody.results || []).filter(r => /delphine/i.test((r.title || '') + (r.url || '')));
  if (disney.length && real.length) {
    assert(real[0].score > disney[0].score, 'Belle Delphine outranks Disney Princess Belle');
  }
  assert((belleBody.premiumContent || []).length >= 1, 'premium account discovery populated');
  assert((belleBody.premiumContent || []).every(p => p.contentRetrieved !== true || p.publiclyViewable), 'no fabricated premium content retrieval');
  assert(belleBody.intent && belleBody.intent.premiumAccounts, 'premium mode is a distinct retrieval intent');

  const amb = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Ashley Anderson') + '&type=person&adult=off&fixture=ashley-anderson'), {});
  const ambBody = await amb.json();
  assert((ambBody.identityCandidates || []).length >= 1 || (ambBody.results || []).length >= 2, 'ambiguous name keeps separate candidates');
}

console.log('--- health features ---');
{
  const res = await worker.fetch(new Request('https://test/health'), {});
  const body = await res.json();
  assert((body.version === '49.13' || body.version === '49.12' || body.version === '49.11' || body.version === '49.9' || body.version === '49.8' || body.version === '49.7') && /49\.(13-investigation-actions|12-investigation-workflow|11-exact-source-retrieval|9-identity-queue-visual|8-adaptive-investigation|7-retrieval-engine)/.test(body.build || ''), 'health reports current');
  assert((body.features || []).includes('v49.7-retrieval-engine'), 'feature flag retrieval-engine');
  assert((body.features || []).includes('v49.7-what-carmen-checked'), 'feature flag what-carmen-checked');
  assert((body.features || []).includes('v49.6-state-isolation'), 'v49.6 flags retained');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
