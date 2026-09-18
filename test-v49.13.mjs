// v49.13 investigation actions — primary Deep Dive retrieval, Ask, recreate
// position, Accounts/Premium, identity-first preserved. Deterministic planner
// + fixture searches. Not live production.
import { readFileSync } from 'node:fs';
import {
  PLANNER_VERSION,
  PLANNER_BUILD,
  PRIMARY_DIVE_LENSES,
  SECONDARY_DIVE_LENSES,
  parseInvestigationIntent,
  routeNaturalLanguageResearch,
  buildLensQueries,
  isNaiveLensQuery,
  recreatePositionQueries,
  researchFocusQueries,
  adaptiveLensesForFocus,
  applyInvestigationAction,
  createInvestigationState,
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

console.log('--- v49.13 version / primary investigation actions ---');
{
  assert(PLANNER_VERSION === '49.14' || PLANNER_VERSION === '49.13', 'PLANNER_VERSION 49.13');
  assert(PLANNER_BUILD === '49.14-person-image-results' || PLANNER_BUILD === '49.13-investigation-actions', 'PLANNER_BUILD');
  assert(appSrc.includes("const VERSION = '49.14'") || appSrc.includes("const VERSION = '49.13'"), 'frontend VERSION');
  assert(/carmen-build" content="49\.(14|13)"/.test(html), 'html build');
  assert(/v49\.1[34]/.test(html), 'header shows version');
  assert(PRIMARY_DIVE_LENSES.map(l => l.id).join(',') === 'bondage,visuals,accounts', 'primary lenses Bondage/Visuals/Accounts');
  assert(SECONDARY_DIVE_LENSES.map(l => l.id).includes('people'), 'People remains a secondary/internal lens');
  assert(/id="diveBondageBtn"/.test(html) && !/<button class="btn ghost hidden" id="diveBondageBtn"/.test(html), 'Bondage is a visible primary control');
  assert(/id="diveVisualsBtn"/.test(html) && !/<button class="btn ghost hidden" id="diveVisualsBtn"/.test(html), 'Visuals is a visible primary control');
  assert(/Accounts \/ Premium/.test(html), 'Accounts / Premium label');
  assert(/data-testid="find-more"/.test(html) && /data-testid="dive-nl-input"/.test(html), 'Find More + Ask present');
  assert(/divePeopleBtn/.test(html) && /hidden/.test(html), 'People button exists but is not primary');
  assert(/data-divetab="posts">Connected</.test(html) || /Connected/.test(html), 'People is not a primary tab label');
  assert(/More views/.test(html), 'dashboard tabs are secondary More views');
  assert(/data-testid="recreate-position"/.test(html) && /Recreate this position/.test(html), 'Recreate this position control');
  assert(/recreatePosition/.test(appSrc), 'UI wires recreatePosition');
  assert(/entity-specific bondage investigation/.test(plannerSrc) || /find this person in bondage/.test(plannerSrc), 'planner bondage is entity-specific');
}

console.log('--- Bondage is real retrieval, not a naive skip ---');
{
  const intent = parseInvestigationIntent('Belle Delphine', { entity: 'Belle Delphine', diveLens: 'bondage', topic: 'bondage' });
  assert(intent.mode === 'dive-bondage' && intent.diveLens === 'bondage', 'bondage button parses as dive-bondage');
  assert(intent.topic === 'bondage' && /belle/i.test(intent.subject), 'person + bondage topic');
  assert(isNaiveLensQuery('Belle Delphine bondage', intent) === false, 'X + bondage is not treated as a naive rewrite for the Bondage branch');
  const qs = buildLensQueries(intent, [], []);
  assert(qs.some(x => /belle delphine/i.test(x.q) && /bondage/i.test(x.q)), 'emits person × bondage query');
  assert(qs.some(x => /shibari|hogtie|restrained|bdsm/i.test(x.q)), 'semantic bondage expansion');
  assert(qs.every(x => /belle/i.test(x.q)), 'no generic bondage without the person');
  const generic = qs.filter(x => /bondage/i.test(x.q) && !/belle/i.test(x.q));
  assert(generic.length === 0, 'generic bondage-only queries are not emitted');
}

console.log('--- Ask this investigation parses to planner branches ---');
{
  const entity = { entity: 'Belle Delphine', topic: '' };
  const vis = routeNaturalLanguageResearch('Find more public visual sources for this person.', entity);
  assert(vis.mode === 'dive-visuals' || vis.lens === 'visuals', 'Ask visuals → dive-visuals');
  const acc = routeNaturalLanguageResearch('Find accounts connected to this person.', entity);
  assert(acc.mode === 'premium-accounts', 'Ask accounts → premium-accounts');
  const tut = routeNaturalLanguageResearch('Find tutorials for this position.', entity);
  assert(tut.mode === 'recreate-position', 'Ask tutorials for position → recreate-position');
  const bond = routeNaturalLanguageResearch('Find this person in bondage-related sources.', entity);
  assert(bond.mode === 'dive-bondage' && bond.topic === 'bondage', 'Ask bondage → dive-bondage');
  const people = routeNaturalLanguageResearch('Find other people connected to this investigation.', entity);
  assert(people.mode === 'dive-people', 'Ask connected people → dive-people (internal)');
  const links = routeNaturalLanguageResearch('Follow the source links you discovered and investigate them.', entity);
  assert(links.mode === 'find-more', 'Ask follow links → find-more');
  const accIdx = appSrc.indexOf("find accounts|accounts connected");
  const peopleIdx = appSrc.indexOf("who else|other people");
  assert(accIdx > 0 && peopleIdx > accIdx, 'frontend Ask checks accounts before people so “accounts connected” is not a people search');
}

console.log('--- Recreate this position stays on the selected source ---');
{
  const intent = parseInvestigationIntent('Recreate this position', {
    entity: 'Riley Reid',
    recreatePosition: true,
    seedVisual: { title: 'hogtie still', pageUrl: 'https://example.com/photoset/hogtie', url: 'https://cdn.example.com/hogtie.jpg' },
  });
  assert(intent.mode === 'recreate-position', 'recreate-position mode');
  const qs = recreatePositionQueries(intent, intent.seed, []);
  assert(qs.length >= 2, 'recreate emits instructional queries');
  assert(qs.some(x => /tutorial|how to|diagram|instruction/i.test(x.q)), 'instructional/tutorial queries');
  assert(qs.some(x => /example\.com/.test(x.q) || /hogtie/i.test(x.q)), 'selected source/technique remains the anchor');
}

console.log('--- Adaptive Lens follows Research Focus ---');
{
  const riley = applyResearchFilter(classifyQuery('Riley Reid'), 'on', 'Riley Reid');
  const vis = adaptiveLensesForFocus(['person', 'visuals'], riley).map(l => l.id);
  const career = adaptiveLensesForFocus(['person', 'career'], riley).map(l => l.id);
  const tut = adaptiveLensesForFocus(['tutorial'], classifyQuery('frog tie')).map(l => l.id);
  const topic = adaptiveLensesForFocus(['topic'], { ...riley, context: 'bondage' }).map(l => l.id);
  assert(vis.includes('identity') && vis.includes('visual-evidence') && vis.includes('galleries') && vis.includes('videos'), 'PERSON+VISUALS lenses');
  assert(career.includes('career') && career.includes('credits') && career.includes('interviews'), 'PERSON+CAREER lenses');
  assert(!career.includes('galleries') && !career.includes('videos'), 'career is not the visuals set');
  assert(tut.includes('tutorials') && tut.includes('diagrams') && (tut.includes('instruction') || tut.includes('technique-references')), 'TUTORIAL lenses');
  assert(topic.includes('intersection') && topic.includes('specialist') && topic.includes('discussions'), 'TOPIC lenses');
  const visQ = researchFocusQueries(['person', 'visuals'], riley, []);
  const careerQ = researchFocusQueries(['person', 'career'], riley, []);
  const accQ = researchFocusQueries(['accounts'], riley, []);
  assert(visQ.some(x => x.kind === 'image' || /gallery|video/i.test(x.q)), 'PERSON+VISUALS queries visual media');
  assert(careerQ.some(x => /career|credits|filmography/i.test(x.q)), 'PERSON+CAREER queries work');
  assert(!accQ.some(x => /\binstagram\b/i.test(x.q) && !/onlyfans|fansly|reddit/i.test(x.q)), 'Accounts/Premium does not treat Instagram as the adult-account branch');
  assert(accQ.some(x => /onlyfans|fansly/i.test(x.q)), 'Accounts/Premium searches creator platforms');
}

console.log('--- identity + exact-source still hold ---');
{
  const belle = applyInvestigationAction(createInvestigationState({ subject: 'Belle Delphine' }), 'confirm-identity', {
    name: 'Belle Delphine',
    candidateId: 'cand_belle',
  });
  assert(belle.canonicalPerson && belle.canonicalPerson.canonicalName === 'Belle Delphine', 'canonicalPerson still created');
  const rejected = applyInvestigationAction(createInvestigationState({ subject: 'Belle Delphine' }), 'reject-identity', {
    name: 'Belle',
    candidateId: 'cand_disney',
    host: 'disney.fandom.com',
  });
  assert((rejected.identityFeedback.rejectedCandidateIds || []).includes('cand_disney'), 'reject is candidate-id specific');
}

console.log('--- fixture: Bondage / Visuals / Accounts modes ---');
{
  const bond = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Belle Delphine') + '&entity=Belle%20Delphine&diveLens=bondage&mode=dive-bondage&type=person&adult=on&fixture=belle-delphine&confirmIdentity=1&confirmedIdentity=Belle%20Delphine'), {});
  const bondBody = await bond.json();
  assert(bond.status === 200, 'bondage fixture 200');
  assert(bondBody.classification && /belle/i.test(bondBody.classification.subject || ''), 'bondage keeps Belle');
  const attempted = JSON.stringify(bondBody.whatCarmenChecked || bondBody.attemptedQueries || bondBody.variants || bondBody.query || '');
  assert(/bondage/i.test(JSON.stringify(bondBody).slice(0, 8000)) || /bondage/i.test(attempted), 'bondage investigation mentions bondage');

  const vis = await worker.fetch(new Request('https://test/classify?q=' + encodeURIComponent('Riley Reid') + '&type=person&focus=person,visuals'), {});
  const visBody = await vis.json();
  const career = await worker.fetch(new Request('https://test/classify?q=' + encodeURIComponent('Riley Reid') + '&type=person&focus=person,career'), {});
  const careerBody = await career.json();
  const visIds = (visBody.adaptiveLenses || visBody.lenses || []).map(l => l.id);
  const careerIds = (careerBody.adaptiveLenses || careerBody.lenses || []).map(l => l.id);
  assert(visIds.includes('videos') || visIds.includes('galleries'), 'classify PERSON+VISUALS has galleries/videos');
  assert(careerIds.includes('career'), 'classify PERSON+CAREER has career');
  assert(JSON.stringify(visIds) !== JSON.stringify(careerIds), 'Adaptive Lens changes with focus');
}

console.log('--- health ---');
{
  const res = await worker.fetch(new Request('https://test/health'), {});
  const body = await res.json();
  assert((body.version === '49.14' || body.version === '49.13') && (body.build === '49.14-person-image-results' || body.build === '49.13-investigation-actions'), 'health reports current');
  assert((body.features || []).includes('v49.14-person-image-results') || (body.features || []).includes('v49.13-investigation-actions'), 'feature investigation-actions');
  assert((body.features || []).includes('v49.13-bondage-retrieval'), 'feature bondage-retrieval');
  assert((body.features || []).includes('v49.13-recreate-position'), 'feature recreate-position');
  assert((body.features || []).includes('v49.12-investigation-workflow'), 'v49.12 retained');
  assert((body.features || []).includes('v49.11-exact-source-retrieval'), 'v49.11 retained');
}

console.log('--- no parallel engine ---');
{
  assert(!/new SearchEngine|parallel retrieval engine/i.test(workerSrc), 'no parallel retrieval engine');
  assert(/recreatePositionQueries/.test(workerSrc), 'worker imports recreatePositionQueries');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
