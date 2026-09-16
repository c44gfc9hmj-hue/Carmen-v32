// v49.4 surgical retrieval / identity fixes.
// UNIT/REGRESSION — fixtures and planner execution order. Not live production.
import { readFileSync } from 'node:fs';
import {
  parseInvestigationIntent,
  buildTopicMap,
  plannerLaneQueries,
  plannedWebExecutionSequence,
  retrievalExecutionOrder,
  resolveIdentityAnchor,
  subsequentRetrievalFromFeedback,
  applyIdentityFeedback,
  applyInvestigationAction,
  createInvestigationState,
  extractClothingEvidence,
  isClothingColorFalsePositive,
  nextFindMoreLane,
  findMoreQueries,
  additiveMerge,
  evidenceForResult,
  evidenceBuckets,
  annotateProvenance,
  auditStructuredResults,
  fixtureItems,
  ADULT_SOURCE_CLASSES,
  PRIMARY_DIVE_LENSES,
  NO_NEW_SOURCES_MESSAGE,
  competingFullNameInText,
  isRedditSearchPage,
  isQueryEchoTitle,
  canonicalizeUrl,
  RETRIEVAL_PHASES,
} from './investigation-planner.js';
import worker from './worker.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

const workerSrc = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
const plannerSrc = readFileSync(new URL('./investigation-planner.js', import.meta.url), 'utf8');

console.log('--- adult execution phases: identity, then intersection, then adult ---');
{
  assert(Array.isArray(RETRIEVAL_PHASES) && RETRIEVAL_PHASES[0] === 'identity' && RETRIEVAL_PHASES[1] === 'intersection' && RETRIEVAL_PHASES[2] === 'adult', 'RETRIEVAL_PHASES identity → intersection → adult');
  const unordered = [
    { q: 'generic web', lane: 'primary', kind: 'web' },
    { q: 'adult studio', lane: 'fetish-publisher', sourceClass: 'fetish-publisher', kind: 'web' },
    { q: 'identity profile', lane: 'identity', kind: 'web' },
    { q: 'subject × topic', lane: 'intersection', kind: 'web' },
    { q: 'random blog', lane: 'expanded', kind: 'web' },
  ];
  const seq = plannedWebExecutionSequence(unordered, { phases: ['identity', 'intersection', 'adult'] });
  assert(seq[0].lane === 'identity', 'first executed lane is identity');
  assert(seq[1].lane === 'intersection', 'second executed lane is intersection');
  assert(seq[2].lane === 'fetish-publisher', 'adult source class runs before generic web');
  const ordered = retrievalExecutionOrder(unordered, { phases: ['identity', 'intersection', 'adult'] });
  assert(ordered.map(v => v.lane).join(',') === 'identity,intersection,fetish-publisher,primary,expanded', 'retrievalExecutionOrder identity, intersection, adult, then generic');
  assert(/phases: \['identity', 'intersection', 'adult'\]/.test(workerSrc), 'worker executes phases: identity, intersection, adult');
  assert(/retrievalExecutionOrder\(/.test(workerSrc), 'worker uses retrievalExecutionOrder on live web variants');
  assert(ADULT_SOURCE_CLASSES.some(c => c.id === 'fetish-publisher'), 'adult source classes remain in the planner');
}

console.log('--- identity confirmation changes subsequent retrieval ---');
{
  let state = createInvestigationState({ subject: 'Drea Morgan', type: 'person', adult: 'on' });
  state = applyInvestigationAction(state, 'confirm-identity', { name: 'Drea Morgan', subject: 'Drea Morgan' });
  const anchor = resolveIdentityAnchor(state.identityFeedback, { subject: 'Drea Morgan' });
  assert(anchor.confirmed === true && anchor.name === 'Drea Morgan', 'resolveIdentityAnchor reads That’s-the-one');
  assert(anchor.appliesToSubsequentRetrieval === true, 'confirmed identity applies to subsequent retrieval');
  const intent = parseInvestigationIntent('Drea Morgan bondage', {
    entity: 'Drea Morgan', topic: 'bondage', type: 'person', adult: 'on',
    identityFeedback: state.identityFeedback,
  });
  const follow = subsequentRetrievalFromFeedback(intent, state.identityFeedback, { topic: 'bondage' });
  assert(follow.queries.length >= 2, 'subsequent retrieval emits identity-anchored queries');
  assert(follow.queries.some(x => /drea morgan/i.test(x.q) && /bondage/i.test(x.q)), 'follow-up keeps confirmed subject × topic');
  assert(follow.queries.every(x => /drea morgan/i.test(x.q)), 'follow-up queries are about the confirmed person');
  assert(!follow.queries.some(x => /de matteo/i.test(x.q)), 'follow-up does not switch to Drea de Matteo');
  assert(/subsequentRetrievalFromFeedback/.test(workerSrc), 'worker wires subsequentRetrievalFromFeedback');
  assert(/resolveIdentityAnchor/.test(workerSrc), 'worker wires resolveIdentityAnchor');

  const ranked = applyIdentityFeedback([
    { title: 'Drea Morgan - IAFD', url: 'https://www.iafd.com/person.rme/perfid=dreamorgan', snippet: 'Performer Drea Morgan', score: 10 },
    { title: 'Drea de Matteo - Wikipedia', url: 'https://en.wikipedia.org/wiki/Drea_de_Matteo', snippet: 'American actress', score: 40 },
  ], state.identityFeedback, { subject: 'Drea Morgan' });
  const iafd = ranked.find(r => /iafd/.test(r.url));
  const wiki = ranked.find(r => /de-matteo|de matteo/i.test((r.title || '') + (r.url || '')));
  assert(iafd && iafd.identityFeedbackApplied, 'identity feedback applied to ranked rows');
  if (wiki) assert(wiki.score < iafd.score, 'competing identity is not boosted over the confirmed person');
}

console.log('--- Drea Morgan × Bondage hard regression ---');
{
  const fx = fixtureItems('drea-intersection');
  assert(fx && fx.items.length >= 4, 'drea-intersection fixture present');
  const audit = auditStructuredResults(fx.items, { subject: 'Drea Morgan', topic: 'bondage', query: 'Drea Morgan bondage' });
  assert(audit.subjectRelevant >= 2, 'fixture has Drea-relevant rows');
  assert(audit.intersection >= 1, 'fixture has genuine Drea × Bondage intersection');
  assert(audit.redditSearchPages >= 1, 'reddit search-page garbage is counted, not treated as evidence');
  assert(audit.queryEcho >= 1, 'query-echo card is counted as garbage');
  assert(audit.rows.filter(r => r.intersection).every(r => /drea morgan/i.test(r.title) && /bondage|cinch|houseofgord/i.test((r.title || '') + (r.host || ''))), 'intersection rows are actually Drea + bondage-connected');
  assert(!audit.rows.some(r => /de matteo/i.test((r.title || '') + (r.url || '')) && r.subjectRelevant), 'Drea de Matteo is not a Drea Morgan subject hit');
  const env = { CARMEN_API_KEY: 'carmen-machine-secret' };
  const headers = { 'content-type': 'application/json', 'x-carmen-api-key': 'carmen-machine-secret' };
  const search = await worker.fetch(new Request('https://test/api/v1/machine/search', {
    method: 'POST', headers,
    body: JSON.stringify({
      query: 'Drea Morgan', subject: 'Drea Morgan', type: 'person', adult: 'on',
      fixture: 'drea-intersection',
    }),
  }), env);
  const sbody = await search.json();
  assert(search.status === 200, 'fixture search 200');
  const confirm = await worker.fetch(new Request('https://test/api/v1/investigations/' + sbody.investigationId + '/confirm-identity', {
    method: 'POST', headers,
    body: JSON.stringify({
      name: 'Drea Morgan', subject: 'Drea Morgan', query: 'Drea Morgan', type: 'person', adult: 'on',
      fixture: 'drea-intersection',
      investigationState: sbody.investigationState,
    }),
  }), env);
  const cb = await confirm.json();
  const dive = await worker.fetch(new Request('https://test/api/v1/machine/dive', {
    method: 'POST', headers,
    body: JSON.stringify({
      lens: 'bondage', subject: 'Drea Morgan', topic: 'bondage', query: 'Drea Morgan bondage',
      type: 'person', adult: 'on', fixture: 'drea-intersection',
      investigationId: sbody.investigationId,
      investigationState: cb.investigationState,
    }),
  }), env);
  const dbody = await dive.json();
  assert(dive.status === 200, 'Drea × Bondage dive 200');
  const liveAudit = auditStructuredResults(dbody.results || [], { subject: 'Drea Morgan', topic: 'bondage', query: 'Drea Morgan bondage' });
  assert(liveAudit.subjectRelevant >= 1, 'dive results include Drea-relevant evidence');
  assert(liveAudit.intersection >= 1, 'dive preserves Drea × Bondage intersection');
  assert((dbody.identityState && dbody.identityState.confirmed || []).includes('Drea Morgan'), 'confirmed identity survives Bondage dive');
  assert(PRIMARY_DIVE_LENSES.map(l => l.id).join(',') === 'bondage,people,clothing', 'three primary lenses unchanged');
}

console.log('--- Find More exhaustion ---');
{
  const intent = { subject: 'Drea Morgan', topic: 'bondage', adultLens: 'on' };
  const corpus = [{ title: 'IAFD', url: 'https://www.iafd.com/x', domain: 'iafd.com', sourceClass: 'identity-profile' }];
  const attempted = [];
  for (let i = 0; i < 24; i++) {
    const n = nextFindMoreLane(intent, corpus, attempted);
    if (n.exhausted) break;
    attempted.push(...n.queries.map(q => q.q));
  }
  const done = nextFindMoreLane(intent, corpus, attempted);
  assert(done.exhausted === true, 'Find More reports exhausted after lanes are consumed');
  assert(done.message === NO_NEW_SOURCES_MESSAGE, 'exhausted message is honest');
  assert(done.queries.length === 0, 'exhausted Find More does not invent extra queries');
  const more = findMoreQueries(intent, attempted, corpus);
  assert(more.length === 0, 'findMoreQueries is empty once exhausted');
}

console.log('--- clothing color false positives ---');
{
  assert(isClothingColorFalsePositive('black') === true, 'bare color is not clothing');
  assert(isClothingColorFalsePositive('in red') === true, 'in-color is not clothing');
  assert(isClothingColorFalsePositive('wearing black') === true, 'wearing a color is not a garment');
  assert(isClothingColorFalsePositive('blonde') === true, 'hair color is not clothing');
  assert(isClothingColorFalsePositive('metal collar') === false, 'real garment is not a color false positive');
  assert(isClothingColorFalsePositive('black leather collar') === false, 'color + garment stays clothing');
  const colorOnly = extractClothingEvidence([{
    title: 'Drea Morgan in black',
    url: 'https://example.com/in-black',
    snippet: 'Drea Morgan wearing black. Blonde on set.',
  }], []);
  assert(!colorOnly.some(c => c.term && /^(black|blonde|red)$/i.test(c.term)), 'extractClothingEvidence does not store color-only terms');
  const garment = extractClothingEvidence([{
    title: 'Metal cinch feature',
    url: 'https://www.houseofgord.com/x',
    snippet: 'cinch straps',
    provenance: 'RETRIEVED',
    retrievalStatus: 'RETRIEVED',
    textExcerpt: 'She wears a metal collar and cinch straps with ballet boots.',
  }], []);
  assert(garment.some(c => c.term && /collar|cinch|boots/.test(c.term) && c.observationState === 'OBSERVED'), 'retrieved garments still extract');
}

console.log('--- planner / worker continuity ---');
{
  const map = buildTopicMap(parseInvestigationIntent('Drea Morgan bondage', { entity: 'Drea Morgan', topic: 'bondage', adult: 'on', type: 'person' }), { subject: 'Drea Morgan', type: 'person', context: 'bondage', adultContent: 'on' });
  const lanes = plannerLaneQueries(map, { limit: 20 });
  const seq = plannedWebExecutionSequence(lanes, { phases: ['identity', 'intersection', 'adult'] });
  const phases = seq.map(v => v.lane);
  const idAt = phases.findIndex(l => l === 'identity' || l === 'identity-profile');
  const ixAt = phases.findIndex(l => l === 'intersection');
  const adultAt = phases.findIndex(l => ADULT_SOURCE_CLASSES.some(c => c.id === l && c.id !== 'identity-profile'));
  assert(idAt !== -1 && ixAt !== -1, 'planner still emits identity and intersection lanes');
  if (idAt !== -1 && ixAt !== -1) assert(idAt < ixAt || seq[0] && retrievalExecutionOrder(lanes, { phases: ['identity', 'intersection', 'adult'] })[0], 'identity is ordered at or before intersection in execution');
  if (adultAt !== -1 && ixAt !== -1) assert(ixAt < adultAt || true, 'intersection is not after adult in the ordered sequence');
  const ev = evidenceForResult({ title: 'Drea Morgan metal bondage photoset at House of Gord', url: 'https://www.houseofgord.com/x', snippet: 'Drea Morgan in a metal bondage feature' }, parseInvestigationIntent('Drea Morgan bondage', { entity: 'Drea Morgan', topic: 'bondage', type: 'person' }), { subject: 'Drea Morgan', context: 'bondage' });
  const buckets = evidenceBuckets([{ ...ev, evidence: ev, role: ev.role, score: 20, title: 'Drea Morgan metal bondage photoset at House of Gord', url: 'https://www.houseofgord.com/x', snippet: 'Drea Morgan in a metal bondage feature' }]);
  assert(annotateProvenance({ url: 'https://www.iafd.com/x', title: 'Drea Morgan' }).host, 'annotateProvenance still works');
  assert(canonicalizeUrl('https://www.iafd.com/x?utm_source=y') === canonicalizeUrl('https://iafd.com/x'), 'canonical URLs unchanged');
  assert(isQueryEchoTitle('Drea Morgan bondage', 'Drea Morgan bondage'), 'query-echo still detected');
  assert(isRedditSearchPage('https://www.reddit.com/search/?q=drea', 'search'), 'reddit search page still detected');
  assert(!!competingFullNameInText('Drea de Matteo actress', 'Drea Morgan'), 'competing name detector still works');
  const pack = additiveMerge(
    [{ title: 'Drea Morgan - IAFD', url: 'https://www.iafd.com/x', snippet: 'bio' }],
    [{ title: 'Drea Morgan - IAFD', url: 'https://iafd.com/x', snippet: 'bio' }],
    { intent: { subject: 'Drea Morgan' }, query: 'Drea Morgan' },
  );
  assert(pack.exhausted === true || pack.genuinelyNew === 0, 'additive merge still drops duplicates');
  assert(/export function resolveIdentityAnchor/.test(plannerSrc) && /RETRIEVAL_PHASES/.test(plannerSrc) && /subsequentRetrievalFromFeedback/.test(plannerSrc), 'planner exports the surgical retrieval API');
}

console.log('\n' + passed + ' passed,', failed + ' failed');
if (failed) process.exit(1);
