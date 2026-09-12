// Carmen — canonical Cloudflare Worker backend.
// Routes: GET /health, GET /search, GET /img, POST /dive, GET|POST /retrieve, GET|POST /source,
// POST /chat, POST /analyze, POST /synthesize.
// Everything else is served from static assets (the Carmen frontend) via the ASSETS binding.
//
// Safety contract: Carmen is a research/analysis tool only. It never contacts
// people, sends messages, posts, comments, submits forms, makes purchases,
// creates accounts, performs transactions, or takes any external action on a
// user's behalf. The AI system prompt enforces this; the search layer only
// reads public web pages.

const MAX_RESULTS = 20;
const SEARCH_TIMEOUT_MS = 8000;
const AI_TIMEOUT_MS = 30000;
let SEARCH_BUDGET = { used: 0, max: 36 };

const PROVIDERS = ['DuckDuckGo', 'Bing', 'Google', 'Mojeek', 'Startpage', 'Yahoo', 'Reddit'];

const BLOCKED_HOSTS = new Set([
  'duckduckgo.com', 'www.duckduckgo.com',
  'bing.com', 'www.bing.com', 'microsoft.com', 'www.microsoft.com',
  'google.com', 'www.google.com',
  'search.yahoo.com', 'yahoo.com', 'www.yahoo.com',
  'mojeek.com', 'www.mojeek.com',
  'startpage.com', 'www.startpage.com',
  // search-engine help/account/nav surfaces that leak into result lists
  'support.google.com', 'support.microsoft.com', 'support.apple.com',
  'accounts.google.com', 'myaccount.google.com', 'policies.google.com',
  'go.microsoft.com', 'www.msn.com', 'msn.com',
  'support.startpage.com', 'support.duckduckgo.com',
  'blog.mojeek.com', 'community.mojeek.com',
  'about.google', 'ads.google.com',
]);

const NAV_LINK_RE = /^(images?|videos?|news|maps|shopping|mail|sign in|sign up|log in|login|more|web|all|finance|sports|weather|travel|games?|apps?|about|help|privacy|terms|settings|preferences|account|home|search|filter|tools?|feedback|learn more|learn|mobile|desktop|menu|skip|close|open|back|next|previous|continue|submit|cancel|yes|no)$/i;

function cors(req) {
  const origin = req.headers.get('Origin') || '';
  const allowedExact = new Set([
    'http://localhost:8787',
    'http://127.0.0.1:8787',
    'https://carmen-iphone-v25.94bwfd5grv.workers.dev',
  ]);
  let allow = 'https://carmen-iphone-v25.94bwfd5grv.workers.dev';
  if (origin) {
    if (allowedExact.has(origin) || origin.endsWith('.workers.dev') ||
        origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      allow = origin;
    }
  } else {
    allow = '*';
  }
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}

function json(value, status, req, extra = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...cors(req),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  });
}

function cleanText(s = '') {
  return decodeEntities(String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

function decodeEntities(s = '') {
  // Build named-entity patterns at runtime so the source cannot get HTML-decoded
  // by editors into no-op replacements.
  return String(s)
    .replace(new RegExp('&' + 'nbsp;', 'gi'), ' ')
    .replace(new RegExp('&' + 'amp;', 'gi'), '&')
    .replace(new RegExp('&' + 'quot;', 'gi'), '"')
    .replace(new RegExp('&' + 'apos;', 'gi'), "'")
    .replace(new RegExp('&' + 'lt;', 'gi'), '<')
    .replace(new RegExp('&' + 'gt;', 'gi'), '>')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ''; } });
}

// Resolve redirect-wrapped URLs (DuckDuckGo uddg=, etc.).
function unwrap(raw) {
  let url = decodeEntities(String(raw || '')).trim();
  if (!url) return '';
  if (url.startsWith('//')) url = 'https:' + url;
  try {
    const u = new URL(url);
    for (const key of ['uddg', 'url', 'u', 'ru', 'goto']) {
      const target = u.searchParams.get(key);
      if (target && /^https?:\/\//i.test(target)) return decodeURIComponent(target);
    }
  } catch {}
  return url;
}

function validUrl(url) {
  try { return /^https?:$/i.test(new URL(url).protocol); } catch { return false; }
}

// Strip a trailing/leading bare URL copied into a title by messy anchor parsing.
function cleanTitle(title) {
  let t = cleanText(decodeEntities(title));
  if (!t) return '';
  // Remove any embedded "https://..." fragments (Bing/Yahoo splice the URL into the title).
  t = t.replace(/https?:\/\/\S+/gi, ' ').trim();
  // Drop a leading "host.com" breadcrumb token copied in front of the real title.
  t = t.replace(/^\s*[\w.-]+\.(com|net|org|gov|edu|io|co|ai|us|uk|de)\b[\s\u203a>\-]*/i, '').trim();
  // Drop trailing " › path › segment" breadcrumb leftovers.
  t = t.replace(/\s+\u203a.*$/g, '').trim();
  t = t.replace(/\s+/g, ' ').trim();
  if (NAV_LINK_RE.test(t)) return '';
  if (t.length < 4 || t.length > 300) return '';
  if (/^[\w.-]+\.(com|net|org|gov|edu|io|co|ai)$/i.test(t)) return ''; // bare host
  return t;
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function uniqueAdd(results, seen, item) {
  const url = unwrap(item.url);
  const title = cleanTitle(item.title);
  if (!validUrl(url) || !title) return false;
  const host = hostOf(url);
  if (BLOCKED_HOSTS.has(host)) return false;
  if (host === 'reddit.com' || host.endsWith('.reddit.com')) {
    // Reddit results come from the JSON API; skip any stray anchor links.
    if (!item.source || !item.source.startsWith('Reddit')) return false;
  }
  let key;
  try { key = new URL(url).href.replace(/#.*$/, ''); } catch { return false; }
  if (seen.has(key)) return false;
  seen.add(key);
  const images = Array.isArray(item.images) ? item.images.filter(x => typeof x === 'string' && x.startsWith('http')).slice(0, 8) : [];
  const image = typeof item.image === 'string' && item.image.startsWith('http') ? item.image : (images[0] || '');
  results.push({
    title: title.slice(0, 240),
    url: key,
    source: String(item.source || 'Public web').slice(0, 120),
    snippet: cleanText(decodeEntities(item.snippet || '')).slice(0, 600),
    image,
    images,
    observedAt: new Date().toISOString(),
    queryVariant: item.queryVariant || '',
  });
  return true;
}

async function fetchText(url, init = {}, timeout = SEARCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally { clearTimeout(timer); }
}

const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

// --- Provider-specific parsers ------------------------------------------------
// Each returns true if it produced any results. Falls back to generic anchor
// parsing so a changed class name never zeroes out a whole provider.

function parseDDG(html, results, seen) {
  const out = [];
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = unwrap(m[1]);
    // Snippet follows in a result__snippet anchor.
    const after = html.slice(m.index, m.index + 1600);
    const sm = after.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    out.push({ title: m[2], url, snippet: sm ? sm[1] : '', source: 'DuckDuckGo' });
  }
  let added = false;
  for (const it of out) added = uniqueAdd(results, seen, it) || added;
  return added;
}

function parseBing(html, results, seen) {
  // Bing mobile: the page title lives in <h2>...</h2>, the URL in a separate
  // <a class="tilk" href> anchor, and the snippet in a <p>.
  let added = false;
  const re = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(html))) {
    const block = m[1];
    const hm = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const um = block.match(/href="(https?:[^"]+)"/i);
    if (!hm || !um) continue;
    const sm = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    added = uniqueAdd(results, seen, { title: hm[1], url: unwrap(um[1]), snippet: sm ? sm[1] : '', source: 'Bing' }) || added;
  }
  return added;
}

function parseYahoo(html, results, seen) {
  let added = false;
  const re = /<a[^>]*class="[^"]*(?:yschttl| ac-1st|result-link)[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    added = uniqueAdd(results, seen, { title: m[2], url: unwrap(m[1]), snippet: '', source: 'Yahoo' }) || added;
  }
  return added;
}

function parseGoogle(html, results, seen) {
  let added = false;
  // Google wraps result titles in <h3> inside an <a href>.
  const re = /<a[^>]*href="\/url\?q=([^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  let m;
  while ((m = re.exec(html))) {
    added = uniqueAdd(results, seen, { title: m[2], url: decodeURIComponent(m[1]), snippet: '', source: 'Google' }) || added;
  }
  if (!added) {
    const re2 = /<h3[^>]*>([\s\S]*?)<\/h3>\s*(?:<\/div>)?\s*<\/a>/gi;
    while ((m = re2.exec(html))) {
      // Best-effort: find the nearest preceding href.
      const before = html.slice(Math.max(0, m.index - 400), m.index);
      const hm = before.match(/href="([^"]+)"/g);
      if (hm) {
        const href = hm[hm.length - 1].replace(/^href="|"/g, '');
        added = uniqueAdd(results, seen, { title: m[1], url: href, snippet: '', source: 'Google' }) || added;
      }
    }
  }
  return added;
}

function parseMojeek(html, results, seen) {
  let added = false;
  const re = /<a[^>]*class="[^"]*ob[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    added = uniqueAdd(results, seen, { title: m[2], url: unwrap(m[1]), snippet: '', source: 'Mojeek' }) || added;
  }
  return added;
}

function parseStartpage(html, results, seen) {
  let added = false;
  const re = /<a[^>]*class="[^"]*w-gl__result[^"]*"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<span[^>]*class="[^"]*w-gl__result-title[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
  let m;
  while ((m = re.exec(html))) {
    added = uniqueAdd(results, seen, { title: m[2], url: unwrap(m[1]), snippet: '', source: 'Startpage' }) || added;
  }
  return added;
}

// Generic fallback: extract ordinary result-like links.
function parseAnchors(html, source, results, seen, limit) {
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && results.length < limit) {
    const url = unwrap(m[1]);
    const host = hostOf(url);
    if (!host || BLOCKED_HOSTS.has(host)) continue;
    if (host === 'reddit.com' || host.endsWith('.reddit.com')) continue;
    // Require a real-looking title (not a bare nav link).
    const title = cleanTitle(m[2]);
    if (!title) continue;
    uniqueAdd(results, seen, { title, url, source });
  }
}

async function htmlSearch(url, source, parser, results, seen, diagnostics, queryVariant = '') {
  if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) {
    diagnostics[source] = { error: 'skipped (fetch budget)' };
    return;
  }
  SEARCH_BUDGET.used++;
  const before = results.length;
  try {
    const r = await fetchText(url, { headers: BROWSER_HEADERS });
    diagnostics[source] = { status: r.status, ok: r.ok };
    if (!r.ok) return;
    const html = await r.text();
    const structured = parser ? parser(html, results, seen) : false;
    if (!structured) parseAnchors(html, source, results, seen, MAX_RESULTS);
  } catch (e) {
    diagnostics[source] = { error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 200) };
  }
  if (queryVariant) {
    for (let i = before; i < results.length; i++) {
      if (!results[i].queryVariant) results[i].queryVariant = queryVariant;
    }
  }
}

async function ddg(q, results, seen, diagnostics) {
  await htmlSearch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q) + '&kp=-2', 'DuckDuckGo', parseDDG, results, seen, diagnostics, q);
  if (results.length < 8) {
    await htmlSearch('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q), 'DuckDuckGo Lite', null, results, seen, diagnostics, q);
  }
}

async function bing(q, results, seen, diagnostics) {
  await htmlSearch('https://www.bing.com/search?q=' + encodeURIComponent(q) + '&adlt=off', 'Bing', parseBing, results, seen, diagnostics, q);
}

async function google(q, results, seen, diagnostics) {
  await htmlSearch('https://www.google.com/search?q=' + encodeURIComponent(q) + '&safe=off&num=10', 'Google', parseGoogle, results, seen, diagnostics, q);
}

async function mojeek(q, results, seen, diagnostics) {
  await htmlSearch('https://www.mojeek.com/search?q=' + encodeURIComponent(q), 'Mojeek', parseMojeek, results, seen, diagnostics, q);
}

async function startpage(q, results, seen, diagnostics) {
  await htmlSearch('https://www.startpage.com/sp/search?query=' + encodeURIComponent(q) + '&cat=web', 'Startpage', parseStartpage, results, seen, diagnostics, q);
}

async function yahoo(q, results, seen, diagnostics) {
  await htmlSearch('https://search.yahoo.com/search?p=' + encodeURIComponent(q), 'Yahoo', parseYahoo, results, seen, diagnostics, q);
}

async function reddit(q, results, seen, diagnostics) {
  if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) {
    diagnostics.Reddit = { error: 'skipped (fetch budget)' };
    return;
  }
  SEARCH_BUDGET.used++;
  const endpoints = [
    'https://old.reddit.com/search.json?q=' + encodeURIComponent(q) + '&limit=25&sort=relevance&t=all&include_over_18=on',
    'https://www.reddit.com/search.json?q=' + encodeURIComponent(q) + '&limit=25&sort=relevance&t=all&include_over_18=on',
    'https://api.reddit.com/search?q=' + encodeURIComponent(q) + '&limit=25&sort=relevance&t=all&include_over_18=on',
  ];
  let lastErr = null;
  for (const endpoint of endpoints) {
    try {
      const r = await fetchText(endpoint, {
        headers: { ...BROWSER_HEADERS, accept: 'application/json' },
      });
      diagnostics.Reddit = { status: r.status, ok: r.ok };
      if (!r.ok) { lastErr = 'HTTP ' + r.status; continue; }
      const j = await r.json();
      for (const child of j?.data?.children || []) {
        const d = child?.data;
        if (!d?.permalink) continue;
        uniqueAdd(results, seen, {
          title: d.title || 'Reddit result',
          url: 'https://www.reddit.com' + d.permalink,
          source: d.subreddit_name_prefixed || (d.subreddit ? 'Reddit · r/' + d.subreddit : 'Reddit'),
          snippet: d.selftext || '',
          image: typeof d.thumbnail === 'string' && d.thumbnail.startsWith('http') ? d.thumbnail : (d.preview?.images?.[0]?.source?.url ? decodeEntities(d.preview.images[0].source.url) : ''),
          queryVariant: q,
        });
        if (results.length >= MAX_RESULTS) break;
      }
      return;
    } catch (e) {
      lastErr = e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 200);
    }
  }
  if (!diagnostics.Reddit) diagnostics.Reddit = { error: lastErr || 'unavailable' };
}

async function wikipedia(q, results, seen, diagnostics, classification) {
  if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) return;
  SEARCH_BUDGET.used++;
  try {
    const r = await fetchText('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(q) + '&utf8=1&format=json&srlimit=5', {
      headers: { accept: 'application/json', 'user-agent': 'CarmenResearch/38 (investigation workspace)' },
    });
    diagnostics.Wikipedia = { status: r.status, ok: r.ok };
    if (!r.ok) return;
    const j = await r.json();
    const hits = j?.query?.search || [];
    const tokens = String(q || '').toLowerCase().split(/\s+/).filter(t => t.length > 2);
    for (const hit of hits) {
      const title = hit.title || '';
      if (tokens.length && tokens.every(t => !title.toLowerCase().includes(t))) continue;
      if (classification && classification.type === 'person' && tokens.length >= 2) {
        const hitCount = tokens.filter(t => title.toLowerCase().includes(t)).length;
        if (hitCount === 0) continue;
      }
      const url = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
      uniqueAdd(results, seen, {
        title,
        url,
        source: 'Wikipedia',
        snippet: cleanText(hit.snippet || ''),
        queryVariant: q,
      });
    }
    const top = hits[0]?.title;
    if (top && SEARCH_BUDGET.used < SEARCH_BUDGET.max && !(tokens.length && tokens.every(t => !String(top).toLowerCase().includes(t)))) {
      SEARCH_BUDGET.used++;
      try {
        const r2 = await fetchText('https://en.wikipedia.org/w/api.php?action=query&titles=' + encodeURIComponent(top) + '&prop=pageimages|extracts&pithumbsize=640&exintro=1&explaintext=1&format=json', {
          headers: { accept: 'application/json', 'user-agent': 'CarmenResearch/38 (investigation workspace)' },
        });
        const j2 = await r2.json();
        const page = Object.values(j2?.query?.pages || {})[0];
        if (page) {
          const url = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(String(page.title || top).replace(/ /g, '_'));
          const existing = results.find(x => x.url === url);
          const thumb = page.thumbnail?.source;
          if (existing && thumb) {
            existing.image = existing.image || thumb;
            existing.images = [...new Set([...(existing.images || []), thumb])];
            if (page.extract && !existing.snippet) existing.snippet = String(page.extract).slice(0, 600);
          }
        }
      } catch {}
    }
  } catch (e) {
    diagnostics.Wikipedia = { error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 200) };
  }
}

const SEO_JUNK_RE = /(nameberry|howmanyofme|houseofnames|behindthename|urbandictionary|quizlet\.com|coursehero|chegg\.com|slideplayer|scribd\.com|pinterest\.com|fandom\.com\/wiki\/Special)/i;
const TUBE_INDEX_RE = /(nudevista|xvideos|pornhub|xnxx|spankbang|xhamster|redtube|youporn|alohatube|tubepornstars|heavyfetish|bdsmx\.tube|thothub|fapello|erome)\./i;
const RETAILER_RE = /(bestbuy|walmart|amazon|ebay|target|newegg|bhphotovideo|costco)\./i;
const NAV_TITLE_RE = /^(blog|community|newsletter|home|login|sign in|search|menu)$/i;
const SKIP_IMAGE_RE = /(favicon|sprite|1x1|pixel|tracking|badge\.svg|logo\.(png|svg|jpg|gif)|icon-?\d+|apple-touch-icon|join\.(jpg|png|gif)|play\.(png|gif|jpg)|spinner|placeholder|blank\.(gif|png)|custom_assets|\/icons?\/)/i;
const NON_NAME_TOKENS = /^(workers?|iphone|ipad|server|engine|cloud|docs?|api|sdk|framework|protocol|database|linux|windows|android|ios|iphones?)$/i;
const PROFILE_HOST_RE = /(^|\.)(linkedin|instagram|twitter|x|onlyfans)\.com$/i;
const TECHNIQUE_WORD_RE = /\b(technique|techniques|position|positions|tutorial|tutorials|how[- ]to|howto|knot|knots|tie|ties|pose|poses|grip|stance|method|procedure|form|hitch|splice|joinery|jig)\b/i;
const SKILL_WORD_RE = /\b(weld|welding|welder|woodwork|woodworking|carpentry|fabricat(?:e|ion)|repair|repairs|solder|soldering|machin(?:e|ing)|plumbing|electrical|diy|craft|crafts|build(?:ing)?|project)\b/i;
const INSTRUCTIONAL_HOST_RE = /(youtube\.com|youtu\.be|wikihow\.com|instructables\.com|wikipedia\.org|reddit\.com|khronos|familyhandyman|thisoldhouse|finewoodworking|lincolnelectric|millerwelds|hobart)/i;
const TECHNIQUE_HINTS = new Set(['technique', 'position', 'instruction']);
const SKILL_HINTS = new Set(['skill', 'project']);


function classifyQuery(q, hint = '') {
  const raw = String(q || '').trim();
  const hintMap = {
    person: 'person', topic: 'topic', website: 'website', claim: 'topic',
    product: 'product', position: 'technique', other: '', organization: 'organization',
    vehicle: 'vehicle', place: 'place', social: 'social', reddit: 'reddit',
    technique: 'technique', skill: 'skill', project: 'project', instruction: 'technique',
  };
  const hinted = hintMap[String(hint || '').toLowerCase()] || '';
  if (!raw) return { type: 'unknown', confidence: 'low', reason: 'Empty query', isUrl: false };
  const maybeUrl = /^https?:\/\//i.test(raw) || (/^[\w.-]+\.[a-z]{2,}([/:?]|$)/i.test(raw) && !/\s/.test(raw));
  if (maybeUrl) {
    const url = normalizeUrlForStore(raw.startsWith('http') ? raw : 'https://' + raw) || ('https://' + raw);
    const host = hostOf(url);
    const isImage = /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(url);
    if (/reddit\.com$/i.test(host) || host.endsWith('.reddit.com')) {
      return { type: 'reddit', confidence: 'high', reason: 'Direct Reddit URL', isUrl: true, url, isImage };
    }
    return { type: 'website', confidence: 'high', reason: 'Direct URL', isUrl: true, url, isImage };
  }
  if (TECHNIQUE_HINTS.has(hinted) || (TECHNIQUE_WORD_RE.test(raw) && !SKILL_WORD_RE.test(raw))) {
    return { type: 'technique', confidence: hinted ? 'medium' : 'medium', reason: 'Looks like a technique, position, or instructional form', isUrl: false };
  }
  if (SKILL_HINTS.has(hinted) || SKILL_WORD_RE.test(raw) || /\bhow to\b/i.test(raw)) {
    return { type: hinted === 'project' ? 'project' : 'skill', confidence: 'medium', reason: 'Looks like a skill, craft, or project to learn', isUrl: false };
  }
  if (/^@[\w.]+/.test(raw) || /\b(instagram|tiktok|onlyfans|twitter|linkedin)\b/i.test(raw)) {
    return { type: 'social', confidence: 'medium', reason: 'Looks like a social handle or profile query', isUrl: false };
  }
  if (/\b(reddit|r\/[a-z0-9_]+)/i.test(raw)) {
    return { type: hinted || 'reddit', confidence: 'medium', reason: 'Reddit/community query', isUrl: false };
  }
  if (/\b(inc|llc|corp|company|university|hospital|foundation)\b/i.test(raw)) {
    return { type: 'organization', confidence: 'medium', reason: 'Organization language in the query', isUrl: false };
  }
  if (/\b(19|20)\d{2}\b/.test(raw) && /\b(toyota|honda|ford|chevy|chevrolet|nissan|bmw|runner|civic|f-?150|mustang|iphone|ipad)\b/i.test(raw)) {
    return { type: 'vehicle', confidence: 'medium', reason: 'Year + vehicle/product tokens', isUrl: false };
  }
  if (/\b(iphone|ipad|pixel \d|playstation|xbox|macbook)\b/i.test(raw)) {
    return { type: 'product', confidence: 'medium', reason: 'Product-like query', isUrl: false };
  }
  const words = raw.split(/\s+/);
  const nameLike = words.length >= 2 && words.length <= 4 && words.every(w => /^[A-Za-z][A-Za-z.'’-]*$/.test(w));
  const looksLikeProductPhrase = words.some(w => NON_NAME_TOKENS.test(w));
  if (nameLike && looksLikeProductPhrase && !hinted) {
    return { type: 'topic', confidence: 'low', reason: 'Phrase looks like a product/topic, not a personal name', isUrl: false };
  }
  if (nameLike && (!hinted || hinted === 'person') && !looksLikeProductPhrase) {
    return { type: 'person', confidence: words.length === 1 ? 'low' : 'medium', reason: 'Name-like query — treating as a person candidate search', isUrl: false };
  }
  if (words.length === 1 && /^[A-Za-z]{2,}$/.test(raw)) {
    return { type: hinted || 'ambiguous', confidence: 'low', reason: 'Single token — many people/entities could match', isUrl: false };
  }
  if (hinted) return { type: hinted, confidence: 'medium', reason: 'Using the selected subject type as a search hint', isUrl: false };
  return { type: 'topic', confidence: 'low', reason: 'Treated as a topic/query, not a specific named entity', isUrl: false };
}

function researchPaths(type) {
  const t = String(type || 'topic');
  const paths = {
    person: [
      { id: 'identity', label: 'Identity & aliases' },
      { id: 'images', label: 'Images & visual sources' },
      { id: 'videos', label: 'Videos' },
      { id: 'presence', label: 'Public web presence' },
      { id: 'timeline', label: 'Timeline' },
      { id: 'related', label: 'Related people & entities' },
      { id: 'sources', label: 'Sources' },
      { id: 'leads', label: 'Leads' },
      { id: 'questions', label: 'Questions to investigate' },
    ],
    product: [
      { id: 'overview', label: 'Overview' },
      { id: 'specs', label: 'Specifications' },
      { id: 'variants', label: 'Models & variants' },
      { id: 'images', label: 'Images' },
      { id: 'videos', label: 'Videos' },
      { id: 'manuals', label: 'Manuals & documents' },
      { id: 'reviews', label: 'Reviews' },
      { id: 'alternatives', label: 'Alternatives' },
      { id: 'sources', label: 'Sources' },
      { id: 'questions', label: 'Questions' },
    ],
    vehicle: [
      { id: 'overview', label: 'Overview' },
      { id: 'specs', label: 'Specifications' },
      { id: 'variants', label: 'Years & variants' },
      { id: 'images', label: 'Images' },
      { id: 'videos', label: 'Videos' },
      { id: 'manuals', label: 'Manuals' },
      { id: 'maintenance', label: 'Maintenance & parts' },
      { id: 'sources', label: 'Sources' },
      { id: 'questions', label: 'Questions' },
    ],
    technique: [
      { id: 'what', label: 'What this is' },
      { id: 'terms', label: 'Terminology' },
      { id: 'visuals', label: 'Visual references' },
      { id: 'variations', label: 'Variations' },
      { id: 'tutorials', label: 'Tutorials' },
      { id: 'videos', label: 'Videos' },
      { id: 'sources', label: 'Sources' },
      { id: 'related', label: 'Related techniques' },
      { id: 'questions', label: 'Questions' },
    ],
    skill: [
      { id: 'goal', label: 'What you are trying to accomplish' },
      { id: 'materials', label: 'Materials' },
      { id: 'tools', label: 'Tools' },
      { id: 'steps', label: 'Steps' },
      { id: 'measurements', label: 'Measurements' },
      { id: 'techniques', label: 'Techniques' },
      { id: 'safety', label: 'Safety considerations' },
      { id: 'trouble', label: 'Troubleshooting' },
      { id: 'tutorials', label: 'Tutorials' },
      { id: 'sources', label: 'References' },
    ],
    project: [
      { id: 'goal', label: 'What you are trying to accomplish' },
      { id: 'materials', label: 'Materials' },
      { id: 'tools', label: 'Tools' },
      { id: 'steps', label: 'Steps' },
      { id: 'measurements', label: 'Measurements' },
      { id: 'techniques', label: 'Techniques' },
      { id: 'safety', label: 'Safety considerations' },
      { id: 'trouble', label: 'Troubleshooting' },
      { id: 'tutorials', label: 'Tutorials' },
      { id: 'sources', label: 'References' },
    ],
    place: [
      { id: 'overview', label: 'Overview' },
      { id: 'location', label: 'Location & context' },
      { id: 'images', label: 'Images' },
      { id: 'related', label: 'Related places & entities' },
      { id: 'sources', label: 'Sources' },
      { id: 'questions', label: 'Questions' },
    ],
    social: [
      { id: 'identity', label: 'Identity & handles' },
      { id: 'images', label: 'Images' },
      { id: 'videos', label: 'Videos' },
      { id: 'presence', label: 'Public presence' },
      { id: 'related', label: 'Related accounts & entities' },
      { id: 'sources', label: 'Sources' },
      { id: 'questions', label: 'Questions' },
    ],
    organization: [
      { id: 'overview', label: 'Overview' },
      { id: 'official', label: 'Official presence' },
      { id: 'people', label: 'Public people & roles' },
      { id: 'history', label: 'History' },
      { id: 'sources', label: 'Sources' },
      { id: 'questions', label: 'Questions' },
    ],
    website: [
      { id: 'page', label: 'This page' },
      { id: 'site', label: 'Site context' },
      { id: 'images', label: 'Images' },
      { id: 'related', label: 'Related public pages' },
      { id: 'sources', label: 'Sources' },
      { id: 'questions', label: 'Questions' },
    ],
    reddit: [
      { id: 'thread', label: 'Thread context' },
      { id: 'claims', label: 'Claims in discussion' },
      { id: 'sources', label: 'Linked sources' },
      { id: 'questions', label: 'What still needs checking' },
    ],
    topic: [
      { id: 'overview', label: 'Overview' },
      { id: 'definitions', label: 'Definitions' },
      { id: 'history', label: 'History' },
      { id: 'evidence', label: 'Evidence' },
      { id: 'related', label: 'Related concepts' },
      { id: 'sources', label: 'Sources' },
      { id: 'questions', label: 'Questions' },
    ],
    ambiguous: [
      { id: 'interpretations', label: 'Possible interpretations' },
      { id: 'candidates', label: 'Candidate matches' },
      { id: 'sources', label: 'Sources' },
      { id: 'questions', label: 'How to disambiguate' },
    ],
  };
  return paths[t] || paths.topic;
}

function inferPathsFromQuestion(question, allPaths) {
  const t = String(question || '').toLowerCase();
  if (!t) return [];
  const available = new Set((allPaths || []).map(p => p.id));
  const out = [];
  const rules = [
    [/image|photo|visual|picture|gallery|pic\b/, ['images', 'visuals']],
    [/video|youtube|interview|clip|watch|footage/, ['videos']],
    [/timeline|history|when|chronolog|date/, ['timeline', 'history']],
    [/identity|alias|who is|real name|handle/, ['identity']],
    [/presence|website|profile|social|official/, ['presence', 'official']],
    [/related|other people|connected|associated/, ['related']],
    [/tutorial|how to|learn|teach|instruct|procedure|steps/, ['tutorials', 'steps']],
    [/tool|material|part|supply/, ['tools', 'materials']],
    [/safety|hazard|ppe/, ['safety']],
    [/spec|measurement|dimension/, ['specs', 'measurements']],
    [/source|citation|evidence|reference/, ['sources']],
    [/variation|variant|model/, ['variations', 'variants']],
    [/term|definition|what is this|meaning/, ['what', 'terms', 'definitions']],
  ];
  for (const [re, ids] of rules) {
    if (!re.test(t)) continue;
    for (const id of ids) if (available.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

function resolveDivePaths(type, body = {}) {
  const all = researchPaths(type);
  const requestedRaw = Array.isArray(body.paths) ? body.paths : (Array.isArray(body.pathIds) ? body.pathIds : []);
  const requested = requestedRaw.map(x => (typeof x === 'string' ? x : x && x.id)).filter(Boolean);
  const custom = String(body.customQuestion || body.question || '').trim();
  const inferred = inferPathsFromQuestion(custom, all);
  const wantAll = body.all === true || body.all === 'true' || requested.includes('all') || (!requested.length && !inferred.length);
  if (wantAll) return { all: true, selected: all, inferred, custom };
  const ids = new Set(requested.filter(id => id !== 'all'));
  for (const id of inferred) ids.add(id);
  const extras = [];
  if (ids.has('videos') && !all.some(p => p.id === 'videos')) extras.push({ id: 'videos', label: 'Videos' });
  if (ids.has('images') && !all.some(p => p.id === 'images') && !all.some(p => p.id === 'visuals')) extras.push({ id: 'images', label: 'Images' });
  let selected = all.filter(p => ids.has(p.id)).concat(extras);
  if (!selected.length) selected = all;
  return { all: extras.length ? false : selected.length === all.length, selected, inferred, custom };
}

function pathSearchVariants(seed, selectedPaths) {
  const extra = [];
  const ids = new Set((selectedPaths || []).map(p => p.id));
  const add = (q, why) => {
    const t = String(q || '').trim();
    if (!t || extra.some(x => x.q === t)) return;
    extra.push({ q: t, why });
  };
  if (ids.has('images') || ids.has('visuals')) add(seed + ' photos OR images OR gallery', 'visual evidence');
  if (ids.has('videos')) add(seed + ' video OR youtube OR interview', 'video sources');
  if (ids.has('timeline') || ids.has('history')) add(seed + ' timeline OR history', 'chronology');
  if (ids.has('presence') || ids.has('official')) add(seed + ' official OR profile OR website', 'public presence');
  if (ids.has('tutorials') || ids.has('steps')) add(seed + ' tutorial OR procedure OR how to', 'instructional sources');
  if (ids.has('safety')) add(seed + ' safety', 'safety context');
  return extra.slice(0, 4);
}

function youtubeId(url) {
  try {
    const u = new URL(String(url || ''));
    const h = u.hostname.replace(/^www\./, '').toLowerCase();
    if (h === 'youtu.be') return u.pathname.replace(/^\//, '').split('/')[0] || '';
    if (h === 'youtube.com' || h === 'm.youtube.com' || h.endsWith('.youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = u.pathname.match(/\/(?:embed|shorts|live)\/([^/?]+)/);
      if (m) return m[1];
    }
  } catch {}
  return '';
}

function vimeoId(url) {
  try {
    const u = new URL(String(url || ''));
    if (!/(^|\.)vimeo\.com$/i.test(u.hostname.replace(/^www\./, ''))) return '';
    const m = u.pathname.match(/\/(?:video\/)?(\d+)/);
    return m ? m[1] : '';
  } catch { return ''; }
}

function isVideoHost(url) {
  const h = hostOf(url).replace(/^www\./, '');
  return /youtube\.com|youtu\.be|vimeo\.com|reddit\.com/i.test(h) || /\.(mp4|webm|mov)(\?|$)/i.test(String(url || ''));
}

function collectDiveVideos(retrieved, results) {
  const out = [];
  const seen = new Set();
  const add = (url, pageUrl, title, thumb) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    const yt = youtubeId(url);
    const vim = vimeoId(url);
    const host = hostOf(url).replace(/^www\./, '');
    const embedUrl = yt ? ('https://www.youtube.com/embed/' + yt) : (vim ? ('https://player.vimeo.com/video/' + vim) : '');
    out.push({
      url,
      pageUrl: pageUrl || url,
      title: title || host,
      domain: host,
      thumbnail: thumb || (yt ? ('https://i.ytimg.com/vi/' + yt + '/hqdefault.jpg') : ''),
      embedUrl,
      playable: !!embedUrl,
      retrievedAt: new Date().toISOString(),
    });
  };
  for (const r of results || []) {
    if (youtubeId(r.url) || vimeoId(r.url) || /\.(mp4|webm|mov)(\?|$)/i.test(r.url || '')) {
      add(r.url, r.url, r.title, r.image);
    }
  }
  for (const page of retrieved || []) {
    if (page.ogVideo) add(page.ogVideo, page.finalUrl || page.url, page.title, page.ogImage);
    const text = String(page.textExcerpt || page.text || page.description || '');
    const re = /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[\w-]{6,}|youtu\.be\/[\w-]{6,}|vimeo\.com\/\d+)/gi;
    let m;
    while ((m = re.exec(text)) && out.length < 12) add(m[0], page.finalUrl || page.url, page.title, page.ogImage);
  }
  return out.slice(0, 12);
}

function relatedFromDiscovery(results, candidate) {
  const focus = (candidate && candidate.url) || '';
  const focusHost = hostOf(focus);
  const out = [];
  for (const r of results || []) {
    if (!r || r.url === focus) continue;
    if (r.confidence !== 'high' && r.confidence !== 'medium') continue;
    if (focusHost && hostOf(r.url) === focusHost) continue;
    out.push({
      kind: r.entityType || 'source',
      label: r.title,
      url: r.url,
      why: r.reason || 'Related public source',
      image: r.image || '',
      domain: r.domain || hostOf(r.url),
    });
    if (out.length >= 6) break;
  }
  return out;
}

function parseRelated(text) {
  const out = [];
  const raw = String(text || '');
  const idx = raw.search(/RELATED(?:_ENTITIES)?\b/i);
  if (idx < 0) return out;
  const block = raw.slice(idx).split(/\n(?:OBSERVED|INFERRED|UNKNOWN)\b/i)[0];
  const re = /^\s*[-*]\s*([A-Za-z][A-Za-z /]{2,24})\s*[:—\-]\s*(.+)$/gm;
  let m;
  while ((m = re.exec(block)) && out.length < 8) {
    const kind = m[1].trim().toLowerCase();
    const rest = m[2].trim();
    const parts = rest.split(/\s[—–-]\s/);
    out.push({ kind, label: (parts[0] || rest).trim(), why: parts.slice(1).join(' — ').trim() });
  }
  return out;
}

function buildSearchVariants(q, classification) {
  const clean = q.trim().replace(/\s+/g, ' ').slice(0, 200);
  const out = [];
  const add = (query, why) => {
    const t = String(query || '').trim();
    if (!t) return;
    if (!out.some(x => x.q === t)) out.push({ q: t, why });
  };
  if (classification.isUrl) {
    add(classification.url, 'inspect the submitted URL');
    const host = hostOf(classification.url).replace(/^www\./, '');
    const pathName = humanizePath(classification.url);
    if (pathName && /[a-z]/i.test(pathName) && pathName.toLowerCase() !== host.split('.')[0] && pathName.length >= 4) {
      add(pathName, 'name inferred from URL path');
    } else if (host) {
      add(host, 'search the domain');
    }
    return out.slice(0, 3);
  }
  add(clean, 'primary query');
  if (classification.type === 'person' && /\s/.test(clean)) {
    add('"' + clean.replace(/"/g, '') + '"', 'exact name');
    add(clean + ' official OR website OR profile', 'official/profile pages');
  } else if (classification.type === 'website') {
    add(clean.replace(/^https?:\/\//, ''), 'domain form');
  } else if (classification.type === 'product' || classification.type === 'vehicle') {
    add('"' + clean.replace(/"/g, '') + '"', 'exact product string');
  } else if (classification.type === 'technique') {
    add(clean + ' tutorial OR diagram OR how to', 'instructional / visual references');
    add('"' + clean.replace(/"/g, '') + '"', 'exact technique name');
  } else if (classification.type === 'skill') {
    add(clean + ' tutorial OR guide OR procedure', 'how-to / procedure sources');
    add(clean + ' tools materials safety', 'tools and safety context');
  } else if (classification.type === 'organization') {
    add(clean + ' official website', 'official organization pages');
  } else if (classification.type === 'reddit') {
    add(clean.replace(/^r\//, ''), 'community query');
  } else if (/\s/.test(clean) && !/^".*"$/.test(clean)) {
    add('"' + clean.replace(/"/g, '') + '"', 'exact phrase');
  }
  return out.slice(0, 3);
}

function scoreResult(query, item, classification) {
  const q = String(query || '').toLowerCase().replace(/['"]/g, '');
  const tokens = q.split(/\s+/).filter(t => t.length > 1);
  const title = String(item.title || '').toLowerCase();
  const url = String(item.url || '').toLowerCase();
  const host = hostOf(item.url).replace(/^www\./, '');
  const sld = host.split('.')[0] || '';
  const snip = String(item.snippet || '').toLowerCase();
  let score = 8;
  const bits = [];
  if (classification.isUrl && classification.url && (item.url === classification.url || item.url === classification.url.replace(/\/$/, ''))) {
    score += 50; bits.push('submitted URL');
  }
  if (q && title.includes(q)) { score += 42; bits.push('exact query in title'); }
  else if (tokens.length && tokens.every(t => title.includes(t))) { score += 24; bits.push('all name tokens in title'); }
  else if (tokens.some(t => title.includes(t))) { score += 8; bits.push('partial name match'); }
  if (tokens.length && tokens.every(t => host.includes(t) || url.includes(t))) { score += 20; bits.push('name tokens in URL/domain'); }
  const brandHit = tokens.find(t => t.length > 2 && (t === sld || host === t + '.com' || host.endsWith('.' + t + '.com')));
  if ((classification.type === 'product' || classification.type === 'organization' || classification.type === 'vehicle' || classification.type === 'website' || classification.type === 'topic') && brandHit) {
    score += 36; bits.push('official brand/domain match');
  } else if ((classification.type === 'product' || classification.type === 'organization' || classification.type === 'website') && tokens.some(t => t.length > 3 && host.includes(t))) {
    score += 16; bits.push('brand/domain match');
  }
  if (/official site|official website/i.test(item.snippet || '') || /\/models\/|\/about|\/profile/i.test(url)) {
    score += 16; bits.push('likely official or profile page');
  }
  if (host.endsWith('wikipedia.org')) {
    const missing = tokens.filter(t => t.length > 2 && !title.includes(t) && !url.includes(t) && !snip.includes(t));
    if (classification.type === 'person' && missing.length) { score -= 36; bits.push('encyclopedia hit missing name tokens'); }
    else if (tokens.length && tokens.every(t => !title.includes(t))) { score -= 40; bits.push('encyclopedia hit unrelated to query'); }
    else { score += 16; bits.push('encyclopedia source'); }
  }
  if (PROFILE_HOST_RE.test(host)) { score += 14; bits.push('public profile host'); }
  if (host === 'reddit.com' || host.endsWith('.reddit.com')) { score += 12; bits.push('Reddit thread'); }
  if (item.image || (item.images && item.images.length)) { score += 6; bits.push('has visual evidence'); }
  if ((classification.type === 'technique' || classification.type === 'skill') && INSTRUCTIONAL_HOST_RE.test(host)) {
    score += 16; bits.push('instructional source');
  }
  if ((classification.type === 'technique' || classification.type === 'skill') && /tutorial|how to|guide|explained|diagram|procedure|safety/i.test(title + ' ' + snip)) {
    score += 12; bits.push('instructional title');
  }
  if (classification.type === 'technique' && (item.image || (item.images && item.images.length))) {
    score += 8; bits.push('visual reference');
  }
  if (NAV_TITLE_RE.test(String(item.title || '').trim())) { score -= 45; bits.push('generic nav title'); }
  if (SEO_JUNK_RE.test(host) || SEO_JUNK_RE.test(url)) { score -= 30; bits.push('SEO/name-mill site'); }
  if (TUBE_INDEX_RE.test(host) || /\/(top|playlists?|pornstar|search)\//i.test(url)) {
    score -= 22; bits.push('aggregator/index, not a primary source');
  }
  if (classification.type === 'product' && RETAILER_RE.test(host)) {
    score -= 18; bits.push('retailer listing, not manufacturer');
  }
  if (/\/tag\/|\/tags\/|\/browse\//i.test(url)) { score -= 10; bits.push('tag/index page'); }
  if (host.endsWith('mojeek.com') || host.endsWith('startpage.com') || host.endsWith('bing.com')) { score -= 40; bits.push('search-engine chrome'); }
  if (classification.confidence === 'low' || classification.type === 'ambiguous') {
    score = Math.min(score, 48);
  }
  const confidence = score >= 55 ? 'high' : score >= 32 ? 'medium' : 'low';
  let reason;
  if (classification.type === 'ambiguous' || (classification.confidence === 'low' && tokens.length <= 1)) {
    reason = score >= 32
      ? 'Ambiguous query — ' + (bits[0] || 'name overlap') + '; many people/entities could match'
      : 'Low confidence — single-token overlap, many collisions possible';
  } else if (score >= 55) reason = 'Strong match — ' + bits.slice(0, 2).join(' + ');
  else if (score >= 32) reason = 'Possible match — ' + (bits[0] || 'name overlap') + ', limited corroborating evidence';
  else if (classification.type === 'person' && tokens.some(t => title.includes(t))) reason = 'Low confidence — name collision or thin context';
  else reason = 'Low confidence — weak overlap with the query';
  return { score, confidence, reason, signals: bits };
}

function aliasesFor(item, query) {
  const out = [];
  const path = humanizePath(item.url);
  if (path && /[A-Za-z]{3,}/.test(path) && !/^\d/.test(path) && path.toLowerCase() !== String(query || '').toLowerCase()) out.push(path);
  const handle = (String(item.url || '').match(/(?:x\.com|twitter\.com|instagram\.com|onlyfans\.com)\/([A-Za-z0-9_.]+)/i) || [])[1];
  if (handle && !/^(intent|share|search|i|p|reel)$/i.test(handle) && !/\./.test(handle)) out.push('@' + handle);
  const snipAt = String(item.snippet || '').match(/@[\w.]{2,30}/g) || [];
  out.push(...snipAt.filter(x => !/\.(png|jpg|ico|json|xml|svg)$/i.test(x)).slice(0, 2));
  for (const a of item.aliases || []) {
    if (!a || /\.(png|jpg|ico|json|xml|svg)$/i.test(a) || /^@favicon/i.test(a)) continue;
    out.push(a);
  }
  return [...new Set(out.map(x => String(x).trim()).filter(Boolean))].slice(0, 4);
}

function rankResults(query, results, classification) {
  const ranked = results.map(item => {
    const s = scoreResult(query, item, classification);
    const host = hostOf(item.url);
    const sourceType = (host === 'reddit.com' || host.endsWith('.reddit.com')) ? 'reddit' : 'web';
    return {
      ...item,
      sourceType,
      domain: host.replace(/^www\./, ''),
      score: s.score,
      confidence: s.confidence,
      reason: s.reason,
      signals: s.signals,
      aliases: aliasesFor(item, query),
      entityType: classification.type,
    };
  }).filter(r => r.score > 10 && (r.signals || []).length);
  ranked.sort((a, b) => b.score - a.score || String(a.domain).localeCompare(String(b.domain)));
  const seenHost = new Map();
  for (const r of ranked) {
    const n = seenHost.get(r.domain) || 0;
    if (n >= 3) r.score -= 12;
    seenHost.set(r.domain, n + 1);
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, MAX_RESULTS);
}

function usableImage(url) {
  if (typeof url !== 'string' || !url.startsWith('http')) return '';
  if (SKIP_IMAGE_RE.test(url)) return '';
  if (url.startsWith('data:')) return '';
  return url;
}

function rankImages(urls, pageUrl) {
  const scored = [];
  for (const raw of urls || []) {
    let abs = String(raw || '');
    if (!abs) continue;
    try { if (pageUrl) abs = new URL(decodeEntities(abs), pageUrl).href; } catch {}
    const u = usableImage(abs);
    if (!u) continue;
    let p = 1;
    if (/\.(jpe?g|webp)(\?|$)/i.test(u) && /\/(content|uploads?|media|photos?|wp-content|images\/content)\//i.test(u)) p = 5;
    else if (/\.(jpe?g|webp)(\?|$)/i.test(u)) p = 3;
    else if (/\.png(\?|$)/i.test(u)) p = 2;
    scored.push({ u, p });
  }
  scored.sort((a, b) => b.p - a.p);
  const seen = new Set();
  const out = [];
  for (const { u } of scored) {
    const k = u.replace(/[?#].*$/, '');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out;
}

async function enrichTopResults(results, classification) {
  const take = classification.type === 'person' || classification.isUrl ? 4 : 3;
  const picked = results.slice(0, take);
  for (const r of results.slice(take, 12)) {
    if (picked.length >= take + 2) break;
    const host = (r.domain || hostOf(r.url)).replace(/^www\./, '');
    if (PROFILE_HOST_RE.test(host) && !picked.includes(r)) picked.push(r);
  }
  await Promise.all(picked.map(async (item) => {
    if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) return;
    SEARCH_BUDGET.used++;
    try {
      const retrieved = await retrieveSource(item.url);
      item.retrievalStatus = retrieved.status;
      item.retrievedAt = retrieved.retrievedAt || null;
      if (retrieved.status === 'RETRIEVED') {
        if (retrieved.title && retrieved.title.length > 4 && (!item.title || item.title.length < retrieved.title.length)) {
          item.title = item.title || retrieved.title;
        }
        if ((!item.snippet || item.snippet.length < 40) && retrieved.description) item.snippet = retrieved.description;
        const imgs = rankImages([retrieved.ogImage, ...(retrieved.images || []), ...(item.images || [])], retrieved.finalUrl || item.url);
        item.images = imgs.slice(0, 8);
        item.image = item.images[0] || '';
        item.fingerprint = retrieved.fingerprint;
        item.textExcerpt = String(retrieved.textExcerpt || retrieved.text || '').slice(0, 1800);
        item.provenance = 'RETRIEVED';
        if (retrieved.identifiers) {
          item.aliases = [...new Set([...(item.aliases || []), ...(retrieved.identifiers.aliases || []), ...(retrieved.identifiers.handles || [])])].slice(0, 6);
          item.profiles = retrieved.identifiers.profiles;
        }
        if (retrieved.author) item.author = retrieved.author;
        if (retrieved.subreddit) item.subreddit = retrieved.subreddit;
        if (retrieved.published) item.published = retrieved.published;
      } else {
        item.provenance = item.provenance || 'DISCOVERED';
        item.retrievalError = retrieved.error || 'retrieval failed';
      }
    } catch (e) {
      item.provenance = 'DISCOVERED';
      item.retrievalError = String(e?.message || e).slice(0, 160);
    }
    if (item.provenance === 'RETRIEVED' && /official|profile|models\//i.test(item.reason || item.url)) {
      item.score = (item.score || 0) + 4;
    }
  }));
  results.sort((a, b) => (b.score || 0) - (a.score || 0));
  return results;
}

async function inspectDirectUrl(classification, results, seen, diagnostics) {
  if (!classification.isUrl || !classification.url) return null;
  const retrieved = await retrieveSource(classification.url);
  diagnostics.DirectURL = { status: retrieved.status === 'RETRIEVED' ? 200 : 422, ok: retrieved.status === 'RETRIEVED', error: retrieved.error };
  if (retrieved.status === 'RETRIEVED') {
    const imgs = rankImages([retrieved.ogImage, ...(retrieved.images || [])], retrieved.finalUrl || classification.url);
    const title = retrieved.title || humanizePath(classification.url) || classification.url;
    uniqueAdd(results, seen, {
      title,
      url: retrieved.finalUrl || retrieved.url || classification.url,
      source: 'Direct URL',
      snippet: retrieved.description || String(retrieved.textExcerpt || retrieved.text || '').slice(0, 400),
      image: imgs[0] || '',
      images: imgs,
      queryVariant: classification.url,
    });
    const row = results.find(r => r.url === (retrieved.finalUrl || retrieved.url) || r.url === classification.url);
    if (row) {
      row.provenance = 'RETRIEVED';
      row.retrievalStatus = 'RETRIEVED';
      row.textExcerpt = String(retrieved.textExcerpt || retrieved.text || '').slice(0, 1800);
      row.images = imgs;
      row.image = imgs[0] || row.image;
      row.fingerprint = retrieved.fingerprint;
      if (retrieved.identifiers) {
        row.aliases = [...new Set([...(row.aliases || []), ...(retrieved.identifiers.aliases || []), ...(retrieved.identifiers.handles || [])])].slice(0, 6);
        row.profiles = retrieved.identifiers.profiles;
      }
    }
  } else if (classification.isImage) {
    uniqueAdd(results, seen, {
      title: humanizePath(classification.url) || classification.url,
      url: classification.url,
      source: 'Direct image URL',
      snippet: 'Image URL submitted for inspection. Carmen did not invent this image.',
      image: classification.url,
      images: [classification.url],
      queryVariant: classification.url,
    });
  }
  return retrieved;
}

function humanizePath(url) {
  try {
    const p = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(p).replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  } catch { return ''; }
}

async function runDiscovery(query, opts = {}) {
  SEARCH_BUDGET = { used: 0, max: opts.budget || 36 };
  const q = String(query || '').trim().slice(0, 500);
  const classification = classifyQuery(q, opts.hint);
  const variants = buildSearchVariants(classification.isUrl ? (opts.displayQuery || q) : q, classification);
  if (Array.isArray(opts.extraQueries)) {
    for (const extra of opts.extraQueries) variants.push({ q: extra, why: 'deep-dive expansion' });
  }
  const results = [], seen = new Set(), diagnostics = {};
  if (!q) return { query: q, classification, variants, results, providers: diagnostics, count: 0 };

  if (classification.isUrl) {
    await inspectDirectUrl(classification, results, seen, diagnostics);
    const follow = variants.filter(v => v.q && v.q !== classification.url).slice(0, 1);
    if (!follow.length) {
      const host = hostOf(classification.url).replace(/^www\./, '');
      const pathName = humanizePath(classification.url);
      if (pathName && /[a-z]/i.test(pathName) && pathName.toLowerCase() !== host.split('.')[0]) follow.push({ q: pathName, why: 'name inferred from URL path' });
    }
    for (const variant of follow) {
      if (!variants.some(v => v.q === variant.q)) variants.push(variant);
      await Promise.all([
        ddg(variant.q, results, seen, diagnostics),
        bing(variant.q, results, seen, diagnostics),
        reddit(variant.q, results, seen, diagnostics),
      ]);
    }
  } else {
    const webVariants = variants.slice(0, 3);
    for (let i = 0; i < webVariants.length; i++) {
      const variant = webVariants[i];
      const jobs = [
        ddg(variant.q, results, seen, diagnostics),
        bing(variant.q, results, seen, diagnostics),
      ];
      if (i === 0) {
        jobs.push(reddit(variant.q, results, seen, diagnostics));
        jobs.push(wikipedia(variant.q, results, seen, diagnostics, classification));
      }
      await Promise.all(jobs);
      if (results.length >= MAX_RESULTS) break;
    }
    if (results.length < 6 && SEARCH_BUDGET.used < SEARCH_BUDGET.max) {
      await startpage(q, results, seen, diagnostics);
    }
  }

  let ranked = rankResults(classification.isUrl ? (humanizePath(classification.url) || q) : q, results, classification);
  if (opts.enrich !== false) ranked = await enrichTopResults(ranked, classification);

  for (const r of ranked) {
    if (!r.provenance) r.provenance = r.retrievalStatus === 'RETRIEVED' ? 'RETRIEVED' : 'DISCOVERED';
    if (!r.images) r.images = r.image ? [r.image] : [];
    r.observedAt = r.observedAt || new Date().toISOString();
  }

  let warning = ranked.length ? undefined : 'No public-web results were returned. Provider diagnostics are included for troubleshooting.';
  if (classification.isUrl && diagnostics.DirectURL && !diagnostics.DirectURL.ok) {
    const fail = 'Submitted URL could not be retrieved (' + (diagnostics.DirectURL.error || 'blocked or failed') + '). Carmen did not pretend to inspect it.';
    warning = warning ? fail + ' ' + warning : fail;
  }

  return {
    query: q,
    classification,
    variants,
    results: ranked,
    providers: diagnostics,
    count: ranked.length,
    paths: researchPaths(classification.type),
    warning,
  };
}

async function searchWeb(req) {
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') || '').trim().slice(0, 500);
  const hint = (u.searchParams.get('type') || u.searchParams.get('subject') || '').trim();
  if (!q) return json({ results: [], query: '', count: 0, providers: {}, classification: classifyQuery('') }, 200, req);
  const discovery = await runDiscovery(q, { hint, enrich: true });
  return json(discovery, 200, req);
}

// --- AI provider --------------------------------------------------------------
// Carmen talks to OpenRouter's OpenAI-compatible Chat Completions API.
// There is no silent fallback to api.openai.com / gpt-4.1-mini.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'openrouter/free';
const OPENAI_HOST_RE = /(^|\.)openai\.com$/i;

/** Resolve AI secret: prefer API_KEY, fall back to Api_key (existing CF binding name). */
function getApiKey(env) {
  return env.API_KEY || env.Api_key || '';
}

function trimmedEnv(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function getAiConfig(env) {
  const apiKey = getApiKey(env);
  let apiUrl = trimmedEnv(env.API_URL) || OPENROUTER_URL;
  let model = trimmedEnv(env.MODEL) || OPENROUTER_MODEL;
  let host = '';
  try { host = new URL(apiUrl).hostname.toLowerCase(); } catch {
    apiUrl = OPENROUTER_URL;
    host = 'openrouter.ai';
  }
  // Leftover OpenAI env vars must not hijack the provider.
  if (OPENAI_HOST_RE.test(host) || /^gpt-4\.1-mini$/i.test(model)) {
    apiUrl = OPENROUTER_URL;
    model = OPENROUTER_MODEL;
    host = 'openrouter.ai';
  }
  const provider = (host === 'openrouter.ai' || host.endsWith('.openrouter.ai')) ? 'openrouter' : (host || 'openrouter');
  return { apiKey, apiUrl, model, provider, configured: !!apiKey };
}

function extractMessageContent(j) {
  const choice = j?.choices?.[0];
  const raw = choice?.message?.content ?? choice?.text ?? '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw.map(part => {
      if (typeof part === 'string') return part;
      if (part && typeof part.text === 'string') return part.text;
      if (part && typeof part.content === 'string') return part.content;
      return '';
    }).join('');
  }
  return '';
}

async function provider(env, messages, temperature = 0.2) {
  const cfg = getAiConfig(env);
  if (!cfg.apiKey) throw Error('AI provider is not configured. Add the API_KEY Worker secret before using Carmen AI.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const r = await fetch(cfg.apiUrl, {
      method: 'POST', signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
        'HTTP-Referer': 'https://carmen-iphone-v25.94bwfd5grv.workers.dev/',
        'X-Title': 'Carmen',
      },
      body: JSON.stringify({ model: cfg.model, temperature, messages }),
    });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { throw Error(`AI provider returned HTTP ${r.status}`); }
    if (!r.ok) {
      const msg = (j && j.error && (j.error.message || j.error)) || `AI provider returned HTTP ${r.status}`;
      throw Error(typeof msg === 'string' ? msg : `AI provider returned HTTP ${r.status}`);
    }
    return j;
  } finally { clearTimeout(timer); }
}

const CARMEN_SYSTEM = 'You are Carmen, a conservative AI research assistant for adult users. Be concise and useful. Clearly distinguish OBSERVED (directly stated/visible), INFERRED (labeled interpretation), and UNKNOWN. Never invent facts, sources, URLs, dates, or evidence. Never claim something was saved or sent unless the user explicitly requested it. Never autonomously contact people, send messages, post, comment, submit forms, make purchases, create accounts, perform transactions, or take any external action. You may research, analyze, organize, and prepare information only. For sexual or self-bondage topics, do not provide explicit step-by-step sexual or self-bondage instructions; you may organize public sources, terminology, visual references, and research questions. For general skills and crafts you may outline procedures only when they are grounded in retrieved sources.';

async function chat(req, env) {
  try {
    const b = await req.json();
    const subject = b.subject ? `Investigation subject: ${JSON.stringify(b.subject)}. ` : '';
    const messages = [{ role: 'system', content: CARMEN_SYSTEM + ' ' + subject + 'Context: ' + JSON.stringify(b.context || {}) }];
    for (const m of Array.isArray(b.messages) ? b.messages : []) {
      if (m && typeof m.content === 'string') messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content.slice(0, 20000) });
    }
    const j = await provider(env, messages, 0.3);
    return json({ text: extractMessageContent(j) }, 200, req);
  } catch (e) { return json({ error: e?.name === 'AbortError' ? 'AI provider timed out.' : e?.message || String(e) }, 500, req); }
}

function validateImage(x) {
  if (typeof x !== 'string' || !x.startsWith('data:image/')) throw Error('imageDataUrl must be an image data URL');
  if (x.length > 16000000) throw Error('Image is too large. Use a smaller screenshot.');
}

function parseModelJson(raw) {
  const clean = String(raw || '').trim();
  if (!clean) throw Error('AI provider returned invalid JSON.');
  const candidates = [clean];
  const unfenced = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (unfenced && unfenced !== clean) candidates.push(unfenced);
  const fence = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) candidates.push(fence[1].trim());
  for (const c of candidates) {
    try { return JSON.parse(c); } catch {}
    const a = c.indexOf('{'), b = c.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(c.slice(a, b + 1)); } catch {} }
  }
  throw Error('AI provider returned invalid JSON.');
}

async function structuredVision(req, env, body, mode) {
  if (!getApiKey(env)) throw Error('AI provider is not configured. Add the API_KEY Worker secret before using Carmen AI.');
  let content;
  if (mode === 'analyze') {
    validateImage(body.imageDataUrl);
    content = [
      { type: 'text', text: 'You are Carmen, a conservative visual-evidence analyst. Return ONLY valid JSON with exactly these keys: title, observations, inferences, unknowns, relationships, candidatePatterns, signature, audit. Observations are directly visible only. Inferences are labeled interpretations. Never invent identity, intent, ownership, price, location, safety, authenticity, or obscured details. CandidatePatterns are hypotheses, not facts. Page URL: ' + String(body.pageUrl || '') + '\nSource type: ' + String(body.sourceType || 'web') + '\nSource name: ' + String(body.sourceName || '') + '\nContext: ' + String(body.pageContext || '') },
      { type: 'image_url', image_url: { url: body.imageDataUrl } },
    ];
  } else {
    const refs = Array.isArray(body.references) ? body.references : [];
    if (refs.length < 2) throw Error('Select at least 2 saved references to compare.');
    if (refs.length > 4) throw Error('Compare up to 4 references at once.');
    content = [{ type: 'text', text: 'You are Carmen performing conservative evidence synthesis. Return ONLY valid JSON with exactly these keys: summary, consistentFindings, differences, candidatePatterns, leads, unknowns, audit. Compare only visible or explicitly supplied evidence. Do not identify people or infer intent, ownership, price, location, authenticity, or hidden facts. User question: ' + String(body.question || 'Compare these references and identify useful similarities, differences, and patterns.') }];
    refs.forEach((r, i) => {
      content.push({ type: 'text', text: `REFERENCE ${i + 1}: ${String(r.title || 'Untitled')} | URL: ${String(r.url || '')} | Source type: ${String(r.sourceType || 'web')} | Source name: ${String(r.sourceName || '')} | Context: ${String(r.context || '')}` });
      if (typeof r.imageDataUrl === 'string' && r.imageDataUrl.startsWith('data:image/')) { validateImage(r.imageDataUrl); content.push({ type: 'image_url', image_url: { url: r.imageDataUrl } }); }
    });
  }
  const j = await provider(env, [{ role: 'user', content }], 0);
  return parseModelJson(extractMessageContent(j));
}

async function analyze(req, env) { try { return json(await structuredVision(req, env, await req.json(), 'analyze'), 200, req); } catch (e) { return json({ error: e?.name === 'AbortError' ? 'AI provider timed out.' : e?.message || String(e) }, 500, req); } }
async function synthesize(req, env) { try { return json(await structuredVision(req, env, await req.json(), 'synthesize'), 200, req); } catch (e) { return json({ error: e?.name === 'AbortError' ? 'AI provider timed out.' : e?.message || String(e) }, 500, req); } }

async function imageProxy(req) {
  const target = new URL(req.url).searchParams.get('u') || '';
  if (!/^https?:\/\//i.test(target)) return new Response('Bad image URL', { status: 400, headers: cors(req) });
  let host = '';
  try { host = new URL(target).hostname; } catch { return new Response('Bad image URL', { status: 400, headers: cors(req) }); }
  if (PRIVATE_HOST_RE.test(host) || BLOCKED_HOSTS.has(host.toLowerCase())) {
    return new Response('Blocked host', { status: 403, headers: cors(req) });
  }
  try {
    const r = await fetchText(target, {
      headers: { ...BROWSER_HEADERS, accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', referer: new URL(target).origin + '/' },
      redirect: 'follow',
    }, 8000);
    if (!r.ok) return new Response('Upstream ' + r.status, { status: 502, headers: cors(req) });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct && !ct.startsWith('image/') && !ct.includes('octet-stream') && !ct.includes('binary')) {
      return new Response('Not an image', { status: 415, headers: cors(req) });
    }
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 2500000) return new Response('Too large', { status: 413, headers: cors(req) });
    return new Response(buf, {
      status: 200,
      headers: {
        ...cors(req),
        'content-type': ct.startsWith('image/') ? ct.split(';')[0] : 'image/jpeg',
        'cache-control': 'public, max-age=86400',
      },
    });
  } catch (e) {
    return new Response('Image fetch failed', { status: 502, headers: cors(req) });
  }
}

function collectDiveImages(retrieved, results) {
  const out = [], seen = new Set();
  const add = (url, pageUrl, source) => {
    const u = usableImage(url);
    if (!u) return;
    const key = u.replace(/[?#].*$/, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      url: u,
      sourceUrl: u,
      pageUrl: pageUrl || '',
      domain: hostOf(pageUrl || u).replace(/^www\./, ''),
      source: source || 'retrieved page',
      retrievedAt: new Date().toISOString(),
    });
  };
  for (const page of retrieved || []) {
    if (page.ogImage) add(page.ogImage, page.finalUrl || page.url, 'og:image');
    for (const img of page.images || []) add(img, page.finalUrl || page.url, 'page image');
  }
  for (const r of results || []) {
    if (r.image) add(r.image, r.url, r.source);
    for (const img of r.images || []) add(img, r.url, r.source);
  }
  return out.slice(0, 24);
}

async function deepDiveHandler(req, env) {
  try {
    const b = await req.json().catch(() => ({}));
    const query = String(b.query || b.subjectQuery || '').trim().slice(0, 500);
    const candidate = b.candidate && typeof b.candidate === 'object' ? b.candidate : null;
    const hint = String(b.subject || b.type || '').trim();
    if (!query && !(candidate && candidate.url)) {
      return json({ error: 'Select a candidate or enter a subject before running Deep Dive.' }, 400, req);
    }
    const seed = query || String(candidate.title || '').trim();
    const classification = classifyQuery(seed, hint);
    const resolved = resolveDivePaths(classification.type, b);
    const selectedPaths = resolved.selected;
    const selectedIds = new Set(selectedPaths.map(p => p.id));
    const customQuestion = resolved.custom || String(b.customQuestion || b.instructions || '').trim();
    const extra = [];
    const retrieved = [];
    const seenUrl = new Set();
    const pushRet = async (url) => {
      if (!url || seenUrl.has(url) || retrieved.length >= 6) return;
      seenUrl.add(url);
      retrieved.push(await retrieveSource(url));
    };
    if (candidate?.url) await pushRet(candidate.url);
    const focus = retrieved[0];
    const ids = (focus && focus.identifiers) || { profiles: [], handles: [], aliases: [] };
    if (candidate?.url) {
      const host = hostOf(candidate.url).replace(/^www\./, '');
      if (host) extra.push('"' + seed.replace(/"/g, '') + '" site:' + host);
    }
    for (const h of (ids.handles || []).slice(0, 2)) extra.push(h);
    if (classification.type === 'person') extra.push('"' + seed.replace(/"/g, '') + '" (profile OR official OR website)');
    if (classification.type === 'technique') extra.push(seed + ' tutorial OR diagram');
    if (classification.type === 'skill' || classification.type === 'project') extra.push(seed + ' procedure OR safety');
    for (const v of pathSearchVariants(seed, selectedPaths)) extra.push(v.q);
    extra.push(seed + ' reddit');
    const plan = {
      subject: seed,
      type: classification.type,
      why: classification.reason,
      focusUrl: candidate?.url || '',
      all: resolved.all,
      selectedPaths: selectedPaths.map(p => p.id),
      customQuestion,
      investigating: [
        resolved.all ? 'Investigate all relevant research paths for this entity type' : ('Investigate selected paths: ' + selectedPaths.map(p => p.label).join(', ')),
        customQuestion ? ('User question: ' + customQuestion.slice(0, 180)) : 'No custom question — follow the selected paths',
        candidate?.url ? 'Retrieve the selected source page and public identifiers found on it' : 'Retrieve the strongest public sources',
        selectedIds.has('images') || selectedIds.has('visuals') ? 'Collect images with page provenance' : 'Images collected only when they appear on retrieved pages',
        selectedIds.has('videos') ? 'Collect playable or openable public videos' : 'Video collection skipped unless a source page includes one',
        'Separate OBSERVED / INFERRED / UNKNOWN — visual likeness is not identity proof',
      ],
      variants: extra.slice(0, 8),
      identifiers: ids,
      safety: 'Read-only public research. Carmen will not contact anyone, send messages, post, or take external actions.',
    };

    const discovery = await runDiscovery(seed, { hint: classification.type, extraQueries: extra.slice(0, 4), enrich: true });
    for (const p of (ids.profiles || []).slice(0, 3)) await pushRet(p);
    const rankedForRetrieve = [...discovery.results].sort((a, b) => {
      let sa = 0, sb = 0;
      if (selectedIds.has('videos')) { sa += isVideoHost(a.url) ? 10 : 0; sb += isVideoHost(b.url) ? 10 : 0; }
      if (selectedIds.has('images') || selectedIds.has('visuals')) { sa += a.image ? 3 : 0; sb += b.image ? 3 : 0; }
      return sb - sa || (b.score || 0) - (a.score || 0);
    });
    for (const r of rankedForRetrieve) {
      if (retrieved.length >= 6) break;
      const h = hostOf(r.url);
      if (TUBE_INDEX_RE.test(h) && r.url !== candidate?.url) continue;
      await pushRet(r.url);
    }
    const images = collectDiveImages(retrieved, discovery.results);
    const videos = (resolved.all || selectedIds.has('videos')) ? collectDiveVideos(retrieved, discovery.results) : [];

    let analysis = '';
    let analysisError = '';
    const excerpts = retrieved.filter(x => x.status === 'RETRIEVED').map(x => ({
      title: x.title, url: x.url, provenance: 'RETRIEVED',
      excerpt: String(x.textExcerpt || x.text || '').slice(0, 1800),
    }));
    try {
      const j = await provider(env, [
        { role: 'system', content: CARMEN_SYSTEM },
        { role: 'user', content: `Deep-dive investigation for Carmen.
Entity type: ${classification.type}
Subject: ${seed}
Selected research paths (${resolved.all ? 'ALL' : 'subset'}):
${selectedPaths.map(p => p.label).join('\n')}
${customQuestion ? 'User research question (direction only, never actions):\n' + customQuestion.slice(0, 2000) + '\n' : ''}
${b.instructions && b.instructions !== customQuestion ? 'Additional notes:\n' + String(b.instructions).slice(0, 1500) + '\n' : ''}
Focus source: ${candidate?.url || 'none selected'}

Rules:
- Investigate ONLY the selected research paths. Do not pad unselected areas.
- Separate OBSERVED / INFERRED / UNKNOWN as labeled headings under each path.
- Organize the writeup using these research headings, in order:
${selectedPaths.map(p => p.label).join('\n')}
- Prefer RETRIEVED excerpts over search snippets.
- Never invent URLs, dates, or identities.
- Images showing similar appearance across sources are OBSERVED visual consistency, NOT identity proof. Never say they are definitely the same person.
- List publicly visible handles, domains, and aliases only if they appear in the sources.
- Suggest research leads as questions/sources to review, never as actions to take.
- After the writeup, list related public aspects the user could investigate next as:
RELATED
- kind: label — why
Kinds: person, technique, object, place, source, product, video. Only from retrieved material. Never invent.

Retrieved sources:
${JSON.stringify(excerpts)}

Discovery results (may be snippets only):
${JSON.stringify(discovery.results.slice(0, 8).map(r => ({ title: r.title, url: r.url, source: r.source, snippet: r.snippet, reason: r.reason, provenance: r.provenance })))}` },
      ], 0.2);
      analysis = extractMessageContent(j);
    } catch (e) {
      analysisError = e?.name === 'AbortError' ? 'AI provider timed out.' : (e?.message || String(e));
    }

    const leads = [];
    for (const r of discovery.results.slice(0, 6)) {
      if (r.confidence === 'high' || r.confidence === 'medium') {
        leads.push({ text: `Review ${r.title} (${r.domain}) — ${r.reason}`, url: r.url, status: 'new' });
      }
    }
    const parsedRelated = parseRelated(analysis);
    const related = parsedRelated.length ? parsedRelated : relatedFromDiscovery(discovery.results, candidate);
    const suggestions = [];
    if (discovery.results.length) suggestions.push('Carmen found ' + discovery.results.length + ' public sources that may be relevant.');
    if (videos.length) suggestions.push(videos.length + ' public video source' + (videos.length === 1 ? '' : 's') + ' surfaced.');
    if (related.length) suggestions.push('Would you like to investigate a related entity without leaving this case?');

    return json({
      plan,
      classification,
      results: discovery.results,
      retrieved,
      images,
      videos,
      analysis,
      analysisError,
      leads,
      related,
      suggestions,
      paths: selectedPaths,
      availablePaths: researchPaths(classification.type),
      selectedPathIds: selectedPaths.map(p => p.id),
      all: resolved.all,
      customQuestion,
      providers: discovery.providers,
      query: seed,
    }, 200, req);
  } catch (e) {
    return json({ error: e?.name === 'AbortError' ? 'Deep Dive timed out.' : e?.message || String(e) }, 500, req);
  }
}

async function learnHandler(req, env) {
  try {
    const b = await req.json().catch(() => ({}));
    const query = String(b.query || b.subject || '').trim().slice(0, 500);
    if (!query) return json({ error: 'Enter something you want to learn or understand.' }, 400, req);
    const hint = String(b.type || b.subject || '').trim();
    const classification = classifyQuery(query, hint);
    const paths = researchPaths(classification.type);
    const discovery = await runDiscovery(query, { hint: classification.type, enrich: true });
    const retrieved = [];
    const seen = new Set();
    for (const r of discovery.results) {
      if (retrieved.length >= 5) break;
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      retrieved.push(await retrieveSource(r.url));
    }
    const images = collectDiveImages(retrieved, discovery.results);
    const excerpts = retrieved.filter(x => x.status === 'RETRIEVED').map(x => ({
      title: x.title, url: x.url, provenance: 'RETRIEVED',
      excerpt: String(x.textExcerpt || x.text || '').slice(0, 1600),
    }));
    let lesson = '';
    let analysisError = '';
    try {
      const j = await provider(env, [
        { role: 'system', content: CARMEN_SYSTEM + ' You teach from public sources. Never instruct anyone to take external actions on other people. Safety notes are research, not a command to act.' },
        { role: 'user', content: `Turn this public-web research into a conservative learning brief for Carmen.

Entity type: ${classification.type}
Subject: ${query}
${b.instructions ? 'Learner notes (direction only):\n' + String(b.instructions).slice(0, 1500) + '\n' : ''}

Write using these headings:
${paths.map(p => p.label).join('\n')}

Rules:
- Separate OBSERVED / INFERRED / UNKNOWN inside headings.
- Ground claims in retrieved excerpts. Never invent steps, measurements, or part numbers.
- If sources disagree, say so.
- For skills/projects, include safety as UNKNOWN where sources do not specify it.
- Suggest next questions and public references, never actions that contact people or buy things.

Retrieved sources:
${JSON.stringify(excerpts)}

Discovery results:
${JSON.stringify(discovery.results.slice(0, 8).map(r => ({ title: r.title, url: r.url, snippet: r.snippet, reason: r.reason, provenance: r.provenance })))}` },
      ], 0.2);
      lesson = extractMessageContent(j);
    } catch (e) {
      analysisError = e?.name === 'AbortError' ? 'AI provider timed out.' : (e?.message || String(e));
    }
    return json({
      classification,
      paths,
      results: discovery.results,
      retrieved,
      images,
      lesson,
      analysis: lesson,
      analysisError,
      providers: discovery.providers,
      query,
      safety: 'Read-only learning from public sources. Carmen will not contact anyone or take external actions.',
    }, 200, req);
  } catch (e) {
    return json({ error: e?.name === 'AbortError' ? 'Learn timed out.' : e?.message || String(e) }, 500, req);
  }
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response('', { headers: cors(req) });
    if (u.pathname === '/health' && req.method === 'GET') {
      const ai = getAiConfig(env);
      return json({
        ok: true,
        worker: 'carmen',
        version: '40',
        build: 'workspace',
        schemaVersion: 2,
        provider: ai.provider,
        model: ai.model,
        configured: ai.configured,
        routes: ['/health', '/search', '/retrieve', '/source', '/img', '/dive', '/learn', '/chat', '/analyze', '/synthesize'],
        searchProviders: ['DuckDuckGo', 'Bing', 'Reddit', 'Wikipedia', 'Startpage'],
        assets: !!(env.ASSETS && typeof env.ASSETS.fetch === 'function'),
        features: ['discovery', 'retrieve', 'provenance', 'ranking', 'images', 'videos', 'deep-dive', 'dive-select', 'learn', 'collections', 'adaptive-paths', 'branching', 'instructions', 'timeline', 'evidence', 'leads'],
      }, 200, req);
    }
    if (u.pathname === '/search' && req.method === 'GET') return searchWeb(req);
    if (u.pathname === '/img' && req.method === 'GET') return imageProxy(req);
    if (u.pathname === '/dive' && req.method === 'POST') return deepDiveHandler(req, env);
    if (u.pathname === '/learn' && req.method === 'POST') return learnHandler(req, env);
    if (u.pathname === '/chat' && req.method === 'POST') return chat(req, env);
    if (u.pathname === '/analyze' && req.method === 'POST') return analyze(req, env);
    if (u.pathname === '/synthesize' && req.method === 'POST') return synthesize(req, env);
    if ((u.pathname === '/retrieve' || u.pathname === '/source') && (req.method === 'GET' || req.method === 'POST')) return retrieveHandler(req);
    // SPA fallback: serve static assets for everything else.
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(req);
    return new Response('Carmen static assets binding is missing. Set the ASSETS binding in wrangler.jsonc.', { status: 500, headers: { ...cors(req), 'content-type': 'text/plain; charset=utf-8' } });
  },
};

// --- Source retrieval layer (Phase 2) ---------------------------------------
const RETRIEVE_TIMEOUT_MS = 12000;
const MAX_RETRIEVE_BYTES = 1500000;
const MAX_TEXT_CHARS = 100000;
const MAX_IMAGES = 12;
const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\]|\[fd)/i;

function normalizeUrlForStore(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    if (!/^https?:$/i.test(u.protocol)) return '';
    u.hash = '';
    return u.href;
  } catch { return ''; }
}

function extractMeta(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i) || [])[1] || '';
  const ogImage = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:image["']/i) || [])[1] || '';
  const ogVideo = (html.match(/<meta[^>]+property=["']og:video(?::url)?["'][^>]+content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:video(?::url)?["']/i) || [])[1] || '';
  return {
    title: cleanText(title).slice(0, 300),
    description: cleanText(desc).slice(0, 600),
    ogImage: decodeEntities(ogImage),
    ogVideo: decodeEntities(ogVideo),
  };
}

function extractPublicIdentifiers(html, pageUrl) {
  const profiles = [];
  const handles = [];
  const aliases = [];
  const seen = new Set();
  const addProfile = (href) => {
    try {
      const u = new URL(decodeEntities(href), pageUrl);
      const host = u.hostname.replace(/^www\./, '').toLowerCase();
      if (!/^(x\.com|twitter\.com|instagram\.com|onlyfans\.com|linkedin\.com)$/.test(host)) return;
      const parts = u.pathname.split('/').filter(Boolean);
      let part = parts[0];
      if (host === 'linkedin.com') part = parts[0] === 'in' || parts[0] === 'company' ? parts[1] : '';
      if (!part || /^(intent|share|search|i|p|reel|explore|login|signup|cdn-cgi)$/i.test(part)) return;
      if (/\.(ico|png|jpe?g|gif|svg|xml|json|css|js|webp|woff2?)$/i.test(part)) return;
      const url = (host === 'linkedin.com' ? ('https://www.linkedin.com/in/' + part) : ('https://' + host + '/' + part));
      if (seen.has(url.toLowerCase())) return;
      seen.add(url.toLowerCase());
      profiles.push(url);
      handles.push('@' + part.replace(/^@/, ''));
    } catch {}
  };
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html || '')) && profiles.length < 8) addProfile(m[1]);
  const creator = (html || '').match(/twitter:creator["'][^>]*content=["']@?([^"'>\s]+)/i)
    || (html || '').match(/content=["']@?([^"'>\s]+)["'][^>]*twitter:creator/i);
  if (creator && creator[1]) handles.push('@' + creator[1].replace(/^@/, ''));
  const pathAlias = humanizePath(pageUrl);
  if (pathAlias && /[A-Za-z]/.test(pathAlias) && pathAlias.length >= 4) aliases.push(pathAlias);
  return {
    profiles: [...new Set(profiles)].slice(0, 6),
    handles: [...new Set(handles)].slice(0, 6),
    aliases: [...new Set(aliases)].slice(0, 4),
  };
}

function simpleFingerprint(text) {
  let h = 0;
  const s = String(text || '').slice(0, 50000);
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return 'fp_' + (h >>> 0).toString(16);
}

async function retrieveSource(targetUrl) {
  const url = normalizeUrlForStore(targetUrl);
  if (!url) return { status: 'RETRIEVAL_FAILED', error: 'Invalid URL', url: targetUrl };
  let host = '';
  try { host = new URL(url).hostname; } catch { return { status: 'RETRIEVAL_FAILED', error: 'Invalid URL', url }; }
  if (PRIVATE_HOST_RE.test(host) || BLOCKED_HOSTS.has(host.toLowerCase())) {
    return { status: 'RETRIEVAL_FAILED', error: 'Private or blocked host', url, host };
  }
  if (/(^|\.)reddit\.com$/i.test(host)) {
    try {
      const jsonUrl = /\.json(\?|$)/i.test(url) ? url : url.replace(/\/?(\?.*)?$/, '') + '.json';
      const rr = await fetchText(jsonUrl, { headers: { ...BROWSER_HEADERS, accept: 'application/json' }, redirect: 'follow' }, RETRIEVE_TIMEOUT_MS);
      if (rr.ok) {
        const j = await rr.json();
        const post = Array.isArray(j) ? j[0]?.data?.children?.[0]?.data : j?.data?.children?.[0]?.data;
        if (post && (post.title || post.body || post.selftext)) {
          const text = cleanText((post.title || '') + ' ' + (post.selftext || post.body || '')).slice(0, MAX_TEXT_CHARS);
          const images = [];
          const preview = post.preview?.images?.[0]?.source?.url;
          if (preview) images.push(decodeEntities(preview));
          if (typeof post.thumbnail === 'string' && post.thumbnail.startsWith('http')) images.push(post.thumbnail);
          if (typeof post.url_overridden_by_dest === 'string' && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(post.url_overridden_by_dest)) images.push(post.url_overridden_by_dest);
          return {
            status: 'RETRIEVED',
            url,
            finalUrl: post.permalink ? ('https://www.reddit.com' + post.permalink) : url,
            title: post.title || 'Reddit post',
            description: String(post.selftext || post.body || '').slice(0, 600),
            text,
            textExcerpt: text,
            ogImage: images[0] || '',
            images: images.slice(0, MAX_IMAGES),
            fingerprint: simpleFingerprint(text),
            retrievedAt: new Date().toISOString(),
            author: post.author || '',
            subreddit: post.subreddit_name_prefixed || (post.subreddit ? 'r/' + post.subreddit : ''),
            published: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : '',
            contentType: 'application/json',
          };
        }
      }
    } catch {}
  }
  try {
    const r = await fetchText(url, { headers: BROWSER_HEADERS, redirect: 'follow' }, RETRIEVE_TIMEOUT_MS);
    if (!r.ok) return { status: 'RETRIEVAL_FAILED', error: `HTTP ${r.status}`, url, httpStatus: r.status };
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_RETRIEVE_BYTES) {
      return { status: 'RETRIEVAL_FAILED', error: 'Response too large', url, bytes: buf.byteLength };
    }
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.startsWith('image/')) {
      return {
        status: 'RETRIEVED',
        url,
        finalUrl: r.url || url,
        title: humanizePath(url) || host,
        description: 'Direct image resource',
        text: '',
        textExcerpt: '',
        ogImage: r.url || url,
        images: [r.url || url],
        fingerprint: simpleFingerprint(url + buf.byteLength),
        retrievedAt: new Date().toISOString(),
        bytes: buf.byteLength,
        contentType: ct,
        identifiers: { profiles: [], handles: [], aliases: [] },
      };
    }
    const html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    const meta = extractMeta(html);
    const text = cleanText(html).slice(0, MAX_TEXT_CHARS);
    const rawImgs = [];
    if (meta.ogImage) rawImgs.push(meta.ogImage);
    const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;
    let m;
    while ((m = imgRe.exec(html)) && rawImgs.length < 40) rawImgs.push(m[1]);
    const images = rankImages(rawImgs, r.url || url).slice(0, MAX_IMAGES);
    const identifiers = extractPublicIdentifiers(html, r.url || url);
    let ogAbs = meta.ogImage;
    try { if (ogAbs) ogAbs = new URL(decodeEntities(ogAbs), r.url || url).href; } catch {}
    let ogVideo = meta.ogVideo || '';
    try { if (ogVideo) ogVideo = new URL(decodeEntities(ogVideo), r.url || url).href; } catch {}
    return {
      status: 'RETRIEVED',
      url,
      finalUrl: r.url || url,
      title: meta.title,
      description: meta.description,
      text,
      textExcerpt: text,
      ogImage: ogAbs || images[0] || '',
      ogVideo,
      images,
      fingerprint: simpleFingerprint(text),
      retrievedAt: new Date().toISOString(),
      bytes: buf.byteLength,
      contentType: r.headers.get('content-type') || '',
      identifiers,
    };
  } catch (e) {
    return {
      status: 'RETRIEVAL_FAILED',
      error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 300),
      url,
    };
  }
}

async function retrieveHandler(req) {
  try {
    let target = '';
    if (req.method === 'GET') {
      target = new URL(req.url).searchParams.get('url') || '';
    } else {
      const b = await req.json().catch(() => ({}));
      target = b.url || b.target || '';
    }
    if (!target) return json({ error: 'Missing url parameter' }, 400, req);
    const result = await retrieveSource(target);
    return json(result, result.status === 'RETRIEVAL_FAILED' ? 422 : 200, req);
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500, req);
  }
}

export { classifyQuery, scoreResult, buildSearchVariants, decodeEntities, rankResults, humanizePath, researchPaths, resolveDivePaths, inferPathsFromQuestion, pathSearchVariants, youtubeId, collectDiveVideos, parseRelated };
