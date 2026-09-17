// v49.9 identity verification + persistent queue + visual evidence gate.
// Deterministic — planner functions + fixture searches. Not live production.
import { readFileSync } from 'node:fs';
import {
  PLANNER_VERSION,
  PLANNER_BUILD,
  parseInvestigationIntent,
  parseResearchFocus,
  researchFocusQueries,
  adaptiveLensesForFocus,
  buildIdentityVerificationPack,
  visualEvidenceGate,
  applyVisualEvidenceGate,
  dedupeVisualEvidence,
  findMoreVisualQueries,
  serializeAdaptiveController,
  restoreAdaptiveController,
  persistInvestigationQueue,
  resumeInvestigationQueue,
  identityPhaseShouldHoldExpansion,
  analyzePublicAccountPlan,
  sourceLifecycleState,
  honestResourceStop,
  queuedWorkSummary,
  suppressionFromRejection,
  applyInvestigationAction,
  createInvestigationState,
  createAdaptiveController,
  enqueueAdaptiveFamilies,
  decideInvestigationContinuation,
  classifyVisualRelevance,
  fictionalNameCollision,
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

console.log('--- v49.9 version / hierarchy preserved ---');
{
  assert(PLANNER_VERSION === '49.12' || PLANNER_VERSION === '49.11' || PLANNER_VERSION === '49.9', 'PLANNER_VERSION current');
  assert(PLANNER_BUILD === '49.12-investigation-workflow' || PLANNER_BUILD === '49.11-exact-source-retrieval' || PLANNER_BUILD === '49.9-identity-queue-visual', 'PLANNER_BUILD');
  assert(appSrc.includes("const VERSION = '49.12'") || appSrc.includes("const VERSION = '49.11'") || appSrc.includes("const VERSION = '49.9'"), 'frontend VERSION');
  assert(/carmen-build" content="49\.(9|11|12)"/.test(html), 'html build');
  assert(/v49\.(9|11|12)/.test(html), 'header shows version');
  assert(PRIMARY_DIVE_LENSES.map(l => l.id).join(',') === 'bondage,people,visuals', 'Deep Dive hierarchy unchanged');
  assert(/data-testid="premium-accounts"/.test(html) && /id="divePremiumBtn"/.test(html), 'Account/Premium button present');
  assert(/data-testid="identity-verify"/.test(html), 'identity verification surface');
  assert(/data-testid="resume-queue"/.test(html), 'resume queue surface');
  assert(/images \+ videos/i.test(html), 'VISUALS copy includes images + videos');
  assert(/scrollIntoView/.test(appSrc), 'Deep Dive snaps/scrolls into view');
  assert(/YES — THIS PERSON|Yes — this person|Yes, this is the person/.test(appSrc) && /NOT THIS PERSON|Not this person/.test(appSrc), 'identity confirm/reject copy');
  assert(/UNVERIFIED VISUAL/.test(appSrc), 'UI labels unverified visuals');
  assert(/researchFocus/.test(appSrc) && /focusSend/.test(appSrc), 'UI sends Research Focus to planner');
}

console.log('--- Research Focus is a planner branch ---');
{
  const f = parseResearchFocus('person,visuals,tutorial');
  assert(f.includes('person') && f.includes('visuals') && f.includes('tutorial'), 'multi-select focus parsed');
  assert(parseResearchFocus('website').includes('url'), 'website maps to URL focus');
  const riley = applyResearchFilter(classifyQuery('Riley Reid'), 'on', 'Riley Reid');
  const qs = researchFocusQueries(['person', 'visuals', 'topic'], { ...riley, context: 'bondage' }, []);
  assert(qs.some(x => /profile|bio|database/i.test(x.q)), 'PERSON focus queues identity queries');
  assert(qs.some(x => x.kind === 'image' || /photos|gallery|video/i.test(x.q)), 'VISUALS focus queues image/video queries');
  assert(qs.some(x => /bondage/i.test(x.q) && /riley reid/i.test(x.q)), 'TOPIC focus queues entity × topic');
  const lenses = adaptiveLensesForFocus(['person', 'visuals'], riley);
  assert(lenses.some(l => l.id === 'visual-evidence' || l.id === 'identity'), 'Adaptive Lens follows PERSON+VISUALS');
  const career = adaptiveLensesForFocus(['person'], riley);
  assert(career.some(l => l.id === 'career' || l.id === 'credits'), 'PERSON-only Adaptive Lens keeps career/credits');
}

console.log('--- Identity verification pack ---');
{
  const riley = applyResearchFilter(classifyQuery('Riley Reid'), 'on', 'Riley Reid');
  const ranked = [
    { title: 'Riley Reid', url: 'https://www.iafd.com/person.rme/perfid=rileyreid', snippet: 'Riley Reid performer database', domain: 'iafd.com', image: 'https://iafd.com/riley.jpg' },
    { title: 'Riley Reid OnlyFans', url: 'https://onlyfans.com/rileyreid', snippet: 'Riley Reid', domain: 'onlyfans.com', accountHandle: 'rileyreid' },
    { title: 'Someone Else', url: 'https://example.com/other', snippet: 'unrelated', domain: 'example.com' },
  ];
  const pack = buildIdentityVerificationPack(ranked, riley, {});
  assert(pack.needed === true, 'unconfirmed PERSON search needs identity verification');
  assert(pack.candidates.length >= 1 && pack.candidates.length <= 6, 'candidate set is small and high quality');
  assert(pack.allowMultiplePositive === true, 'multiple positive confirmations allowed');
  const confirmed = applyInvestigationAction(createInvestigationState({ subject: 'Riley Reid' }), 'confirm-identity', { name: 'Riley Reid' });
  assert(confirmed.phase === 'IDENTITY_CONFIRMED' || confirmed.phase === 'RESEARCHING', 'confirm triggers investigation phase');
  assert(confirmed.canonicalEntities.includes('Riley Reid'), 'confirmed identity is canonical');
  const rejected = applyInvestigationAction(createInvestigationState({ subject: 'Riley Reid' }), 'reject-identity', { name: 'Someone Else', host: 'example.com' });
  assert(rejected.phase === 'IDENTITY_RESOLUTION', 'reject stays in identity resolution');
  assert((rejected.identityFeedback.rejectedPeople || []).some(n => /someone else/i.test(n)), 'rejection recorded as negative evidence');
  const supp = suppressionFromRejection(rejected.identityFeedback);
  assert(supp.people.length >= 1 && supp.queryNegatives.length >= 1, 'rejection produces query negatives');
}

console.log('--- identity hold is the default for unconfirmed PERSON ---');
{
  const riley = applyResearchFilter(classifyQuery('Riley Reid'), 'on', 'Riley Reid');
  assert(identityPhaseShouldHoldExpansion(riley, {}, {}) === true, 'default PERSON search holds expansion until identity is confirmed');
  assert(identityPhaseShouldHoldExpansion(riley, {}, { identityPhase: false }) === false, 'identityPhase:false does not hold');
  assert(identityPhaseShouldHoldExpansion(riley, { confirmed: ['Riley Reid'] }, { identityPhase: true }) === false, 'confirmed identity does not hold');
  const ctrl = createAdaptiveController({ classification: riley, identity: { canonicalName: 'Riley Reid' } });
  enqueueAdaptiveFamilies(ctrl, { classification: riley, identity: { canonicalName: 'Riley Reid' }, identityFeedback: { confirmed: ['Riley Reid'] }, wantVisual: true, researchFocus: ['person', 'visuals'] });
  assert(ctrl.pending.some(p => p.family === 'visual'), 'visual branch queued after identity is confirmed');
  assert(ctrl.pending.some(p => p.family === 'accounts' || p.family === 'premium'), 'account branch queued after identity is confirmed');
}

console.log('--- Visual evidence gate ---');
{
  const rileyB = applyResearchFilter(classifyQuery('Riley Reid bondage'), 'on', 'Riley Reid bondage');
  const personOnly = visualEvidenceGate({ title: 'Riley Reid headshot', url: 'https://iafd.com/riley.jpg', snippet: 'Riley Reid' }, rileyB);
  assert(personOnly.verdict === 'unverified' && /UNVERIFIED VISUAL/.test(personOnly.label), 'Riley image without bondage is UNVERIFIED VISUAL');
  const frog = classifyQuery('frog tie');
  const wildlife = visualEvidenceGate({ title: 'green tree frog amphibian', url: 'https://cdn.pixabay.com/photo/frog.jpg', snippet: 'wildlife' }, frog);
  assert(wildlife.verdict === 'rejected', 'amphibian is not a frog-tie visual');
  const belle = applyResearchFilter(classifyQuery('Belle Delphine'), 'on', 'Belle Delphine');
  const disney = visualEvidenceGate({ title: 'Disney Princess Belle', url: 'https://disney.fandom.com/wiki/Belle', snippet: 'Beauty and the Beast' }, belle);
  assert(disney.verdict === 'rejected', 'Disney Belle collision rejected');
  const drea = applyResearchFilter(classifyQuery('Drea Morgan bondage'), 'on', 'Drea Morgan bondage');
  const stock = visualEvidenceGate({ title: 'generic bondage stock', url: 'https://shutterstock.com/image.jpg', snippet: 'stock photo bondage' }, drea);
  assert(stock.verdict === 'rejected', 'stock/generic bondage is not entity-specific evidence');
  const first = visualEvidenceGate({ title: 'Riley photos', url: 'https://pinterest.com/riley', snippet: 'Riley' }, rileyB);
  assert(first.verdict === 'rejected' || first.entityMatch !== 'full', 'first-name-only is not identity evidence');
  const gated = applyVisualEvidenceGate([
    { title: 'Riley Reid bondage photoset', url: 'https://babepedia.com/Riley_Reid', snippet: 'Riley Reid bondage gallery', image: 'https://babepedia.com/riley-bondage.jpg' },
    { title: 'green tree frog', url: 'https://pixabay.com/frog.jpg', snippet: 'amphibian' },
  ], rileyB);
  assert(gated.verified.length + gated.unverified.length + gated.rejected.length === 2, 'gate partitions visuals');
}

console.log('--- Find More unique relevant visuals ---');
{
  const intent = parseInvestigationIntent('Riley Reid', { findMore: true, subject: 'Riley Reid', topic: 'bondage' });
  intent.visual = true;
  intent.subject = 'Riley Reid';
  intent.topic = 'bondage';
  const more = findMoreVisualQueries(intent, [], [{ url: 'https://babepedia.com/Riley_Reid', domain: 'babepedia.com' }], ['https://babepedia.com/a.jpg']);
  assert(more.length >= 1, 'Find More produces visual queries');
  assert(more.every(x => /riley reid/i.test(x.q)), 'Find More stays on the entity');
  assert(more.some(x => /gallery|photoset|stills/i.test(x.q)), 'Find More seeks unique galleries not a generic dump');
  const ded = dedupeVisualEvidence([
    { url: 'https://a.example/1.jpg', image: 'https://a.example/1.jpg' },
    { url: 'https://a.example/1.jpg?w=400', image: 'https://a.example/1.jpg' },
  ], ['https://a.example/1.jpg']);
  assert(ded.unique.length === 0 && ded.duplicatesRemoved >= 1, 'near-duplicate visuals are not appended');
}

console.log('--- Persistent queue / resume ---');
{
  const ctrl = createAdaptiveController({ query: 'Riley Reid', classification: { type: 'person', subject: 'Riley Reid' } });
  enqueueAdaptiveFamilies(ctrl, { classification: { type: 'person', subject: 'Riley Reid' }, identity: { canonicalName: 'Riley Reid' }, wantVisual: true });
  const packed = serializeAdaptiveController(ctrl);
  assert(packed && packed.pending.length > 0, 'controller serializes pending work');
  const restored = restoreAdaptiveController(packed);
  assert(restored.pending.length === packed.pending.length, 'restore keeps queued work');
  const state = persistInvestigationQueue(createInvestigationState({ query: 'Riley Reid' }), ctrl, { stopKind: 'E' });
  assert(state.investigationQueue && state.remainingWork.length > 0, 'queue persisted on resource rail');
  assert(state.stopState && state.stopState.resumable, 'stop state marks resumable');
  const resumed = resumeInvestigationQueue(state);
  assert(resumed && resumed.pending.length > 0, 'resume restores pending rather than restarting');
  const e = honestResourceStop(ctrl, { iterations: 4, sourceClasses: ['identity'] });
  assert(e.stopKind === 'E' && e.investigationComplete === false, 'E is not investigation-complete');
  assert(/not complete/i.test(e.headline) && /resource safeguard/i.test(e.headline), 'E headline is honest');
  assert(!/Research complete/i.test(e.headline), 'E never says Research complete');
  const summary = queuedWorkSummary(ctrl);
  assert(summary.resumable && summary.remainingCount > 0, 'queued work summary exposed');
}

console.log('--- Analyze public account never bypasses ---');
{
  const plan = analyzePublicAccountPlan('https://onlyfans.com/rileyreid', { type: 'person', subject: 'Riley Reid' }, { handle: 'rileyreid' });
  assert(plan.neverBypassAuth === true, 'plan never bypasses auth');
  assert(/Subscriber-only|login-gated|not retrieved/i.test(plan.boundary), 'boundary is explicit');
  assert(plan.queries.some(q => /rileyreid/i.test(q.q)), 'public handle corroboration queued');
  const life = sourceLifecycleState({ url: 'https://onlyfans.com/rileyreid', accessState: 'AUTHENTICATION_REQUIRED' }, { opened: true });
  assert(life.opened && !life.retrievedContent, 'opened is not retrieved');
  assert(life.accessBoundary, 'access boundary reported');
}

console.log('--- Worker wires v49.9 without a new engine ---');
{
  assert(/buildIdentityVerificationPack/.test(workerSrc), 'identity pack wired');
  assert(/applyVisualEvidenceGate/.test(workerSrc), 'visual gate wired');
  assert(/persistInvestigationQueue/.test(workerSrc) && /restoreAdaptiveController/.test(workerSrc), 'queue persist/resume wired');
  assert(/analyzePublicAccountPlan/.test(workerSrc), 'Analyze public account wired');
  assert(/parseResearchFocus/.test(workerSrc) && /adaptiveLensesForFocus/.test(workerSrc), 'Research Focus + Adaptive Lens wired');
  assert(/createAdaptiveController/.test(workerSrc) && /runAdaptiveQuery/.test(workerSrc), 'still the v49.8 adaptive engine');
  assert(!/new SearchEngine|parallel retrieval engine/i.test(workerSrc), 'no parallel retrieval engine');
  assert(/v49\.9-identity-verification/.test(workerSrc), 'health feature flags');
}

console.log('--- fixture searches still succeed ---');
{
  const riley = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Riley Reid') + '&type=person&adult=on&fixture=riley-reid&focus=person'), {});
  const rileyBody = await riley.json();
  assert(riley.status === 200, 'fixture Riley Reid 200');
  assert(rileyBody.classification && rileyBody.classification.type === 'person', 'Riley classified as person');
  assert((rileyBody.results || []).some(r => /iafd/i.test(r.url || '')), 'Riley IAFD present');
  assert(rileyBody.identityVerification && Array.isArray(rileyBody.identityVerification.candidates), 'identity verification pack in envelope');
  assert(rileyBody.investigationQueue, 'investigation queue echoed');
  assert(rileyBody.adaptiveInvestigation, 'adaptive investigation trace present');

  const rileyB = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Riley Reid bondage') + '&entity=Riley%20Reid&topic=bondage&type=person&adult=on&fixture=riley-reid&focus=person,visuals,topic'), {});
  const rileyBBody = await rileyB.json();
  assert(rileyBBody.classification && rileyBBody.classification.subject === 'Riley Reid', 'Riley remains resolved person');
  assert(/bondage/i.test(rileyBBody.investigationContext && rileyBBody.investigationContext.topic || rileyBBody.classification.context || ''), 'bondage topic survives');

  const frog = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('frog tie') + '&adult=on&fixture=frog-tie&focus=position,visuals'), {});
  const frogBody = await frog.json();
  assert(frogBody.classification && frogBody.classification.type !== 'person', 'frog tie is not a person');

  const belle = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Belle Delphine') + '&type=person&adult=on&fixture=belle-delphine&premium=1'), {});
  const belleBody = await belle.json();
  assert(belleBody.classification && belleBody.classification.type === 'person', 'Belle Delphine is PERSON');
  assert((belleBody.premiumContent || []).length >= 1, 'premium account discovery populated');
}

console.log('--- health features ---');
{
  const res = await worker.fetch(new Request('https://test/health'), {});
  const body = await res.json();
  assert((body.version === '49.12' || body.version === '49.11' || body.version === '49.9') && (body.build === '49.12-investigation-workflow' || body.build === '49.11-exact-source-retrieval' || body.build === '49.9-identity-queue-visual'), 'health reports current');
  assert((body.features || []).includes('v49.9-identity-verification'), 'feature identity-verification');
  assert((body.features || []).includes('v49.9-persistent-queue'), 'feature persistent-queue');
  assert((body.features || []).includes('v49.9-visual-evidence-gate'), 'feature visual-evidence-gate');
  assert((body.features || []).includes('v49.8-adaptive-investigation'), 'v49.8 flags retained');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
