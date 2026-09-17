// Live production exact-source tests Q / R / S.
const ORIGIN = process.env.CARMEN_API_ORIGIN || process.env.CARMEN_ORIGIN || 'https://carmen-iphone-v25.94bwfd5grv.workers.dev';
const BELLE = process.env.CARMEN_Q_URL || 'https://onlyfans.com/belledelphine';
const REDDIT = process.env.CARMEN_R_URL || 'https://www.reddit.com/r/Bondage/comments/1afxb3z/chanta_rose/';
const ARTICLE = process.env.CARMEN_S_URL || 'https://example.com/';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

async function analyze(url, extra = {}) {
  const r = await fetch(ORIGIN + '/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ url, pageUrl: url, kind: extra.kind || 'webpage', subject: extra.subject || '', title: extra.title || '', exactSource: true }),
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { error: text }; }
  return { status: r.status, body };
}

console.log('live origin', ORIGIN);

const health = await fetch(ORIGIN + '/health').then(r => r.json());
assert(health.version === '49.11' || /49\.11/.test(health.build || ''), 'production Worker is 49.11');
assert((health.features || []).includes('v49.11-exact-source-retrieval'), 'exact-source feature on Worker');

console.log('--- Q Belle Delphine OnlyFans ---');
{
  const { status, body } = await analyze(BELLE, { subject: 'Belle Delphine', title: 'Belle Delphine' });
  console.log('Q', JSON.stringify({
    status,
    canonicalUrl: body.canonicalUrl || (body.identity && body.identity.canonicalUrl),
    sourceId: body.sourceId,
    sourceType: body.sourceType || (body.identity && body.identity.sourceType),
    fetchAttempted: body.fetchAttempted,
    fetchSucceeded: body.fetchSucceeded,
    publicContentRetrieved: body.publicContentRetrieved,
    authRequired: body.authRequired,
    terminalState: body.terminalState,
    genericSearchUsedAsRetrieval: body.genericSearchUsedAsRetrieval,
    seeds: (body.seeds || []).length,
    handle: body.identity && body.identity.handle,
  }));
  assert(status === 200, 'Q 200');
  assert(/onlyfans\.com\/belledelphine/i.test(body.canonicalUrl || (body.identity && body.identity.canonicalUrl) || ''), 'Q exact URL preserved');
  assert((body.identity && body.identity.handle) === 'belledelphine', 'Q handle remains belledelphine');
  assert(!/^(onlyfans)$/i.test(String(body.title || '').trim()), 'Q not collapsed to platform name OnlyFans');
  assert(body.fetchAttempted === true, 'Q fetch attempted');
  assert(body.genericSearchUsedAsRetrieval !== true, 'Q not generic OF discovery');
  assert(body.authRequired === true || body.terminalState === 'AUTHENTICATION_REQUIRED' || body.publicContentRetrieved === true, 'Q public metadata or auth boundary');
  assert(!(body.fetchSucceeded === true && /^(onlyfans)$/i.test(String(body.title || '').trim())), 'Q did not treat generic OF homepage as the profile');
}

console.log('--- R Chanta Rose Reddit ---');
{
  const { status, body } = await analyze(REDDIT, { subject: 'Chanta Rose', kind: 'reddit', title: 'Chanta Rose' });
  console.log('R', JSON.stringify({
    status,
    canonicalUrl: body.canonicalUrl,
    sourceId: body.sourceId,
    postId: body.reddit && body.reddit.postId,
    subreddit: body.reddit && body.reddit.subreddit,
    author: body.reddit && body.reddit.author,
    fetchAttempted: body.fetchAttempted,
    fetchSucceeded: body.fetchSucceeded,
    postContentRetrieved: body.reddit && body.reddit.postContentRetrieved,
    terminalState: body.terminalState,
    genericSearchUsedAsRetrieval: body.genericSearchUsedAsRetrieval,
    retrievalPath: body.retrievalPath || (body.debug && body.debug.retrievalPath),
    attempts: (body.retrievalAttempts || (body.debug && body.debug.retrievalAttempts) || []).map(a => ({ label: a.label, status: a.status, error: a.error, note: a.note })),
    what: body.whatCarmenActuallyRetrieved,
  }));
  assert(status === 200, 'R 200');
  assert(/reddit\.com/i.test(body.canonicalUrl || ''), 'R permalink preserved');
  assert(/1afxb3z/i.test(body.canonicalUrl || '') || (body.reddit && body.reddit.postId === '1afxb3z'), 'R post id preserved');
  assert(body.fetchAttempted === true, 'R fetch attempted');
  assert(body.genericSearchUsedAsRetrieval !== true, 'R not generic Reddit discovery');
  assert((body.identity && body.identity.handle) !== 'r', 'R handle is not the /r/ path segment');
  if (body.fetchSucceeded) {
    assert(body.reddit && body.reddit.postContentRetrieved === 'YES', 'R post content retrieved');
    assert(!/^(reddit)$/i.test(String((body.reddit && body.reddit.title) || (body.retrieved && body.retrieved.title) || '').trim()), 'R is the post, not the Reddit shell');
  } else {
    assert(/could not be publicly retrieved|FETCH_FAILED|NOT_PUBLICLY_RETRIEVABLE/i.test(JSON.stringify(body.unknowns || []) + (body.whatCarmenActuallyRetrieved || '') + (body.terminalState || '')), 'R honest failure');
  }
}

console.log('--- S Source → Source ---');
{
  const { status, body } = await analyze(ARTICLE, { subject: 'Example', title: 'Example Domain' });
  console.log('S', JSON.stringify({
    status,
    canonicalUrl: body.canonicalUrl,
    fetchSucceeded: body.fetchSucceeded,
    links: (body.links || []).length,
    seeds: (body.seeds || []).length,
    chained: (body.chainedSources || []).map(s => ({ url: s.url, fetchSucceeded: s.fetchSucceeded, parent: s.parent })),
    parentReceivedSeeds: body.parentReceivedSeeds || ((body.seeds || []).length > 0),
  }));
  assert(status === 200, 'S 200');
  assert(body.fetchAttempted === true, 'S fetch attempted');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
