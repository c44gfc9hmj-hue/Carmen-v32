import { classifyQuery, scoreResult, buildSearchVariants, buildExpandedVariants, decodeEntities, rankResults, humanizePath, researchPaths, resolveDivePaths, inferPathsFromQuestion, pathSearchVariants, youtubeId, parseRelated, classifyAccess, accessLabel, parseQueryContext, applyResearchFilter, normalizeAdult, adultSemanticVariants, imageSearchQuery, collectDiveImages, isAdultishSource, extraContext, normalizeDepth, contextVocabulary, discoveryLanes, extractGraphLeads, isAggregatorPage, isSpecificEvidence, classifyResultKind, interestLenses, parseInvestigativeQuestion, visualCandidatesFor, buildSelectedEntity, entityIdFor, discoveryEvidenceFrom, diveSeedQuery, diveExpansionQueries, diveRetrievalQueue, userAskedForSourceRestriction, interpretConcept, interpretRequest, morphologicalNeighbors, inferFamily, FETCH_HARD_CAP, budgetReport, resetFetchBudget, remainingFetches } from './worker.js';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

console.log('--- classify ---');
{
  const p = classifyQuery('Drea Morgan');
  assert(p.type === 'person', 'two-word name is person');
  assert(p.isUrl === false, 'name is not a URL');
  const u = classifyQuery('https://dreamorgan.com/models/DreaMorgan.html');
  assert(u.type === 'website' && u.isUrl === true, 'http URL classified as website');
  const r = classifyQuery('https://www.reddit.com/r/test/comments/abc/hello/');
  assert(r.type === 'reddit' && r.isUrl === true, 'reddit URL classified');
  const a = classifyQuery('Morgan');
  assert(a.type === 'ambiguous' || a.confidence === 'low', 'single token is ambiguous/low');
  const prod = classifyQuery('Apple iPhone', 'product');
  assert(prod.type === 'product', 'product hint honored');
  const v = classifyQuery('Toyota 4Runner 1986');
  assert(v.type === 'vehicle' || v.type === 'product', 'year+vehicle classified');
  const img = classifyQuery('https://example.com/pic.jpg');
  assert(img.isImage === true, 'image URL flagged');
  const topic = classifyQuery('Cloudflare Workers');
  assert(topic.type !== 'person', 'Cloudflare Workers is not classified as a person');
  const tech = classifyQuery('bowline knot');
  assert(tech.type === 'technique', 'named knot/technique is technique');
  const skill = classifyQuery('welding a steel frame');
  assert(skill.type === 'skill', 'welding project is skill');
  const hitch = classifyQuery('welding a trailer hitch');
  assert(hitch.type === 'skill', 'welding a trailer hitch is a skill/project, not a hardcoded subject');
  const wood = classifyQuery('woodworking a bookshelf');
  assert(wood.type === 'skill', 'woodworking project is skill');
  const joinery = classifyQuery('dovetail joinery');
  assert(joinery.type === 'technique', 'named joinery is a technique');
  const hintedTech = classifyQuery('frogtie', 'technique');
  assert(hintedTech.type === 'technique', 'technique hint is honored without hardcoding the query');
  const unhintedToken = classifyQuery('frogtie');
  assert(unhintedToken.type === 'ambiguous' || unhintedToken.confidence === 'low', 'unknown single token is not a hardcoded technique');
  const org = classifyQuery('Lincoln Electric Company');
  assert(org.type === 'organization', 'company language is organization');
}

console.log('--- variants ---');
{
  const v = buildSearchVariants('Drea Morgan', classifyQuery('Drea Morgan'));
  assert(v.some(x => x.q.includes('"Drea Morgan"')), 'person gets exact-name variant');
  assert(v[0].q === 'Drea Morgan', 'primary query first');
  const u = buildSearchVariants('https://dreamorgan.com/models/DreaMorgan.html', classifyQuery('https://dreamorgan.com/models/DreaMorgan.html'));
  assert(u.some(x => /drea morgan/i.test(x.q)), 'URL path is humanized into a name variant');
}

console.log('--- ranking ---');
{
  const q = 'Drea Morgan';
  const c = classifyQuery(q);
  const ranked = rankResults(q, [
    { title: 'Blog', url: 'https://blog.mojeek.com/', source: 'Mojeek', snippet: '' },
    { title: 'Drea Morgan', url: 'https://dreamorgan.com/', source: 'Bing', snippet: "Drea Morgan's Official Site! Offering full-length videos" },
    { title: 'Drea Morgan Tube Search', url: 'https://www.nudevista.com/?q=drea+morgan', source: 'Bing', snippet: '111 results' },
    { title: 'Drea Morgan - dreamorgan.com', url: 'https://dreamorgan.com/models/DreaMorgan.html', source: 'Bing', snippet: 'Vital Stats' },
    { title: 'How many people named Morgan', url: 'https://howmanyofme.com/morgan', source: 'Bing', snippet: 'name count' },
    { title: 'Drea morgan bdsm - Aloha Tube', url: 'https://www.alohatube.com/top/drea_morgan_bdsm', source: 'Bing', snippet: '' },
    { title: 'Drea Morgan (@Drea__Morgan) / X', url: 'https://x.com/drea__morgan', source: 'Bing', snippet: '' },
  ], c);
  assert(ranked[0].url.includes('dreamorgan.com'), 'official/profile domain ranks first');
  assert(ranked[0].confidence === 'high' || ranked[0].score >= 55, 'top result is high confidence');
  assert(/strong match/i.test(ranked[0].reason), 'top result explains strong match');
  const mill = ranked.find(r => r.url.includes('howmanyofme'));
  assert(!mill || mill.score < ranked[0].score, 'name-mill ranked below official');
  assert(ranked.every(r => r.reason), 'every result has a reason');
  assert(!ranked.some(r => r.url.includes('blog.mojeek.com')), 'search-engine chrome suppressed or sunk');
  const x = ranked.find(r => r.url.includes('x.com'));
  const tube = ranked.find(r => r.url.includes('alohatube'));
  assert(x && (!tube || x.score > tube.score), 'X profile outranks tube aggregator');
}

console.log('--- product official domain ---');
{
  const q = 'Apple iPhone';
  const c = classifyQuery(q, 'product');
  const ranked = rankResults(q, [
    { title: 'Apple iPhones - Best Buy', url: 'https://www.bestbuy.com/site/shop/apple-iphones', source: 'Bing', snippet: 'Shop Apple iPhone' },
    { title: 'iPhone - Apple', url: 'https://www.apple.com/iphone/', source: 'Bing', snippet: 'Explore iPhone' },
    { title: 'Apple iPhone Collection - Walmart.com', url: 'https://www.walmart.com/browse/cell-phones/apple-iphone/1105910', source: 'Bing', snippet: '' },
  ], c);
  assert(ranked[0].url.includes('apple.com'), 'manufacturer domain ranks above retailers');
}

console.log('--- scoring language is not certainty ---');
{
  const s = scoreResult('John Smith', { title: 'John Smith Plumbing', url: 'https://johnsmithplumbing.com', snippet: 'local plumber' }, classifyQuery('John Smith'));
  assert(!/definitely|proof|same person/i.test(s.reason), 'reason does not claim identity');
}

console.log('--- entities ---');
{
  assert(decodeEntities('a & b &#39; c') === "a & b ' c", 'entities decoded');
  assert(decodeEntities('https://x.com/?q=a&s=t').includes('&s='), 'url amp decoded');
  assert(decodeEntities('Apple iPhones & Accessories') === 'Apple iPhones & Accessories', 'named amp decoded');
  assert(decodeEntities('Posts tagged "Workers"').includes('"Workers"'), 'named quot decoded');
}

console.log('--- research paths adapt to type ---');
{
  const person = researchPaths('person').map(p => p.id);
  assert(person.includes('identity') && person.includes('images'), 'person paths include identity and images');
  assert(person.includes('videos'), 'person paths include videos');
  const tech = researchPaths('technique').map(p => p.id);
  assert(tech.includes('visuals') && tech.includes('tutorials'), 'technique paths include visuals and tutorials');
  const skill = researchPaths('skill').map(p => p.id);
  assert(skill.includes('tools') && skill.includes('safety'), 'skill paths include tools and safety');
  assert(!JSON.stringify(researchPaths('person')).toLowerCase().includes('drea'), 'paths are not hardcoded to a test person');
  assert(!JSON.stringify(researchPaths('technique')).toLowerCase().includes('frogtie'), 'technique paths are not hardcoded to a test query');
  const orgPaths = researchPaths('organization').map(p => p.id);
  assert(orgPaths.includes('official'), 'organization paths include official presence');
}
console.log('--- instructional ranking ---');
{
  const q = 'bowline knot';
  const c = classifyQuery(q);
  assert(c.type === 'technique', 'bowline knot classified as technique');
  const ranked = rankResults(q, [
    { title: 'How to tie a bowline knot', url: 'https://www.wikihow.com/Tie-a-Bowline-Knot', source: 'Bing', snippet: 'A step-by-step tutorial' },
    { title: 'Bowline products', url: 'https://www.example.net/bowline', source: 'Bing', snippet: 'listing' },
  ], c);
  assert(ranked[0].url.includes('wikihow'), 'instructional host ranks first for a technique');
  assert(ranked[0].signals.includes('instructional source') || /instructional/i.test(ranked[0].reason), 'reason mentions instructional source');
}
console.log('--- humanizePath ---');
{
  assert(humanizePath('https://dreamorgan.com/models/DreaMorgan.html') === 'Drea Morgan', 'camelCase path becomes a name');
}

console.log('--- dive path selection is not cosmetic ---');
{
  const person = researchPaths('person');
  const all = resolveDivePaths('person', { all: true });
  assert(all.all === true && all.selected.length === person.length, 'ALL selects every path for the type');
  const subset = resolveDivePaths('person', { all: false, paths: ['images', 'videos'] });
  assert(subset.all === false, 'subset is not ALL');
  assert(subset.selected.map(p => p.id).join(',') === 'images,videos', 'backend keeps the selected path ids');
  const productSubset = resolveDivePaths('product', { all: false, paths: ['images', 'videos'] });
  assert(productSubset.selected.some(p => p.id === 'videos'), 'videos path is honored even when the entity type does not list it by default');
  const inferred = inferPathsFromQuestion('Focus on public interviews and videos', person);
  assert(inferred.includes('videos'), 'custom question infers videos path');
  const variants = pathSearchVariants('example subject', subset.selected);
  assert(variants.some(v => /video|youtube/i.test(v.q)), 'selected video path changes search variants');
  assert(youtubeId('https://www.youtube.com/watch?v=dQw4w9wgGcQ') === 'dQw4w9wgGcQ', 'youtube id parsed');
  const rel = parseRelated('RELATED\n- technique: a public form — mentioned on the source page\n- person: someone else — linked from the same site');
  assert(rel.length >= 1 && rel[0].kind === 'technique', 'related entities parsed from writeup');
  assert(!JSON.stringify(variants).toLowerCase().includes('frogtie'), 'path variants are not hardcoded to a test query');
  const personAll = resolveDivePaths('person', { all: true });
  assert(personAll.selected.some(p => p.id === 'evidence'), 'ALL person paths include evidence');
  assert(personAll.selected.some(p => p.id === 'videos'), 'ALL person paths include videos');
  const skillAll = resolveDivePaths('skill', { all: true });
  assert(skillAll.selected.length === researchPaths('skill').length, 'ALL skill selects every skill path');
  const allVariants = pathSearchVariants('example subject', personAll.selected);
  assert(allVariants.length >= 4, 'ALL generates multiple path-specific search variants');
}

console.log('--- contextual visual research ---');
{
  const c = classifyQuery('Alex Rivera interview');
  assert(c.type === 'person', 'person + context still classifies as person');
  assert(c.context && /interview/i.test(c.context), 'remainder is treated as requested context');
  assert(c.relation === 'interview', 'interview relation detected');
  const v = buildSearchVariants('Alex Rivera interview', c);
  assert(v.some(x => /interview/i.test(x.q)), 'variants include the requested context');
  assert(v.some(x => /official|profile|website/i.test(x.q)), 'variants still look for official/profile pages');
  const ranked = rankResults('Alex Rivera interview', [
    { title: 'Alex Rivera plumbing', url: 'https://alexriveraplumbing.example', source: 'Bing', snippet: 'local plumber' },
    { title: 'Alex Rivera interview', url: 'https://news.example/alex-rivera-interview', source: 'Bing', snippet: 'A public interview with Alex Rivera' },
  ], c);
  assert(ranked[0].url.includes('interview'), 'context-matching source ranks above a name-only collision');
  const parsed = parseQueryContext('Alex Rivera red dress', classifyQuery('Alex Rivera red dress'));
  assert(parsed.subject === 'Alex Rivera' && parsed.context === 'red dress', 'clothing context split from the person');
}

console.log('--- expanded research variants ---');
{
  const c = classifyQuery('Alex Rivera');
  const ex = buildExpandedVariants('Alex Rivera', c);
  assert(ex.some(x => /photos|images|gallery/i.test(x.q)), 'expanded variants include image indexes');
  assert(ex.some(x => /youtube|video/i.test(x.q)), 'expanded variants include video indexes');
  assert(ex.some(x => /official|profile|website/i.test(x.q)), 'expanded variants include official pages');
  assert(!JSON.stringify(ex).toLowerCase().includes('riley'), 'expanded variants are not hardcoded to a test person');
}

console.log('--- access states ---');
{
  const pay = classifyAccess({ httpStatus: 200, html: '<html><title>Subscribe to continue</title><body>Subscribe to continue reading this article. Become a member today.</body></html>', url: 'https://news.example/story', host: 'news.example' });
  assert(pay.accessState === 'PAYWALLED', 'paywall language is PAYWALLED');
  assert(pay.status === 'RETRIEVAL_FAILED', 'paywalled content is not marked retrieved');
  assert(/paywall/i.test(accessLabel(pay.accessState)), 'paywall label is explicit');
  const auth = classifyAccess({ httpStatus: 401, html: '', url: 'https://example.com/private', host: 'example.com' });
  assert(auth.accessState === 'AUTHENTICATION_REQUIRED', 'HTTP 401 is authentication required');
  const age = classifyAccess({ httpStatus: 200, html: '<p>You must be 18. Age verification required before viewing.</p>', url: 'https://example.com/gate', host: 'example.com' });
  assert(age.accessState === 'AGE_RESTRICTED', 'age gate detected');
  const ok = classifyAccess({ httpStatus: 200, html: '<html><title>Example Domain</title><body>' + 'This domain is for use in illustrative examples in documents. '.repeat(8) + '</body></html>', url: 'https://example.com/', host: 'example.com' });
  assert(ok.accessState === 'DIRECTLY_RETRIEVED', 'ordinary public page is directly retrieved');
  const priv = classifyAccess({ httpStatus: 200, html: '', url: 'http://127.0.0.1/', host: '127.0.0.1' });
  assert(priv.accessState === 'BLOCKED', 'private host is blocked');
}

console.log('--- no hardcoded test subjects in production worker ---');
{
  const src = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
  assert(!/\bfrogtie\b/i.test(src), 'worker does not hardcode frogtie');
  assert(!/dreamorgan/i.test(src), 'worker does not hardcode the person-search test domain');
  assert(!/\bdrea morgan\b/i.test(src), 'worker does not hardcode Drea Morgan');
  assert(!/\briley reid\b/i.test(src), 'worker does not hardcode Riley Reid');
}

console.log('--- adult content is a research filter, not an entity type ---');
{
  assert(normalizeAdult('ON') === 'on', 'normalizeAdult on');
  assert(normalizeAdult('both') === 'both', 'normalizeAdult both');
  assert(normalizeAdult('') === 'off', 'normalizeAdult default off');
  const q = 'Jordan Hale';
  const off = applyResearchFilter(classifyQuery(q), 'off', q);
  const on = applyResearchFilter(classifyQuery(q), 'on', q);
  const both = applyResearchFilter(classifyQuery(q), 'both', q);
  assert(off.type === 'person' && on.type === 'person' && both.type === 'person', 'adult filter does not change entity type');
  assert(off.adultContent === 'off' && on.adultContent === 'on' && both.adultContent === 'both', 'adultContent persisted on classification');
  assert(on.context === 'adult content', 'adult ON with no extra words implies adult-content context');
  assert(Array.isArray(both.contextLanes) && both.contextLanes.includes('general') && both.contextLanes.includes('adult'), 'BOTH keeps distinguishable lanes');
  const vsOn = adultSemanticVariants('Jordan Hale');
  assert(vsOn.every(v => !/\bJordan Hale adult\b/i.test(v.q)), 'does not blindly append the word adult');
  assert(vsOn.some(v => /performer|photoset|"official site"|models/i.test(v.q)), 'uses adult-industry public semantics');
  const imgOn = imageSearchQuery(q, on);
  assert(!/\badult\b/i.test(imgOn), 'image query does not blindly append adult');
  assert(/photoset|scene|models|gallery/i.test(imgOn), 'adult ON image query is semantic');
}

console.log('--- adult ON ranking is not generic biography ---');
{
  const q = 'Jordan Hale';
  const on = applyResearchFilter(classifyQuery(q), 'on', q);
  const off = applyResearchFilter(classifyQuery(q), 'off', q);
  const both = applyResearchFilter(classifyQuery(q), 'both', q);
  const items = [
    { title: 'Jordan Hale', url: 'https://en.wikipedia.org/wiki/Jordan_Hale', source: 'Bing', snippet: 'American person, biography' },
    { title: 'Jordan Hale - Official Site', url: 'https://jordanhale.example/models/JordanHale', source: 'Bing', snippet: 'photoset performer official site models' },
    { title: 'Jordan Hale - IAFD', url: 'https://www.iafd.com/person.rme/perfid=jordanhale', source: 'Bing', snippet: 'performer filmography' },
  ];
  const rankedOn = rankResults(q, items, on);
  assert(!rankedOn[0].url.includes('wikipedia'), 'adult ON does not rank generic biography first');
  assert(rankedOn[0].url.includes('iafd') || /\/models\//.test(rankedOn[0].url), 'adult ON prefers adult-industry public sources');
  assert(rankedOn[0].contextLane === 'adult', 'top adult-ON result is labeled adult-context');
  const wikiOn = rankedOn.find(r => r.url.includes('wikipedia'));
  const iafdOn = rankedOn.find(r => r.url.includes('iafd'));
  assert(iafdOn && wikiOn && iafdOn.score > wikiOn.score, 'adult-industry source outranks wikipedia when ON');
  const rankedOff = rankResults(q, items, off);
  const wikiOff = rankedOff.find(r => r.url.includes('wikipedia'));
  assert(wikiOff, 'adult OFF still surfaces general biography');
  assert(!wikiOff.signals.includes('generic biography, weak for adult-context research'), 'adult OFF does not penalize encyclopedia as adult-weak');
  const rankedBoth = rankResults(q, items, both);
  assert(rankedBoth.some(r => r.contextLane === 'adult'), 'BOTH keeps adult-context lane');
  assert(rankedBoth.some(r => r.url.includes('wikipedia') || r.contextLane === 'general'), 'BOTH keeps general lane');
  const bothPornSnippet = rankResults(q, [
    { title: 'Jordan Hale', url: 'https://en.wikipedia.org/wiki/Jordan_Hale', source: 'Bing', snippet: 'American pornographic actress' },
    { title: 'Jordan Hale - IAFD', url: 'https://www.iafd.com/person.rme/perfid=jordanhale', source: 'Bing', snippet: 'performer filmography' },
  ], both);
  assert(!bothPornSnippet[0].url.includes('wikipedia'), 'BOTH does not let an encyclopedia beat industry sources just because the bio mentions the profession');
  assert(bothPornSnippet.find(r => r.url.includes('wikipedia'))?.contextLane === 'general', 'encyclopedia stays in the general lane even if the snippet mentions adult work');
  const vOff = buildSearchVariants(q, off);
  const vOn = buildSearchVariants(q, on);
  assert(vOn.some(v => /performer|photoset|official site|models/i.test(v.q)), 'ON expands with adult-industry semantics');
  assert(!vOff.some(v => /photoset/i.test(v.q)), 'OFF does not inject adult-industry variants');
  assert(JSON.stringify(vOn) !== JSON.stringify(vOff), 'ON and OFF produce different variant sets');
}

console.log('--- person + extra context is a different research problem ---');
{
  const raw = 'Jordan Hale bondage';
  const c = applyResearchFilter(classifyQuery(raw), 'on', raw);
  assert(c.type === 'person', 'person + context still classifies as person');
  assert(c.subject === 'Jordan Hale', 'entity is the person');
  assert(/bondage/i.test(c.context), 'bondage is requested context, not discarded');
  const v = buildSearchVariants(raw, c);
  assert(v.some(x => /bondage/i.test(x.q)), 'variants keep the requested context');
  assert(v.some(x => /photoset|performer|scene|gallery/i.test(x.q)), 'adult ON adds industry semantics on top of the extra context');
  const ranked = rankResults(raw, [
    { title: 'Jordan Hale', url: 'https://en.wikipedia.org/wiki/Jordan_Hale', source: 'Bing', snippet: 'biography' },
    { title: 'Jordan Hale bondage photoset', url: 'https://www.babepedia.com/babe/Jordan_Hale', source: 'Bing', snippet: 'bondage photoset performer' },
  ], c);
  assert(ranked[0].url.includes('babepedia'), 'person + bondage ranks contextual adult source above biography');
  assert(/requested context|entity ∩ context|intersection/i.test(ranked[0].reason) || (ranked[0].signals || []).some(s => /context/i.test(s)), 'reason cites the requested context');
}

console.log('--- entity + technical context generalizes ---');
{
  const apple = classifyQuery('Apple repair');
  assert(apple.type === 'product', 'Apple + repair is a product with technical context');
  assert(/repair/i.test(apple.context), 'repair is the context');
  const av = classifyQuery('Lincoln Aviator towing');
  assert(av.type === 'vehicle', 'Lincoln Aviator + towing is a vehicle with technical context');
  assert(av.subject === 'Lincoln Aviator', 'entity is the vehicle');
  assert(/towing/i.test(av.context), 'towing is the context');
  const ranked = rankResults('Lincoln Aviator towing', [
    { title: 'Lincoln Aviator', url: 'https://en.wikipedia.org/wiki/Lincoln_Aviator', source: 'Bing', snippet: 'luxury SUV' },
    { title: 'Lincoln Aviator towing capacity', url: 'https://www.lincoln.com/suvs/aviator/towing/', source: 'Bing', snippet: 'towing payload hitch' },
  ], av);
  assert(ranked[0].url.includes('lincoln.com') || /towing/i.test(ranked[0].title), 'vehicle + towing ranks the contextual source first');
}

console.log('--- ALL still means ALL with adult context ---');
{
  const personAll = resolveDivePaths('person', { all: true });
  assert(personAll.all === true && personAll.selected.length === researchPaths('person').length, 'ALL still selects every person path');
  const onClass = applyResearchFilter(classifyQuery('Jordan Hale'), 'on', 'Jordan Hale');
  const vars = pathSearchVariants('Jordan Hale', personAll.selected, onClass);
  assert(vars.some(v => /photoset|scene|models|gallery/i.test(v.q)), 'ALL + adult ON generates contextual visual variants');
  assert(vars.length >= 4, 'ALL still generates multiple path-specific search variants');
  const subset = resolveDivePaths('person', { all: false, paths: ['images', 'videos'] });
  assert(subset.all === false && subset.selected.length === 2, 'subset is still not ALL');
}

console.log('--- adult ON visual collection rejects generic portraits ---');
{
  const on = applyResearchFilter(classifyQuery('Jordan Hale'), 'on', 'Jordan Hale');
  const imgs = collectDiveImages([], [
    { image: 'https://upload.wikimedia.org/wikipedia/commons/jordan.jpg', url: 'https://en.wikipedia.org/wiki/Jordan_Hale', title: 'Jordan Hale' },
    { image: 'https://www.babepedia.com/content/jordan.jpg', url: 'https://www.babepedia.com/babe/Jordan_Hale', title: 'Jordan Hale photoset' },
  ], on);
  assert(imgs.length >= 1, 'images were collected');
  assert(imgs[0].url.includes('babepedia'), 'adult ON image collection prefers adult-context visuals over wiki portraits');
  assert(/not identity proof/i.test(imgs[0].reason || imgs[0].caption || ''), 'visual likeness is not identity proof');
  assert(isAdultishSource({ url: 'https://www.iafd.com/person.rme/perfid=x', title: 'performer', snippet: '' }), 'industry database is adult-context');
  assert(!isAdultishSource({ url: 'https://en.wikipedia.org/wiki/Jordan_Hale', title: 'Jordan Hale', snippet: 'biography' }), 'wikipedia biography is not adult-context');
  assert(!isAdultishSource({ url: 'https://www.apple.com/store', title: 'Apple Store Online', snippet: 'Shop the latest iPhone models' }), 'product “models” language is not adult-context');
}

console.log('--- discovery lanes are independent, not a keyword dump ---');
{
  const c = applyResearchFilter(classifyQuery('Jordan Hale bondage'), 'on', 'Jordan Hale bondage');
  const graph = discoveryLanes(c, 'contextual');
  assert(graph.lanes.some(l => l.id === 'intersection'), 'has an intersection lane');
  assert(graph.lanes.some(l => l.id === 'identity'), 'has an identity lane');
  const allQs = graph.lanes.flatMap(l => l.queries);
  assert(allQs.some(q => /bondage/i.test(q) && /Jordan Hale/i.test(q)), 'intersection query is entity + context');
  const relatedLanes = graph.lanes.filter(l => /^term-/.test(l.id));
  assert(relatedLanes.length >= 1, 'related terminology is its own lane');
  assert(relatedLanes.every(l => l.queries.length === 1), 'each related term is searched independently');
  assert(!allQs.some(q => /bdsm/i.test(q) && /shibari/i.test(q) && /restraint/i.test(q) && /rope/i.test(q)), 'does not dump every related term into one query');
  const broad = discoveryLanes(c, 'broad');
  const deep = discoveryLanes(c, 'deep');
  assert(deep.lanes.length > broad.lanes.length, 'deep has more lanes than broad');
  assert(normalizeDepth('contextual', applyResearchFilter(classifyQuery('Jordan Hale'), 'off', 'Jordan Hale')) === 'broad', 'contextual with no extra context falls back to broad');
  assert(normalizeDepth('', c) === 'contextual', 'person + extra context defaults to contextual');
  assert(normalizeDepth('deep', c) === 'deep', 'deep is honored');
}

console.log('--- intersection ranking beats name-only ---');
{
  const c = applyResearchFilter(classifyQuery('Jordan Hale bondage'), 'on', 'Jordan Hale bondage');
  const iafdItem = { title: 'Jordan Hale in Rope Session (2014)', url: 'https://www.iafd.com/title.rme/title=ropesession', snippet: 'bondage scene credits performer' };
  const wikiItem = { title: 'Jordan Hale', url: 'https://en.wikipedia.org/wiki/Jordan_Hale', snippet: 'American person, biography' };
  const scoredIafd = scoreResult('Jordan Hale bondage', iafdItem, c);
  const scoredWiki = scoreResult('Jordan Hale bondage', wikiItem, c);
  assert(scoredIafd.intersection === true, 'scoreResult flags entity ∩ context');
  assert(scoredIafd.score > scoredWiki.score, 'intersection page outscores name-only biography');
  const ranked = rankResults('Jordan Hale bondage', [
    wikiItem,
    iafdItem,
    { title: 'Bondage videos', url: 'https://tube.example/bondage', snippet: 'generic bondage index' },
  ], c);
  assert(/iafd|ropesession/i.test(ranked[0].url), 'entity ∩ context production record ranks first');
  assert(ranked[0].intersection === true, 'top result is flagged as intersection');
  const wiki = ranked.find(r => /wikipedia/i.test(r.url));
  assert(!wiki || wiki.score < ranked[0].score, 'name-only biography is below the intersection or filtered');
}

console.log('--- relationship extraction from retrieved text ---');
{
  const c = applyResearchFilter(classifyQuery('Jordan Hale bondage'), 'on', 'Jordan Hale bondage');
  const leads = extractGraphLeads([{
    title: 'Credits',
    url: 'https://example.com/credits',
    textExcerpt: 'Jordan Hale appeared in Rope Session (2014) and the interview "Talking Shop". Also known as.',
    identifiers: { aliases: ['J Hale'], handles: [], profiles: [] },
  }], [], c);
  assert(leads.some(l => /rope session/i.test(l.label)), 'extracts observed production titles');
  assert(leads.some(l => l.kind === 'alias' && /j hale/i.test(l.label)), 'extracts observed aliases');
  assert(!leads.some(l => /jordan hale/i.test(l.label) && l.kind === 'production'), 'does not treat the entity name as a discovered production');
}

console.log('--- ALL is adaptive for entity+context, unchanged without it ---');
{
  const person = researchPaths('person');
  const all = resolveDivePaths('person', { all: true });
  assert(all.all === true && all.selected.length === person.length, 'ALL without extra context still matches the type path set');
  const c = applyResearchFilter(classifyQuery('Jordan Hale bondage'), 'on', 'Jordan Hale bondage');
  const adaptive = resolveDivePaths('person', { all: true }, c);
  assert(adaptive.all === true, 'ALL with active context is still ALL');
  assert(adaptive.selected.some(p => p.id === 'context'), 'ALL with active context includes the requested-context path');
  assert(adaptive.selected.some(p => p.id === 'projects'), 'ALL includes projects/productions');
  assert(adaptive.selected.length > person.length, 'adaptive ALL is larger than the generic type list');
}

console.log('--- no hardcoded differential-test subjects ---');
{
  const src = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
  assert(!/\babella danger\b/i.test(src), 'worker does not hardcode Abella Danger');
  assert(!/\bangela white\b/i.test(src), 'worker does not hardcode Angela White');
}

console.log('--- aggregator index does not beat specific intersection evidence ---');
{
  const raw = 'Jordan Hale bondage';
  const c = applyResearchFilter(classifyQuery(raw), 'on', raw);
  const specific = { title: 'Jordan Hale in Rope Session (2014)', url: 'https://www.iafd.com/title.rme/title=ropesession', snippet: 'bondage scene credits performer' };
  const specialistPage = { title: 'Jordan Hale Electro Torment (2014)', url: 'https://studio.example/jordan-hale-electro-torment', snippet: 'bondage scene photoset performer' };
  const tube = { title: 'Jordan Hale Bondage Porn Videos', url: 'https://www.pornhub.com/video/search?search=jordan+hale+bondage', snippet: 'Watch Jordan Hale bondage porn videos' };
  const eporner = { title: '"Jordan Hale Bondage" Search', url: 'https://www.eporner.com/search/jordan-hale-bondage/', snippet: 'Most relevant porn videos to watch' };
  const wiki = { title: 'Jordan Hale', url: 'https://en.wikipedia.org/wiki/Jordan_Hale', snippet: 'American person, biography' };
  const wrongPerson = { title: 'Morgan Blake in Rope Session (2014)', url: 'https://www.iafd.com/title.rme/title=otherperson', snippet: 'bondage scene credits performer Morgan Blake' };
  const wrongContext = { title: 'Jordan Hale interview on morning radio', url: 'https://news.example/jordan-hale-interview', snippet: 'a public interview about career and projects' };
  const industryProfile = { title: 'Jordan Hale — free sex vids profile', url: 'https://www.freeones.com/jordan-hale', snippet: 'performer filmography' };

  assert(isAggregatorPage(tube) === true, 'tube search URL is an aggregator');
  assert(isAggregatorPage(eporner) === true, 'tube index search is an aggregator');
  assert(isAggregatorPage(specific) === false, 'specialist title record is not an aggregator');
  assert(isAggregatorPage(industryProfile) === false, 'industry profile host is not treated as an aggregator');
  assert(isSpecificEvidence(specific, c) === true, 'IAFD title page is specific evidence');
  assert(isSpecificEvidence(tube, c) === false, 'aggregator is not specific evidence');

  const scoredTube = scoreResult(raw, tube, c);
  const scoredSpecific = scoreResult(raw, specific, c);
  assert(scoredTube.intersection !== true, 'keyword co-occurrence on an index is not verified intersection');
  assert(scoredTube.resultKind === 'AGGREGATOR', 'tube index resultKind is AGGREGATOR');
  assert(scoredSpecific.intersection === true, 'specific production is verified intersection');
  assert(scoredSpecific.resultKind === 'INTERSECTION_MATCH', 'specific production resultKind is INTERSECTION_MATCH');
  assert(scoredSpecific.score > scoredTube.score, 'specific intersection outscores aggregator exact-title overlap');

  const ranked = rankResults(raw, [tube, eporner, wiki, specific, specialistPage, wrongPerson, wrongContext, industryProfile], c);
  assert(ranked.length >= 1, 'contextual ranking returned candidates');
  assert(/iafd|studio\.example/i.test(ranked[0].url), 'specific production/specialist outranks aggregator indexes');
  assert(ranked[0].resultKind === 'INTERSECTION_MATCH', 'top result is Direct contextual evidence internally');
  assert(ranked[0].intersection === true, 'top result keeps intersection flag');
  const tubeR = ranked.find(r => /pornhub|eporner/i.test(r.url));
  const specR = ranked.find(r => /iafd\.com\/title/i.test(r.url));
  assert(specR && (!tubeR || specR.score > tubeR.score), 'IAFD title outranks tube aggregators');
  if (tubeR) {
    assert(tubeR.resultKind === 'AGGREGATOR', 'surviving tube row is labeled AGGREGATOR');
    assert(tubeR.intersection !== true, 'aggregator is not flagged as intersection');
  }
  const wikiR = ranked.find(r => /wikipedia/i.test(r.url));
  assert(!wikiR || wikiR.resultKind === 'GENERIC_BACKGROUND' || wikiR.resultKind === 'ENTITY_MATCH', 'encyclopedia is background/entity, not intersection');
  assert(!wikiR || specR.score > wikiR.score, 'name-only biography stays below true intersection');
  const wrongR = ranked.find(r => /otherperson|Morgan Blake/i.test(r.url + ' ' + r.title));
  assert(!wrongR || specR.score > wrongR.score, 'wrong person + right context ranks below true intersection');
  const interviewR = ranked.find(r => /interview/i.test(r.url));
  assert(!interviewR || specR.score > interviewR.score, 'right person + wrong context ranks below true intersection');
}

console.log('--- keyword overlap is not a relationship ---');
{
  const c = applyResearchFilter(classifyQuery('Jordan Hale bondage'), 'on', 'Jordan Hale bondage');
  const cooccur = { title: 'Jordan Hale Bondage Porn Videos', url: 'https://www.xvideos.com/?k=jordan+hale+bondage', snippet: 'jordan hale bondage videos to watch' };
  const s = scoreResult('Jordan Hale bondage', cooccur, c);
  assert(s.intersection === false, 'a page containing both words is not automatically a relationship');
  assert(s.resultKind === 'AGGREGATOR', 'generic index stays AGGREGATOR');
  const kind = classifyResultKind(cooccur, c, { intersection: false, hasEntity: true, hasContext: true });
  assert(kind === 'AGGREGATOR', 'classifyResultKind does not let aggregators masquerade as INTERSECTION_MATCH');
}

console.log('--- interest lenses stay adaptive ---');
{
  const personL = interestLenses('person', { type: 'person', adultContent: 'off' });
  assert(personL.some(x => x.id === 'everything' && x.label === 'Everything'), 'person has Everything');
  assert(personL.some(x => x.id === 'interviews'), 'person has Interviews');
  assert(personL.some(x => x.id === 'career'), 'person has Career');
  assert(personL.some(x => x.id === 'specific' && x.custom), 'person has Specific context');
  assert(personL.some(x => x.id === 'question' && x.question), 'person has Ask a question');
  const vehicleL = interestLenses('vehicle', { type: 'vehicle', adultContent: 'off' });
  assert(vehicleL.some(x => x.id === 'towing'), 'vehicle has Towing');
  assert(vehicleL.some(x => x.id === 'repair'), 'vehicle has Repair');
  const skillL = interestLenses('skill', { type: 'skill' });
  assert(skillL.some(x => x.id === 'techniques'), 'skill has Techniques');
  assert(skillL.some(x => x.id === 'safety'), 'skill has Safety');
  const productL = interestLenses('product', { type: 'product' });
  assert(productL.some(x => x.id === 'repair'), 'product has Repair');
  const adultL = interestLenses('person', { type: 'person', adultContent: 'on' });
  assert(adultL.some(x => x.id === 'credits'), 'adult ON person includes credits lens');
  assert(!adultL.some(x => /bondage|riley|abella|angela/i.test(x.id + x.label + (x.context || ''))), 'lenses are not hardcoded to a test subject or fetish');
  const offL = interestLenses('person', { type: 'person', adultContent: 'off' });
  assert(!offL.some(x => x.id === 'credits'), 'adult OFF does not inject credits lens');
}

console.log('--- vehicle + towing result kinds still generalize ---');
{
  const av = classifyQuery('Lincoln Aviator towing');
  const ranked = rankResults('Lincoln Aviator towing', [
    { title: 'Lincoln Aviator', url: 'https://en.wikipedia.org/wiki/Lincoln_Aviator', source: 'Bing', snippet: 'luxury SUV' },
    { title: 'Lincoln Aviator towing capacity', url: 'https://www.lincoln.com/suvs/aviator/towing/', source: 'Bing', snippet: 'towing payload hitch' },
    { title: 'Lincoln Aviator Search', url: 'https://www.example.com/search?q=lincoln+aviator+towing', source: 'Bing', snippet: 'search results towing' },
  ], av);
  assert(ranked[0].url.includes('lincoln.com') || /towing/i.test(ranked[0].title), 'vehicle + towing still ranks the contextual source first');
  assert(ranked[0].resultKind === 'INTERSECTION_MATCH' || ranked[0].intersection === true, 'vehicle contextual hit is intersection, not a dump');
  const idx = ranked.find(r => /\/search\?/i.test(r.url));
  assert(!idx || idx.resultKind === 'AGGREGATOR' || idx.score < ranked[0].score, 'generic search index does not beat towing evidence');
}

console.log('--- visual entity match is identification, not identity proof ---');
{
  const c = applyResearchFilter(classifyQuery('Jordan Hale'), 'on', 'Jordan Hale');
  const visual = { title: 'Jordan Hale - Official Site', url: 'https://jordanhale.example/models/JordanHale', snippet: 'photoset performer official site', image: 'https://jordanhale.example/photo.jpg', images: ['https://jordanhale.example/photo.jpg'] };
  const wiki = { title: 'Jordan Hale', url: 'https://en.wikipedia.org/wiki/Jordan_Hale', snippet: 'American person, biography' };
  const tube = { title: 'Jordan Hale Porn Videos', url: 'https://www.pornhub.com/video/search?search=jordan+hale', snippet: 'watch videos' };
  const kindV = classifyResultKind(visual, c, { hasEntity: true, hasVisual: true });
  assert(kindV === 'VISUAL_ENTITY_MATCH', 'person + public image is VISUAL_ENTITY_MATCH');
  const kindW = classifyResultKind(wiki, c, { hasEntity: true, hasVisual: false });
  assert(kindW === 'GENERIC_BACKGROUND' || kindW === 'ENTITY_MATCH', 'encyclopedia is not a visual identity card');
  assert(classifyResultKind(tube, c, { hasEntity: true, hasVisual: false }) === 'AGGREGATOR', 'tube index stays aggregator');
  const ranked = rankResults('Jordan Hale', [wiki, visual, tube], c);
  const vis = ranked.find(r => /jordanhale\.example/.test(r.url));
  const wikiR = ranked.find(r => /wikipedia/i.test(r.url));
  assert(vis && (vis.resultKind === 'VISUAL_ENTITY_MATCH' || vis.resultKind === 'INTERSECTION_MATCH'), 'ranked visual candidate is a visual/entity match, not an index');
  assert(vis && (!wikiR || vis.score >= wikiR.score), 'visual public profile is not below generic biography for adult ON identity');
  const rail = visualCandidatesFor(ranked, c);
  assert(rail.length >= 1 && rail[0].url.includes('jordanhale.example'), 'visual rail leads with the public visual candidate');
  assert(rail.every(r => r.resultKind !== 'AGGREGATOR'), 'visual rail excludes aggregators');
  assert(rail.every(r => !/wikipedia/i.test(r.url || '')), 'visual rail excludes encyclopedia biography hosts');
  const ent = buildSelectedEntity(c, visual, { canonicalName: 'Jordan Hale', aliases: ['J Hale'] }, { originalQuery: 'Jordan Hale', context: '', adultContent: 'on' });
  assert(ent.canonicalName === 'Jordan Hale', 'selected entity uses canonical name, not a page title dump');
  assert(ent.visualLikenessIsNotIdentityProof === true, 'selected entity records that visual likeness is not identity proof');
  assert(ent.originalQuery === 'Jordan Hale', 'selected entity keeps the original query');
}

console.log('--- investigative instruction is not keyword concatenation ---');
{
  const c = applyResearchFilter(classifyQuery('Jordan Hale bondage'), 'on', 'Jordan Hale bondage');
  const ins = parseInvestigativeQuestion('Find interviews where she discusses rope', c);
  assert(ins.intent === 'interviews', 'interview instruction is classified as interviews');
  assert(/rope/i.test(ins.topic), 'topic extracted from the instruction');
  assert(ins.variants.some(v => /interview/i.test(v.q) && /rope/i.test(v.q) && /Jordan Hale/i.test(v.q)), 'variants search entity + topic + interview');
  assert(ins.variants.every(v => !/where she discusses/i.test(v.q)), 'does not concatenate the raw sentence onto a query');
  assert(ins.paths.includes('interviews'), 'instruction infers interviews path');
  const conn = parseInvestigativeQuestion('Find everything connecting this person to studio X', { subject: 'Jordan Hale', type: 'person' });
  assert(conn.intent === 'relationships' || conn.intent === 'directed', 'connection instruction is relationship or directed');
  assert(conn.variants.some(v => /Jordan Hale/i.test(v.q) && /studio X/i.test(v.q)), 'connection variants keep entity and topic');
  assert(conn.variants.every(v => !/find everything connecting/i.test(v.q)), 'does not dump the instruction sentence as the query');
  const src = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
  assert(!/\briley reid\b/i.test(src), 'v45 worker still does not hardcode Riley Reid');
}

console.log('--- selected entity carries context into dive seed ---');
{
  const raw = 'Jordan Hale bondage';
  const c = applyResearchFilter(classifyQuery(raw), 'on', raw);
  const cand = { title: 'Jordan Hale in Rope Session (2014)', url: 'https://www.iafd.com/title.rme/title=ropesession', snippet: 'bondage scene', image: 'https://iafd.example/p.jpg' };
  const ent = buildSelectedEntity(c, cand, { canonicalName: 'Jordan Hale' }, { originalQuery: raw, context: 'bondage', adultContent: 'on', depth: 'contextual' });
  assert(ent.canonicalName === 'Jordan Hale', 'canonical name is the person');
  assert(/bondage/i.test(ent.context), 'bondage context is stored on the selected entity');
  assert(ent.originalQuery === raw, 'original search is stored');
  assert(ent.url.includes('iafd'), 'selected source URL is stored');
  assert(ent.entityId === 'entity:person:jordan hale', 'entity id is type + canonical name, not a URL');
  assert(ent.discoveryEvidence && ent.discoveryEvidence.url.includes('iafd'), 'identifying page is nested as discovery evidence');
  assert(ent.visualLikenessIsNotIdentityProof === true, 'visual likeness is not identity proof on the selected entity');
}

console.log('--- v46 Test A: different-domain discovery is not blocked by Source A ---');
{
  const c = { subject: 'Jordan Hale', type: 'person' };
  const extras = diveExpansionQueries({ classification: c, seed: 'Jordan Hale', evidenceHost: 'source-a.example', customQuestion: '' });
  assert(!extras.some(q => /site:source-a\.example/i.test(q)), 'A: no automatic site: restriction to the identifying host');
  assert(extras.some(q => /Jordan Hale/i.test(q)), 'A: expansion queries are entity-named');
  const queue = diveRetrievalQueue({
    evidenceUrl: 'https://source-a.example/jordan',
    discoveryResults: [
      { url: 'https://source-a.example/gallery', title: 'same-host gallery' },
      { url: 'https://source-b.example/interview', title: 'independent interview' },
      { url: 'https://www.reddit.com/r/example/jordan', title: 'reddit thread' },
    ],
    galleryUrls: ['https://source-a.example/photos/1', 'https://source-a.example/photos/2', 'https://source-a.example/photos/3'],
    retrieveCap: 6,
    adult: 'off',
  });
  assert(queue[0] === 'https://source-a.example/jordan', 'A: identifying URL is provenance, retrieved once');
  assert(queue.includes('https://source-b.example/interview'), 'A: Source B can appear after selecting Source A');
  assert(queue.indexOf('https://source-b.example/interview') < queue.indexOf('https://source-a.example/gallery') || !queue.includes('https://source-a.example/gallery'), 'A: other-domain discovery is queued before same-domain pages');
  const gallerySlots = queue.filter(u => /source-a\.example\/photos/.test(u)).length;
  assert(gallerySlots <= 2, 'A: same-host galleries cannot crowd out other-domain retrieval');
}

console.log('--- v46 Test B: identifying source unavailable still researches the entity ---');
{
  const extras = diveExpansionQueries({ classification: { subject: 'Jordan Hale', type: 'person' }, seed: 'Jordan Hale', evidenceHost: 'source-a.example' });
  assert(extras.some(q => /"Jordan Hale"/i.test(q)), 'B: quoted entity query exists without the identifying page');
  assert(extras.some(q => /reddit/i.test(q)), 'B: independent public-source classes still generate');
  const queue = diveRetrievalQueue({
    evidenceUrl: 'https://source-a.example/missing',
    discoveryResults: [
      { url: 'https://source-b.example/bio' },
      { url: 'https://en.wikipedia.org/wiki/Jordan_Hale' },
    ],
    retrieveCap: 6,
  });
  assert(queue.includes('https://source-b.example/bio'), 'B: unavailable Source A does not prevent other retrievals');
  assert(queue.includes('https://en.wikipedia.org/wiki/Jordan_Hale'), 'B: other public sources remain in the queue');
  const seed = diveSeedQuery({ subject: 'Jordan Hale', type: 'person' }, 'Jordan Hale', 'Jordan Hale', 'https://source-a.example/missing');
  assert(seed === 'Jordan Hale', 'B: seed stays the canonical entity, not the dead URL');
}

console.log('--- v46 Test C: Browse result set is not the universe ---');
{
  const extras = diveExpansionQueries({
    classification: { subject: 'Jordan Hale', type: 'person', context: 'interview' },
    seed: 'Jordan Hale interview',
    evidenceHost: 'source-a.example',
    resolvedAll: true,
  });
  assert(extras.some(q => /reddit/i.test(q)), 'C: reddit lane is generated independently of Browse');
  assert(extras.some(q => /interview/i.test(q)), 'C: context lanes are independent of the Browse result set');
  assert(extras.every(q => !/^https?:\/\//i.test(q)), 'C: expansion queries are searches, not the Browse URL list');
  const src = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
  const diveFn = src.slice(src.indexOf('async function deepDiveHandler'), src.indexOf('async function learnHandler'));
  assert(/runDiscovery\(seed/.test(diveFn), 'C: Deep Dive runs a fresh discovery, not lastResults');
  assert(!/lastResults/.test(diveFn), 'C: dive handler does not reuse the Browse collection as the universe');
}

console.log('--- v46 Test D: provenance survives as discovery evidence ---');
{
  const cand = { title: 'Jordan Hale — Official', url: 'https://source-a.example/j', snippet: 'official page', image: 'https://source-a.example/p.jpg', domain: 'source-a.example', provenance: 'DISCOVERED', reason: 'official-looking domain' };
  const c = { type: 'person', subject: 'Jordan Hale' };
  const ent = buildSelectedEntity(c, cand, { canonicalName: 'Jordan Hale' }, { originalQuery: 'Jordan Hale' });
  assert(ent.discoveryEvidence && ent.discoveryEvidence.url === cand.url, 'D: original Browse source recorded as discovery evidence');
  assert(ent.discoveryEvidence.domain === 'source-a.example', 'D: evidence domain is stored');
  assert(ent.discoveryEvidence.image === cand.image, 'D: identifying image is provenance, not identity');
  assert(ent.sourceRefs.includes(cand.url), 'D: source refs keep the identifying URL');
  const ev = discoveryEvidenceFrom(cand);
  assert(ev.url === cand.url && ev.title === cand.title, 'D: discoveryEvidenceFrom copies URL/title/snippet, not identity');
}

console.log('--- v46 Test E: canonical entity survives source change ---');
{
  const c = { type: 'person', subject: 'Jordan Hale' };
  const a = { title: 'Official', url: 'https://source-a.example/j', domain: 'source-a.example', image: 'https://source-a.example/a.jpg' };
  const b = { title: 'Interview', url: 'https://source-b.example/interview', domain: 'source-b.example', image: 'https://source-b.example/b.jpg' };
  const id = entityIdFor('person', 'Jordan Hale');
  const entA = buildSelectedEntity(c, a, { canonicalName: 'Jordan Hale' }, { originalQuery: 'Jordan Hale' });
  const entB = buildSelectedEntity(c, b, { canonicalName: 'Jordan Hale' }, { originalQuery: 'Jordan Hale', entityId: entA.entityId });
  assert(entA.entityId === id, 'E: entity id is derived from type+name');
  assert(entB.entityId === entA.entityId, 'E: changing discovery source does not change entity id');
  assert(entB.canonicalName === 'Jordan Hale', 'E: canonical name survives source change');
  assert(entB.discoveryEvidence.url === b.url, 'E: new evidence is recorded');
  assert(entA.entityId !== entA.discoveryEvidence.url, 'E: entity id is not the source URL');
  assert(diveSeedQuery(c, 'Jordan Hale', 'Jordan Hale', a.url) === diveSeedQuery(c, 'Jordan Hale', 'Jordan Hale', b.url), 'E: seed query is identical after source swap');
}

console.log('--- v46 Test F: custom question is instruction, not a site restriction ---');
{
  const c = { subject: 'Jordan Hale', type: 'person' };
  const ins = parseInvestigativeQuestion('Find interviews where she discusses rope', c);
  assert(ins.intent === 'interviews', 'F: interview instruction is classified as interviews');
  assert(/rope/i.test(ins.topic), 'F: topic extracted from the instruction');
  assert(ins.variants.every(v => !/site:/i.test(v.q)), 'F: instruction variants do not inherit a site: restriction');
  assert(ins.variants.every(v => !/source-a/i.test(v.q)), 'F: instruction does not mention the Browse host');
  assert(ins.variants.every(v => !/where she discusses/i.test(v.q)), 'F: raw sentence is not concatenated as the query');
  const extras = diveExpansionQueries({
    classification: c,
    seed: 'Jordan Hale',
    instruction: ins,
    customQuestion: 'Find interviews where she discusses rope',
    evidenceHost: 'source-a.example',
  });
  assert(!extras.some(q => /site:source-a/i.test(q)), 'F: custom question does not add identifying-host site:');
  assert(extras.some(q => /interview/i.test(q) && /rope/i.test(q)), 'F: instruction influences query planning');
  assert(userAskedForSourceRestriction('Find interviews where she discusses rope') === false, 'F: plain investigative question is not a source restriction');
  assert(userAskedForSourceRestriction('only on source-a.example') === true, 'F: explicit only-on-domain is a source restriction');
  assert(userAskedForSourceRestriction('site:source-a.example interviews') === true, 'F: explicit site: is a source restriction');
  const gated = diveExpansionQueries({
    classification: c,
    seed: 'Jordan Hale',
    customQuestion: 'only on source-a.example',
    evidenceHost: 'source-a.example',
  });
  assert(gated.some(q => /site:source-a\.example/i.test(q)), 'F: site: is added only when the user asked for it');
  assert(extras.every(q => !/https?:\/\/source-a\.example\/p\.jpg/i.test(q)), 'F: selected image URL is not a search query');
}

console.log('--- v46 Test G: same entity/source split for non-person types ---');
{
  const cases = [
    { type: 'product', name: 'Acme Widget' },
    { type: 'vehicle', name: 'Lincoln Aviator' },
    { type: 'organization', name: 'Lincoln Electric' },
    { type: 'topic', name: 'Cloudflare Workers' },
    { type: 'technique', name: 'bowline knot' },
    { type: 'skill', name: 'welding a steel frame' },
    { type: 'website', name: 'example.com' },
  ];
  for (const row of cases) {
    const extras = diveExpansionQueries({
      classification: { subject: row.name, type: row.type },
      seed: row.name,
      evidenceHost: 'source-a.example',
    });
    assert(!extras.some(q => /site:source-a\.example/i.test(q)), 'G: ' + row.type + ' has no automatic site: to identifying host');
    const id = entityIdFor(row.type, row.name);
    const ent = buildSelectedEntity({ type: row.type, subject: row.name }, { url: 'https://source-a.example/x', title: row.name, domain: 'source-a.example' }, { canonicalName: row.name }, {});
    assert(ent.entityId === id, 'G: ' + row.type + ' entity id is name-based not url-based');
    assert(ent.canonicalName === row.name, 'G: ' + row.type + ' keeps canonical name');
    assert(ent.discoveryEvidence.url === 'https://source-a.example/x', 'G: ' + row.type + ' keeps discovery evidence separate');
    assert(diveSeedQuery({ subject: row.name, type: row.type }, row.name, row.name, 'https://source-a.example/x') === row.name, 'G: ' + row.type + ' seed is the entity, not the identifying URL');
  }
  const src = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
  const extraFn = src.slice(src.indexOf('function diveExpansionQueries'), src.indexOf('function diveRetrievalQueue'));
  assert((extraFn.match(/site:/g) || []).length === 1, 'G: dive expansion has only the explicit-request site: path');
  assert(/userAskedForSourceRestriction\(customQuestion\)/.test(extraFn), 'G: site: identifying host is gated on explicit user request');
  assert(!/\bdrea morgan\b/i.test(src), 'G: worker does not hardcode Drea Morgan');
  assert(!/\bfrogtie\b/i.test(src), 'G: worker does not hardcode Frogtie');
}

console.log('--- v46 dive seed never uses the identifying URL or page title ---');
{
  const c = { subject: 'Jordan Hale', type: 'person', context: 'rope' };
  assert(diveSeedQuery(c, 'Jordan Hale', 'Jordan Hale', 'https://source-a.example/j') === 'Jordan Hale', 'original name query wins over URL fallback');
  assert(diveSeedQuery(c, 'https://source-a.example/j', 'Jordan Hale', 'Page Title | Source A') === 'Jordan Hale rope' || diveSeedQuery(c, 'https://source-a.example/j', 'Jordan Hale', '') === 'Jordan Hale', 'URL original query falls back to canonical name, not page title');
  assert(!/^https?:/i.test(diveSeedQuery(c, 'https://source-a.example/j', 'Jordan Hale', '')), 'seed is never the identifying URL');
}

console.log('--- v47 semantic concept layer (CONCEPT × ENTITY × LENS) ---');
{
  const personRopeOn = applyResearchFilter(classifyQuery('Jordan Hale rope'), 'on', 'Jordan Hale rope');
  assert(/rope/i.test(personRopeOn.context || ''), 'person + rope keeps rope as context');
  const ropeOn = interpretConcept('rope', 'person', 'on');
  assert(ropeOn.family !== 'bondage' && ropeOn.family !== 'restraint', 'rope is not remapped to a bondage family');
  assert(!(ropeOn.related || []).some(x => /bondage|shibari|kinbaku|bdsm/i.test(x)), 'unknown object does not dump adult-practice synonyms');
  assert((ropeOn.interview || []).length >= 1, 'person + adult + concept still plans interview sources');
  assert((ropeOn.media || []).length >= 1, 'person + adult + concept still plans media sources');
  const ropeLanes = discoveryLanes(personRopeOn, 'contextual');
  const ropeIds = ropeLanes.lanes.map(l => l.id);
  assert(ropeIds.includes('intersection'), 'person+rope has an intersection lane');
  assert(ropeIds.includes('identity'), 'person+rope has an identity lane');
  assert(ropeLanes.lanes.length >= 3, 'person+rope adult ON produces multiple independent lanes');
  const ropeQs = ropeLanes.lanes.flatMap(l => l.queries);
  assert(ropeQs.some(q => /rope/i.test(q) && /Jordan Hale/i.test(q)), 'intersection query is entity + rope');
  assert(!ropeQs.some(q => /bdsm/i.test(q) && /shibari/i.test(q) && /bondage/i.test(q)), 'does not dump every related term into one query');
  assert(ropeLanes.lanes.some(l => l.id === 'interviews' || l.id === 'images' || l.id === 'concept-sense' || l.id === 'productions'), 'has interview, media, production, or concept-sense lane');
  assert(ropeLanes.lanes.filter(l => /^term-/.test(l.id) || l.id === 'intersection' || l.id === 'interviews').length >= 2, 'lanes are independent, not one concatenated query');

  const personRopeOff = applyResearchFilter(classifyQuery('Jordan Hale rope'), 'off', 'Jordan Hale rope');
  const ropeOff = interpretConcept('rope', 'person', 'off');
  assert(!(ropeOff.related || []).some(x => /bondage|shibari|photoset|pornstar/i.test(x)), 'adult OFF does not dump adult-industry terms onto rope');
  const offQs = discoveryLanes(personRopeOff, 'contextual').lanes.flatMap(l => l.queries).join(' ');
  assert(!/photoset|pornstar|shibari|kinbaku/i.test(offQs), 'adult OFF person+rope queries are not an adult dump');

  const bondageOn = interpretConcept('bondage', 'person', 'on');
  assert((bondageOn.related || []).length >= 1, 'typed bondage still expands related terminology from the seed pack');
  const bondageLanes = discoveryLanes(applyResearchFilter(classifyQuery('Jordan Hale bondage'), 'on', 'Jordan Hale bondage'), 'contextual');
  assert(bondageLanes.lanes.some(l => l.id === 'intersection'), 'person+bondage intersection lane');
  assert(bondageLanes.lanes.some(l => /^term-/.test(l.id)), 'person+bondage related terminology is its own lane');
  assert(bondageLanes.lanes.some(l => l.id === 'interviews'), 'person+bondage interview lane');

  const photo = interpretConcept('photography', 'person', 'off');
  assert(photo.family === 'visual' || (photo.related || []).some(x => /photo|gallery|image/i.test(x)), 'person + photography is a visual/media concept');
  const interview = interpretConcept('interview', 'person', 'off');
  assert(interview.family === 'interview' || (interview.interview || []).length >= 1, 'person + interview is an interview concept');

  const tow = interpretConcept('towing', 'vehicle', 'off');
  assert(tow.related.some(x => /hitch|payload|capacity/i.test(x)), 'vehicle + towing expands hitch/payload/capacity');
  const towLanes = discoveryLanes(applyResearchFilter(classifyQuery('Lincoln Aviator towing'), 'off', 'Lincoln Aviator towing'), 'contextual');
  assert(towLanes.lanes.some(l => l.id === 'intersection'), 'vehicle+towing intersection');
  const towQs = towLanes.lanes.flatMap(l => l.queries).join(' ');
  assert(/hitch|payload|capacity/i.test(towQs + ' ' + tow.related.join(' ')), 'vehicle towing research includes hitch/payload/capacity');

  const hitchSkill = interpretConcept('hitch', 'skill', 'off');
  assert(hitchSkill.family === 'practice', 'skill + hitch is practice, not vehicle towing');
  assert(hitchSkill.related.some(x => /fabricat|install|procedure|safety|tutorial/i.test(x)), 'skill + hitch expands fabrication/install/safety');
  assert(!hitchSkill.related.some(x => /payload|tow rating/i.test(x)), 'skill + hitch does not inherit the vehicle towing pack');
  const weldClass = applyResearchFilter(classifyQuery('welding a trailer hitch'), 'off', 'welding a trailer hitch');
  const weldLanes = discoveryLanes(weldClass, 'contextual');
  assert(weldClass.type === 'skill', 'welding a trailer hitch classifies as skill');
  assert(!weldLanes.lanes.some(l => /tow-capacity|payload/i.test(l.id)), 'skill+hitch discovery lanes are not vehicle towing terms');
  assert(weldLanes.lanes.some(l => /fabricat|install|procedure|safety|tutorial|intersection|concept-sense/i.test(l.id + (l.queries || []).join(' '))), 'skill+hitch still has practice/intersection lanes');

  const joinery = interpretConcept('joinery', 'skill', 'off');
  assert(joinery.family === 'practice' || joinery.related.some(x => /tutorial|procedure/i.test(x)), 'woodworking joinery is a practice/skill concept');

  const hist = interpretConcept('history', 'topic', 'off');
  assert(hist.family === 'history' || hist.related.some(x => /terminology|overview|timeline/i.test(x)), 'topic + history has context-family related terms');

  const unknown = interpretConcept('zorbith', 'topic', 'off');
  assert(unknown.term === 'zorbith', 'unknown term is still a concept');
  assert(unknown.family === 'open' || unknown.provenance === 'INFERRED', 'unknown term is inferred, not a failure');
  const unknownLanes = discoveryLanes(applyResearchFilter(classifyQuery('Jordan Hale zorbith'), 'off', 'Jordan Hale zorbith'), 'contextual');
  assert(unknownLanes.lanes.length >= 2, 'unknown concept still produces research lanes');
  assert(unknownLanes.lanes.some(l => l.id === 'concept-sense' || l.id === 'intersection'), 'unknown concept still has a sense or intersection lane');
  const histTopic = applyResearchFilter(classifyQuery('zorbith history'), 'off', 'zorbith history');
  assert(/history/i.test(histTopic.context || ''), 'unknown subject + history still splits out the concept');
  const histConcept = interpretRequest(histTopic).concepts;
  assert(histConcept.some(c => /history|zorbith/i.test(c.term)), 'topic + unknown still yields a concept');

  const trans = interpretConcept('transmission', 'vehicle', 'off');
  assert(trans.family === 'documentation' || trans.related.some(x => /spec|manual|capacity|review/i.test(x)), 'vehicle + unknown component still gets documentation lanes');

  const req = interpretRequest({ type: 'person', subject: 'Jordan Hale', context: 'rope', adultContent: 'on', relation: 'context' }, 'Find interviews where she discusses rope');
  assert(req.concepts.some(c => /rope|interview/i.test(c.term)), 'custom question contributes concepts');
  assert(req.instruction && req.instruction.intent, 'custom question is parsed as an instruction, not concatenated');
}

console.log('--- v47 CONCEPT × ENTITY: same term, different lanes ---');
{
  const ropePerson = interpretConcept('rope', 'person', 'on');
  const ropeVehicle = interpretConcept('rope', 'vehicle', 'off');
  const ropeSkill = interpretConcept('rope', 'skill', 'off');
  assert((ropePerson.interview || []).length > (ropeVehicle.interview || []).length, 'person+rope interviews more than vehicle+rope');
  assert(ropeVehicle.sourceTypes.some(s => /manufacturer|spec|review/i.test(s)), 'vehicle+rope uses product/vehicle source types');
  assert(ropeSkill.sourceTypes.some(s => /tutorial|manual/i.test(s)), 'skill+rope uses instructional source types');
}

console.log('--- v47 no hardcoded test subjects; adult ontology is axes not tags ---');
{
  const src = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
  assert(!/\bdrea morgan\b/i.test(src), 'worker does not hardcode Drea Morgan');
  assert(!/\briley reid\b/i.test(src), 'worker does not hardcode Riley Reid');
  assert(!/\babella danger\b/i.test(src), 'worker does not hardcode Abella Danger');
  assert(!/\bangela white\b/i.test(src), 'worker does not hardcode Angela White');
  assert(!/\bfrogtie\b/i.test(src), 'worker does not hardcode Frogtie');
  assert(!/restraint_object/.test(src), 'no special-case restraint_object family');
  assert(/PLATFORM_IA/.test(src), 'adult platform IA is recorded');
  assert(!/pornhub\.com\/categories/.test(src), 'does not copy raw platform category URLs into the engine');
}

console.log('--- v47 source independence still holds ---');
{
  const extras = diveExpansionQueries({
    classification: { subject: 'Jordan Hale', type: 'person', context: 'rope', adultContent: 'on' },
    seed: 'Jordan Hale rope',
    evidenceHost: 'source-a.example',
    customQuestion: 'Find interviews where she discusses rope',
    depth: 'contextual',
  });
  assert(!extras.some(q => /site:source-a\.example/i.test(q)), 'identifying host is not a site: restriction');
  assert(extras.some(q => /interview/i.test(q) && /rope/i.test(q)), 'custom interview+rope instruction influences lanes');
}

console.log('--- v47 fetch budget and staged continue ---');
{
  assert(typeof FETCH_HARD_CAP === 'number' && FETCH_HARD_CAP <= 50 && FETCH_HARD_CAP >= 20, 'hard cap sits under typical Worker subrequest limits');
  resetFetchBudget();
  assert(remainingFetches() === FETCH_HARD_CAP, 'reset restores remaining fetches');
  assert(budgetReport().used === 0 && budgetReport().max === FETCH_HARD_CAP, 'budget report starts at zero');
  const src = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
  assert(/continueFrom/.test(src), 'Deep Dive accepts continueFrom');
  assert(/pendingUrls/.test(src), 'research state keeps pending URLs');
  assert(/Research paused/.test(src), 'honest pause copy exists');
  assert(/Analysis unavailable/.test(readFileSync(new URL('./public/app.js', import.meta.url), 'utf8')) === true, 'analysis-unavailable copy remains only for genuine AI failure');
  const app = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
  assert(/more evidence available to continue/i.test(app), 'UI distinguishes paused research from failed analysis');
  assert(/continueDiveBtn/.test(app), 'Continue research control is wired');
  assert(/continueFrom/.test(app), 'client posts continueFrom on resume');
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
