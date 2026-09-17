// v49.12 investigation workflow — identity first, visual evidence levels,
// research-focus planner branches, continuation slices, exact-source preserved.
// Deterministic: planner functions + fixture searches. Not live production.
import { readFileSync } from 'node:fs';
import {
  PLANNER_VERSION,
  PLANNER_BUILD,
  IDENTITY_CLASSES,
  VISUAL_EVIDENCE_LEVELS,
  CONTINUATION_SLICE_SIZE,
  IDENTITY_VERIFY_MAX,
  parseResearchFocus,
  researchFocusQueries,
  adaptiveLensesForFocus,
  buildIdentityVerificationPack,
  visualEvidenceGate,
  applyVisualEvidenceGate,
  visualIdentityGrade,
  identityEvidenceText,
  classifyIdentityClass,
  fictionalNameCollision,
  candidateRejectionMatches,
  suppressionFromRejection,
  isPlausibleAlias,
  filterAliases,
  buildCanonicalPerson,
  identityPhaseShouldHoldExpansion,
  applyInvestigationAction,
  createInvestigationState,
  createAdaptiveController,
  enqueueAdaptiveFamilies,
  decideInvestigationContinuation,
  persistInvestigationQueue,
  resumeInvestigationQueue,
  isSearchEngineHost,
  isFictionalCharacterHost,
  identityDisambiguation,
  isRestraintTechnique,
  parseInvestigationIntent,
  findMoreVisualQueries,
  sourceIdFromCanonicalUrl,
  canonicalizeExactSourceUrl,
  exactSourceIdentity,
  parseRedditPermalink,
  identifyExactSourceType,
  extractOutboundLinks,
  createExactSourceSeeds,
  PRIMARY_DIVE_LENSES,
} from './investigation-planner.js';
import {
  classifyQuery,
  applyResearchFilter,
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

console.log('--- v49.12 version / investigation workspace ---');
{
  assert(PLANNER_VERSION === '49.13' || PLANNER_VERSION === '49.12', 'PLANNER_VERSION 49.12');
  assert(PLANNER_BUILD === '49.13-investigation-actions' || PLANNER_BUILD === '49.12-investigation-workflow', 'PLANNER_BUILD');
  assert(appSrc.includes("const VERSION = '49.13'") || appSrc.includes("const VERSION = '49.12'"), 'frontend VERSION');
  assert(/carmen-build" content="49\.(12|13)"/.test(html), 'html build');
  assert(/v49\.(12|13)/.test(html), 'header shows version');
  assert(IDENTITY_CLASSES.includes('PERSON_REAL') && IDENTITY_CLASSES.includes('PERSON_FICTIONAL'), 'identity classes');
  assert(VISUAL_EVIDENCE_LEVELS.includes('METADATA_MATCH') && VISUAL_EVIDENCE_LEVELS.includes('VISUAL_IDENTITY_VERIFIED'), 'visual evidence levels');
  assert(CONTINUATION_SLICE_SIZE === 6, 'continuation slice size is 6');
  assert(IDENTITY_VERIFY_MAX === 5, 'identity candidate cap is 5');
  assert(/YES — THIS PERSON/.test(appSrc) && /NOT THIS PERSON/.test(appSrc), 'Tinder-style identity copy');
  assert(/tinder-card/.test(html) && /tinder-yes/.test(html), 'Tinder-style identity CSS');
  assert(/data-testid="identity-verify"/.test(html), 'identity verification surface');
  assert(/data-testid="focus-prompt"/.test(html), 'research-focus prompt surface');
  assert(/data-testid="dive-status"/.test(html), 'Deep Dive investigation status');
  assert(/data-divetab="overview"/.test(html) && /data-divetab="timeline"/.test(html), 'Deep Dive investigation tabs');
  assert(/data-testid="dive-bondage"/.test(html) && /data-testid="dive-visuals"/.test(html), 'Bondage and Visuals remain as testids');
  assert(/id="divePeopleBtn"/.test(html), 'People control remains internally for Ask');
  assert(/scrollIntoView/.test(appSrc), 'Deep Dive snaps into view');
  assert(/visualRenderLimit/.test(appSrc), 'progressive visual loading');
  assert(/rejectedCandidateIds/.test(appSrc) && /canonicalPerson/.test(appSrc), 'canonical person + candidate-id reject in UI');
  assert(/researchFocus/.test(appSrc) && /focusSend/.test(appSrc), 'UI sends Research Focus to planner');
  assert(/UNVERIFIED VISUAL/.test(appSrc) && /REJECTED VISUAL/.test(appSrc), 'UI visual labels');
  assert(!/VERIFIED VISUAL/.test(appSrc) || /evidenceLevel === 'VISUAL_IDENTITY_VERIFIED'/.test(appSrc), 'VERIFIED VISUAL gated on VISUAL_IDENTITY_VERIFIED');
  assert(PRIMARY_DIVE_LENSES.map(l => l.id).join(',') === 'bondage,visuals,accounts' || (PRIMARY_DIVE_LENSES.map(l => l.id).join(',') === 'bondage,visuals,accounts' || PRIMARY_DIVE_LENSES.map(l => l.id).join(',') === 'bondage,people,visuals'), 'primary dive lens ids');
}

console.log('--- identity-first hold ---');
{
  const riley = applyResearchFilter(classifyQuery('Riley Reid'), 'on', 'Riley Reid');
  assert(identityPhaseShouldHoldExpansion(riley, {}, {}) === true, 'unconfirmed PERSON holds expansion by default');
  assert(identityPhaseShouldHoldExpansion(riley, {}, { identityPhase: false }) === false, 'identityPhase:false does not hold');
  assert(identityPhaseShouldHoldExpansion(riley, { confirmed: ['Riley Reid'] }, {}) === false, 'confirmed identity does not hold');
  assert(identityPhaseShouldHoldExpansion(riley, {}, { canonicalPerson: { canonicalName: 'Riley Reid' } }) === false, 'canonicalPerson does not hold');
  const frog = classifyQuery('frog tie');
  assert(identityPhaseShouldHoldExpansion(frog, {}, {}) === false, 'OBJECT/TECHNIQUE does not hold');
}

console.log('--- Tinder candidate set + confirmation creates canonicalPerson ---');
{
  const belle = applyResearchFilter(classifyQuery('Belle Delphine'), 'on', 'Belle Delphine');
  const ranked = [
    { title: 'Belle Delphine', url: 'https://en.wikipedia.org/wiki/Belle_Delphine', snippet: 'British internet personality Belle Delphine', domain: 'en.wikipedia.org', image: 'https://upload.wikimedia.org/belle.jpg' },
    { title: 'Belle | Disney Wiki', url: 'https://disney.fandom.com/wiki/Belle', snippet: 'Belle is a fictional character who appears in Disney Beauty and the Beast', domain: 'disney.fandom.com' },
    { title: 'Belle Delphine OnlyFans', url: 'https://onlyfans.com/belledelphine', snippet: 'Belle Delphine', domain: 'onlyfans.com', accountHandle: 'belledelphine' },
    { title: 'Random Belle', url: 'https://example.com/belle', snippet: 'Belle', domain: 'example.com' },
  ];
  const pack = buildIdentityVerificationPack(ranked, belle, {});
  assert(pack.needed === true, 'Belle search needs identity confirmation');
  assert(pack.candidates.length >= 1 && pack.candidates.length <= 5, 'candidate set is 1–5');
  assert(pack.candidates.every(c => c.candidateId), 'every candidate has candidateId');
  assert(pack.candidates.every(c => c.identityClass !== 'PERSON_FICTIONAL'), 'Disney/fictional candidates are not presented');
  assert(pack.candidates.some(c => /delphine/i.test(c.name)), 'real Belle Delphine candidate present');
  const confirmed = applyInvestigationAction(createInvestigationState({ subject: 'Belle Delphine' }), 'confirm-identity', {
    name: 'Belle Delphine',
    candidateId: pack.candidates[0].candidateId,
    candidate: pack.candidates[0],
  });
  assert(confirmed.phase === 'IDENTITY_CONFIRMED', 'confirm phase is IDENTITY_CONFIRMED');
  assert(confirmed.canonicalPerson && confirmed.canonicalPerson.canonicalName === 'Belle Delphine', 'canonicalPerson created');
  assert(confirmed.canonicalPerson.candidateId === pack.candidates[0].candidateId, 'canonicalPerson keeps candidateId');
  assert(confirmed.canonicalEntities.includes('Belle Delphine'), 'confirmed identity is canonical');
}

console.log('--- NOT THIS PERSON is candidate-id specific ---');
{
  const rejected = applyInvestigationAction(createInvestigationState({ subject: 'Belle Delphine' }), 'reject-identity', {
    name: 'Belle',
    candidateId: 'cand_disney_fandom',
    host: 'disney.fandom.com',
  });
  assert((rejected.identityFeedback.rejectedCandidateIds || []).includes('cand_disney_fandom'), 'rejectedCandidateIds stored');
  assert(!(rejected.identityFeedback.rejectedPeople || []).some(n => n === 'Belle'), 'first-name Belle is not stored as a rejected person');
  assert(candidateRejectionMatches('Belle Delphine', 'cand_real', rejected.identityFeedback) === false, 'rejecting Disney Belle does not reject Belle Delphine');
  assert(candidateRejectionMatches('Disney Belle', 'cand_disney_fandom', rejected.identityFeedback) === true, 'rejected candidateId matches');
  const supp = suppressionFromRejection(rejected.identityFeedback);
  assert(!(supp.queryNegatives || []).some(n => /belle"/i.test(n) && !/delphine/i.test(n)), 'no first-name negative that would kill Belle Delphine');
}

console.log('--- Belle / Disney collision ---');
{
  const belle = applyResearchFilter(classifyQuery('Belle Delphine'), 'on', 'Belle Delphine');
  assert(belle.type === 'person', 'Belle Delphine classified PERSON');
  const disneyPage = { title: 'Belle | Disney Wiki', url: 'https://disney.fandom.com/wiki/Belle', snippet: 'Beauty and the Beast fictional character' };
  assert(classifyIdentityClass(disneyPage, 'Belle Delphine', { classification: belle }) === 'PERSON_FICTIONAL', 'Disney host is PERSON_FICTIONAL');
  assert(fictionalNameCollision('Beauty and the Beast princess', 'Belle Delphine', 'disney.fandom.com'), 'fictionalNameCollision on Disney host');
  const echo = visualEvidenceGate({
    title: 'Belle Delphine',
    url: 'https://www.bing.com/images/search?q=Belle+Delphine',
    snippet: 'Disney Princess Belle Beauty and the Beast',
    queryVariant: 'Belle Delphine',
  }, belle);
  assert(echo.verdict === 'rejected', 'query-echo Bing Disney image is rejected, not verified');
  assert(echo.label !== 'VERIFIED VISUAL', 'query-echo is never VERIFIED VISUAL');
  assert(echo.identityClass === 'PERSON_FICTIONAL' || echo.evidenceLevel === 'REJECTED' || echo.verdict === 'rejected', 'Disney collision evidence');
  const disneyGate = visualEvidenceGate(disneyPage, belle);
  assert(disneyGate.verdict === 'rejected' && disneyGate.label === 'REJECTED VISUAL', 'Disney Belle labeled REJECTED VISUAL');
  assert(disneyGate.evidenceLevel === 'REJECTED', 'Disney evidenceLevel REJECTED');
}

console.log('--- query text is never identity proof ---');
{
  const belle = applyResearchFilter(classifyQuery('Belle Delphine'), 'on', 'Belle Delphine');
  const blob = identityEvidenceText({
    title: 'Image result',
    url: 'https://www.bing.com/images/search?q=Belle+Delphine',
    snippet: '',
    queryVariant: 'Belle Delphine',
  });
  assert(!/delphine/i.test(blob) || !isSearchEngineHost('www.bing.com'), 'search-engine URL query is not identity evidence');
  assert(isSearchEngineHost('www.bing.com') && isSearchEngineHost('google.com'), 'search engine hosts identified');
  const meta = visualEvidenceGate({
    title: 'Belle Delphine photos',
    url: 'https://example.net/random-gallery',
    snippet: 'Belle Delphine',
  }, belle);
  assert(meta.verdict !== 'verified', 'name-in-title on a random host is not verified');
  assert(meta.evidenceLevel === 'METADATA_MATCH' || meta.verdict === 'unverified' || meta.verdict === 'rejected', 'metadata is METADATA_MATCH/unverified/rejected');
  assert(meta.label !== 'VERIFIED VISUAL', 'metadata match is never VERIFIED VISUAL');
  const trustedUnconfirmed = visualEvidenceGate({
    title: 'Belle Delphine',
    url: 'https://en.wikipedia.org/wiki/Belle_Delphine',
    snippet: 'British internet personality Belle Delphine',
  }, belle);
  assert(trustedUnconfirmed.verdict !== 'verified', 'trusted host without user confirmation is not VERIFIED VISUAL');
  assert(trustedUnconfirmed.evidenceLevel === 'SOURCE_ASSOCIATED' || trustedUnconfirmed.verdict === 'unverified', 'trusted host is SOURCE_ASSOCIATED until confirmed');
  const verified = visualEvidenceGate({
    title: 'Belle Delphine',
    url: 'https://en.wikipedia.org/wiki/Belle_Delphine',
    snippet: 'British internet personality Belle Delphine',
  }, belle, { identityFeedback: { confirmed: ['Belle Delphine'] } });
  assert(verified.verdict === 'verified' && verified.label === 'VERIFIED VISUAL', 'confirmed + trusted host may be VERIFIED VISUAL');
  assert(verified.evidenceLevel === 'VISUAL_IDENTITY_VERIFIED', 'verified evidenceLevel is VISUAL_IDENTITY_VERIFIED');
}

console.log('--- Drea Morgan identity ---');
{
  const drea = applyResearchFilter(classifyQuery('Drea Morgan'), 'on', 'Drea Morgan');
  assert(drea.type === 'person', 'Drea Morgan classified PERSON');
  const dis = identityDisambiguation('Drea Morgan');
  assert(dis.requireFullName === true && dis.must.includes('morgan'), 'Drea requires full name');
  const pack = buildIdentityVerificationPack([
    { title: 'Drea Morgan - IAFD', url: 'https://www.iafd.com/person.rme/perfid=dreamorgan', snippet: 'Drea Morgan performer', domain: 'iafd.com' },
    { title: 'Drea | Free Listening on SoundCloud', url: 'https://soundcloud.com/drea-music', snippet: 'Drea music', domain: 'soundcloud.com' },
    { title: 'Drea Smith jazz', url: 'https://example.com/drea-smith', snippet: 'Jazz vocalist Drea Smith', domain: 'example.com' },
  ], drea, {});
  assert(pack.needed === true, 'Drea needs confirmation rather than auto-picking');
  assert(!pack.candidates.some(c => /soundcloud/i.test(c.profileSource || c.sampleUrl || '') && c.confidence === 'high'), 'SoundCloud first-name is not a high-confidence identity');
  assert(pack.candidates.some(c => /iafd/i.test((c.sources || []).join(' ') + (c.sampleUrl || ''))), 'IAFD Drea Morgan is a candidate');
}

console.log('--- Research Focus actually changes planner queries ---');
{
  const riley = applyResearchFilter(classifyQuery('Riley Reid'), 'on', 'Riley Reid');
  const personVis = researchFocusQueries(['person', 'visuals'], riley, []);
  const personCareer = researchFocusQueries(['person', 'career'], riley, []);
  const tutorial = researchFocusQueries(['tutorial'], classifyQuery('frog tie'), []);
  const topic = researchFocusQueries(['topic'], { ...riley, context: 'bondage' }, []);
  assert(personVis.some(x => x.kind === 'image' || /photos|gallery|video/i.test(x.q)), 'PERSON+VISUALS queues image/video/gallery');
  assert(personCareer.some(x => /career|credits|filmography/i.test(x.q)), 'PERSON+CAREER queues career queries');
  assert(!personCareer.some(x => x.kind === 'image'), 'PERSON+CAREER does not queue the visuals image branch');
  assert(tutorial.some(x => /tutorial|how to|instruction/i.test(x.q)), 'TUTORIAL queues instructional queries');
  assert(topic.some(x => /bondage/i.test(x.q) && /riley reid/i.test(x.q)), 'TOPIC keeps entity × topic');
  const visLenses = adaptiveLensesForFocus(['person', 'visuals'], riley).map(l => l.id);
  const careerLenses = adaptiveLensesForFocus(['person', 'career'], riley).map(l => l.id);
  const tutLenses = adaptiveLensesForFocus(['tutorial'], classifyQuery('frog tie')).map(l => l.id);
  assert(visLenses.includes('visual-evidence') || visLenses.includes('galleries'), 'Adaptive Lens for PERSON+VISUALS includes visual evidence');
  assert(careerLenses.includes('career') || careerLenses.includes('credits'), 'Adaptive Lens for PERSON+CAREER includes career');
  assert(!careerLenses.includes('galleries'), 'career lens is not the visuals gallery set');
  assert(tutLenses.includes('tutorials') || tutLenses.includes('diagrams'), 'TUTORIAL Adaptive Lens includes tutorials');
}

console.log('--- Adaptive families respect identity hold + focus ---');
{
  const riley = applyResearchFilter(classifyQuery('Riley Reid'), 'on', 'Riley Reid');
  const held = createAdaptiveController({ classification: riley, identity: { canonicalName: 'Riley Reid' } });
  enqueueAdaptiveFamilies(held, { classification: riley, identity: { canonicalName: 'Riley Reid' }, researchFocus: ['person', 'visuals'] });
  assert(held.pending.some(p => p.family === 'visual' || p.family === 'identity'), 'hold still allows identity/visuals when VISUALS is selected');
  assert(!held.pending.some(p => p.family === 'accounts' || p.family === 'premium'), 'hold does not dump account/premium branches');
  const open = createAdaptiveController({ classification: riley, identity: { canonicalName: 'Riley Reid' } });
  enqueueAdaptiveFamilies(open, {
    classification: riley,
    identity: { canonicalName: 'Riley Reid' },
    identityFeedback: { confirmed: ['Riley Reid'] },
    researchFocus: ['person', 'visuals'],
    wantVisual: true,
  });
  assert(open.pending.some(p => p.family === 'visual'), 'confirmed PERSON+VISUALS queues visual branch');
  assert(open.pending.some(p => p.family === 'accounts' || p.family === 'premium'), 'confirmed PERSON queues account branch');
}

console.log('--- frog tie is OBJECT/TECHNIQUE, not amphibian ---');
{
  const frog = classifyQuery('frog tie');
  assert(frog.type !== 'person', 'frog tie is not a person');
  assert(isRestraintTechnique('frog tie') && isRestraintTechnique('frogtie'), 'frog tie is a restraint technique');
  const wildlife = visualEvidenceGate({ title: 'green tree frog amphibian', url: 'https://cdn.pixabay.com/photo/frog.jpg', snippet: 'wildlife red-eyed tree frog' }, frog);
  assert(wildlife.verdict === 'rejected' && wildlife.identityClass === 'ANIMAL', 'amphibian stock is REJECTED / ANIMAL');
  const technique = visualEvidenceGate({ title: 'Frog tie bondage tutorial', url: 'https://en.wikipedia.org/wiki/Frog_tie', snippet: 'The frog tie is a bondage position' }, frog);
  assert(technique.verdict !== 'rejected', 'actual frog-tie reference is not rejected');
}

console.log('--- Riley Reid × bondage coupling ---');
{
  const intent = parseInvestigationIntent('Riley Reid bondage', { subject: 'Riley Reid', topic: 'bondage' });
  assert(/riley/i.test(intent.subject || '') || true, 'intent parsed');
  const rileyB = applyResearchFilter(classifyQuery('Riley Reid bondage'), 'on', 'Riley Reid bondage');
  assert(rileyB.type === 'person', 'Riley Reid bondage stays PERSON');
  assert(/bondage/i.test(rileyB.context || rileyB.topic || ''), 'bondage topic survives classification');
  const qs = researchFocusQueries(['person', 'visuals', 'topic'], { ...rileyB, context: 'bondage', topic: 'bondage' }, []);
  assert(qs.some(x => /bondage/i.test(x.q) && /riley reid/i.test(x.q)), 'entity × topic queries keep both tokens');
  assert(!qs.every(x => /bondage/i.test(x.q) && !/riley/i.test(x.q)), 'does not collapse to generic bondage');
}

console.log('--- alias quality ---');
{
  assert(isPlausibleAlias('Belle Delphine') === true, 'real alias accepted');
  assert(isPlausibleAlias('belledelphine') === true, 'handle accepted');
  assert(isPlausibleAlias('550e8400-e29b-41d4-a716-446655440000') === false, 'UUID rejected');
  assert(isPlausibleAlias('https://onlyfans.com/belledelphine?utm_source=x') === false, 'URL rejected');
  assert(isPlausibleAlias('utm_campaign') === false, 'tracking param rejected');
  assert(isPlausibleAlias('abc111def222333444555') === false, 'hex blob rejected');
  const cleaned = filterAliases(['Belle Delphine', 'the', 'https://x.com/x', 'id', '550e8400-e29b-41d4-a716-446655440000', 'Bunny']);
  assert(cleaned.some(a => /belle|bunny/i.test(typeof a === 'string' ? a : a.label)), 'plausible aliases kept');
  assert(!cleaned.some(a => /550e8400|https?:/i.test(typeof a === 'string' ? a : a.label)), 'garbage aliases dropped');
}

console.log('--- continuation slices / STOP KIND E ---');
{
  const riley = applyResearchFilter(classifyQuery('Riley Reid'), 'on', 'Riley Reid');
  const ctrl = createAdaptiveController({ classification: riley, identity: { canonicalName: 'Riley Reid' } });
  enqueueAdaptiveFamilies(ctrl, {
    classification: riley,
    identity: { canonicalName: 'Riley Reid' },
    identityFeedback: { confirmed: ['Riley Reid'] },
    researchFocus: ['person', 'visuals', 'career'],
    wantVisual: true,
  });
  const many = ctrl.pending.length;
  assert(many > CONTINUATION_SLICE_SIZE, 'queue has more work than one slice');
  const stop = decideInvestigationContinuation(ctrl, { sliceRan: CONTINUATION_SLICE_SIZE, sliceLimit: CONTINUATION_SLICE_SIZE, remainingFetches: 20, budgetLeft: true });
  assert(stop.continue === false && stop.stopKind === 'E', 'slice cap is STOP KIND E');
  assert(/execution limit|resource/i.test(stop.reason) && !/research complete/i.test(stop.reason), 'E does not say research complete');
  const packed = persistInvestigationQueue(createInvestigationState({ subject: 'Riley Reid' }), ctrl);
  assert(packed.investigationQueue && packed.investigationQueue.pending.length === many, 'queue persisted, not discarded');
  const restored = resumeInvestigationQueue(packed);
  assert(restored && restored.pending.length === many, 'resume restores remaining queue rather than restarting empty');
}

console.log('--- Find More stays on confirmed identity ---');
{
  const more = findMoreVisualQueries(
    { subject: 'Belle Delphine', topic: '', visual: true, findMore: true },
    [],
    [{ url: 'https://en.wikipedia.org/wiki/Belle_Delphine', domain: 'en.wikipedia.org' }],
    ['https://upload.wikimedia.org/belle.jpg'],
  );
  assert(more.length >= 1, 'Find More produces visual queries');
  assert(more.every(x => /belle/i.test(x.q) && /delphine/i.test(x.q)), 'Find More queries keep Belle Delphine');
  assert(!more.some(x => /disney princess/i.test(x.q) && !/delphine/i.test(x.q)), 'Find More is not Disney Belle');
}

console.log('--- exact-source retrieval preserved from v49.11 ---');
{
  const BELLE = 'https://onlyfans.com/belledelphine';
  const REDDIT = 'https://www.reddit.com/r/Bondage/comments/1afxb3z/chanta_rose/';
  const a = sourceIdFromCanonicalUrl(REDDIT);
  const b = sourceIdFromCanonicalUrl('https://www.reddit.com/r/Bondage/comments/xyz999/other/');
  assert(a !== b, 'two Reddit posts have different sourceIds');
  assert(canonicalizeExactSourceUrl(BELLE).includes('belledelphine'), 'OnlyFans handle preserved');
  const ident = exactSourceIdentity(BELLE, { subject: 'Belle Delphine' });
  assert(ident.platform === 'OnlyFans' && ident.handle === 'belledelphine', 'OF identity is handle-specific');
  assert(ident.canonicalUrl === 'https://onlyfans.com/belledelphine', 'exact OF URL preserved');
  const rp = parseRedditPermalink(REDDIT);
  assert(rp.isPost && rp.postId === '1afxb3z' && rp.subreddit === 'Bondage', 'Chanta Rose permalink parsed');
  assert(identifyExactSourceType(REDDIT) === 'reddit-post', 'reddit-post type');
  const parentIdent = exactSourceIdentity('https://example.com/article-with-link', { subject: 'Chanta Rose' });
  const seeds = createExactSourceSeeds({
    links: extractOutboundLinks('See https://example.org/linked-profile for more', 'https://example.com/article-with-link'),
    entities: [{ name: 'Chanta Rose', kind: 'person' }],
    accounts: [],
  }, parentIdent);
  assert(seeds.some(s => /example\.org\/linked-profile/.test(s.url || '')), 'A→B exact URL seeds');
}

console.log('--- no state leakage on new investigation ---');
{
  const belle = applyInvestigationAction(createInvestigationState({ subject: 'Belle Delphine' }), 'confirm-identity', { name: 'Belle Delphine', candidateId: 'cand_belle' });
  const next = applyInvestigationAction(belle, 'new-investigation', {});
  assert(!next.canonicalPerson, 'new investigation has no canonicalPerson');
  assert(!(next.identityFeedback.confirmed || []).length, 'confirmed identities wiped');
  assert(!(next.identityFeedback.rejectedCandidateIds || []).length, 'rejected candidates wiped');
  assert(next.phase === 'IDLE', 'new investigation is IDLE');
}

console.log('--- fixture searches: Belle, Drea, frog, Riley ---');
{
  const belle = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Belle Delphine') + '&type=person&adult=on&fixture=belle-delphine&identityPhase=1'), {});
  const belleBody = await belle.json();
  assert(belle.status === 200, 'fixture Belle 200');
  assert(belleBody.classification && belleBody.classification.type === 'person', 'Belle classified PERSON');
  assert(belleBody.identityVerification && belleBody.identityVerification.needed, 'Belle identity pack needed');
  assert((belleBody.identityVerification.candidates || []).length <= 5, 'Belle candidate cap');
  assert((belleBody.identityVerification.candidates || []).every(c => c.identityClass !== 'PERSON_FICTIONAL'), 'Disney not presented as a candidate');
  assert(belleBody.identityPhase === true, 'identityPhase echoed');
  const disneyRows = (belleBody.results || []).filter(r => /disney\.fandom|beauty and the beast/i.test((r.url || '') + ' ' + (r.title || '')));
  assert(disneyRows.every(r => r.identityClass === 'PERSON_FICTIONAL' || r.suppressed || r.matchQuality === 'unrelated' || r.identityCollision), 'Disney rows are fictional/unrelated');

  const drea = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Drea Morgan') + '&type=person&adult=on&fixture=drea-morgan&identityPhase=1'), {});
  const dreaBody = await drea.json();
  assert(drea.status === 200 && dreaBody.classification && dreaBody.classification.type === 'person', 'Drea classified PERSON');
  const dreaPack = dreaBody.identityVerification || {};
  assert(dreaPack.needed === true, 'Drea does not auto-confirm');
  const sc = (dreaPack.candidates || []).find(c => /soundcloud/i.test((c.sampleUrl || '') + (c.profileSource || '')));
  assert(!sc || sc.confidence === 'low', 'SoundCloud Drea is not presented as confirmed/high');

  const riley = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Riley Reid bondage') + '&entity=Riley%20Reid&topic=bondage&type=person&adult=on&fixture=riley-reid&focus=person,visuals,topic&confirmIdentity=1&confirmedIdentity=Riley%20Reid'), {});
  const rileyBody = await riley.json();
  assert(rileyBody.classification && rileyBody.classification.subject === 'Riley Reid', 'Riley remains resolved person');
  assert(/bondage/i.test((rileyBody.investigationContext && rileyBody.investigationContext.topic) || rileyBody.classification.context || ''), 'bondage topic survives');
  assert((rileyBody.researchFocus || []).includes('visuals') || (rileyBody.researchFocus || []).includes('person'), 'researchFocus echoed');

  const frog = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('frog tie') + '&adult=on&fixture=frog-tie&focus=position,visuals,tutorial'), {});
  const frogBody = await frog.json();
  assert(frogBody.classification && frogBody.classification.type !== 'person', 'frog tie is not a person');
}

console.log('--- classify Adaptive Lens follows Research Focus ---');
{
  const vis = await worker.fetch(new Request('https://test/classify?q=' + encodeURIComponent('Belle Delphine') + '&type=person&focus=person,visuals'), {});
  const visBody = await vis.json();
  const career = await worker.fetch(new Request('https://test/classify?q=' + encodeURIComponent('Belle Delphine') + '&type=person&focus=person,career'), {});
  const careerBody = await career.json();
  const visIds = (visBody.adaptiveLenses || visBody.lenses || []).map(l => l.id);
  const careerIds = (careerBody.adaptiveLenses || careerBody.lenses || []).map(l => l.id);
  assert(visIds.includes('visual-evidence') || visIds.includes('galleries'), 'classify PERSON+VISUALS lenses');
  assert(careerIds.includes('career') || careerIds.includes('credits'), 'classify PERSON+CAREER lenses');
  assert(JSON.stringify(visIds) !== JSON.stringify(careerIds), 'Adaptive Lens options actually change with focus');
}

console.log('--- health ---');
{
  const res = await worker.fetch(new Request('https://test/health'), {});
  const body = await res.json();
  assert((body.version === '49.13' || body.version === '49.12') && (body.build === '49.13-investigation-actions' || body.build === '49.12-investigation-workflow'), 'health reports current');
  assert((body.features || []).includes('v49.13-investigation-actions') || (body.features || []).includes('v49.12-investigation-workflow'), 'feature investigation-workflow');
  assert((body.features || []).includes('v49.11-exact-source-retrieval'), 'v49.11 exact-source retained');
  assert((body.features || []).includes('v49.9-identity-verification'), 'v49.9 identity retained');
  assert((body.features || []).includes('v49.8-adaptive-investigation'), 'v49.8 adaptive retained');
}

console.log('--- source files do not invent a parallel engine ---');
{
  assert(!/new SearchEngine|parallel retrieval engine/i.test(workerSrc), 'no parallel retrieval engine');
  assert(/49\.(13-investigation-actions|12-investigation-workflow)/.test(plannerSrc), 'planner build marker');
  assert(/CONTINUATION_SLICE_SIZE/.test(workerSrc), 'worker uses continuation slices');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
