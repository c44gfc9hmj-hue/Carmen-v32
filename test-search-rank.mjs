import { classifyQuery, scoreResult, buildSearchVariants, buildExpandedVariants, decodeEntities, rankResults, humanizePath, researchPaths, resolveDivePaths, inferPathsFromQuestion, pathSearchVariants, youtubeId, parseRelated, classifyAccess, accessLabel, parseQueryContext } from './worker.js';
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

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
