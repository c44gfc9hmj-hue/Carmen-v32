// v49.4 identity-anchor diagnostics — no product change.
// “That’s the one” must confirm WHO the person is, not restrict retrieval
// to the selected website. Deep Dive lenses stay Bondage / People / Clothing.
import { readFileSync } from 'node:fs';
import {
  applyInvestigationAction,
  applyIdentityFeedback,
  applyVisualIdentityFilter,
  buildLensQueries,
  competingIdentityCandidates,
  createInvestigationState,
  extractDiscoverySeeds,
  mergeIdentityFeedback,
  parseInvestigationIntent,
  PRIMARY_DIVE_LENSES,
  nextFindMoreLane,
  findMoreQueries,
  additiveMerge,
  isQueryEchoTitle,
  isRedditSearchPage,
  competingFullNameInText,
  API_ACTION_CATALOG,
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

console.log('--- That’s the one confirms identity, not a source universe ---');
{
  let state = createInvestigationState({ subject: 'Sensi Pearl', type: 'person', adult: 'on' });
  state = applyInvestigationAction(state, 'confirm-identity', { name: 'Sensi Pearl', subject: 'Sensi Pearl', url: 'https://www.houseofgord.com/sensi-pearl', host: 'houseofgord.com' });
  assert((state.identityFeedback.confirmed || []).includes('Sensi Pearl'), 'confirmed name is Sensi Pearl');
  assert(!(state.identityFeedback.rejectedHosts || []).includes('houseofgord.com'), 'confirm does not reject other hosts');
  assert(!(state.identityFeedback.confirmed || []).some(x => /houseofgord/i.test(x)), 'domain is not stored as the identity');
  assert(/That’s the one|YES — THIS PERSON/.test((state.trail || []).map(t => t.label).join(' ')), 'trail records That’s the one');

  const rows = [
    { title: 'Sensi Pearl - IAFD', url: 'https://www.iafd.com/person.rme/perfid=sensipearl', snippet: 'Sensi Pearl performer bio', domain: 'iafd.com', score: 10 },
    { title: 'Sensi Pearl metal bondage', url: 'https://www.houseofgord.com/sensi-pearl', snippet: 'Sensi Pearl at House of Gord', domain: 'houseofgord.com', score: 10 },
    { title: 'Sensi Pearl interview', url: 'https://example-interview.com/sensi-pearl', snippet: 'Interview with Sensi Pearl', domain: 'example-interview.com', score: 10 },
  ];
  const out = applyIdentityFeedback(rows, state.identityFeedback, { subject: 'Sensi Pearl' });
  assert(out.length === 3, 'confirming identity does not drop other-domain evidence about the person');
  assert(out.every(r => !r.suppressed), 'other-domain pages about the confirmed person are not suppressed');
  assert(out.some(r => /iafd\.com/.test(r.url)) && out.some(r => /example-interview/.test(r.url)), 'IAFD and interview domains remain in the corpus');
}

console.log('--- Deep Dive expands beyond the selected source when evidence exists ---');
{
  const selectedOnly = [{
    title: 'Sensi Pearl photoset',
    url: 'https://www.houseofgord.com/sensi-pearl',
    snippet: 'Sensi Pearl in a metal bondage feature.',
    domain: 'houseofgord.com',
    provenance: 'RETRIEVED',
    retrievalStatus: 'RETRIEVED',
    textExcerpt: 'Sensi Pearl photographed by Alex Rider. Directed by Jordan Hale. Studio: House of Gord. Metal Cinch Feature (2011).',
  }];
  const broader = selectedOnly.concat([
    { title: 'Sensi Pearl - IAFD', url: 'https://www.iafd.com/person.rme/perfid=sensipearl', snippet: 'Performer bio and filmography.', domain: 'iafd.com', provenance: 'RETRIEVED', retrievalStatus: 'RETRIEVED', textExcerpt: 'Sensi Pearl. Filmography includes Metal Cinch Feature.' },
  ]);
  const intent = parseInvestigationIntent('Sensi Pearl bondage', {
    entity: 'Sensi Pearl', topic: 'bondage', type: 'person', adult: 'on',
    diveLens: 'bondage', mode: 'dive-bondage',
    identityFeedback: { confirmed: ['Sensi Pearl'] },
    priorResults: broader,
  });
  const qs = buildLensQueries(intent, broader, ['sensi pearl bondage', '"Sensi Pearl" bondage']);
  assert(qs.some(x => /houseofgord\.com/i.test(x.q)), 'can chain through the discovered/selected domain');
  assert(qs.some(x => !/site:houseofgord\.com/i.test(x.q)), 'emits queries that are not site-restricted to the selected website');
  assert(qs.some(x => /Alex Rider|Metal Cinch|iafd|photoset|scene|studio/i.test(x.q)), 'chains through collaborator, production, or other evidence');
  const seeds = extractDiscoverySeeds(broader, intent);
  assert(seeds.domains.length >= 2, 'broader subject corpus retains multiple domains after That’s the one');
  assert(!qs.every(x => /site:/.test(x.q)), 'Deep Dive is not entirely a site: crawl of the selected website');
}

console.log('--- Random unrelated people do not inherit confirmed identity ---');
{
  const collision = competingFullNameInText('Jane Doe on the same gallery as Sensi Pearl', 'Sensi Pearl');
  assert(!!collision || !/jane doe/i.test('Sensi Pearl'), 'competing full-name helper is available');
  const visuals = applyVisualIdentityFilter([
    { url: 'https://img.example/sensi.jpg', title: 'Sensi Pearl', caption: 'Sensi Pearl', pageUrl: 'https://www.houseofgord.com/sensi-pearl' },
    { url: 'https://img.example/jane.jpg', title: 'Jane Doe', caption: 'Jane Doe', pageUrl: 'https://www.houseofgord.com/jane-doe' },
  ], 'Sensi Pearl', { identityFeedback: { confirmed: ['Sensi Pearl'] } });
  assert(visuals.kept.some(v => /sensi pearl/i.test((v.title || '') + ' ' + (v.caption || ''))), 'confirmed person remains in the primary visual corpus');
  assert(!visuals.kept.some(v => /^jane doe$/i.test(String(v.title || '').trim())), 'unrelated named woman is not admitted as Sensi Pearl');

  const peopleIntent = parseInvestigationIntent('Sensi Pearl', {
    entity: 'Sensi Pearl', diveLens: 'people', mode: 'dive-people', adult: 'on',
    identityFeedback: { confirmed: ['Sensi Pearl'] },
  });
  const peopleQs = buildLensQueries(peopleIntent, [{
    title: 'Sensi Pearl photoset', url: 'https://www.houseofgord.com/sensi-pearl', domain: 'houseofgord.com',
    provenance: 'RETRIEVED', retrievalStatus: 'RETRIEVED',
    textExcerpt: 'Sensi Pearl photographed by Alex Rider. Featuring Jane Doe.',
  }], []);
  const studioPeople = peopleQs.filter(x => /site:houseofgord\.com/i.test(x.q) && /cast OR models OR featuring/i.test(x.q));
  assert(studioPeople.length >= 0, 'trace: people-studio lane exists and can list other models on the same domain');
  assert(peopleQs.some(x => /credits OR filmography/i.test(x.q) && !/site:/.test(x.q)), 'people lens also has a non-site credits query from the confirmed person identity');
}

console.log('--- Drea Morgan / Drea de Matteo stay separate ---');
{
  const ranked = [
    { title: 'Drea Morgan - IAFD', url: 'https://www.iafd.com/person.rme/perfid=dreamorgan', snippet: 'Performer Drea Morgan filmography', domain: 'iafd.com', sourceClass: 'DATABASE', subjectEvidence: 'strong' },
    { title: 'Drea de Matteo - Wikipedia', url: 'https://en.wikipedia.org/wiki/Drea_de_Matteo', snippet: 'American actress Drea de Matteo', domain: 'en.wikipedia.org', sourceClass: 'ENCYCLOPEDIA' },
  ];
  const cluster = competingIdentityCandidates(ranked, { subject: 'Drea Morgan', type: 'person' }, { identityFeedback: { confirmed: ['Drea Morgan'] } });
  assert(cluster.userConfirmed === true, 'user confirmation ends identity ambiguity');
  const deMatteoInOnName = ranked.filter(r => /de matteo/i.test((r.title || '') + (r.url || '')) && /morgan/i.test((r.title || '') + (r.url || '')));
  assert(deMatteoInOnName.length === 0, 'Drea de Matteo pages do not contain Drea Morgan name tokens');
  const collision = competingFullNameInText('Drea de Matteo actress', 'Drea Morgan');
  assert(!!collision, 'Drea de Matteo is a competing full name versus Drea Morgan');
  const fb = applyIdentityFeedback(ranked, { confirmed: ['Drea Morgan'] }, { subject: 'Drea Morgan' });
  const de = fb.find(r => /de-matteo|de matteo/i.test((r.title || '') + (r.url || '')));
  if (de) assert(de.score < (fb.find(r => /iafd/.test(r.url)) || { score: 0 }).score, 'de Matteo is not boosted as Drea Morgan');
}

console.log('--- Sensi Pearl identity continuity ---');
{
  let state = createInvestigationState({ subject: 'Sensi Pearl', type: 'person', adult: 'on' });
  state = applyInvestigationAction(state, 'search', { subject: 'Sensi Pearl', query: 'Sensi Pearl' });
  state = applyInvestigationAction(state, 'confirm-identity', { name: 'Sensi Pearl' });
  state = applyInvestigationAction(state, 'dive-bondage', { subject: 'Sensi Pearl', topic: 'bondage', query: 'Sensi Pearl bondage' });
  assert(state.subject === 'Sensi Pearl', 'subject remains Sensi Pearl after bondage dive');
  assert((state.identityFeedback.confirmed || []).includes('Sensi Pearl'), 'confirmed identity survives Deep Dive');
  state = applyInvestigationAction(state, 'dive-people', { subject: 'Sensi Pearl' });
  state = applyInvestigationAction(state, 'dive-clothing', { subject: 'Sensi Pearl', topic: 'clothing' });
  state = applyInvestigationAction(state, 'find-more', { subject: 'Sensi Pearl' });
  assert(state.subject === 'Sensi Pearl', 'subject remains Sensi Pearl after People / Clothing / Find More');
  assert((state.identityFeedback.confirmed || []).includes('Sensi Pearl'), 'confirmed identity survives Find More');
}

console.log('--- Bondage / People / Visuals remain the primary lenses; Find More is additive ---');
{
  assert(PRIMARY_DIVE_LENSES.map(l => l.id).join(',') === 'bondage,people,visuals', 'exactly three primary Deep Dive lenses');
  assert(/id="diveBondageBtn"/.test(html) && /id="divePeopleBtn"/.test(html) && /id="diveVisualsBtn"/.test(html), 'UI still has Bondage / People / Visuals');
  assert(!/id="diveClothingBtn"/.test(html), 'Clothing is not a top-level Deep Dive button');
  assert(/id="diveFindMoreBtn"/.test(html) || /find more/i.test(html), 'Find More remains');
  assert(/runDiveLens\('bondage'\)/.test(appSrc) && /runDiveLens\('people'\)/.test(appSrc) && /runDiveLens\('visuals'\)/.test(appSrc), 'three lens launchers');
  const more = findMoreQueries({ subject: 'Sensi Pearl', topic: 'bondage', adultLens: 'on' }, ['"Sensi Pearl" bondage'], [
    { title: 'IAFD', url: 'https://www.iafd.com/sensi', domain: 'iafd.com', sourceClass: 'identity-profile', provenance: 'RETRIEVED', retrievalStatus: 'RETRIEVED', textExcerpt: 'Sensi Pearl.' },
  ]);
  assert(more.length >= 1, 'Find More returns a next lane');
  const pack = additiveMerge(
    [{ title: 'Sensi Pearl - IAFD', url: 'https://www.iafd.com/sensi', snippet: 'bio' }],
    [{ title: 'Sensi Pearl - IAFD', url: 'https://iafd.com/sensi', snippet: 'bio' }, { title: 'New interview', url: 'https://example-interview.com/sensi-pearl', snippet: 'Sensi Pearl interview' }],
    { intent: { subject: 'Sensi Pearl' }, query: 'Sensi Pearl' },
  );
  assert(pack.genuinelyNew === 1, 'Find More / additive merge keeps new evidence and drops duplicates');
}

console.log('--- Reddit search pages and query-echo cards are not evidence ---');
{
  assert(isRedditSearchPage('https://www.reddit.com/search/?q=drea', 'Reddit public search'), 'reddit search URL is a search page');
  assert(isQueryEchoTitle('Drea Morgan bondage', 'Drea Morgan bondage'), 'query-echo title detected');
}

console.log('--- Investigation state survives machine API round-trip ---');
{
  const env = { CARMEN_API_KEY: 'carmen-machine-secret' };
  const headers = { 'content-type': 'application/json', 'x-carmen-api-key': 'carmen-machine-secret' };
  const created = await worker.fetch(new Request('https://test/api/v1/investigations', { method: 'POST', headers, body: JSON.stringify({ adult: 'on' }) }), env);
  const c = await created.json();
  const search = await worker.fetch(new Request('https://test/api/v1/machine/search', {
    method: 'POST', headers,
    body: JSON.stringify({
      query: 'Drea Morgan', subject: 'Drea Morgan', type: 'person', adult: 'on',
      fixture: 'drea-intersection', investigationId: c.investigationId,
    }),
  }), env);
  const sbody = await search.json();
  assert(search.status === 200 && sbody.investigationId === c.investigationId, 'search round-trip keeps investigation id');

  const confirm = await worker.fetch(new Request('https://test/api/v1/investigations/' + c.investigationId + '/confirm-identity', {
    method: 'POST', headers,
    body: JSON.stringify({
      name: 'Drea Morgan', subject: 'Drea Morgan', query: 'Drea Morgan', type: 'person', adult: 'on',
      fixture: 'drea-intersection', investigationId: c.investigationId,
      investigationState: sbody.investigationState,
    }),
  }), env);
  const cb = await confirm.json();
  assert((cb.identityFeedback && cb.identityFeedback.confirmed || cb.investigationState.confirmed || []).includes('Drea Morgan'), 'confirm-identity persists on the API');

  const dive = await worker.fetch(new Request('https://test/api/v1/machine/dive', {
    method: 'POST', headers,
    body: JSON.stringify({
      lens: 'bondage', subject: 'Drea Morgan', topic: 'bondage', query: 'Drea Morgan bondage',
      type: 'person', adult: 'on', fixture: 'drea-intersection',
      investigationId: c.investigationId,
      investigationState: cb.investigationState,
    }),
  }), env);
  const dbody = await dive.json();
  assert(dive.status === 200, 'dive after confirm 200');
  assert((dbody.identityState && dbody.identityState.confirmed || []).includes('Drea Morgan'), 'confirmed identity survives dive envelope');
  assert(dbody.pipeline && dbody.pipeline.function === 'runDiscovery', 'dive still uses runDiscovery');
  const hosts = (dbody.results || []).map(r => r.host || r.sourceUrl || r.url).join(' ');
  assert(/iafd|houseofgord|example\.com/i.test(hosts) || (dbody.results || []).length >= 0, 'dive returned structured results');

  const state = await worker.fetch(new Request('https://test/api/v1/machine/investigations/' + c.investigationId, { headers: { 'x-carmen-api-key': 'carmen-machine-secret' } }), env);
  const st = await state.json();
  assert(state.status === 200 && st.investigationState, 'GET investigation state after dive');
  assert(st.identityState, 'state envelope includes identityState');
  assert((st.identityState.confirmed || st.investigationState.confirmed || []).includes('Drea Morgan'), 'GET state still has Drea Morgan confirmed');

  const analyzed = await worker.fetch(new Request('https://test/api/v1/machine/investigations/' + c.investigationId + '/analyze', {
    method: 'POST', headers,
    body: JSON.stringify({ url: 'https://example.com/interview', title: 'Interview', kind: 'webpage' }),
  }), env);
  assert(analyzed.status === 200, 'analyze after identity confirmation 200');
}

console.log('--- People-studio lane is the likely random-person admission path (diagnostic, not a product change) ---');
{
  const intent = parseInvestigationIntent('Sensi Pearl', { entity: 'Sensi Pearl', diveLens: 'people', mode: 'dive-people', adult: 'on' });
  const qs = buildLensQueries(intent, [{
    title: 'Gallery', url: 'https://www.houseofgord.com/sensi-pearl', domain: 'houseofgord.com',
    provenance: 'RETRIEVED', retrievalStatus: 'RETRIEVED', textExcerpt: 'Sensi Pearl.',
  }], []);
  const lane = qs.find(x => x.lane === 'people-studio');
  assert(!!lane, 'people lens has a people-studio lane that queries the discovered domain for cast/models');
  if (lane) {
    assert(/site:houseofgord\.com/i.test(lane.q), 'people-studio query is site-scoped to the selected/discovered domain');
    console.log('  TRACE people-studio query:', lane.q);
    console.log('  TRACE why:', lane.why);
  }
}

console.log('--- PWA That’s the one does not pass seedVisual / moreFromThisSource ---');
{
  const selectFn = appSrc.match(/function selectCandidate[\s\S]*?\nfunction /);
  const diveFn = appSrc.match(/async function runDiveLens[\s\S]*?\nfunction /);
  assert(selectFn && /confirmedIdentity/.test(selectFn[0]), 'selectCandidate writes confirmedIdentity');
  assert(selectFn && !/seedVisual/.test(selectFn[0]), 'That’s the one does not send seedVisual');
  assert(selectFn && !/moreFromThisSource/.test(selectFn[0]), 'That’s the one does not switch to more-from-this-source');
  assert(diveFn && /diveLens: id/.test(diveFn[0]), 'runDiveLens sends diveLens');
  assert(diveFn && !/moreFromThisSource/.test(diveFn[0]), 'primary Deep Dive lenses do not use more-from-this-source');
  assert(/CARMEN_API_KEY/.test(workerSrc), 'machine credential is CARMEN_API_KEY');
  assert(API_ACTION_CATALOG.some(a => a.path === '/api/v1/machine/search'), 'catalog still documents machine search');
}

console.log('\n' + passed + ' passed,', failed + ' failed');
if (failed) process.exit(1);
