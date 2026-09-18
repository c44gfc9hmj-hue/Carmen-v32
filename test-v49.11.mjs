// v49.11 exact-source retrieval regression.
// Inspects analyzer state, not merely HTTP 200.
// Fails if the exact URL is lost, sourceId is platform-only, exact fetch is
// skipped, generic search is returned as retrieval, two URLs share an identity,
// or authentication-required content is reported as retrieved.
import { readFileSync } from 'node:fs';
import {
  PLANNER_VERSION,
  PLANNER_BUILD,
  sourceIdFromCanonicalUrl,
  canonicalizeExactSourceUrl,
  identifyExactSourceType,
  parseRedditPermalink,
  parsePremiumProfile,
  exactSourceIdentity,
  parseRedditListing,
  extractOutboundLinks,
  extractEntitiesFromExcerpt,
  createExactSourceSeeds,
  terminalStateForExactSource,
  buildSourceDebug,
  attachExactSourceToInvestigation,
  createInvestigationState,
  isGenericPlatformDiscoveryQuery,
  SOURCE_ANALYSIS_STATES,
} from './investigation-planner.js';
import worker from './worker.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

const appSrc = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
const workerSrc = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
const plannerSrc = readFileSync(new URL('./investigation-planner.js', import.meta.url), 'utf8');

const BELLE = 'https://onlyfans.com/belledelphine';
const REDDIT_A = 'https://www.reddit.com/r/Bondage/comments/abc111/chanta_rose_post_a/';
const REDDIT_B = 'https://www.reddit.com/r/Bondage/comments/xyz999/chanta_rose_post_b/';
const ARTICLE = 'https://example.com/article-with-link';
const CHILD = 'https://example.org/linked-profile';

console.log('--- v49.11 identity is hash(canonicalURL), not platform ---');
{
  const a = sourceIdFromCanonicalUrl(REDDIT_A);
  const b = sourceIdFromCanonicalUrl(REDDIT_B);
  const belle = sourceIdFromCanonicalUrl(BELLE);
  const otherOf = sourceIdFromCanonicalUrl('https://onlyfans.com/rileyreid');
  assert(a && a.startsWith('src_'), 'sourceId prefix');
  assert(a !== b, 'two Reddit posts have different sourceIds');
  assert(belle !== otherOf, 'two OnlyFans profiles have different sourceIds');
  assert(sourceIdFromCanonicalUrl(REDDIT_A) === sourceIdFromCanonicalUrl('https://reddit.com/r/Bondage/comments/abc111/chanta_rose_post_a'), 'canonical www/no-www same id');
  assert(canonicalizeExactSourceUrl(BELLE).includes('belledelphine'), 'OnlyFans handle preserved');
  assert(canonicalizeExactSourceUrl(REDDIT_A).includes('abc111'), 'Reddit post id preserved');
  assert(!canonicalizeExactSourceUrl(REDDIT_A).includes('utm_'), 'tracking stripped without destroying id');
  const ident = exactSourceIdentity(BELLE, { subject: 'Belle Delphine' });
  assert(ident.platform === 'OnlyFans' && ident.handle === 'belledelphine', 'Belle identity remains Belle / OnlyFans / handle');
  assert(ident.canonicalUrl === 'https://onlyfans.com/belledelphine', 'exact OF URL preserved');
  assert(ident.sourceType === 'onlyfans-profile', 'source type is profile-specific');
  const rp = parseRedditPermalink(REDDIT_A);
  assert(rp.isPost && rp.postId === 'abc111' && rp.subreddit === 'Bondage', 'reddit permalink parsed');
  assert(identifyExactSourceType(REDDIT_A) === 'reddit-post', 'reddit-post type');
  assert(identifyExactSourceType('https://www.reddit.com/search/?q=chanta') === 'reddit-search', 'search page is not a post');
  assert(isGenericPlatformDiscoveryQuery('OnlyFans') === true, 'bare OnlyFans is generic');
  assert(isGenericPlatformDiscoveryQuery(BELLE) === false, 'exact OF URL is not generic');
}

console.log('--- Reddit listing parse is post-specific ---');
{
  const json = [
    { kind: 'Listing', data: { children: [{ kind: 't3', data: {
      id: 'abc111', title: 'Chanta Rose post A', selftext: 'Body A with https://example.org/linked-profile',
      author: 'chanta', subreddit: 'Bondage', subreddit_name_prefixed: 'r/Bondage',
      permalink: '/r/Bondage/comments/abc111/chanta_rose_post_a/', created_utc: 1700000000, score: 42,
    } }] } },
    { kind: 'Listing', data: { children: [{ kind: 't1', data: { author: 'user1', body: 'comment one', score: 3, created_utc: 1700000100 } }] } },
  ];
  const listing = parseRedditListing(json, REDDIT_A);
  assert(listing.ok && listing.post.id === 'abc111', 'parsed post id');
  assert(listing.post.author === 'chanta' && listing.post.subreddit === 'r/Bondage', 'author/subreddit');
  assert(listing.comments.length === 1 && /comment one/.test(listing.comments[0].body), 'comments extracted');
  assert(listing.outboundLinks.some(l => /example\.org\/linked-profile/.test(l.url)), 'outbound link extracted');
}

console.log('--- auth-required is not retrieved ---');
{
  const t = terminalStateForExactSource({
    fetchAttempted: true, fetchSucceeded: false, publicContentRetrieved: true,
    authRequired: true, accessState: 'AUTHENTICATION_REQUIRED', parsed: true,
  });
  assert(t === 'AUTHENTICATION_REQUIRED', 'auth wall is AUTHENTICATION_REQUIRED');
  const failed = terminalStateForExactSource({
    fetchAttempted: true, fetchSucceeded: false, publicContentRetrieved: false, error: 'HTTP 403', accessState: 'BLOCKED',
  });
  assert(failed === 'NOT_PUBLICLY_RETRIEVABLE' || failed === 'FETCH_FAILED', 'failed fetch is not ANALYZED');
  const debug = buildSourceDebug({
    canonicalUrl: BELLE, fetchAttempted: true, fetchSucceeded: false,
    authRequired: true, publicContentRetrieved: true, terminalState: 'AUTHENTICATION_REQUIRED',
    genericSearchUsedAsRetrieval: false,
  });
  assert(debug.fetchSucceeded === false, 'debug fetchSucceeded false on auth');
  assert(debug.genericSearchUsedAsRetrieval === false, 'debug does not claim generic search as retrieval');
}

console.log('--- seeds attach to parent investigation ---');
{
  const ident = exactSourceIdentity(REDDIT_A, { subject: 'Chanta Rose' });
  const seeds = createExactSourceSeeds({
    links: extractOutboundLinks('see https://example.org/linked-profile', REDDIT_A),
    entities: extractEntitiesFromExcerpt('Chanta Rose on Reddit', { subject: 'Chanta Rose' }),
    topics: ['bondage'],
  }, ident);
  assert(seeds.some(s => /example\.org/.test(s.url || '')), 'outbound URL becomes a seed');
  assert(seeds.every(s => s.parent === ident.canonicalUrl), 'seeds record parent exact URL');
  const state = attachExactSourceToInvestigation(createInvestigationState({ subject: 'Chanta Rose' }), {
    debug: { canonicalUrl: ident.canonicalUrl, sourceId: ident.sourceId },
    identity: ident,
    canonicalUrl: ident.canonicalUrl,
    seeds,
  });
  assert((state.discoveredSeeds || []).length >= 1, 'parent investigation received seeds');
  assert((state.sourceAnalyses || []).length >= 1, 'source analysis recorded on parent');
}

console.log('--- Worker wires exact-source pipeline ---');
{
  assert(/async function analyzeExactSource/.test(workerSrc), 'analyzeExactSource exists');
  assert(/async function retrieveExactSource/.test(workerSrc), 'retrieveExactSource exists');
  assert(/retrieveExactReddit/.test(workerSrc), 'reddit exact retrieval');
  assert(/genericSearchUsedAsRetrieval/.test(workerSrc), 'generic-search-as-retrieval flag');
  assert(/Exact Reddit post could not be publicly retrieved/.test(workerSrc), 'honest reddit failure copy');
  assert(/v49\.11-exact-source-retrieval/.test(workerSrc), 'health feature flag');
  assert(/SOURCE_ANALYSIS_STATES/.test(plannerSrc), 'state machine exported');
  SOURCE_ANALYSIS_STATES.forEach(s => assert(!!s, 'state ' + s));
  assert(/Analyzing exact source/.test(appSrc), 'UI progressive exact-source copy');
  assert(/Why did Carmen stop\?/.test(appSrc), 'Why did Carmen stop surface');
  assert(/What Carmen actually retrieved/.test(appSrc), 'What Carmen actually retrieved surface');
  assert(/data-testid="result-analyze"/.test(appSrc) && !/onlyfans\|fansly[\s\S]{0,80}result-analyze/.test(appSrc.replace(/[\s\S]*result-analyze/, 'result-analyze')), 'Analyze is not premium-only');
}

console.log('--- /analyze exact OnlyFans URL (Q) ---');
{
  const fetched = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    fetched.push(u);
    if (/html\.duckduckgo|lite\.duckduckgo|bing\.com\/search|google\.com\/search|reddit\.com\/search/i.test(u)) {
      return new Response('<html><title>generic onlyfans search</title><a class="result__a" href="https://onlyfans.com/">OnlyFans</a></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (/onlyfans\.com\/belledelphine/i.test(u)) {
      return new Response('<html><head><title>Belle Delphine</title><meta name="description" content="Belle Delphine public profile"><meta property="og:title" content="Belle Delphine"><meta property="og:description" content="Public creator profile"></head><body>Sign in to continue. Log in to view this creator. Subscribe to unlock.</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('<html><title>other</title></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  try {
    const res = await worker.fetch(new Request('https://test/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: BELLE, title: 'Belle Delphine', subject: 'Belle Delphine', kind: 'webpage' }),
    }), {});
    const body = await res.json();
    assert(res.status === 200, 'Q Analyze 200');
    assert(body.canonicalUrl === 'https://onlyfans.com/belledelphine' || (body.identity && body.identity.canonicalUrl === 'https://onlyfans.com/belledelphine'), 'Q exact URL preserved');
    assert(body.sourceId && body.sourceId === sourceIdFromCanonicalUrl(BELLE), 'Q sourceId is hash of canonical URL');
    assert((body.identity && body.identity.handle) === 'belledelphine', 'Q handle remains belledelphine');
    assert((body.identity && body.identity.platform) === 'OnlyFans', 'Q platform remains OnlyFans');
    assert(body.fetchAttempted === true || (body.debug && body.debug.fetchAttempted), 'Q exact fetch attempted');
    assert(body.genericSearchUsedAsRetrieval !== true, 'Q generic search is not retrieval');
    assert(!/generic onlyfans search/i.test(JSON.stringify(body.sourceFacts || [])), 'Q facts are not generic OF search');
    const fetchedExact = fetched.some(u => /onlyfans\.com\/belledelphine/i.test(u));
    const fetchedGenericSearch = fetched.some(u => /html\.duckduckgo|bing\.com\/search/i.test(u) && /onlyfans/i.test(u) && !/onlyfans\.com\/belledelphine/i.test(u));
    assert(fetchedExact, 'Q worker fetched the exact OnlyFans URL');
    assert(!fetchedGenericSearch || body.genericSearchUsedAsRetrieval !== true, 'Q did not use generic OF search as the source retrieval');
    assert(body.authRequired === true || body.terminalState === 'AUTHENTICATION_REQUIRED' || /AUTHENTICATION_REQUIRED/i.test(body.terminalState || ''), 'Q auth boundary reported');
    assert(!(body.fetchSucceeded === true && body.authRequired === true && !(body.publicContentRetrieved)), 'Q does not claim subscriber content retrieved');
    assert(body.terminalState !== 'ANALYZED' || body.authRequired === true, 'Q does not mark fully analyzed while hiding the auth wall');
    assert((body.identity && body.identity.handle) === 'belledelphine' && !/^(onlyfans)$/i.test(body.title || ''), 'Q identity is not collapsed to platform name');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('--- /analyze generic OnlyFans homepage is NOT profile retrieval ---');
{
  const fetched = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    fetched.push(u);
    if (/html\.duckduckgo|lite\.duckduckgo|bing\.com\/search|reddit\.com\/search/i.test(u)) {
      return new Response('<html><title>generic onlyfans search</title><a class="result__a" href="https://onlyfans.com/">OnlyFans</a></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (/onlyfans\.com\/belledelphine/i.test(u) && !/web\.archive/i.test(u)) {
      return new Response('<!DOCTYPE html><html lang=en><head><title>OnlyFans</title><meta name=description content=OnlyFans><meta property=og:title content=OnlyFans><meta property=og:url content=https://onlyfans.com><meta property=og:description content="OnlyFans is the social platform revolutionizing creator and fan connections."></head><body>' + 'Public landing. '.repeat(80) + '</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('<html><title>other</title></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  try {
    const res = await worker.fetch(new Request('https://test/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: BELLE, title: 'Belle Delphine', subject: 'Belle Delphine', kind: 'webpage' }),
    }), {});
    const body = await res.json();
    assert(res.status === 200, 'Q-home Analyze 200');
    assert((body.identity && body.identity.handle) === 'belledelphine', 'Q-home handle remains belledelphine');
    assert(/onlyfans\.com\/belledelphine/i.test(body.canonicalUrl || ''), 'Q-home exact URL preserved');
    assert(body.fetchSucceeded !== true, 'Q-home generic landing page is not a successful profile retrieval');
    assert(body.genericSearchUsedAsRetrieval !== true, 'Q-home did not substitute generic search');
    assert(body.authRequired === true || body.terminalState === 'AUTHENTICATION_REQUIRED', 'Q-home reports AUTHENTICATION_REQUIRED');
    assert(!fetched.some(u => /html\.duckduckgo|bing\.com\/search/i.test(u)), 'Q-home did not run DDG/Bing as retrieval');
    const blob = JSON.stringify(body.sourceFacts || []) + (body.title || '') + JSON.stringify(body.observations || []);
    assert(!/social platform revolutionizing/i.test(blob), 'Q-home does not present generic OF marketing copy as Belle\'s profile');
    assert(/Belle Delphine|belledelphine/i.test(body.title || (body.identity && body.identity.displayName) || ''), 'Q-home title stays Belle/handle');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('--- /analyze exact Reddit permalink (R) ---');
{
  const fetched = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    fetched.push(u);
    if (/\/comments\/abc111/i.test(u) && /\.json/i.test(u)) {
      return new Response(JSON.stringify([
        { kind: 'Listing', data: { children: [{ kind: 't3', data: {
          id: 'abc111', title: 'Chanta Rose post A', selftext: 'Unique body for post A. https://example.org/linked-profile',
          author: 'chantarose', subreddit: 'Bondage', subreddit_name_prefixed: 'r/Bondage',
          permalink: '/r/Bondage/comments/abc111/chanta_rose_post_a/', created_utc: 1700000000, score: 11,
        } }] } },
        { kind: 'Listing', data: { children: [{ kind: 't1', data: { author: 'c1', body: 'first comment', score: 1 } }] } },
      ]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (/\/comments\/xyz999/i.test(u) && /\.json/i.test(u)) {
      return new Response(JSON.stringify([
        { kind: 'Listing', data: { children: [{ kind: 't3', data: {
          id: 'xyz999', title: 'Chanta Rose post B', selftext: 'Completely different body for post B.',
          author: 'otheruser', subreddit: 'Bondage', subreddit_name_prefixed: 'r/Bondage',
          permalink: '/r/Bondage/comments/xyz999/chanta_rose_post_b/', created_utc: 1700001000, score: 3,
        } }] } },
        { kind: 'Listing', data: { children: [] } },
      ]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (/html\.duckduckgo|bing\.com\/search|reddit\.com\/search/i.test(u)) {
      return new Response('<html><title>Reddit public search</title><a class="result__a" href="https://www.reddit.com/search/?q=chanta">Reddit search</a></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  };
  try {
    const a = await worker.fetch(new Request('https://test/analyze', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: REDDIT_A, title: 'Chanta Rose post A', subject: 'Chanta Rose', kind: 'reddit' }),
    }), {});
    const aBody = await a.json();
    const b = await worker.fetch(new Request('https://test/analyze', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: REDDIT_B, title: 'Chanta Rose post B', subject: 'Chanta Rose', kind: 'reddit' }),
    }), {});
    const bBody = await b.json();
    assert(a.status === 200 && b.status === 200, 'R Analyze 200');
    assert(aBody.sourceId !== bBody.sourceId, 'R two posts have different sourceIds');
    assert(/abc111/.test(aBody.canonicalUrl || '') && /xyz999/.test(bBody.canonicalUrl || ''), 'R permalinks preserved');
    assert(aBody.reddit && aBody.reddit.postId === 'abc111', 'R post id A');
    assert(bBody.reddit && bBody.reddit.postId === 'xyz999', 'R post id B');
    assert(aBody.fetchAttempted === true, 'R exact fetch attempted');
    assert(fetched.some(u => /abc111/.test(u)), 'R fetched post A URL/json');
    assert(fetched.some(u => /xyz999/.test(u)), 'R fetched post B URL/json');
    assert(aBody.genericSearchUsedAsRetrieval !== true, 'R generic reddit search is not retrieval');
    assert(!/Reddit public search/i.test(JSON.stringify(aBody.sourceFacts || [])), 'R facts are not generic reddit search');
    if (aBody.fetchSucceeded) {
      assert(/Unique body for post A/.test(JSON.stringify(aBody)), 'R post A body retrieved');
      assert(aBody.reddit.author === 'chantarose', 'R author extracted');
      assert(aBody.reddit.postContentRetrieved === 'YES', 'R post content retrieved');
    }
    assert(JSON.stringify(aBody.reddit) !== JSON.stringify(bBody.reddit), 'R analyses are post-specific');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('--- failed exact fetch is not masked by search ---');
{
  const fetched = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    if (/html\.duckduckgo|bing\.com\/search/i.test(String(url))) {
      return new Response('<html><title>generic reddit search</title><a class="result__a" href="https://www.reddit.com/r/all/">Reddit</a></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('blocked', { status: 403, headers: { 'content-type': 'text/plain' } });
  };
  try {
    const res = await worker.fetch(new Request('https://test/analyze', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: REDDIT_A, title: 'Chanta Rose', kind: 'reddit' }),
    }), {});
    const body = await res.json();
    assert(body.fetchSucceeded !== true, 'failed fetch is not success');
    assert(body.genericSearchUsedAsRetrieval !== true, 'search did not mask failure');
    assert(/FETCH_FAILED|NOT_PUBLICLY_RETRIEVABLE|PROVIDER_UNAVAILABLE/.test(body.terminalState || ''), 'terminal is a failure state');
    assert(body.terminalState !== 'AUTHENTICATION_REQUIRED', 'reddit miss is not an OnlyFans auth wall');
    assert(/could not be publicly retrieved|not publicly retrievable|FETCH_FAILED/i.test(JSON.stringify(body.unknowns || []) + (body.whatCarmenActuallyRetrieved || '') + (body.whyDidCarmenStop || '')), 'honest failure copy');
    assert(!(body.publicReferences && body.publicReferences.length && body.fetchSucceeded), 'search hits are not claimed as retrieved source');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('--- source → source chain (S) ---');
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (/example\.com\/article-with-link/i.test(u)) {
      return new Response('<html><title>Source A</title><body>Article about Chanta Rose linking to <a href="https://example.org/linked-profile">linked profile</a> https://example.org/linked-profile</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (/example\.org\/linked-profile/i.test(u)) {
      return new Response('<html><title>Source B profile</title><body>This is the linked public profile of Chanta Rose, unique to B.</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('no', { status: 404 });
  };
  try {
    const res = await worker.fetch(new Request('https://test/analyze', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: ARTICLE, title: 'Source A', subject: 'Chanta Rose', kind: 'webpage' }),
    }), {});
    const body = await res.json();
    assert(res.status === 200, 'S Analyze 200');
    assert(body.fetchSucceeded === true, 'S source A retrieved');
    assert((body.links || []).some(l => /example\.org\/linked-profile/.test(l.url || l.canonicalUrl || '')), 'S extracted outbound URL');
    assert((body.seeds || []).some(s => /example\.org\/linked-profile/.test(s.url || '')), 'S seed created for B');
    const child = (body.chainedSources || []).find(s => /example\.org/.test(s.url || ''));
    assert(child, 'S chained source B present');
    assert(child.parent === body.canonicalUrl || child.parentSourceId === body.sourceId, 'S B parent is A');
    assert(child.sourceId !== body.sourceId, 'S A and B have different sourceIds');
    if (child.fetchSucceeded) assert(/unique to B|linked public profile/i.test(child.excerpt || child.title || ''), 'S B-specific retrieval');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('--- Pullpush archive of the exact post ID is retrieval, not generic search ---');
{
  const fetched = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    fetched.push(u);
    if (/api\.pullpush\.io\/reddit\/search\/submission\/\?ids=abc111/i.test(u)) {
      return new Response(JSON.stringify({
        data: [{
          id: 'abc111',
          title: 'Chanta Rose post A',
          selftext: 'Unique body for post A. https://example.org/linked-profile',
          author: 'chantarose',
          subreddit: 'Bondage',
          permalink: '/r/Bondage/comments/abc111/chanta_rose_post_a/',
          url: 'https://i.redd.it/abc111image.jpeg',
          url_overridden_by_dest: 'https://i.redd.it/abc111image.jpeg',
          created_utc: 1700000000,
          score: 11,
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (/html\.duckduckgo|bing\.com\/search|reddit\.com\/search/i.test(u)) {
      return new Response('<html><title>Reddit public search</title><a class="result__a" href="https://www.reddit.com/r/all/">Reddit</a></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('blocked', { status: 403, headers: { 'content-type': 'text/plain' } });
  };
  try {
    const res = await worker.fetch(new Request('https://test/analyze', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: REDDIT_A, title: 'Chanta Rose post A', subject: 'Chanta Rose', kind: 'reddit' }),
    }), {});
    const body = await res.json();
    assert(res.status === 200, 'Pullpush Analyze 200');
    assert(fetched.some(u => /api\.pullpush\.io.*ids=abc111/i.test(u)), 'Pullpush fetched by exact post id');
    assert(body.fetchSucceeded === true, 'Pullpush counts as exact-source retrieval');
    assert(body.reddit && body.reddit.postId === 'abc111', 'Pullpush preserves post id');
    assert(body.reddit.author === 'chantarose', 'Pullpush author extracted');
    assert(body.reddit.postContentRetrieved === 'YES', 'Pullpush post content retrieved');
    assert(/Unique body for post A/.test(JSON.stringify(body)), 'Pullpush body retrieved');
    assert((body.media || []).some(m => /i\.redd\.it\/abc111image/.test(m)), 'Pullpush media extracted');
    assert(body.genericSearchUsedAsRetrieval !== true, 'Pullpush is not generic search');
    assert(body.retrievalPath === 'pullpush' || (body.debug && body.debug.retrievalPath === 'pullpush'), 'retrievalPath pullpush');
    assert(!/^(reddit)$/i.test(String((body.reddit && body.reddit.title) || '').trim()), 'title is the post, not Reddit');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('--- Public frontend OG of the exact permalink is retrieval when archives are blocked ---');
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (/redlib\.privacyredirect\.com\/r\/Bondage\/comments\/abc111/i.test(u)) {
      return new Response('<!doctype html><html><head><title>Making sure you\'re not a bot!</title><meta property="author" content="u/chantarose"><meta property="twitter:url" content="/r/Bondage/comments/abc111/chanta_rose_post_a/"><meta property="og:title" content="Chanta Rose post A - r/Bondage"><meta property="og:url" content="/r/Bondage/comments/abc111/chanta_rose_post_a/"><meta property="og:image" content="/thumb/b/abc111.jpg"></head><body>abc111</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (/html\.duckduckgo|bing\.com\/search/i.test(u)) {
      return new Response('<html><title>Reddit public search</title><a class="result__a" href="https://www.reddit.com/search/?q=chanta">Reddit search</a></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('blocked', { status: 403, headers: { 'content-type': 'text/plain' } });
  };
  try {
    const res = await worker.fetch(new Request('https://test/analyze', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: REDDIT_A, title: 'Chanta Rose post A', subject: 'Chanta Rose', kind: 'reddit' }),
    }), {});
    const body = await res.json();
    assert(body.fetchSucceeded === true, 'frontend OG of the exact post is retrieval');
    assert(body.reddit && body.reddit.postId === 'abc111', 'frontend preserves post id');
    assert(body.reddit.author === 'chantarose', 'frontend author from public metadata');
    assert(body.reddit.postContentRetrieved === 'YES', 'frontend post content retrieved');
    assert(/Chanta Rose post A/i.test(body.reddit.title || body.title || ''), 'frontend title is the post');
    assert(body.genericSearchUsedAsRetrieval !== true, 'frontend is not generic search');
    assert(body.terminalState !== 'AUTHENTICATION_REQUIRED', 'reddit miss is not an OnlyFans auth wall');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('--- health 49.11 ---');
{
  const res = await worker.fetch(new Request('https://test/health'), {});
  const body = await res.json();
  assert(body.version === '49.14' || body.version === '49.13' || body.version === '49.12' || body.version === '49.11', 'health version current');
  assert(body.build === '49.14-person-image-results' || body.build === '49.13-investigation-actions' || body.build === '49.12-investigation-workflow' || body.build === '49.11-exact-source-retrieval', 'health build');
  assert((body.features || []).includes('v49.11-exact-source-retrieval'), 'feature exact-source');
  assert((body.features || []).includes('v49.9-identity-verification'), 'v49.9 flags retained');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
