// v49.8 adaptive / open-ended investigation.
// Deterministic — planner functions + fixture searches. Not live production.
import { readFileSync } from 'node:fs';
import {
  PLANNER_VERSION,
  PLANNER_BUILD,
  parseInvestigationIntent,
  isTutorialIntent,
  semanticVariations,
  classifyVisualRelevance,
  fictionalNameCollision,
  identityDisambiguation,
  conceptOrthographyVariants,
  conceptDiscoveryQueries,
  conceptVisualSearchQuery,
  isRestraintTechnique,
  identityVariantQueries,
  visualInvestigationQueries,
  entityAssociatedVisualQueries,
  accountInvestigationQueries,
  extractInvestigationSeeds,
  evaluateNovelty,
  createAdaptiveController,
  enqueueInvestigationPaths,
  nextInvestigationBatch,
  recordInvestigationBatch,
  decideInvestigationContinuation,
  enqueueAdaptiveFamilies,
  seedsToQueries,
  adaptiveTrace,
  buildWhyDidYouStop,
  buildWhatCarmenChecked,
  buildEntityIdentityRecord,
  ADAPTIVE_STOP_KINDS,
  ADAPTIVE_NOVELTY_STOP_STREAK,
  ADAPTIVE_BATCH_SIZE,
  INVESTIGATION_PATH_FAMILIES,
  PRIMARY_DIVE_LENSES,
} from './investigation-planner.js';
import {
  classifyQuery,
  applyResearchFilter,
  diveSeedQuery,
  extraContext,
  coupleEntityTopic,
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

console.log('--- v49.8 version / hierarchy preserved ---');
{
  assert(PLANNER_VERSION === '49.8' || PLANNER_VERSION === '49.9', 'PLANNER_VERSION current');
  assert(PLANNER_BUILD === '49.8-adaptive-investigation' || PLANNER_BUILD === '49.9-identity-queue-visual', 'PLANNER_BUILD');
  assert(/const VERSION = '49\.[89]'/.test(appSrc), 'frontend VERSION');
  assert(/carmen-build" content="49\.[89]"/.test(html), 'html build');
  assert(/v49\.[89]/.test(html), 'header shows current version');
  assert(PRIMARY_DIVE_LENSES.map(l => l.id).join(',') === 'bondage,people,visuals', 'Deep Dive hierarchy unchanged');
  assert(/data-testid="premium-accounts"/.test(html) && /id="divePremiumBtn"/.test(html), 'Account/Premium button present');
  assert(/data-testid="what-carmen-checked"/.test(html) && /data-testid="why-did-you-stop"/.test(html), 'trace UI kept');
  assert(/resource safeguard/i.test(appSrc), 'UI no longer calls an arbitrary research budget “complete”');
  assert(!/per-request research budget/.test(appSrc), 'old budget-complete copy removed from UI');
}

console.log('--- TEST A Riley Reid identity (no regression) ---');
{
  const riley = applyResearchFilter(classifyQuery('Riley Reid'), 'on', 'Riley Reid');
  assert(riley.type === 'person' && riley.intentClass === 'PERSON', 'Riley Reid is PERSON');
}

console.log('--- TEST B Riley Reid × bondage coupling (no regression) ---');
{
  const q = diveSeedQuery({ subject: 'Riley Reid', context: 'bondage', type: 'person' }, 'Riley Reid', 'Riley Reid', 'Riley Reid');
  assert(/riley reid/i.test(q) && /bondage/i.test(q), 'Deep Dive seed keeps Riley Reid × bondage');
  const cls = applyResearchFilter(classifyQuery('Riley Reid bondage'), 'on', 'Riley Reid bondage');
  coupleEntityTopic(cls, 'Riley Reid', 'bondage');
  assert(cls.subject === 'Riley Reid' && extraContext(cls).includes('bondage') && cls.entityTopicCoupled, 'entity × topic coupled');
}

console.log('--- TEST C Drea Morgan entity-associated visual seeds ---');
{
  const drea = applyResearchFilter(classifyQuery('Drea Morgan bondage'), 'on', 'Drea Morgan bondage');
  assert(drea.type === 'person' && /bondage/i.test(drea.context || ''), 'Drea Morgan bondage = PERSON × TOPIC');
  const evidence = [
    { title: 'Drea Morgan discussion', url: 'https://www.reddit.com/r/something/comments/abc/drea_morgan_bondage/', snippet: 'Drea Morgan bondage set', matchQuality: 'exact' },
    { title: 'Drea Morgan gallery', url: 'https://babepedia.com/drea-morgan', snippet: 'photos gallery of Drea Morgan', matchQuality: 'likely', images: ['https://babepedia.com/img/drea.jpg'] },
  ];
  const vis = entityAssociatedVisualQueries(drea, evidence, []);
  assert(vis.some(x => /site:.*reddit/i.test(x.q)), 'Reddit entity evidence seeds a visual/source follow-up');
  assert(vis.some(x => /babepedia/i.test(x.q) && /gallery|photos|images/i.test(x.q)), 'gallery page seeds image investigation');
  assert(vis.every(x => /drea morgan/i.test(x.q)), 'visual seeds stay on Drea Morgan, not generic bondage images');
  const personVis = visualInvestigationQueries(drea, evidence, [], { identity: { canonicalName: 'Drea Morgan' } });
  assert(personVis.some(x => /image|photos|gallery/i.test(x.q) && /drea morgan/i.test(x.q)), 'person visual branch actually searches images');
}

console.log('--- TEST D frog tie concept-to-visual retrieval ---');
{
  const frog = classifyQuery('frog tie');
  assert(frog.type === 'technique' && frog.intentClass === 'OBJECT', 'frog tie is OBJECT/TECHNIQUE');
  const ortho = conceptOrthographyVariants('frog tie');
  assert(ortho.includes('frog tie') && (ortho.includes('frog-tie') || ortho.includes('frogtie')), 'orthography variants generated from the concept');
  const dq = conceptDiscoveryQueries('frog tie', frog, []);
  const blob = dq.map(x => x.q.toLowerCase()).join('\n');
  assert(/frog-tie|frogtie/.test(blob), 'discovery queries include hyphen/compound forms');
  assert(/image|photos|visual reference|diagram|illustration/.test(blob), 'classified concept produces visual discovery queries');
  assert(/tutorial|guide|technique/.test(blob), 'classified concept produces instructional discovery queries');
  assert(/reddit/.test(blob), 'source-specific frog-tie path exists');
  assert(dq.every(x => /frog/i.test(x.q)), 'concept queries stay on frog tie — not a universal chip dump');
  const vis = visualInvestigationQueries(frog, [], []);
  assert(vis.some(x => /diagram|illustration|visual reference|image|photos/i.test(x.q)), 'technique visual branch is real retrieval, not a class label');
  assert(vis.some(x => /bondage|shibari|restraint|rope/.test(x.q)), 'frog-tie visual queries disambiguate from amphibians');
  const imgQ = conceptVisualSearchQuery('frog tie', '');
  assert(/bondage|shibari|restraint/.test(imgQ), 'concept visual search query is restraint-disambiguated');
  assert(isRestraintTechnique('frog tie') && isRestraintTechnique('frogtie'), 'frog tie classified as restraint technique');
  const wildlife = classifyVisualRelevance({ url: 'https://cdn.pixabay.com/photo/frog.jpg', title: 'green tree frog', snippet: 'amphibian wildlife' }, frog);
  assert(wildlife.demote && wildlife.visualClass === 'unrelated', 'amphibian/wildlife images are demoted for frog-tie');
  const echoWildlife = classifyVisualRelevance({
    url: 'https://get.pxhere.com/photo/frogs-frog-amphibian.jpg',
    title: '"frog tie" (bondage OR shibari OR restraint OR rope)',
  }, frog);
  assert(echoWildlife.demote, 'query-echo title does not keep wildlife hosts in the frog-tie visual set');
}

console.log('--- TEST E frog tie tutorial routing preserved ---');
{
  assert(isTutorialIntent('frog tie tutorial'), 'tutorial intent');
  const intent = parseInvestigationIntent('frog tie tutorial');
  assert(intent.tutorialIntent === true, 'planner tutorialIntent');
}

console.log('--- TEST F Belle Delphine identity collision ---');
{
  const belle = applyResearchFilter(classifyQuery('Belle Delphine'), 'on', 'Belle Delphine');
  assert(belle.type === 'person', 'Belle Delphine is PERSON');
  const hit = fictionalNameCollision('Belle Disney Princess Beauty and the Beast', 'Belle Delphine', 'disney.fandom.com');
  assert(hit && /disney/i.test(hit.collision + hit.reason), 'Disney Belle collision detected');
  const dis = identityDisambiguation('Belle Delphine');
  assert(dis.must.includes('delphine') && dis.negatives.some(n => /disney/i.test(n)), 'identity record requires Delphine and rejects Disney Princess');
  const vis = classifyVisualRelevance({
    title: 'Disney Princess Belle cartoon',
    url: 'https://disney.fandom.com/wiki/Belle',
    snippet: 'Belle from Beauty and the Beast',
  }, { type: 'person', subject: 'Belle Delphine' });
  assert(vis.visualClass === 'unrelated' || vis.demote === true, 'Princess Belle visual rejected');
  const idq = identityVariantQueries(belle, { canonicalName: 'Belle Delphine', aliases: [] }, '', []);
  assert(idq.every(x => /delphine/i.test(x.q)), 'identity/visual queries use the full canonical name, never first-name-only Belle');
  assert(idq.some(x => /disney|princess/i.test(x.q)), 'Belle visual queries include collision negatives');
}

console.log('--- TEST G Account/Premium is a real investigation branch ---');
{
  const acc = accountInvestigationQueries({ type: 'person', subject: 'Belle Delphine' }, { canonicalName: 'Belle Delphine' }, [
    { url: 'https://onlyfans.com/belledelphine', domain: 'onlyfans.com', handle: 'belledelphine' },
  ], []);
  assert(acc.some(x => /instagram|x\.com|twitter/i.test(x.q)), 'public profile discovery');
  assert(acc.some(x => /onlyfans|fansly|loyalfans/i.test(x.q)), 'subscription-profile metadata path');
  assert(acc.some(x => /linktree|allmylinks|official links/i.test(x.q)), 'link-hub path');
  assert(acc.some(x => /site:onlyfans\.com/i.test(x.q)), 'discovered premium URL becomes a recursive public-metadata seed');
  assert(acc.some(x => /belledelphine/i.test(x.q) && /profile|links|bio/i.test(x.q)), 'handle corroboration');
}

console.log('--- TEST H Adaptive expansion continues past duplicates ---');
{
  const ctrl = createAdaptiveController({
    query: 'Riley Reid',
    classification: { type: 'person', subject: 'Riley Reid', intentClass: 'PERSON' },
    identity: { canonicalName: 'Riley Reid', aliases: [] },
  });
  enqueueAdaptiveFamilies(ctrl, {
    classification: { type: 'person', subject: 'Riley Reid', intentClass: 'PERSON', context: 'bondage' },
    identity: { canonicalName: 'Riley Reid', aliases: [] },
    topic: 'bondage',
    wantVisual: true,
  });
  assert(ctrl.pending.length > 4, 'multiple investigation families queued, not one identity variant');
  assert(ctrl.pending.some(p => p.family === 'identity-variants' || p.family === 'entity-topic'), 'identity/entity-topic families present');
  assert(ctrl.pending.some(p => p.family === 'visual'), 'visual is a real queued branch');
  assert(ctrl.pending.some(p => p.family === 'accounts' || p.family === 'premium'), 'account/premium is a real queued branch');
  const first = nextInvestigationBatch(ctrl, 2);
  recordInvestigationBatch(ctrl, first, evaluateNovelty({ items: [{ url: 'https://example.com/a', title: 'Riley Reid' }] }, { urls: ['https://example.com/a'] }));
  assert(ctrl.zeroNoveltyStreak >= 1, 'duplicate-only batch raises zero-novelty streak');
  const decision = decideInvestigationContinuation(ctrl, { remainingFetches: 20, budgetLeft: true, elapsedMs: 10, maxIterations: 10 });
  assert(decision.continue === true, 'duplicates on one branch do not stop the investigation while other paths remain');
  assert(ctrl.pending.length > 0, 'unexplored families remain after a duplicate batch');
}

console.log('--- TEST I Stop diagnostics distinguish A–F ---');
{
  assert(ADAPTIVE_STOP_KINDS.A === 'investigation_exhausted', 'A exhausted');
  assert(ADAPTIVE_STOP_KINDS.C === 'no_novelty', 'C no novelty');
  assert(ADAPTIVE_STOP_KINDS.D === 'provider_unavailable', 'D provider');
  assert(ADAPTIVE_STOP_KINDS.E === 'resource_guard', 'E resource');
  assert(ADAPTIVE_STOP_KINDS.F === 'access_boundary', 'F access');

  const stopE = buildWhyDidYouStop({
    uniqueResults: 16, duplicates: 8, variants: [{ q: 'x' }], sourceClasses: ['identity'],
    budgetHit: true, pathsRemainingCount: 3, iterations: 14,
  });
  assert(stopE.stopClass === 'resource_guard' || stopE.stopKind === 'E', 'budget with remaining paths is resource_guard');
  assert(/resource safeguard|resource limit/i.test(stopE.headline), 'does not say research complete');
  assert(/not complete|before all/i.test(stopE.headline), 'honest that investigation was not complete');
  assert(!/per-request research budget was reached/i.test(stopE.headline), 'old budget copy gone');

  const stopA = buildWhyDidYouStop({
    uniqueResults: 12, exhausted: true, pathsRemainingCount: 0, zeroNoveltyStreak: ADAPTIVE_NOVELTY_STOP_STREAK,
    variants: [{ q: 'x' }], sourceClasses: ['identity', 'visual'], iterations: 6,
  });
  assert(stopA.stopClass === 'investigation_exhausted' || stopA.stopKind === 'A', 'exhausted paths + no novelty = A');
  assert(/exhausted/i.test(stopA.headline), 'exhausted headline');

  const stopD = buildWhyDidYouStop({ uniqueResults: 2, variants: [{ q: 'x' }], sourceClasses: ['identity'], providerUnavailable: true, adaptiveStopKind: 'D' });
  assert(stopD.stopClass === 'provider_unavailable' || stopD.stopKind === 'D', 'provider unavailable = D');

  const stopF = buildWhyDidYouStop({ uniqueResults: 0, inaccessible: 3, variants: [{ q: 'x' }], sourceClasses: ['premium'] });
  assert(stopF.notFoundVsNotSearched === 'E' || stopF.stopKind === 'F', 'access boundary still reported');

  const ctrl = createAdaptiveController({ classification: { type: 'person', subject: 'X' } });
  enqueueInvestigationPaths(ctrl, [{ q: '"X" site:onlyfans.com', family: 'premium', accessBound: true }]);
  const decF = decideInvestigationContinuation(ctrl, { remainingFetches: 20, budgetLeft: true, elapsedMs: 10, accessBoundary: true });
  assert(decF.stopKind === 'F' && decF.continue === false, 'controller stops on access boundary');

  const decE = decideInvestigationContinuation(createAdaptiveController({}), { remainingFetches: 0, resourceExhausted: true, budgetLeft: false });
  // empty pending + resource → exhausted A, not E (nothing remained)
  const ctrlE = createAdaptiveController({});
  enqueueInvestigationPaths(ctrlE, [{ q: 'more path', family: 'visual' }]);
  const decE2 = decideInvestigationContinuation(ctrlE, { remainingFetches: 0, resourceExhausted: true, budgetLeft: false, elapsedMs: 10 });
  assert(decE2.stopKind === 'E' && /not complete/i.test(decE2.reason), 'resource guard with remaining paths is E, not complete');
}

console.log('--- TEST J Provenance / recursive seeds ---');
{
  const seeds = extractInvestigationSeeds([
    { title: 'Riley Reid (aka Bondage Riley)', url: 'https://www.iafd.com/person.rme/perfid=rileyreid', aliases: ['Bondage Riley'], accountHandle: 'rileyreid', accountPlatform: 'X', contentType: 'identity' },
    { title: 'Riley Reid gallery', url: 'https://babepedia.com/Riley_Reid', snippet: 'gallery photoset' },
    { title: 'Riley Reid OnlyFans', url: 'https://onlyfans.com/rileyreid', accountHandle: 'rileyreid', accountPlatform: 'OnlyFans', contentType: 'account' },
  ], { type: 'person', subject: 'Riley Reid' });
  assert(seeds.aliases.some(a => /bondage riley/i.test(a.label)), 'alias extracted from evidence');
  assert(seeds.accounts.some(a => /onlyfans/i.test(a.platform + a.domain + a.url)), 'account extracted with platform');
  assert(seeds.galleries.length >= 1, 'gallery link extracted');
  const qs = seedsToQueries(seeds, { type: 'person', subject: 'Riley Reid', context: 'bondage' }, []);
  assert(qs.some(x => /bondage riley/i.test(x.q)), 'discovered alias becomes a new investigation branch');
  assert(qs.some(x => /site:babepedia/i.test(x.q) || /site:onlyfans/i.test(x.q)), 'discovered domain/account seeds recursive public follow-up');
}

console.log('--- novelty + controller bookkeeping ---');
{
  const nov = evaluateNovelty({
    items: [
      { url: 'https://a.example/1', title: 'new', aliases: ['Alias One'] },
      { url: 'https://b.example/1', title: 'dup', duplicate: true },
    ],
  }, { urls: ['https://b.example/1'], hosts: ['b.example'] });
  assert(nov.newUniqueResults === 1 && nov.duplicateResults >= 1, 'novelty splits unique vs duplicate');
  assert(nov.newDomains.includes('a.example'), 'new domain recorded');
  assert(nov.meaningful === true, 'new unique result is meaningful novelty');
  const none = evaluateNovelty({ items: [{ url: 'https://a.example/1' }] }, { urls: ['https://a.example/1'] });
  assert(none.meaningful === false && none.duplicateResults >= 1, 'all-duplicate batch is not meaningful');
  assert(INVESTIGATION_PATH_FAMILIES.includes('visual') && INVESTIGATION_PATH_FAMILIES.includes('accounts'), 'path families catalogued');
  assert(ADAPTIVE_BATCH_SIZE >= 2, 'batches are small evaluation units, not a single dump');
}

console.log('--- What Carmen checked expanded trace ---');
{
  const ctrl = createAdaptiveController({ classification: { type: 'person', subject: 'Riley Reid' } });
  enqueueAdaptiveFamilies(ctrl, { classification: { type: 'person', subject: 'Riley Reid' }, identity: { canonicalName: 'Riley Reid' }, wantVisual: true });
  const batch = nextInvestigationBatch(ctrl, 2);
  recordInvestigationBatch(ctrl, batch, { meaningful: true, newUniqueResults: 3, duplicateResults: 1, newDomains: ['iafd.com'], newAliases: [], newAccounts: [], newVisualCandidates: [] });
  const trace = adaptiveTrace(ctrl);
  assert(trace.iterations === 1, 'trace records iterations');
  const checked = buildWhatCarmenChecked({
    variants: batch,
    sourceClasses: ['identity'],
    aliases: ['Riley Reid'],
    uniqueResults: 3,
    adaptive: trace,
  });
  assert(/iteration/i.test(checked.summary), 'checked summary mentions iterations');
  assert(Array.isArray(checked.visualPaths) && Array.isArray(checked.identityVariants), 'checked exposes visual + identity variants');
}

console.log('--- fixture searches still succeed (A/B/D/E/F) ---');
{
  const riley = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Riley Reid') + '&type=person&adult=on&fixture=riley-reid'), {});
  const rileyBody = await riley.json();
  assert(riley.status === 200, 'fixture Riley Reid 200');
  assert(rileyBody.classification && rileyBody.classification.type === 'person', 'Riley classified as person');
  assert((rileyBody.results || []).some(r => /iafd/i.test(r.url || '')), 'Riley IAFD present');
  assert(rileyBody.whatCarmenChecked && rileyBody.whyDidYouStop, 'envelope includes checked/stop');
  assert(rileyBody.adaptiveInvestigation, 'adaptive investigation trace present');
  assert(!/per-request research budget was reached/i.test((rileyBody.whyDidYouStop && rileyBody.whyDidYouStop.headline) || ''), 'fixture stop is not the old budget copy');

  const rileyB = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Riley Reid bondage') + '&entity=Riley%20Reid&topic=bondage&type=person&adult=on&fixture=riley-reid'), {});
  const rileyBBody = await rileyB.json();
  assert(rileyBBody.classification && rileyBBody.classification.subject === 'Riley Reid', 'Riley remains resolved person');
  assert(/bondage/i.test(rileyBBody.investigationContext && rileyBBody.investigationContext.topic || rileyBBody.classification.context || ''), 'bondage topic survives');

  const frog = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('frog tie') + '&adult=on&fixture=frog-tie'), {});
  const frogBody = await frog.json();
  assert(frogBody.classification && frogBody.classification.type !== 'person', 'frog tie is not a person');
  assert((frogBody.variants || []).some(v => /frog-tie|frogtie|diagram|visual reference|tutorial/i.test(v.q)), 'frog-tie investigation actually queued concept/visual/tutorial queries');

  const frogT = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('frog tie tutorial') + '&adult=on&fixture=frog-tie'), {});
  const frogTBody = await frogT.json();
  assert(frogTBody.intent && frogTBody.intent.tutorialIntent, 'tutorial intent on fixture search');
  assert((frogTBody.results || []).some(r => r.contentType === 'tutorial' || /wikihow|instructables/i.test(r.url || '')), 'instructional resource ranked');

  const belle = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Belle Delphine') + '&type=person&adult=on&fixture=belle-delphine&premium=1'), {});
  const belleBody = await belle.json();
  assert(belleBody.classification && belleBody.classification.type === 'person', 'Belle Delphine is PERSON');
  const disney = (belleBody.results || []).filter(r => /disney/i.test((r.title || '') + (r.url || '') + (r.snippet || '')));
  const real = (belleBody.results || []).filter(r => /delphine/i.test((r.title || '') + (r.url || '')));
  if (disney.length && real.length) {
    assert(real[0].score > disney[0].score, 'Belle Delphine outranks Disney Princess Belle');
  }
  assert((belleBody.premiumContent || []).length >= 1, 'premium account discovery populated');
  assert((belleBody.accounts || belleBody.premiumContent || []).some(a => a.url || a.platform), 'account branch returns platform/url evidence');
}

console.log('--- health features ---');
{
  const res = await worker.fetch(new Request('https://test/health'), {});
  const body = await res.json();
  assert((body.version === '49.8' || body.version === '49.9') && /49\.(8-adaptive-investigation|9-identity-queue-visual)/.test(body.build || ''), 'health reports current');
  assert((body.features || []).includes('v49.8-adaptive-investigation'), 'feature flag adaptive-investigation');
  assert((body.features || []).includes('v49.8-visual-branch'), 'feature flag visual-branch');
  assert((body.features || []).includes('v49.7-retrieval-engine'), 'v49.7 flags retained');
  assert((body.features || []).includes('v49.6-state-isolation'), 'v49.6 flags retained');
}

console.log('--- worker wires adaptive continuation (not a parallel engine) ---');
{
  assert(/createAdaptiveController/.test(workerSrc) && /decideInvestigationContinuation/.test(workerSrc), 'worker uses planner controller');
  assert(/runAdaptiveQuery/.test(workerSrc), 'adaptive queries reuse existing ddg/bing/image providers');
  assert(/SEARCH_BUDGET\.max = FETCH_HARD_CAP/.test(workerSrc), 'adaptive continuation uses FETCH_HARD_CAP as the rail, not the first-pass budget');
  assert(/adaptiveReserve/.test(workerSrc), 'first-pass leaves fetch headroom for adaptive continuation');
  assert(/entityAssociatedVisualQueries/.test(workerSrc), 'entity-seeded visual path wired');
  assert(!/new SearchEngine|parallel retrieval engine/i.test(workerSrc), 'no parallel retrieval engine');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
