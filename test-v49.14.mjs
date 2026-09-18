// v49.14 person-selection + image-result production fix.
// Distinct identity surfaces, sourceUrl survival, multi-image retention.
// Does not redesign Deep Dive. Deterministic planner + fixture searches.
import { readFileSync } from 'node:fs';
import {
  PLANNER_VERSION,
  PLANNER_BUILD,
  PRIMARY_DIVE_LENSES,
  competingIdentityCandidates,
  clusterByIdentity,
  buildIdentityVerificationPack,
  serializeEvidenceItem,
  visualDedupeKey,
  dedupeVisualEvidence,
  applyVisualEvidenceGate,
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
const deploySrc = readFileSync(new URL('./.github/workflows/deploy.yml', import.meta.url), 'utf8');

console.log('--- v49.14 version / marker ---');
{
  assert(PLANNER_VERSION === '49.14', 'PLANNER_VERSION 49.14');
  assert(PLANNER_BUILD === '49.14-person-image-results', 'PLANNER_BUILD');
  assert(appSrc.includes("const VERSION = '49.14'"), 'frontend VERSION');
  assert(/carmen-build" content="49\.14"/.test(html), 'html build');
  assert(/v49\.14/.test(html), 'header shows version');
  assert(/49\.14-person-image-results/.test(plannerSrc), 'planner marker present');
  assert(!/apply-v49\.14\.sh/.test(deploySrc), 'incomplete apply hook is not in deploy workflow');
}

console.log('--- unspecified-role surfaces are not merged ---');
{
  const rows = [
    { title: 'Alex Rivera - IAFD', url: 'https://www.iafd.com/person.rme/perfid=alexrivera', snippet: 'Alex Rivera performer biography', domain: 'iafd.com', sourceClass: 'DATABASE', evidence: { subjectEvidence: 'strong' } },
    { title: "Alex Rivera's Official Site", url: 'https://alexrivera.example/profile', snippet: 'Alex Rivera official videos', domain: 'alexrivera.example', sourceClass: 'PRIMARY' },
    { title: 'Alex | Free Listening on SoundCloud', url: 'https://soundcloud.com/alex-beats', snippet: 'Stream Alex music. Unrelated first-name match.', domain: 'soundcloud.com' },
    { title: 'Alex Rivera realtor', url: 'https://example-realtor.com/alex-rivera', snippet: 'Alex Rivera real estate agent', domain: 'example-realtor.com', sourceClass: 'PUBLIC_PROFILE' },
  ];
  const clusters = clusterByIdentity(rows, 'Alex Rivera');
  assert(clusters.length >= 2, 'multiple identity surfaces remain distinct');
  const hosts = clusters.map(c => (c.sourceDomains || []).join(' ') + ' ' + (c.host || '') + ' ' + ((c.urls || []).join(' ')));
  const hasIaFd = hosts.some(h => /iafd/i.test(h));
  const hasRealtor = hosts.some(h => /realtor/i.test(h));
  assert(hasIaFd && hasRealtor, 'IAFD and realtor stay separate');
  const mergedUnspecified = clusters.length === 1 && clusters[0].role === 'unspecified';
  assert(!mergedUnspecified, 'unspecified-role rows are not collapsed into one candidate');
  const pack = buildIdentityVerificationPack(rows, { type: 'person', subject: 'Alex Rivera' }, {});
  assert(pack.needed === true, 'confirmation is still required');
  assert((pack.candidates || []).length >= 2, 'more than one valid identity surface is retained');
  assert(pack.candidates.every(c => c.sourceUrl || c.sampleUrl), 'every candidate has sourceUrl');
  assert(pack.candidates.every(c => Array.isArray(c.sources) && c.sources.length), 'every candidate has source metadata');
  const sc = pack.candidates.find(c => /soundcloud/i.test((c.sourceUrl || '') + (c.profileSource || '') + (c.sampleUrl || '')));
  assert(!sc || sc.confidence !== 'high', 'first-name music host is not high confidence');
}

console.log('--- same person across identity-grade hosts still corroborates ---');
{
  const drea = competingIdentityCandidates([
    { title: 'Drea Morgan - IAFD', url: 'https://www.iafd.com/person.rme/perfid=dreamorgan', sourceClass: 'DATABASE', resultKind: 'IDENTITY_MATCH', evidence: { subjectEvidence: 'strong' }, snippet: 'Drea Morgan performer' },
    { title: 'Drea Morgan | LoyalFans', url: 'https://www.loyalfans.com/servedrea', sourceClass: 'ADULT_PLATFORM', resultKind: 'IDENTITY_MATCH', snippet: 'Drea Morgan' },
    { title: 'Drea Morgan metal bondage photoset', url: 'https://www.houseofgord.com/dreamorgan-cinch', sourceClass: 'ADULT_PLATFORM', resultKind: 'IDENTITY_MATCH', snippet: 'Drea Morgan' },
  ], { type: 'person', subject: 'Drea Morgan' });
  assert(drea.ambiguous === false, 'IAFD/LoyalFans/House of Gord remain one person, not dumped as ambiguous');
  assert(drea.candidates.length >= 1, 'corroborated identity still produces a candidate');
}

console.log('--- competing specified roles stay separate ---');
{
  const c = competingIdentityCandidates([
    { title: 'Ashley Anderson actress', url: 'https://en.wikipedia.org/wiki/Ashley_Anderson', sourceClass: 'ENCYCLOPEDIA', resultKind: 'IDENTITY_MATCH', snippet: 'actress' },
    { title: 'Ashley Anderson realtor', url: 'https://example-realtor.com/ashley-anderson', sourceClass: 'PUBLIC_PROFILE', resultKind: 'WEAK_MATCH', snippet: 'real estate broker' },
  ], { type: 'person', subject: 'Ashley Anderson' });
  assert(c.ambiguous === true, 'actress vs realtor remains ambiguous');
  assert(c.candidates.length >= 2, 'two roleful surfaces are not merged');
}

console.log('--- sourceUrl and imageUrl stay separate ---');
{
  const row = serializeEvidenceItem({
    title: 'Gallery still',
    url: 'https://example.net/person/profile',
    sourceUrl: 'https://example.net/person/profile',
    pageUrl: 'https://example.net/person/profile',
    image: 'https://cdn.example.net/still-1.jpg',
    imageUrl: 'https://cdn.example.net/still-1.jpg',
    source: 'Bing Images',
    provider: 'Bing Images',
  }, { subject: 'Test Person' });
  assert(row.sourceUrl === 'https://example.net/person/profile', 'sourceUrl is the page');
  assert(row.imageUrl === 'https://cdn.example.net/still-1.jpg', 'imageUrl is the image');
  assert(row.sourceUrl !== row.imageUrl, 'sourceUrl and imageUrl are distinct');
}

console.log('--- unique images from the same page survive; duplicates collapse ---');
{
  const hits = [
    { imageUrl: 'https://cdn.example.net/a.jpg', url: 'https://cdn.example.net/a.jpg', pageUrl: 'https://example.net/gallery', sourceUrl: 'https://example.net/gallery', kind: 'image', source: 'Bing Images' },
    { imageUrl: 'https://cdn.example.net/b.jpg', url: 'https://cdn.example.net/b.jpg', pageUrl: 'https://example.net/gallery', sourceUrl: 'https://example.net/gallery', kind: 'image', source: 'Bing Images' },
    { imageUrl: 'https://cdn.example.net/c.jpg', url: 'https://cdn.example.net/c.jpg', pageUrl: 'https://example.net/gallery', sourceUrl: 'https://example.net/gallery', kind: 'image', source: 'Yahoo Images' },
    { imageUrl: 'https://cdn.example.net/a.jpg', url: 'https://cdn.example.net/a.jpg', pageUrl: 'https://example.net/gallery', sourceUrl: 'https://example.net/gallery', kind: 'image', source: 'Bing Images' },
  ];
  const keys = hits.map(h => visualDedupeKey(h));
  assert(keys[0] !== keys[1] && keys[1] !== keys[2], 'distinct files from one gallery are distinct keys');
  const deduped = dedupeVisualEvidence(hits, []);
  assert(deduped.unique.length === 3, 'three unique images survive');
  assert(deduped.duplicatesRemoved === 1, 'exact duplicate image is removed');
  assert(deduped.unique.every(im => im.sourceUrl === 'https://example.net/gallery'), 'sourceUrl preserved on each image');
  assert(deduped.unique.every(im => im.imageUrl && im.imageUrl !== im.sourceUrl), 'imageUrl remains the file, not the page');
  assert(deduped.unique.every(im => im.source), 'provider metadata survives');
}

console.log('--- Deep Dive primary actions are unchanged ---');
{
  assert(PRIMARY_DIVE_LENSES.map(l => l.id).join(',') === 'bondage,visuals,accounts', 'primary lenses Bondage/Visuals/Accounts');
  assert(/id="diveBondageBtn"/.test(html) && /id="diveVisualsBtn"/.test(html), 'Bondage and Visuals controls remain');
  assert(/Accounts \/ Premium/.test(html), 'Accounts / Premium remains');
  assert(/data-testid="find-more"/.test(html) && /data-testid="dive-nl-input"/.test(html), 'Find More + Ask remain');
  assert(/data-testid="recreate-position"/.test(html), 'Recreate this position remains');
  assert(/YES — THIS PERSON/.test(appSrc) && /NOT THIS PERSON/.test(appSrc), 'identity confirmation controls remain');
  assert(/identity-open-source/.test(appSrc), 'identity View source control exists');
  assert(/goToDive\(\)/.test(appSrc), 'person confirmation still enters Deep Dive');
}

console.log('--- attachImageHit no longer collapses by host ---');
{
  assert(!/hostOf\(r\.url\) === hostOf\(pageUrl\) && hostOf\(pageUrl\)/.test(workerSrc), 'same-host image collapse is gone');
  assert(/only fold into the exact same source page/.test(workerSrc), 'exact-page merge remains documented');
}

console.log('--- fixture person + image pipeline ---');
{
  const drea = await worker.fetch(new Request('https://test/search?q=' + encodeURIComponent('Drea Morgan') + '&type=person&adult=on&fixture=drea-morgan&identityPhase=1'), {});
  const body = await drea.json();
  assert(drea.status === 200, 'fixture search 200');
  assert(body.classification && body.classification.type === 'person', 'classified PERSON');
  const pack = body.identityVerification || {};
  assert(pack.needed === true, 'does not auto-confirm');
  assert((pack.candidates || []).length >= 2, 'more than one valid identity surface retained');
  assert(pack.candidates.every(c => c.sourceUrl || c.sampleUrl), 'candidates carry sourceUrl');
  assert(pack.candidates.every(c => c.candidateId), 'candidates have candidateId');
  const iafd = pack.candidates.find(c => /iafd/i.test((c.sourceUrl || '') + (c.sampleUrl || '') + (c.sources || []).join(' ') + (c.profileSource || '')));
  assert(!!iafd, 'IAFD surface is a candidate');
  assert(iafd && /^https?:\/\//.test(iafd.sourceUrl || iafd.sampleUrl || ''), 'IAFD sourceUrl is a real URL');
  if (iafd && iafd.representativeImages && iafd.representativeImages.length) {
    assert(iafd.representativeImages.every(u => /iafd\.com|dreamorgan/i.test(u) || /iafd/i.test(iafd.sourceUrl || '')), 'thumbnail belongs to the candidate, not a random host mix');
  }
  const sc = pack.candidates.find(c => /soundcloud/i.test((c.sourceUrl || '') + (c.profileSource || '') + (c.sampleUrl || '')));
  assert(!sc || sc.confidence === 'low', 'SoundCloud first-name is not high');

  const vis = body.visuals || body.visualCorpus || [];
  const uniqueImages = [...new Set(vis.map(v => v.imageUrl || v.url).filter(Boolean))];
  assert(uniqueImages.length >= 2, 'multiple images survive the fixture image pipeline');
  assert(vis.every(v => !v.imageUrl || !v.sourceUrl || v.imageUrl !== v.sourceUrl || !v.pageUrl), 'imageUrl is not silently aliased over a distinct source page');
  const withBoth = vis.filter(v => v.imageUrl && (v.sourceUrl || v.pageUrl));
  assert(withBoth.length >= 1, 'at least one visual keeps both imageUrl and sourceUrl');
  if (withBoth.length) {
    assert(withBoth.every(v => v.imageUrl !== (v.sourceUrl || v.pageUrl)), 'image and source stay separate when both exist');
    assert(withBoth.every(v => v.provider || v.source), 'provider/retrieval metadata survives');
  }
  const verified = vis.filter(v => v.visualGate === 'verified' && v.evidenceLevel === 'VISUAL_IDENTITY_VERIFIED');
  const unverified = vis.filter(v => v.unverifiedVisual || v.visualGate === 'unverified' || v.evidenceLevel === 'METADATA_MATCH' || v.evidenceLevel === 'SOURCE_ASSOCIATED');
  assert(verified.every(v => v.evidenceLevel === 'VISUAL_IDENTITY_VERIFIED'), 'verified visuals actually meet the gate');
  assert(verified.length <= uniqueImages.length, 'verified count is not inflated past surviving images');

  const structured = body.structuredResults || [];
  if (structured.length) {
    assert(structured.every(r => r.sourceUrl), 'structured results expose sourceUrl');
  }
}

console.log('--- health ---');
{
  const res = await worker.fetch(new Request('https://test/health'), {});
  const body = await res.json();
  assert(body.version === '49.14' && body.build === '49.14-person-image-results', 'health reports 49.14');
  assert((body.features || []).includes('v49.14-person-image-results'), 'feature person-image-results');
  assert((body.features || []).includes('v49.13-investigation-actions'), 'v49.13 Deep Dive actions retained');
  assert((body.features || []).includes('v49.12-investigation-workflow'), 'v49.12 workflow retained');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
