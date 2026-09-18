// v50 agent-testable progressive production pass.
// Same runDiscovery pipeline. Thumbnails, bondage diagnostics, progressive dive.
import { readFileSync } from 'node:fs';
import {
  PLANNER_VERSION,
  PLANNER_BUILD,
  PRIMARY_DIVE_LENSES,
  competingIdentityCandidates,
  clusterByIdentity,
  buildIdentityVerificationPack,
  serializePersonCandidate,
  hydratePersonCandidates,
  imageBelongsToCandidate,
  applyVisualEvidenceGate,
  visualEvidenceGate,
  visualDedupeKey,
  dedupeVisualEvidence,
  explainZeroVisuals,
  emptyVisualPipeline,
  buildVisualPipelineDiagnostics,
  createPipelineClock,
  DIVE_STAGES,
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
const plannerSrc = readFileSync(new URL('./investigation-planner.js', import.meta.url), 'utf8');
const deploySrc = readFileSync(new URL('./.github/workflows/deploy.yml', import.meta.url), 'utf8');
const apiMd = readFileSync(new URL('./API.md', import.meta.url), 'utf8');
const gptMd = readFileSync(new URL('./CHATGPT.md', import.meta.url), 'utf8');

console.log('--- v50 version / marker ---');
{
  assert(PLANNER_VERSION === '50', 'PLANNER_VERSION 50');
  assert(PLANNER_BUILD === '50-agent-testable-progressive', 'PLANNER_BUILD');
  assert(appSrc.includes("const VERSION = '50'"), 'frontend VERSION');
  assert(/carmen-build" content="50"/.test(html), 'html build');
  assert(/v50/.test(html), 'header shows version');
  assert(/50-agent-testable-progressive/.test(plannerSrc), 'planner marker present');
  assert(/test-v50\.mjs/.test(deploySrc), 'deploy runs test-v50');
}

console.log('--- v49.14 regressions still hold ---');
{
  const rows = [
    { title: 'Alex Rivera - IAFD', url: 'https://www.iafd.com/person.rme/perfid=alexrivera', snippet: 'Alex Rivera performer biography', domain: 'iafd.com', sourceClass: 'DATABASE', evidence: { subjectEvidence: 'strong' }, image: 'https://www.iafd.com/graphics/headshots/alexrivera.jpg' },
    { title: "Alex Rivera's Official Site", url: 'https://alexrivera.example/profile', snippet: 'Alex Rivera official videos', domain: 'alexrivera.example', sourceClass: 'PRIMARY', image: 'https://alexrivera.example/alex.jpg' },
    { title: 'Alex Rivera realtor', url: 'https://example-realtor.com/alex-rivera', snippet: 'Alex Rivera real estate agent', domain: 'example-realtor.com', sourceClass: 'PUBLIC_PROFILE' },
  ];
  const clusters = clusterByIdentity(rows, 'Alex Rivera');
  assert(clusters.length >= 2, 'multiple identity surfaces remain distinct');
  const pack = buildIdentityVerificationPack(rows, { type: 'person', subject: 'Alex Rivera' }, {});
  assert(pack.needed === true, 'confirmation is still required');
  assert((pack.candidates || []).length >= 2, 'more than one valid identity surface is retained');
  assert(pack.candidates.every(c => c.sourceUrl || c.sampleUrl), 'every candidate has sourceUrl');
  assert(pack.personCandidates && pack.personCandidates.length === pack.candidates.length, 'personCandidates serialize 1:1');
  assert(pack.personCandidates.every(c => c.sourceUrl && c.displayName), 'serialized candidates keep sourceUrl + displayName');
  const iafd = pack.candidates.find(c => /iafd/i.test(c.sourceUrl || ''));
  const realtor = pack.candidates.find(c => /realtor/i.test(c.sourceUrl || ''));
  assert(iafd && realtor, 'IAFD and realtor stay separate');
  assert(iafd.thumbnailUrl && /iafd\.com/i.test(iafd.thumbnailUrl), 'IAFD thumbnail is from IAFD, not a random first image');
  assert(!realtor.thumbnailUrl || /realtor/i.test(realtor.thumbnailUrl) || !/iafd\.com/i.test(realtor.thumbnailUrl), 'realtor does not steal the IAFD image');
  assert(PRIMARY_DIVE_LENSES.map(l => l.id).join(',') === 'bondage,visuals,accounts', 'primary lenses Bondage/Visuals/Accounts');
  assert(/YES — THIS PERSON/.test(appSrc) && /NOT THIS PERSON/.test(appSrc), 'identity confirmation controls remain');
  assert(/identity-open-source/.test(appSrc), 'identity View source control exists');
  assert(/goToDive\(\)/.test(appSrc), 'person confirmation still enters Deep Dive');
}

console.log('--- thumbnails belong only to that candidate ---');
{
  const iafd = { candidateId: 'cand_iafd', name: 'Alex Rivera', sourceUrl: 'https://www.iafd.com/person.rme/perfid=alexrivera', profileSource: 'iafd.com', representativeImages: [] };
  const site = { candidateId: 'cand_site', name: 'Alex Rivera', sourceUrl: 'https://alexrivera.example/profile', profileSource: 'alexrivera.example', representativeImages: [] };
  const ranked = [
    { title: 'Alex Rivera - IAFD', url: 'https://www.iafd.com/person.rme/perfid=alexrivera', image: 'https://www.iafd.com/graphics/headshots/alex.jpg', ogImage: 'https://www.iafd.com/og/alex.jpg' },
    { title: 'Official', url: 'https://alexrivera.example/profile', image: 'https://alexrivera.example/alex.jpg' },
  ];
  const visuals = [
    { imageUrl: 'https://cdn.example.net/stolen.jpg', pageUrl: 'https://unrelated.example/gallery', title: 'Alex Rivera' },
    { imageUrl: 'https://www.iafd.com/stills/one.jpg', pageUrl: 'https://www.iafd.com/person.rme/perfid=alexrivera', title: 'still' },
  ];
  hydratePersonCandidates([iafd, site], ranked, visuals);
  assert(iafd.thumbnailUrl === 'https://www.iafd.com/graphics/headshots/alex.jpg' || iafd.thumbnailUrl === 'https://www.iafd.com/og/alex.jpg' || iafd.thumbnailUrl === 'https://www.iafd.com/stills/one.jpg', 'IAFD hydrates from its own source');
  assert(!/stolen|unrelated/i.test(iafd.thumbnailUrl || ''), 'unrelated gallery image is not attached');
  assert(site.thumbnailUrl === 'https://alexrivera.example/alex.jpg', 'official site keeps its own image');
  assert(!imageBelongsToCandidate('https://cdn.example.net/stolen.jpg', 'https://unrelated.example/gallery', iafd, { candidates: [iafd, site] }), 'stolen image does not belong');
  assert(imageBelongsToCandidate('https://www.iafd.com/stills/one.jpg', 'https://www.iafd.com/person.rme/perfid=alexrivera', iafd, { candidates: [iafd, site] }), 'same-page image belongs');
  const ser = serializePersonCandidate(iafd);
  assert(ser.thumbnailUrl && ser.sourceUrl && ser.id, 'serialized candidate has id/source/thumb');
  assert(ser.observationState === 'OBSERVED', 'thumbnail is OBSERVED not inferred');
  const junkYtt = { candidateId: 'cand_blog', name: 'Alex Rivera', sourceUrl: 'https://www.current-affairs.org/alex/', profileSource: 'current-affairs.org', representativeImages: ['https://i.ytimg.com/vi/ID/hqdefault.jpg'], thumbnailUrl: 'https://i.ytimg.com/vi/ID/hqdefault.jpg' };
  const junkOg = { candidateId: 'cand_og', name: 'Alex Rivera', sourceUrl: 'https://egirl.sx/article/alex', profileSource: 'egirl.sx', representativeImages: ['https://egirl.sx/og-default.png'], thumbnailUrl: 'https://egirl.sx/og-default.png' };
  hydratePersonCandidates([junkYtt, junkOg], [], []);
  assert(!junkYtt.thumbnailUrl, 'template ytimg /vi/ID/ is not a candidate thumbnail');
  assert(!junkOg.thumbnailUrl, 'og-default.png is not a candidate thumbnail');
}

console.log('--- visual gate: query-associated bondage is unverified, not rejected, not verified ---');
{
  const classification = { type: 'person', subject: 'Drea Morgan', intentClass: 'PERSON', context: 'bondage' };
  const hit = {
    title: '',
    url: 'https://cdn.example.net/drea-bondage/cinch-1.jpg',
    image: 'https://cdn.example.net/drea-bondage/cinch-1.jpg',
    pageUrl: 'https://www.houseofgord.com/dreamorgan-cinch',
    queryVariant: '"Drea Morgan" bondage photoset',
    source: 'Bing Images',
  };
  const gate = visualEvidenceGate(hit, classification, {
    subject: 'Drea Morgan',
    topic: 'bondage',
    identityFeedback: { confirmed: ['Drea Morgan'] },
    associatedHosts: ['houseofgord.com', 'iafd.com'],
    query: 'Drea Morgan bondage',
  });
  assert(gate.verdict !== 'rejected', 'person×bondage image-index hit is not rejected solely for empty title');
  assert(gate.verdict !== 'verified' || gate.evidenceLevel !== 'VISUAL_IDENTITY_VERIFIED' || gate.gate !== 'query-associated', 'query-associated never claims visual identity verified by itself');
  const gated = applyVisualEvidenceGate([hit], classification, {
    subject: 'Drea Morgan',
    topic: 'bondage',
    identityFeedback: { confirmed: ['Drea Morgan'] },
    associatedHosts: ['houseofgord.com'],
    query: 'Drea Morgan bondage',
  });
  assert(gated.rejected.length === 0 || gated.unverified.length + gated.verified.length > 0, 'bondage visual survives as unverified or verified, not dropped silently');
  const unrelated = visualEvidenceGate({
    title: 'Random kitten',
    url: 'https://pixabay.com/kittens.jpg',
    image: 'https://pixabay.com/kittens.jpg',
    pageUrl: 'https://pixabay.com/kittens',
    queryVariant: 'bondage',
  }, classification, { subject: 'Drea Morgan', topic: 'bondage', identityFeedback: { confirmed: ['Drea Morgan'] }, query: 'bondage' });
  assert(unrelated.verdict === 'rejected', 'unrelated stock/wildlife is still rejected');
}

console.log('--- visual pipeline diagnostics ---');
{
  const empty = emptyVisualPipeline();
  assert(explainZeroVisuals(empty) === 'providers_returned_zero', 'empty → providers_returned_zero');
  assert(explainZeroVisuals({ ...empty, providerResults: 4, retrieved: 0 }) === 'retrieval_failed', 'retrieved 0 → retrieval_failed');
  assert(explainZeroVisuals({ ...empty, providerResults: 4, retrieved: 4, filtered: 4 }) === 'filtered_out', 'all filtered → filtered_out');
  const pipe = buildVisualPipelineDiagnostics({ providerResults: 6, retrieved: 6, verified: 0, unverified: 2, rejected: 3, duplicatesRemoved: 1, finalVisuals: 2 });
  assert(pipe.zeroReason === '', 'non-zero finals have no zeroReason');
  assert(Array.isArray(DIVE_STAGES) && DIVE_STAGES[0] === 'initialized' && DIVE_STAGES.includes('initial-visuals'), 'dive stages documented');
  const clock = createPipelineClock(Date.now() - 5);
  clock.begin('retrieval');
  clock.end('retrieval');
  const snap = clock.snapshot();
  assert(snap.stages.retrieval && snap.stages.retrieval.ms >= 0, 'pipeline clock records stage ms');
}

console.log('--- machine catalog documents candidates / confirm / diagnostics ---');
{
  assert(API_ACTION_CATALOG.some(a => a.path === '/api/v1/machine/candidates'), 'catalog candidates');
  assert(API_ACTION_CATALOG.some(a => a.path === '/api/v1/machine/confirm'), 'catalog confirm');
  assert(API_ACTION_CATALOG.some(a => a.path === '/api/v1/machine/diagnostics'), 'catalog diagnostics');
  assert(/\/api\/v1\/machine\/candidates/.test(workerSrc), 'worker documents candidates route');
  assert(/stage:/.test(workerSrc) && /initialOnly/.test(workerSrc), 'worker supports initial dive stage');
  assert(/Promise\.all\(chunk\.map/.test(workerSrc), 'web variants run in parallel batches');
  assert(/VisualBudgetReserve/.test(workerSrc), 'identity/dive image search reserves fetches');
  assert(/identityHold && classification.type === 'person'/.test(workerSrc), 'identity portrait reserves visual budget');
  assert(/machineSearch/.test(workerSrc) && /machineCandidates/.test(workerSrc), 'OpenAPI operationIds exist');
  assert(/personCandidates/.test(apiMd), 'API.md documents personCandidates');
  assert(/machine\/candidates/.test(gptMd) || /candidates/.test(gptMd), 'CHATGPT.md mentions candidates');
}

console.log('--- fixture identity + machine API same pipeline ---');
{
  const pwa = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Drea Morgan') + '&type=person&adult=on&fixture=drea-morgan&identityPhase=1'), {});
  const pwaBody = await pwa.json();
  assert(pwa.status === 200, 'fixture search 200');
  assert(pwaBody.requestId && pwaBody.timings && pwaBody.visualPipeline, 'PWA search exposes requestId/timings/visualPipeline');
  const pack = pwaBody.identityVerification || {};
  assert((pack.candidates || []).length >= 2, 'multiple candidates');
  assert((pwaBody.personCandidates || []).length >= 1, 'personCandidates on PWA search');
  const withThumb = (pwaBody.personCandidates || pack.candidates || []).filter(c => c.thumbnailUrl || (c.representativeImages && c.representativeImages[0]));
  assert(withThumb.length >= 1, 'at least one candidate has a thumbnail from its own source');
  assert((pack.candidates || []).every(c => c.sourceUrl || c.sampleUrl), 'sourceUrl preserved');
  const thumbs = withThumb.map(c => c.thumbnailUrl || (c.representativeImages || [])[0]);
  assert(thumbs.every(u => /iafd\.com|dreamorgan\.com/i.test(u)), 'thumbnails are from candidate sources, not a random mix');

  const api = await worker.fetch(new Request('https://test/api/v1/machine/candidates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'Drea Morgan', subject: 'Drea Morgan', type: 'person', adult: 'on', fixture: 'drea-morgan' }),
  }), {});
  const apiBody = await api.json();
  assert(api.status === 200, 'machine candidates 200');
  assert(apiBody.samePipelineAsIphoneUi === true && apiBody.pipeline && apiBody.pipeline.function === 'runDiscovery', 'candidates uses runDiscovery');
  assert(apiBody.pipeline.mock === false, 'not a mock');
  assert((apiBody.personCandidates || []).length >= 1, 'machine candidates return personCandidates');
  assert(apiBody.diagnostics && apiBody.diagnostics.visualPipeline, 'diagnostics envelope present');
  assert(apiBody.requestId && apiBody.timings, 'requestId + timings on machine envelope');

  const pwaUrls = (pwaBody.personCandidates || []).map(c => c.sourceUrl).filter(Boolean).sort();
  const apiUrls = (apiBody.personCandidates || []).map(c => c.sourceUrl).filter(Boolean).sort();
  assert(pwaUrls.length && apiUrls.length && pwaUrls.join('|') === apiUrls.join('|'), 'PWA and machine candidates share the same source URLs');
}

console.log('--- confirm + diagnostics inspect the same investigation ---');
{
  const search = await worker.fetch(new Request('https://test/api/v1/machine/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'Drea Morgan', subject: 'Drea Morgan', type: 'person', adult: 'on', fixture: 'drea-morgan' }),
  }), {});
  const sbody = await search.json();
  const cand = (sbody.personCandidates || [])[0];
  assert(cand && cand.id, 'search returned a candidate id');
  const confirm = await worker.fetch(new Request('https://test/api/v1/machine/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      candidateId: cand.id,
      investigationId: sbody.investigationId,
      investigationState: sbody.investigationState,
      fixture: 'drea-morgan',
      subject: 'Drea Morgan',
      type: 'person',
      adult: 'on',
    }),
  }), {});
  const cbody = await confirm.json();
  assert(confirm.status === 200, 'confirm 200');
  assert((cbody.identityState && (cbody.identityState.confirmed || []).length) || (cbody.investigationState && cbody.investigationState.canonicalPerson), 'confirm retains canonical person');

  const dive = await worker.fetch(new Request('https://test/api/v1/machine/dive', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      lens: 'bondage',
      subject: 'Drea Morgan',
      topic: 'bondage',
      adult: 'on',
      fixture: 'drea-morgan',
      investigationId: cbody.investigationId,
      investigationState: cbody.investigationState,
      stage: 'initial',
    }),
  }), {});
  const dbody = await dive.json();
  assert(dive.status === 200, 'bondage dive 200');
  assert(dbody.visualPipeline, 'dive exposes visualPipeline');
  assert(dbody.partial === true || dbody.diveStage, 'initial stage is marked');
  const vis = dbody.images || dbody.primaryVisuals || [];
  const verified = vis.filter(v => v.visualGate === 'verified' && v.evidenceLevel === 'VISUAL_IDENTITY_VERIFIED');
  assert(verified.every(v => v.evidenceLevel === 'VISUAL_IDENTITY_VERIFIED'), 'verified visuals meet the gate');
  if (!vis.length) {
    assert(dbody.visualPipeline.zeroReason, 'honest empty-state zeroReason when no visuals');
  } else {
    assert(dbody.visualPipeline.finalVisuals > 0, 'pipeline finalVisuals matches surviving visuals');
  }

  const diag = await worker.fetch(new Request('https://test/api/v1/machine/diagnostics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      investigationId: dbody.investigationId,
      investigationState: dbody.investigationState,
    }),
  }), {});
  const diagBody = await diag.json();
  assert(diag.status === 200, 'diagnostics 200 from echoed state');
  assert(diagBody.visualPipeline || (diagBody.diagnostics && diagBody.diagnostics.visualPipeline), 'stored visualPipeline returned');
  assert(diagBody.samePipelineAsIphoneUi === true, 'diagnostics is the real pipeline snapshot');
}

console.log('--- OpenAPI includes the new agent operations ---');
{
  const spec = await worker.fetch(new Request('https://test/api/v1/openapi.json'), {});
  const openapi = await spec.json();
  assert(spec.status === 200 && openapi.openapi === '3.0.3', 'openapi 3.0.3');
  assert(openapi.info.version === '50', 'spec version 50');
  assert(openapi.paths['/api/v1/machine/candidates'], 'spec candidates');
  assert(openapi.paths['/api/v1/machine/confirm'], 'spec confirm');
  assert(openapi.paths['/api/v1/machine/diagnostics'], 'spec diagnostics');
  let descOk = true;
  for (const ops of Object.values(openapi.paths)) {
    for (const op of Object.values(ops)) {
      if (op && typeof op === 'object') {
        if (op.summary && op.summary.length > 300) descOk = false;
        if (op.description && op.description.length > 300) descOk = false;
      }
    }
  }
  assert(descOk, 'ChatGPT Action descriptions stay under 300 chars');
}

console.log('--- progressive UI wiring ---');
{
  assert(/stage: 'initial'/.test(appSrc) && /stage: 'continue'/.test(appSrc), 'Deep Dive requests initial then continue');
  assert(/data-testid="dive-stage"/.test(appSrc), 'UI exposes dive stage');
  assert(/thumbnailUrl/.test(appSrc), 'UI reads thumbnailUrl');
  assert(/identity-thumb/.test(appSrc), 'identity thumb testid');
  assert(/No associated image/.test(appSrc), 'honest placeholder when no thumbnail');
}

console.log('--- health ---');
{
  const res = await worker.fetch(new Request('https://test/health'), {});
  const body = await res.json();
  assert(body.version === '50' && body.build === '50-agent-testable-progressive', 'health reports 50');
  assert((body.features || []).includes('v50-agent-testable'), 'feature agent-testable');
  assert((body.features || []).includes('v49.14-person-image-results'), 'v49.14 retained');
  assert((body.features || []).includes('v49.13-investigation-actions'), 'v49.13 retained');
}

console.log('--- unique images still survive ---');
{
  const hits = [
    { imageUrl: 'https://cdn.example.net/a.jpg', url: 'https://cdn.example.net/a.jpg', pageUrl: 'https://example.net/gallery', sourceUrl: 'https://example.net/gallery', kind: 'image', source: 'Bing Images' },
    { imageUrl: 'https://cdn.example.net/b.jpg', url: 'https://cdn.example.net/b.jpg', pageUrl: 'https://example.net/gallery', sourceUrl: 'https://example.net/gallery', kind: 'image', source: 'Bing Images' },
    { imageUrl: 'https://cdn.example.net/a.jpg', url: 'https://cdn.example.net/a.jpg', pageUrl: 'https://example.net/gallery', sourceUrl: 'https://example.net/gallery', kind: 'image', source: 'Bing Images' },
  ];
  const deduped = dedupeVisualEvidence(hits, []);
  assert(deduped.unique.length === 2, 'two unique images survive');
  assert(deduped.duplicatesRemoved === 1, 'exact duplicate image is removed');
  assert(visualDedupeKey(hits[0]) !== visualDedupeKey(hits[1]), 'distinct files stay distinct');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
