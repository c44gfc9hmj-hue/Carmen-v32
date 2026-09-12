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

function unescapeJsonUrl(s) {
  return decodeEntities(String(s || '').replace(/\\u0026/g, '&').replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/\\"/g, '"'));
}

function attachImageHit(results, seen, hit, diagnosticsKey) {
  const image = usableImage(hit.image) || usableImage(hit.thumb);
  if (!image) return false;
  const pageUrl = unwrap(hit.pageUrl || '');
  if (pageUrl && validUrl(pageUrl)) {
    const existing = results.find(r => r.url === pageUrl || (hostOf(r.url) === hostOf(pageUrl) && hostOf(pageUrl)));
    if (existing) {
      existing.images = rankImages([...(existing.images || []), image, hit.thumb], existing.url).slice(0, 8);
      existing.image = existing.image || existing.images[0] || '';
      existing.imageOrigin = existing.imageOrigin || 'image-index';
      return true;
    }
  }
  const title = cleanTitle(hit.title) || 'Public image result';
  const url = (pageUrl && validUrl(pageUrl)) ? pageUrl : image;
  return uniqueAdd(results, seen, {
    title,
    url,
    source: diagnosticsKey || 'Image index',
    snippet: 'Public image-index result. Attribution is the hosting page — visual likeness is not identity proof.',
    image,
    images: [image, hit.thumb].filter(Boolean),
    queryVariant: hit.query || '',
  });
}

async function bingImages(q, results, seen, diagnostics) {
  if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) {
    diagnostics['Bing Images'] = { error: 'skipped (fetch budget)' };
    return;
  }
  SEARCH_BUDGET.used++;
  try {
    const r = await fetchText('https://www.bing.com/images/search?q=' + encodeURIComponent(q) + '&adlt=off', { headers: BROWSER_HEADERS });
    diagnostics['Bing Images'] = { status: r.status, ok: r.ok };
    if (!r.ok) return;
    const html = await r.text();
    const re = /"murl":"([^"]+)","turl":"([^"]+)"[\s\S]{0,400}?"purl":"([^"]+)"[\s\S]{0,200}?"t":"([^"]*)"/g;
    let m, added = 0;
    while ((m = re.exec(html)) && added < 10) {
      const hit = {
        image: unescapeJsonUrl(m[1]),
        thumb: unescapeJsonUrl(m[2]),
        pageUrl: unescapeJsonUrl(m[3]),
        title: unescapeJsonUrl(m[4]),
        query: q,
      };
      if (attachImageHit(results, seen, hit, 'Bing Images')) added++;
    }
    if (!added) {
      const loose = /"murl":"([^"]+)"/g;
      const purl = /"purl":"([^"]+)"/g;
      const images = [];
      const pages = [];
      let x;
      while ((x = loose.exec(html)) && images.length < 10) images.push(unescapeJsonUrl(x[1]));
      while ((x = purl.exec(html)) && pages.length < 10) pages.push(unescapeJsonUrl(x[1]));
      for (let i = 0; i < images.length && added < 8; i++) {
        if (attachImageHit(results, seen, { image: images[i], pageUrl: pages[i] || '', title: q, query: q }, 'Bing Images')) added++;
      }
    }
    diagnostics['Bing Images'].added = added;
  } catch (e) {
    diagnostics['Bing Images'] = { error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 200) };
  }
}

async function bingVideos(q, results, seen, diagnostics) {
  if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) {
    diagnostics['Bing Videos'] = { error: 'skipped (fetch budget)' };
    return;
  }
  SEARCH_BUDGET.used++;
  try {
    const r = await fetchText('https://www.bing.com/videos/search?q=' + encodeURIComponent(q) + '&adlt=off', { headers: BROWSER_HEADERS });
    diagnostics['Bing Videos'] = { status: r.status, ok: r.ok };
    if (!r.ok) return;
    const html = await r.text();
    const before = results.length;
    parseAnchors(html, 'Bing Videos', results, seen, MAX_RESULTS);
    diagnostics['Bing Videos'].added = Math.max(0, results.length - before);
  } catch (e) {
    diagnostics['Bing Videos'] = { error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 200) };
  }
}

function extractImagesFromHtml(html, pageUrl) {
  const raw = [];
  const push = (u) => { if (u && typeof u === 'string') raw.push(u); };
  const tw = String(html || '').match(/<meta[^>]+(?:name|property)=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)/i)
    || String(html || '').match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']twitter:image/i);
  if (tw) push(tw[1]);
  const link = String(html || '').match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)/i);
  if (link) push(link[1]);
  const imgRe = /<img\b([^>]*)>/gi;
  let m;
  while ((m = imgRe.exec(html || '')) && raw.length < 80) {
    const tag = m[1];
    const src = (tag.match(/\ssrc=["']([^"']+)/i) || [])[1];
    const data = (tag.match(/\s(?:data-src|data-lazy-src|data-original|data-url)=["']([^"']+)/i) || [])[1];
    const srcset = (tag.match(/\ssrcset=["']([^"']+)/i) || [])[1];
    if (srcset) {
      const parts = srcset.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
      if (parts.length) push(parts[parts.length - 1]);
    }
    push(data);
    push(src);
  }
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = ldRe.exec(html || '')) && raw.length < 100) {
    try {
      const j = JSON.parse(m[1]);
      const walk = (o) => {
        if (!o || raw.length > 100) return;
        if (typeof o === 'string' && /^https?:/i.test(o)) push(o);
        else if (Array.isArray(o)) o.slice(0, 8).forEach(walk);
        else if (typeof o === 'object') {
          if (o.image) walk(o.image);
          if (o.thumbnailUrl) walk(o.thumbnailUrl);
          if (o.contentUrl) walk(o.contentUrl);
          if (o.url && typeof o.url === 'string' && /\.(jpe?g|png|webp)/i.test(o.url)) walk(o.url);
        }
      };
      walk(j);
    } catch {}
  }
  return rankImages(raw, pageUrl);
}

function galleryLinks(html, pageUrl) {
  const out = [];
  let pageHost = '';
  try { pageHost = new URL(pageUrl).hostname; } catch { return out; }
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html || '')) && out.length < 4) {
    try {
      const u = new URL(decodeEntities(m[1]), pageUrl);
      if (u.hostname !== pageHost) continue;
      if (/\/(gallery|galleries|photos?|images|pictures|press|media|portfolio)(\/|$)/i.test(u.pathname)) {
        const href = u.href.split('#')[0];
        if (!out.includes(href) && href !== pageUrl) out.push(href);
      }
    } catch {}
  }
  return out.slice(0, 2);
}

function summarizeAccess(retrieved, results) {
  const counts = {};
  const inaccessible = [];
  for (const page of retrieved || []) {
    const state = page.accessState || (page.status === 'RETRIEVED' ? 'DIRECTLY_RETRIEVED' : 'UNAVAILABLE');
    counts[state] = (counts[state] || 0) + 1;
    if (page.status !== 'RETRIEVED' || state === 'PAYWALLED' || state === 'AUTHENTICATION_REQUIRED' || state === 'AGE_RESTRICTED' || state === 'BLOCKED') {
      inaccessible.push({
        url: page.finalUrl || page.url,
        title: page.title || page.url,
        accessState: state,
        label: accessLabel(state),
        note: page.accessNote || page.error || '',
        publicEvidence: page.publicEvidence || '',
      });
    }
  }
  const paywalled = inaccessible.filter(x => x.accessState === 'PAYWALLED');
  const auth = inaccessible.filter(x => x.accessState === 'AUTHENTICATION_REQUIRED');
  const retrievedN = (retrieved || []).filter(p => p.status === 'RETRIEVED').length;
  let headline = '';
  if (paywalled.length && retrievedN === 0 && (results || []).length) {
    headline = 'Absolutely cannot retrieve due to paywall.';
  } else if (auth.length && retrievedN === 0) {
    headline = 'Authentication required — could not retrieve. Carmen does not log in.';
  } else if (inaccessible.length && retrievedN === 0) {
    headline = 'The obvious source was inaccessible. Carmen kept looking across public alternatives.';
  } else if (inaccessible.length) {
    headline = 'Some sources are inaccessible. Public alternatives and references are labeled below.';
  }
  return {
    counts,
    inaccessible,
    paywalled: paywalled.length,
    authenticationRequired: auth.length,
    retrieved: retrievedN,
    headline,
  };
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
const TUBE_INDEX_RE = /(nudevista|xvideos|pornhub|xnxx|spankbang|xhamster|redtube|youporn|alohatube|tubepornstars|heavyfetish|bdsmx\.tube|thothub|fapello|erome|tnaflix|hdzog|xgroovy|eporner|tubebdsm|porntrex|ixxx)\./i;
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
const STOCK_IMAGE_RE = /(shutterstock|gettyimages|istockphoto|adobestock|unsplash\.com|pexels\.com|pixabay\.com|depositphotos)/i;
const ADULT_HOST_RE = /(^|\.)(onlyfans|manyvids|clips4sale|iwantclips|iafd|adultfilmdatabase|adultdvdtalk|babepedia|boobpedia|indexxx|data18|thenude|freeones)\./i;
const ADULT_PATH_RE = /\/(models?|performers?|pornstar|photoset|scene|xxx|galleries)(\/|$)/i;
const GENERIC_BIO_HOST_RE = /(wikipedia\.org|britannica\.com|biography\.com)/i;
const ADULT_LANG_RE = /\b(adult(?:[- ]content)?|nsfw|xxx|porn(?:star)?|onlyfans|bdsm|bondage|fetish|kink|performer|photoset)\b/i;
const ADULT_EVIDENCE_RE = /\b(performer|photoset|adult film|pornstar|xxx|onlyfans|bdsm|bondage|fetish|iafd)\b/i;
const MEMBER_HOST_RE = /(^|\.)(onlyfans|patreon)\.com$/i;
const AUTH_HOST_RE = /(^|\.)(onlyfans|patreon|linkedin|facebook|instagram)\.com$/i;
const ACCESS_LABELS = {
  DIRECTLY_RETRIEVED: 'DIRECTLY RETRIEVED',
  PUBLIC_ALTERNATIVE: 'PUBLIC ALTERNATIVE RETRIEVED',
  PARTIALLY_RETRIEVED: 'PARTIALLY RETRIEVED',
  REFERENCED: 'REFERENCED BUT INACCESSIBLE',
  PAYWALLED: 'PAYWALLED — COULD NOT RETRIEVE',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION REQUIRED — COULD NOT RETRIEVE',
  AGE_RESTRICTED: 'AGE/ACCESS RESTRICTION — COULD NOT RETRIEVE',
  BLOCKED: 'BLOCKED/UNAVAILABLE',
  UNAVAILABLE: 'BLOCKED/UNAVAILABLE',
  UNVERIFIED: 'COULD NOT VERIFY',
};

function accessLabel(state) {
  const k = String(state || '').toUpperCase().replace(/[\s—–-]+/g, '_').replace(/_+/g, '_');
  if (ACCESS_LABELS[k]) return ACCESS_LABELS[k];
  if (/PAYWALL/i.test(state || '')) return ACCESS_LABELS.PAYWALLED;
  if (/AUTH|LOGIN/i.test(state || '')) return ACCESS_LABELS.AUTHENTICATION_REQUIRED;
  if (/AGE/i.test(state || '')) return ACCESS_LABELS.AGE_RESTRICTED;
  if (/PARTIAL/i.test(state || '')) return ACCESS_LABELS.PARTIALLY_RETRIEVED;
  if (/ALTERNATIVE/i.test(state || '')) return ACCESS_LABELS.PUBLIC_ALTERNATIVE;
  if (/DIRECT/i.test(state || '')) return ACCESS_LABELS.DIRECTLY_RETRIEVED;
  if (/REFERENCED/i.test(state || '')) return ACCESS_LABELS.REFERENCED;
  if (/UNVERIF/i.test(state || '')) return ACCESS_LABELS.UNVERIFIED;
  return ACCESS_LABELS.UNAVAILABLE;
}

function classifyAccess({ httpStatus, html, url, host, error } = {}) {
  const h = String(host || hostOf(url) || '').replace(/^www\./, '').toLowerCase();
  const sample = String(html || '').slice(0, 14000);
  const low = sample.toLowerCase();
  const textLen = cleanText(sample).length;
  if (PRIVATE_HOST_RE.test(h) || BLOCKED_HOSTS.has(h) || BLOCKED_HOSTS.has('www.' + h)) {
    return { accessState: 'BLOCKED', status: 'RETRIEVAL_FAILED', error: error || 'Private or blocked host', note: 'Carmen does not retrieve private or blocked hosts.' };
  }
  if (httpStatus === 401) {
    return { accessState: 'AUTHENTICATION_REQUIRED', status: 'RETRIEVAL_FAILED', error: 'HTTP 401', note: 'This source requires a login. Carmen will not sign in.' };
  }
  if (httpStatus === 402) {
    return { accessState: 'PAYWALLED', status: 'RETRIEVAL_FAILED', error: 'HTTP 402', note: 'Absolutely cannot retrieve due to paywall.' };
  }
  if (httpStatus === 403 || httpStatus === 451) {
    return { accessState: 'BLOCKED', status: 'RETRIEVAL_FAILED', error: 'HTTP ' + httpStatus, note: 'The host blocked public retrieval.' };
  }
  if (httpStatus === 404 || httpStatus === 410) {
    return { accessState: 'BLOCKED', status: 'RETRIEVAL_FAILED', error: 'HTTP ' + httpStatus, note: 'This page is gone or was not found.' };
  }
  if (httpStatus && httpStatus >= 500) {
    return { accessState: 'UNAVAILABLE', status: 'RETRIEVAL_FAILED', error: 'HTTP ' + httpStatus, note: 'The host did not return a usable page.' };
  }
  if (/cloudflare[- ](?:challenge|error)|attention required|just a moment\.\.\.|enable javascript and cookies to continue/i.test(low) && textLen < 500) {
    return { accessState: 'BLOCKED', status: 'RETRIEVAL_FAILED', error: error || 'challenge page', note: 'An anti-bot or challenge page blocked retrieval. Carmen does not bypass it.' };
  }
  const loginWall = /(sign in to continue|log in to continue|you must (?:log|sign) in|create an account to (?:continue|view)|authentication required|login to view)/i.test(low);
  const paywallWall = /(subscribe to (?:continue|read|view)|become a (?:paid )?member|this article is for subscribers|\bpaywall\b|members[- ]only content)/i.test(low);
  const ageWall = /(you must be (?:18|21)|age verification required|verify your age|age-?gate)/i.test(low);
  if ((loginWall || AUTH_HOST_RE.test(h)) && textLen < 1400) {
    return { accessState: 'AUTHENTICATION_REQUIRED', status: 'RETRIEVAL_FAILED', error: error || 'login wall', note: 'Authentication required — could not retrieve. Carmen does not log in or scrape behind accounts.' };
  }
  if ((paywallWall) && textLen < 1600) {
    return { accessState: 'PAYWALLED', status: 'RETRIEVAL_FAILED', error: error || 'paywall', note: 'Absolutely cannot retrieve due to paywall. Public titles, snippets, and thumbnails are not the protected content.' };
  }
  if (ageWall && textLen < 1600) {
    return { accessState: 'AGE_RESTRICTED', status: 'RETRIEVAL_FAILED', error: error || 'age gate', note: 'Age or access restriction — could not retrieve. Carmen does not bypass gates.' };
  }
  if (paywallWall && textLen >= 1600) {
    return { accessState: 'PARTIALLY_RETRIEVED', status: 'RETRIEVED', error: '', note: 'Public teaser retrieved. Full article appears paywalled and was not retrieved.' };
  }
  if (error && /timeout/i.test(error)) {
    return { accessState: 'UNAVAILABLE', status: 'RETRIEVAL_FAILED', error: 'timeout', note: 'The page timed out. Carmen did not invent its contents.' };
  }
  if (!httpStatus && error) {
    return { accessState: 'UNAVAILABLE', status: 'RETRIEVAL_FAILED', error: String(error).slice(0, 200), note: 'Retrieval failed. Carmen did not invent this source’s contents.' };
  }
  if (textLen < 80) {
    return { accessState: 'PARTIALLY_RETRIEVED', status: 'RETRIEVED', error: '', note: 'Only a thin public preview was available.' };
  }
  if (MEMBER_HOST_RE.test(h)) {
    return { accessState: 'PARTIALLY_RETRIEVED', status: 'RETRIEVED', error: '', note: 'Public landing page retrieved. Member or logged-in content was not accessed.' };
  }
  return { accessState: 'DIRECTLY_RETRIEVED', status: 'RETRIEVED', error: '', note: '' };
}

const CONTEXT_RELATIONS = [
  { id: 'adult', re: /\b(adult(?:[- ]content)?|nsfw|pornstar|performer)\b/i, synonyms: 'performer OR photoset OR "official site" OR models' },
  { id: 'bondage', re: /\b(bondage|bdsm|shibari|kinbaku|restraint|self[- ]bondage)\b/i, synonyms: 'bondage OR bdsm OR shibari OR rope' },
  { id: 'interview', re: /\b(interview|interviews|podcast|talk show|q\s*&\s*a|qanda)\b/i, synonyms: 'interview OR podcast OR talk OR q&a' },
  { id: 'visual', re: /\b(photos?|images?|pics?|gallery|portrait|headshot)\b/i, synonyms: 'photos OR images OR gallery OR portrait' },
  { id: 'video', re: /\b(videos?|youtube|clip|footage|watch)\b/i, synonyms: 'video OR youtube OR clip OR footage' },
  { id: 'clothing', re: /\b(wearing|outfit|dress|clothing|clothes|costume|wardrobe)\b/i, synonyms: 'wearing OR outfit OR dress OR photos' },
  { id: 'vehicle', re: /\b(car|truck|vehicle|motorcycle|bike)\b/i, synonyms: 'car OR vehicle OR photos' },
  { id: 'towing', re: /\b(tow|towing|payload|hitch)\b/i, synonyms: 'towing OR tow capacity OR payload' },
  { id: 'repair', re: /\b(repair|repairs|fix|service|maintenance)\b/i, synonyms: 'repair OR service OR maintenance' },
  { id: 'skill', re: /\b(weld(?:ing|er)?|woodwork(?:ing)?|fabricat(?:e|ion)|soldering)\b/i, synonyms: 'tutorial OR procedure OR how to OR guide' },
  { id: 'performance', re: /\b(concert|performance|show|tour|stage|set)\b/i, synonyms: 'performance OR concert OR live OR show' },
  { id: 'hobby', re: /\b(hobby|hobbies)\b/i, synonyms: 'hobby OR photos' },
  { id: 'location', re: /\b(in|at|near)\s+[A-Z][A-Za-z.-]+/i, synonyms: 'photos OR event OR location' },
  { id: 'technique', re: /\b(technique|position|pose|poses)\b/i, synonyms: 'photos OR video OR reference' },
  { id: 'object', re: /\b(with|holding|using)\b/i, synonyms: 'photos OR images' },
];

const TRAILING_CONTEXT_RE = /\s+((?:adult(?:\s+content)?)|nsfw|bondage|bdsm|shibari|kinbaku|interview|interviews|photos?|images?|videos?|repair|towing|maintenance|welding)$/i;

function normalizeAdult(v) {
  const s = String(v || '').toLowerCase().trim();
  if (s === 'on' || s === 'true' || s === '1' || s === 'yes') return 'on';
  if (s === 'both') return 'both';
  return 'off';
}

function detectRelation(text) {
  const t = String(text || '');
  for (const rel of CONTEXT_RELATIONS) {
    if (rel.re.test(t)) return rel.id;
  }
  return '';
}

function parseQueryContext(q, classification) {
  const raw = String(q || '').trim().replace(/\s+/g, ' ');
  const empty = { subject: raw, context: '', relation: '', full: raw };
  if (!raw || (classification && classification.isUrl)) return empty;
  const type = classification && classification.type;
  const words = raw.split(/\s+/);
  let subject = raw, context = '';
  const trail = raw.match(TRAILING_CONTEXT_RE);
  if (trail && words.length >= 2) {
    subject = raw.slice(0, raw.length - trail[0].length).trim();
    context = trail[1].trim();
  } else if (type === 'person' && words.length >= 3 && words.slice(0, 2).every(w => /^[A-Za-z][A-Za-z.'’-]*$/.test(w))) {
    subject = words.slice(0, 2).join(' ');
    context = words.slice(2).join(' ');
  } else if (type === 'person' && words.length >= 4) {
    subject = words.slice(0, 2).join(' ');
    context = words.slice(2).join(' ');
  } else if ((type === 'product' || type === 'vehicle' || type === 'organization') && words.length >= 2) {
    const last = words[words.length - 1];
    if (detectRelation(last) && words.length >= 2) {
      subject = words.slice(0, -1).join(' ');
      context = last;
    }
  }
  let relation = detectRelation(context) || detectRelation(raw);
  if (context && !relation) relation = 'context';
  return { subject, context, relation, full: raw };
}

function attachContext(q, classification) {
  const out = (classification && typeof classification === 'object') ? classification : { type: 'topic', confidence: 'low', reason: '', isUrl: false };
  const ctx = parseQueryContext(q, out);
  if (ctx.context) {
    out.subject = ctx.subject;
    out.context = ctx.context;
    out.relation = ctx.relation;
  } else if (ctx.subject) {
    out.subject = out.subject || ctx.subject;
  }
  return out;
}

function applyResearchFilter(classification, adultMode, q) {
  const out = (classification && typeof classification === 'object') ? classification : classifyQuery(q);
  const adult = normalizeAdult(adultMode);
  out.adultContent = adult;
  const raw = String(q || '').trim();
  if (!out.subject) out.subject = out.context ? String(raw).replace(TRAILING_CONTEXT_RE, '').trim() : raw;
  if ((adult === 'on' || adult === 'both') && !out.context) {
    if (adult === 'on') {
      out.context = 'adult content';
      out.relation = out.relation || 'adult';
    } else {
      out.contextLanes = ['general', 'adult'];
      out.relation = out.relation || 'adult';
    }
  }
  if (adult === 'on' && out.context && out.relation !== 'adult') {
    out.adultContext = true;
  }
  if (adult === 'off' && ADULT_LANG_RE.test(out.context || '')) {
    out.adultFromQuery = true;
  }
  return out;
}

function contextualSynonyms(context, relation) {
  const rel = CONTEXT_RELATIONS.find(r => r.id === relation);
  if (rel && rel.synonyms) {
    if (relation === 'clothing' || relation === 'technique' || relation === 'object' || relation === 'location' || relation === 'bondage' || relation === 'repair' || relation === 'towing' || relation === 'skill') {
      return String(context || '') + ' OR ' + rel.synonyms;
    }
    return rel.synonyms;
  }
  return context ? (context + ' photos OR images OR video') : '';
}

function adultSemanticVariants(subject, extraContext) {
  const sub = String(subject || '').replace(/"/g, '').trim();
  const extra = String(extraContext || '').replace(/adult content/i, '').trim();
  const out = [];
  const add = (q, why) => {
    const t = String(q || '').trim();
    if (!t) return;
    if (!out.some(x => x.q === t)) out.push({ q: t, why });
  };
  add('"' + sub + '" (performer OR photoset OR "official site" OR models)', 'adult-industry public sources');
  if (extra) {
    add('"' + sub + '" ' + extra + ' (photoset OR scene OR gallery OR video)', 'requested adult visual context');
    const syn = contextualSynonyms(extra, detectRelation(extra));
    if (syn) add('"' + sub + '" ' + syn, 'adult-context synonyms');
  } else {
    add('"' + sub + '" (interview OR feature) (performer OR "official site")', 'adult-context interviews/features');
  }
  return out.slice(0, 3);
}

function imageSearchQuery(q, classification) {
  const subject = (classification && classification.subject) || q;
  const adult = (classification && classification.adultContent) || 'off';
  const ctx = (classification && classification.context) || '';
  const extra = /adult content/i.test(ctx) ? '' : ctx;
  if ((adult === 'on' || adult === 'both') && extra) return '"' + subject + '" ' + extra;
  if (adult === 'on') return '"' + subject + '" (photoset OR scene OR models OR gallery)';
  if (adult === 'both') return '"' + subject + '" (photoset OR scene OR models OR gallery OR portrait)';
  if (extra) return '"' + subject + '" ' + extra;
  return subject;
}

function isAdultishSource(item) {
  const url = String(item && item.url || '');
  const host = hostOf(url);
  const blob = (String(item && item.title || '') + ' ' + String(item && item.snippet || '') + ' ' + url).toLowerCase();
  return ADULT_HOST_RE.test(host) || ADULT_PATH_RE.test(url) || ADULT_EVIDENCE_RE.test(blob);
}

function isAggregatorPage(item) {
  const url = String(item && item.url || '');
  const host = hostOf(url);
  const title = String(item && item.title || '');
  if (TUBE_INDEX_RE.test(host)) return true;
  if (ADULT_HOST_RE.test(host)) return false;
  if (/\/(top|playlists?|search|tags?|browse|categor(?:y|ies))(\/|\?|$)/i.test(url)) return true;
  if (/\b(tube search|search results?|videos to watch|watch free porn|most relevant porn|free sex vids?)\b/i.test(title)) return true;
  if (/^['""].+['""]\s*search\b/i.test(title)) return true;
  if (/\b(porn videos?|xxx videos?)\b/i.test(title) && !/\b((?:19|20)\d{2})\b/.test(title) && !/\bin\s+[A-Z]/.test(title)) return true;
  return false;
}

function isSpecialistSource(item) {
  const host = hostOf(item && item.url);
  if (ADULT_HOST_RE.test(host) && !TUBE_INDEX_RE.test(host)) return true;
  if (INSTRUCTIONAL_HOST_RE.test(host)) return true;
  if (/\b(title\.rme|person\.rme|perfid=)/i.test(String(item && item.url || ''))) return true;
  return false;
}

function isSpecificEvidence(item, classification) {
  if (isAggregatorPage(item)) return false;
  const title = String(item && item.title || '');
  const snip = String(item && item.snippet || '');
  const url = String(item && item.url || '');
  if (isSpecialistSource(item)) return true;
  if (/\(([12][0-9]{3})\)/.test(title) && /[A-Z][a-z]/.test(title)) return true;
  if (/\bin\s+[A-Z][A-Za-z]/.test(title)) return true;
  if (/\b(interview|transcript|credits|filmography|review|tutorial|procedure|capacity|manual|photoset|scene)\b/i.test(title)) return true;
  if (/\/title\.|\/perfid=|\/babe\//i.test(url) && !/\/search/i.test(url)) return true;
  return false;
}

function classifyResultKind(item, classification, flags) {
  flags = flags || {};
  const host = hostOf(item && item.url);
  const title = String(item && item.title || '').trim();
  const hasVisual = flags.hasVisual || !!(item && (item.image || (item.images && item.images.length)));
  if (NAV_TITLE_RE.test(title) || SEO_JUNK_RE.test(host) || SEO_JUNK_RE.test(String(item && item.url || ''))) return 'JUNK';
  if (isAggregatorPage(item)) return 'AGGREGATOR';
  if (flags.intersection) {
    if (/\b(interview|podcast|transcript)\b/i.test(title)) return 'INTERVIEW_MATCH';
    return 'INTERSECTION_MATCH';
  }
  if (flags.relationship) return 'RELATIONSHIP_MATCH';
  if (item && (item.imageOrigin === 'image-index' || item.mediaKind === 'video') && flags.hasContext) return 'MEDIA_MATCH';
  if (GENERIC_BIO_HOST_RE.test(host)) return extraContext(classification) ? 'GENERIC_BACKGROUND' : 'ENTITY_MATCH';
  if ((classification && classification.type === 'person') && flags.hasEntity && hasVisual && !GENERIC_BIO_HOST_RE.test(host)) return 'VISUAL_ENTITY_MATCH';
  if (flags.hasContext && !flags.hasEntity) return 'CONTEXT_MATCH';
  if (flags.hasEntity && extraContext(classification) && !flags.hasContext) return 'GENERIC_BACKGROUND';
  if (flags.hasEntity) return 'ENTITY_MATCH';
  return 'WEAK_MATCH';
}

function interestLenses(type, classification) {
  const t = String(type || (classification && classification.type) || 'topic');
  const adult = (classification && classification.adultContent) || 'off';
  const byType = {
    person: [
      { id: 'everything', label: 'Everything' },
      { id: 'career', label: 'Career', context: 'career' },
      { id: 'interviews', label: 'Interviews', context: 'interviews' },
      { id: 'projects', label: 'Projects', context: 'projects' },
      { id: 'collaborations', label: 'Collaborations', context: 'collaborations' },
      { id: 'appearances', label: 'Public appearances', context: 'appearances' },
    ],
    vehicle: [
      { id: 'everything', label: 'Everything' },
      { id: 'reliability', label: 'Reliability', context: 'reliability' },
      { id: 'repair', label: 'Repair', context: 'repair' },
      { id: 'towing', label: 'Towing', context: 'towing' },
      { id: 'performance', label: 'Performance', context: 'performance' },
      { id: 'ownership', label: 'Ownership', context: 'ownership' },
      { id: 'issues', label: 'Common problems', context: 'problems' },
    ],
    product: [
      { id: 'everything', label: 'Everything' },
      { id: 'overview', label: 'Overview' },
      { id: 'repair', label: 'Repair', context: 'repair' },
      { id: 'specs', label: 'Specifications', context: 'specifications' },
      { id: 'reviews', label: 'Reviews', context: 'reviews' },
      { id: 'alternatives', label: 'Alternatives', context: 'alternatives' },
    ],
    skill: [
      { id: 'everything', label: 'Everything' },
      { id: 'fundamentals', label: 'Fundamentals', context: 'fundamentals' },
      { id: 'tools', label: 'Tools', context: 'tools' },
      { id: 'techniques', label: 'Techniques', context: 'techniques' },
      { id: 'safety', label: 'Safety', context: 'safety' },
      { id: 'projects', label: 'Projects', context: 'projects' },
      { id: 'trouble', label: 'Troubleshooting', context: 'troubleshooting' },
    ],
    technique: [
      { id: 'everything', label: 'Everything' },
      { id: 'what', label: 'What this is' },
      { id: 'visuals', label: 'Visual references', context: 'photos' },
      { id: 'tutorials', label: 'Tutorials', context: 'tutorial' },
      { id: 'variations', label: 'Variations', context: 'variations' },
    ],
    organization: [
      { id: 'everything', label: 'Everything' },
      { id: 'official', label: 'Official presence' },
      { id: 'people', label: 'People', context: 'people' },
      { id: 'history', label: 'History', context: 'history' },
    ],
    topic: [
      { id: 'everything', label: 'Everything' },
      { id: 'overview', label: 'Overview' },
      { id: 'sources', label: 'Sources' },
    ],
  };
  const list = (byType[t] || byType.topic).map(function (x) { return Object.assign({}, x); });
  if ((adult === 'on' || adult === 'both') && t === 'person' && !list.some(function (x) { return x.id === 'credits'; })) {
    list.splice(1, 0, { id: 'credits', label: 'Credits & public work', context: 'credits' });
  }
  if (!list.some(function (x) { return x.id === 'specific'; })) list.push({ id: 'specific', label: 'Specific context', custom: true });
  if (!list.some(function (x) { return x.id === 'question'; })) list.push({ id: 'question', label: 'Ask a question', question: true });
  return list;
}


function extraContext(classification) {
  return String((classification && classification.context) || '').replace(/adult content/gi, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeDepth(v, classification) {
  const s = String(v || '').toLowerCase().trim();
  if (s === 'deep' || s === 'all') return 'deep';
  if (s === 'broad') return 'broad';
  const extra = extraContext(classification);
  const adultOn = classification && (classification.adultContent === 'on' || classification.adultContent === 'both');
  if (s === 'contextual' || s === 'context') {
    if (extra || adultOn) return 'contextual';
    return 'broad';
  }
  if (extra || adultOn) return 'contextual';
  return 'broad';
}

const RELATION_VOCAB = {
  bondage: {
    related: ['bdsm', 'restraint', 'shibari', 'kinbaku', 'rope'],
    production: ['scene', 'photoset', 'credits'],
    interview: ['interview', 'podcast'],
    media: ['video', 'clip', 'gallery'],
    specialist: ['filmography', 'database', 'credits'],
    org: ['studio', 'production'],
  },
  interview: {
    related: ['podcast', 'q&a', 'feature', 'talk'],
    production: ['episode', 'appearance'],
    interview: ['interview', 'transcript'],
    media: ['youtube', 'video'],
    specialist: ['press', 'magazine'],
    org: ['network', 'show'],
  },
  repair: {
    related: ['service', 'maintenance', 'fix'],
    production: [],
    interview: [],
    media: ['video', 'diagram'],
    specialist: ['manual', 'bulletin', 'guide'],
    org: ['dealer', 'service'],
  },
  towing: {
    related: ['tow capacity', 'payload', 'hitch'],
    production: [],
    interview: [],
    media: ['video'],
    specialist: ['specs', 'capacity'],
    org: ['dealer'],
  },
  adult: {
    related: ['performer', 'photoset'],
    production: ['scene', 'filmography', 'credits'],
    interview: ['interview', 'feature'],
    media: ['gallery', 'video', 'photoset'],
    specialist: ['database', 'credits', 'filmography'],
    org: ['studio'],
  },
  visual: {
    related: ['photos', 'gallery', 'images'],
    production: [],
    interview: [],
    media: ['photoset', 'gallery'],
    specialist: [],
    org: [],
  },
  video: {
    related: ['clip', 'footage', 'youtube'],
    production: [],
    interview: ['interview'],
    media: ['video', 'clip'],
    specialist: [],
    org: [],
  },
  clothing: {
    related: ['outfit', 'wardrobe', 'wearing'],
    production: [],
    interview: [],
    media: ['photos', 'gallery'],
    specialist: [],
    org: [],
  },
  skill: {
    related: ['tutorial', 'procedure', 'how to'],
    production: [],
    interview: [],
    media: ['video', 'diagram'],
    specialist: ['guide'],
    org: [],
  },
  technique: {
    related: ['form', 'variation', 'reference'],
    production: [],
    interview: [],
    media: ['photo', 'video', 'diagram'],
    specialist: ['guide'],
    org: [],
  },
  performance: {
    related: ['concert', 'live', 'tour'],
    production: ['set', 'show'],
    interview: ['interview'],
    media: ['video', 'photos'],
    specialist: [],
    org: ['venue'],
  },
};

function contextVocabulary(classification) {
  const extra = extraContext(classification);
  const rel = (classification && classification.relation) || '';
  const pack = RELATION_VOCAB[rel] || {};
  const userTerms = extra
    ? extra.split(/[\/,&+|]| or /i).map(s => s.trim()).filter(s => s.length > 2 && !/^(and|the|for|with|adult|content)$/i.test(s))
    : [];
  const core = [...new Set(userTerms.length ? userTerms : (rel && rel !== 'adult' && rel !== 'context' ? [rel] : []))];
  const exclude = new Set(core.map(t => String(t).toLowerCase()));
  const take = (arr) => (arr || []).filter(t => !exclude.has(String(t).toLowerCase()));
  return {
    core,
    related: take(pack.related),
    production: take(pack.production),
    interview: take(pack.interview),
    media: take(pack.media),
    specialist: take(pack.specialist),
    org: take(pack.org),
  };
}

function contextTermsForScore(classification) {
  const v = contextVocabulary(classification);
  return [...v.core, ...v.related].map(t => String(t).toLowerCase()).filter(t => t.length > 2);
}

function quoteName(s) {
  return '"' + String(s || '').replace(/"/g, '').trim() + '"';
}

function discoveryLanes(classification, depth) {
  const d = normalizeDepth(depth, classification);
  const subject = String((classification && classification.subject) || '').trim();
  const type = (classification && classification.type) || '';
  const adult = (classification && classification.adultContent) || 'off';
  const vocab = contextVocabulary(classification);
  const lanes = [];
  const add = (id, why, queries, kind) => {
    const qs = [...new Set((queries || []).map(q => String(q || '').trim()).filter(Boolean))];
    if (!qs.length) return;
    lanes.push({ id, why, queries: qs, kind: kind || 'web' });
  };
  if (!subject) return { depth: d, vocab, lanes };

  if (vocab.core.length) {
    add('intersection', 'exact entity ∩ requested context', vocab.core.map(t => quoteName(subject) + ' ' + t));
  } else if (adult === 'on' || adult === 'both') {
    add('intersection', 'entity in adult-industry public sources', adultSemanticVariants(subject, '').map(v => v.q).slice(0, 2));
  }

  if (type === 'person') {
    if (adult === 'on') add('identity', 'entity identity in the active domain', [quoteName(subject) + ' (performer OR profile OR "official site")']);
    else add('identity', 'entity identity', [subject + ' official OR website OR profile', quoteName(subject)]);
  } else {
    add('identity', 'entity identity', [quoteName(subject)]);
  }

  const relatedCap = d === 'deep' ? 4 : d === 'contextual' ? 2 : 0;
  for (const t of vocab.related.slice(0, relatedCap)) {
    add('term-' + String(t).replace(/\s+/g, '-'), 'related terminology for the requested context', [quoteName(subject) + ' ' + t]);
  }

  if (d !== 'broad') {
    if (vocab.interview.length) {
      add('interviews', 'interviews and discussions about the entity in this context', [quoteName(subject) + ' ' + (vocab.core[0] || '') + ' ' + vocab.interview[0]]);
    }
    if (vocab.production.length) {
      add('productions', 'productions, credits, and project references', [quoteName(subject) + ' ' + vocab.production.slice(0, 2).join(' ')]);
    }
    if (vocab.specialist.length) {
      add('specialist', 'specialist publications and public databases', [quoteName(subject) + ' ' + vocab.specialist.slice(0, 2).join(' ') + (vocab.core[0] ? ' ' + vocab.core[0] : '')]);
    }
    const mediaTerms = [...vocab.core, ...vocab.media].filter(Boolean).slice(0, 2);
    if (mediaTerms.length) {
      add('images', 'image indexes for entity ∩ context', [quoteName(subject) + ' ' + mediaTerms.join(' ')], 'image');
      add('videos', 'video metadata for entity ∩ context', [quoteName(subject) + ' ' + mediaTerms.join(' ')], 'video');
    }
  }
  if (d === 'deep' && vocab.org.length) {
    add('organizations', 'organizations associated with the requested context', [quoteName(subject) + ' ' + vocab.org[0] + (vocab.core[0] ? ' ' + vocab.core[0] : '')]);
    add('collaborators', 'people publicly associated with the entity in this context', [quoteName(subject) + ' ' + (vocab.core[0] || '') + ' (with OR directed OR studio)']);
  }
  return { depth: d, vocab, lanes };
}

function extractGraphLeads(retrieved, results, classification) {
  const subject = String((classification && classification.subject) || '').trim();
  const ctxTerms = contextTermsForScore(classification);
  const leads = [];
  const seen = new Set();
  const add = (kind, label, why, q) => {
    const clean = String(label || '').replace(/\s+/g, ' ').trim();
    if (!clean || clean.length < 3) return;
    if (subject && clean.toLowerCase() === subject.toLowerCase()) return;
    const key = (kind + '|' + clean).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    leads.push({ kind, label: clean.slice(0, 80), why, q: String(q || '').trim() });
  };
  const yearTitle = /\b([A-Z][A-Za-z0-9:'&.\-]*(?:\s+[A-Z][A-Za-z0-9:'&.\-]*){1,5})\s*\(((?:19|20)\d{2})\)/g;
  const quoted = /"([A-Z][^"]{6,70})"/g;
  const sources = [...(retrieved || [])];
  for (const r of results || []) {
    if (r && (r.textExcerpt || r.snippet)) {
      sources.push({
        title: r.title,
        url: r.url,
        textExcerpt: r.textExcerpt || r.snippet,
        identifiers: { aliases: r.aliases || [], handles: [], profiles: r.profiles || [] },
      });
    }
  }
  for (const page of sources) {
    const text = String(page.textExcerpt || page.text || page.description || '').slice(0, 8000);
    for (const a of (page.identifiers && page.identifiers.aliases) || []) {
      add('alias', a, 'Public alias observed on a retrieved source', quoteName(a) + (ctxTerms[0] ? ' ' + ctxTerms[0] : ''));
    }
    for (const h of (page.identifiers && page.identifiers.handles) || []) {
      add('handle', h, 'Public handle observed on a retrieved source', h);
    }
    let m;
    yearTitle.lastIndex = 0;
    while ((m = yearTitle.exec(text)) && leads.length < 18) {
      const title = m[1].trim();
      if (title.split(/\s+/).length < 2) continue;
      if (!/[a-z]/.test(title)) continue;
      if (/wikipedia|retrieved|official site|home page/i.test(title)) continue;
      add('production', title, 'Title/year observed on a retrieved source (' + m[2] + ')', quoteName(subject) + ' ' + quoteName(title));
    }
    quoted.lastIndex = 0;
    while ((m = quoted.exec(text)) && leads.length < 18) {
      const title = m[1].trim();
      const n = title.split(/\s+/).length;
      if (n < 2 || n > 8) continue;
      const nearby = text.slice(Math.max(0, m.index - 90), m.index + title.length + 90).toLowerCase();
      const contextNearby = !ctxTerms.length || ctxTerms.some(t => nearby.includes(t)) || /scene|film|video|photoset|feature|interview|episode|directed|studio/i.test(nearby);
      if (!contextNearby) continue;
      add('title', title, 'Quoted title observed near the requested context', quoteName(subject) + ' ' + quoteName(title));
    }
  }
  return leads.slice(0, 12);
}

function buildEntityIdentity(classification, retrieved, results, leads) {
  const aliases = new Set();
  const handles = new Set();
  const domains = new Set();
  for (const page of retrieved || []) {
    for (const a of (page.identifiers && page.identifiers.aliases) || []) aliases.add(a);
    for (const h of (page.identifiers && page.identifiers.handles) || []) handles.add(h);
    const host = hostOf(page.finalUrl || page.url).replace(/^www\./, '');
    if (host) domains.add(host);
  }
  for (const r of results || []) {
    for (const a of r.aliases || []) aliases.add(a);
    if (r.domain) domains.add(r.domain);
  }
  for (const l of leads || []) {
    if (l.kind === 'alias') aliases.add(l.label);
    if (l.kind === 'handle') handles.add(l.label);
  }
  return {
    canonicalName: (classification && classification.subject) || '',
    type: (classification && classification.type) || '',
    aliases: [...aliases].filter(Boolean).slice(0, 8),
    handles: [...handles].filter(Boolean).slice(0, 8),
    domains: [...domains].filter(Boolean).slice(0, 8),
  };
}

function isStockImage(url) {
  return typeof url === 'string' && STOCK_IMAGE_RE.test(url);
}

function classifyQuery(q, hint = '') {
  const raw = String(q || '').trim();
  const done = (obj) => attachContext(raw, obj);
  const hintMap = {
    person: 'person', topic: 'topic', website: 'website', claim: 'topic',
    product: 'product', position: 'technique', other: '', organization: 'organization',
    vehicle: 'vehicle', place: 'place', social: 'social', reddit: 'reddit',
    technique: 'technique', skill: 'skill', project: 'project', instruction: 'technique',
  };
  const hinted = hintMap[String(hint || '').toLowerCase()] || '';
  if (!raw) return done({ type: 'unknown', confidence: 'low', reason: 'Empty query', isUrl: false });
  const maybeUrl = /^https?:\/\//i.test(raw) || (/^[\w.-]+\.[a-z]{2,}([/:?]|$)/i.test(raw) && !/\s/.test(raw));
  if (maybeUrl) {
    const url = normalizeUrlForStore(raw.startsWith('http') ? raw : 'https://' + raw) || ('https://' + raw);
    const host = hostOf(url);
    const isImage = /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(url);
    if (/reddit\.com$/i.test(host) || host.endsWith('.reddit.com')) {
      return done({ type: 'reddit', confidence: 'high', reason: 'Direct Reddit URL', isUrl: true, url, isImage });
    }
    return done({ type: 'website', confidence: 'high', reason: 'Direct URL', isUrl: true, url, isImage });
  }
  const trailEarly = raw.match(TRAILING_CONTEXT_RE);
  if (trailEarly && !hinted) {
    const rel = detectRelation(trailEarly[1]) || detectRelation(raw);
    const head = raw.slice(0, raw.length - trailEarly[0].length).trim();
    if (head && (rel === 'towing' || rel === 'vehicle')) {
      return done({ type: 'vehicle', confidence: 'medium', reason: 'Vehicle-like subject with a technical context', isUrl: false });
    }
    if (head && rel === 'repair' && !/\b(weld|welding|woodwork|solder|plumbing|electrical|diy)\b/i.test(head)) {
      return done({ type: 'product', confidence: 'medium', reason: 'Product-like subject with a repair/service context', isUrl: false });
    }
  }
  if (TECHNIQUE_HINTS.has(hinted) || (TECHNIQUE_WORD_RE.test(raw) && !SKILL_WORD_RE.test(raw))) {
    return done({ type: 'technique', confidence: hinted ? 'medium' : 'medium', reason: 'Looks like a technique, position, or instructional form', isUrl: false });
  }
  if (SKILL_HINTS.has(hinted) || ((SKILL_WORD_RE.test(raw) || /\bhow to\b/i.test(raw)) && !['person', 'product', 'vehicle', 'organization'].includes(hinted))) {
    return done({ type: hinted === 'project' ? 'project' : 'skill', confidence: 'medium', reason: 'Looks like a skill, craft, or project to learn', isUrl: false });
  }
  if (/^@[\w.]+/.test(raw) || /\b(instagram|tiktok|onlyfans|twitter|linkedin)\b/i.test(raw)) {
    return done({ type: 'social', confidence: 'medium', reason: 'Looks like a social handle or profile query', isUrl: false });
  }
  if (/\b(reddit|r\/[a-z0-9_]+)/i.test(raw)) {
    return done({ type: hinted || 'reddit', confidence: 'medium', reason: 'Reddit/community query', isUrl: false });
  }
  if (/\b(inc|llc|corp|company|university|hospital|foundation)\b/i.test(raw)) {
    return done({ type: 'organization', confidence: 'medium', reason: 'Organization language in the query', isUrl: false });
  }
  if (/\b(19|20)\d{2}\b/.test(raw) && /\b(toyota|honda|ford|chevy|chevrolet|nissan|bmw|runner|civic|f-?150|mustang|iphone|ipad)\b/i.test(raw)) {
    return done({ type: 'vehicle', confidence: 'medium', reason: 'Year + vehicle/product tokens', isUrl: false });
  }
  if (/\b(iphone|ipad|pixel \d|playstation|xbox|macbook)\b/i.test(raw)) {
    return done({ type: 'product', confidence: 'medium', reason: 'Product-like query', isUrl: false });
  }
  const words = raw.split(/\s+/);
  const nameLike = words.length >= 2 && words.length <= 4 && words.every(w => /^[A-Za-z][A-Za-z.'’-]*$/.test(w));
  const looksLikeProductPhrase = words.some(w => NON_NAME_TOKENS.test(w));
  if (nameLike && looksLikeProductPhrase && !hinted) {
    return done({ type: 'topic', confidence: 'low', reason: 'Phrase looks like a product/topic, not a personal name', isUrl: false });
  }
  if (nameLike && (!hinted || hinted === 'person') && !looksLikeProductPhrase) {
    return done({ type: 'person', confidence: words.length === 1 ? 'low' : 'medium', reason: 'Name-like query — treating as a person candidate search', isUrl: false });
  }
  if (words.length === 1 && /^[A-Za-z]{2,}$/.test(raw)) {
    return done({ type: hinted || 'ambiguous', confidence: 'low', reason: 'Single token — many people/entities could match', isUrl: false });
  }
  if (hinted) return done({ type: hinted, confidence: 'medium', reason: 'Using the selected subject type as a search hint', isUrl: false });
  return done({ type: 'topic', confidence: 'low', reason: 'Treated as a topic/query, not a specific named entity', isUrl: false });
}

function researchPaths(type, classification) {
  const t = String(type || 'topic');
  const paths = {
    person: [
      { id: 'identity', label: 'Identity & aliases' },
      { id: 'images', label: 'Images & visual sources' },
      { id: 'videos', label: 'Videos' },
      { id: 'presence', label: 'Public web presence' },
      { id: 'timeline', label: 'Timeline' },
      { id: 'related', label: 'Related people' },
      { id: 'entities', label: 'Related entities' },
      { id: 'sources', label: 'Sources' },
      { id: 'evidence', label: 'Evidence' },
      { id: 'leads', label: 'Leads' },
      { id: 'questions', label: 'Questions to investigate' },
    ],
    product: [
      { id: 'overview', label: 'Overview' },
      { id: 'specs', label: 'Specifications' },
      { id: 'variants', label: 'Models & variants' },
      { id: 'images', label: 'Images' },
      { id: 'videos', label: 'Videos' },
      { id: 'reviews', label: 'Reviews' },
      { id: 'pricing', label: 'Pricing & history' },
      { id: 'manuals', label: 'Manuals & documents' },
      { id: 'alternatives', label: 'Alternatives' },
      { id: 'sources', label: 'Sources' },
      { id: 'questions', label: 'Questions' },
    ],
    vehicle: [
      { id: 'overview', label: 'Overview' },
      { id: 'specs', label: 'Specifications' },
      { id: 'variants', label: 'Years & generations' },
      { id: 'images', label: 'Images' },
      { id: 'videos', label: 'Videos' },
      { id: 'issues', label: 'Common issues' },
      { id: 'reviews', label: 'Reviews' },
      { id: 'manuals', label: 'Manuals' },
      { id: 'maintenance', label: 'Maintenance & parts' },
      { id: 'alternatives', label: 'Alternatives' },
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
      { id: 'concepts', label: 'Concepts' },
      { id: 'materials', label: 'Materials' },
      { id: 'tools', label: 'Tools' },
      { id: 'steps', label: 'Steps' },
      { id: 'measurements', label: 'Measurements' },
      { id: 'techniques', label: 'Techniques' },
      { id: 'videos', label: 'Videos' },
      { id: 'variations', label: 'Variations' },
      { id: 'safety', label: 'Safety considerations' },
      { id: 'trouble', label: 'Troubleshooting' },
      { id: 'tutorials', label: 'Tutorials' },
      { id: 'related', label: 'Related projects' },
      { id: 'sources', label: 'References' },
    ],
    project: [
      { id: 'goal', label: 'What you are trying to accomplish' },
      { id: 'concepts', label: 'Concepts' },
      { id: 'materials', label: 'Materials' },
      { id: 'tools', label: 'Tools' },
      { id: 'steps', label: 'Steps' },
      { id: 'measurements', label: 'Measurements' },
      { id: 'techniques', label: 'Techniques' },
      { id: 'videos', label: 'Videos' },
      { id: 'variations', label: 'Variations' },
      { id: 'safety', label: 'Safety considerations' },
      { id: 'trouble', label: 'Troubleshooting' },
      { id: 'tutorials', label: 'Tutorials' },
      { id: 'related', label: 'Related projects' },
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
  let list = paths[t] || paths.topic;
  const extra = extraContext(classification);
  if (classification && (extra || classification.adultContent === 'on' || classification.adultContent === 'both')) {
    const have = new Set(list.map(p => p.id));
    const more = [];
    if (extra && !have.has('context')) more.push({ id: 'context', label: 'Requested context' });
    if (t === 'person') {
      if (!have.has('career')) more.push({ id: 'career', label: 'Career & credits' });
      if (!have.has('projects')) more.push({ id: 'projects', label: 'Projects & productions' });
      if (!have.has('interviews')) more.push({ id: 'interviews', label: 'Interviews & features' });
      if (!have.has('organizations')) more.push({ id: 'organizations', label: 'Organizations' });
    }
    if (more.length) list = list.concat(more);
  }
  return list;
}

function inferPathsFromQuestion(question, allPaths) {
  const t = String(question || '').toLowerCase();
  if (!t) return [];
  const available = new Set((allPaths || []).map(p => p.id));
  const out = [];
  const rules = [
    [/image|photo|visual|picture|gallery|pic\b|portrait/, ['images', 'visuals']],
    [/video|youtube|interview|clip|watch|footage/, ['videos']],
    [/timeline|history|when|chronolog|date/, ['timeline', 'history']],
    [/identity|alias|who is|real name|handle/, ['identity']],
    [/presence|website|profile|social|official/, ['presence', 'official']],
    [/related|other people|connected|associated|connecting|collaborat/, ['related', 'entities']],
    [/interview|podcast|discuss|talks about|q\s*&\s*a/, ['interviews', 'videos']],
    [/credit|filmography|production|photoset|scene/, ['projects', 'career']],
    [/tutorial|how to|learn|teach|instruct|procedure|steps/, ['tutorials', 'steps']],
    [/tool|material|part|supply/, ['tools', 'materials']],
    [/safety|hazard|ppe/, ['safety']],
    [/spec|measurement|dimension/, ['specs', 'measurements']],
    [/source|citation|evidence|reference/, ['sources', 'evidence']],
    [/variation|variant|model|generation/, ['variations', 'variants']],
    [/term|definition|what is this|meaning/, ['what', 'terms', 'definitions']],
    [/review|rating|complaint/, ['reviews']],
    [/price|pricing|cost|history of/, ['pricing']],
    [/issue|problem|common (fault|fail)/, ['issues', 'trouble']],
    [/concept|theory|explained/, ['concepts']],
    [/clothing|wearing|outfit|dress/, ['images', 'visuals']],
  ];
  for (const [re, ids] of rules) {
    if (!re.test(t)) continue;
    for (const id of ids) if (available.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

function parseInvestigativeQuestion(question, classification) {
  const raw = String(question || '').trim();
  const out = { topic: '', intent: '', paths: [], variants: [], why: '' };
  if (!raw) return out;
  const subject = String((classification && classification.subject) || '').trim();
  const t = raw.toLowerCase();
  let topic = '';
  const quoted = raw.match(/[“"]([^"”]{2,80})[”"]/);
  if (quoted) topic = quoted[1].trim();
  const extractors = [
    /(?:discuss(?:es|ed)?|talks?\s+about|speaking about|mentions?)\s+(.+)$/i,
    /(?:connecting(?:\s+this person|\s+them|\s+him|\s+her)?\s+to|connection to|involving|related to)\s+(.+)$/i,
    /(?:sources?\s+(?:on|about|involving|for)|everything\s+(?:on|about|connecting)|find\s+(?:everything|all|sources?))\s+(?:on |about |involving |connecting(?:\s+this person)?\s+to )?(.+)$/i,
    /(?:interviews?\s+(?:where|about|on|with))\s+(.+)$/i,
    /(?:show|find)\s+sources?\s+(?:involving|about|on)\s+(.+)$/i,
  ];
  if (!topic) {
    for (const re of extractors) {
      const m = raw.match(re);
      if (m && m[1]) {
        topic = m[1].replace(/[.?!]+$/, '').replace(/^["“]|["”]$/g, '').trim();
        break;
      }
    }
  }
  if (subject && topic) {
    const esc = subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    topic = topic.replace(new RegExp(esc, 'ig'), ' ').replace(/\b(she|he|they|her|him|them|this person)\b/ig, ' ').replace(/\s+/g, ' ').trim();
  }
  if (topic.length > 72) topic = topic.slice(0, 72).trim();
  if (/interview|podcast|discuss|q\s*&\s*a|talks?\b/.test(t)) {
    out.intent = 'interviews';
    out.paths.push('interviews', 'videos');
  } else if (/photo|image|visual|picture|gallery|portrait/.test(t)) {
    out.intent = 'images';
    out.paths.push('images');
  } else if (/video|clip|watch|footage/.test(t)) {
    out.intent = 'videos';
    out.paths.push('videos');
  } else if (/connect|related|people|collaborat|network|who (?:else|worked)/.test(t)) {
    out.intent = 'relationships';
    out.paths.push('related', 'entities', 'organizations');
  } else if (/source|citation|evidence|document/.test(t)) {
    out.intent = 'sources';
    out.paths.push('sources', 'evidence');
  } else if (/credit|filmography|production|work|title/.test(t)) {
    out.intent = 'work';
    out.paths.push('projects', 'career');
  } else {
    out.intent = 'directed';
    out.paths.push('context', 'sources');
  }
  out.topic = topic;
  const sub = subject.replace(/"/g, '');
  const quotedSub = sub ? '"' + sub + '"' : '';
  const add = (q, why) => { if (q && !out.variants.some(v => v.q === q)) out.variants.push({ q, why }); };
  if (quotedSub && topic) {
    if (out.intent === 'interviews') {
      add(quotedSub + ' interview "' + topic + '"', 'interviews about the requested topic');
      add(quotedSub + ' "' + topic + '" (interview OR podcast OR feature)', 'features discussing the topic');
    } else if (out.intent === 'relationships') {
      add(quotedSub + ' "' + topic + '" (with OR and OR collaboration)', 'connection to the requested topic');
    } else if (out.intent === 'images') {
      add(quotedSub + ' "' + topic + '" (photo OR image OR gallery)', 'visuals for the requested topic');
    } else if (out.intent === 'videos') {
      add(quotedSub + ' "' + topic + '" (video OR clip)', 'videos for the requested topic');
    } else {
      add(quotedSub + ' "' + topic + '"', 'directed research on the requested topic');
      add(quotedSub + ' ' + topic + ' (source OR article OR feature)', 'sources involving the topic');
    }
  } else if (quotedSub && out.intent === 'interviews') {
    add(quotedSub + ' interview OR podcast OR feature', 'interview sources');
  } else if (quotedSub && topic) {
    add(quotedSub + ' "' + topic + '"', 'directed research on the requested topic');
  }
  out.why = out.intent + (topic ? (': ' + topic) : '');
  return out;
}

function visualCandidatesFor(ranked, classification) {
  if (!classification || classification.type !== 'person') return [];
  const pri = (k) => ({ VISUAL_ENTITY_MATCH: 6, ENTITY_MATCH: 5, INTERSECTION_MATCH: 4, INTERVIEW_MATCH: 4, MEDIA_MATCH: 3, RELATIONSHIP_MATCH: 2 }[k] || 0);
  const out = [];
  const seen = new Set();
  for (const r of ranked || []) {
    if (!r) continue;
    if (r.resultKind === 'AGGREGATOR' || r.resultKind === 'JUNK' || r.resultKind === 'WEAK_MATCH') continue;
    if (GENERIC_BIO_HOST_RE.test(hostOf(r.url))) continue;
    const imgs = [...new Set([r.image, ...(r.images || [])].filter(Boolean))];
    if (!imgs.length) continue;
    const key = (r.domain || '') + '|' + imgs[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  out.sort((a, b) => pri(b.resultKind) - pri(a.resultKind) || (b.score || 0) - (a.score || 0));
  return out.slice(0, 6);
}

function entityIdFor(type, name) {
  const t = String(type || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return n ? ('entity:' + (t || 'unknown') + ':' + n) : '';
}

function discoveryEvidenceFrom(item) {
  if (!item || typeof item !== 'object') return null;
  const url = String(item.url || item.pageUrl || '').trim();
  const image = item.image || ((item.images || [])[0]) || '';
  if (!url && !image) return null;
  return {
    url,
    domain: item.domain || hostOf(url),
    title: String(item.title || ''),
    snippet: String(item.snippet || ''),
    source: String(item.source || ''),
    image,
    images: [...new Set([item.image, ...(item.images || [])].filter(Boolean))].slice(0, 8),
    resultKind: item.resultKind || '',
    provenance: item.provenance || 'DISCOVERED',
    reason: item.reason || '',
    observedAt: item.observedAt || '',
  };
}

function userAskedForSourceRestriction(question) {
  const q = String(question || '');
  return /\bsite\s*:/i.test(q) || /\bonly\s+(?:on|from|at)\s+[\w.-]+\.\w+/i.test(q);
}

function diveSeedQuery(classification, originalQuery, canonical, fallbackQuery) {
  const name = String(canonical || (classification && classification.subject) || '').trim();
  const orig = String(originalQuery || '').trim();
  const fb = String(fallbackQuery || '').trim();
  const isUrl = (s) => /^https?:\/\//i.test(s);
  if (orig && !isUrl(orig)) return orig;
  const ctx = extraContext(classification);
  if (name && ctx) return (name + ' ' + ctx).replace(/\s+/g, ' ').trim();
  if (name) return name;
  if (fb && !isUrl(fb)) return fb;
  return name || orig || fb;
}

function diveExpansionQueries(opts) {
  opts = opts || {};
  const classification = opts.classification || {};
  const seed = String(opts.seed || classification.subject || '').trim();
  const extra = [];
  const add = (q) => {
    const t = String(q || '').trim();
    if (t && extra.indexOf(t) < 0) extra.push(t);
  };
  const subject = String(classification.subject || seed || '').replace(/"/g, '');
  const quoted = subject ? ('"' + subject + '"') : '';
  const instruction = opts.instruction || { variants: [] };
  const adult = classification.adultContent || opts.adult || 'off';
  const selectedPaths = opts.selectedPaths || [];
  const selectedIds = opts.selectedIds instanceof Set ? opts.selectedIds : new Set((selectedPaths || []).map(p => p && p.id).filter(Boolean));
  const resolvedAll = opts.resolvedAll === true;
  const expanded = opts.expanded === true;
  const identifiers = opts.identifiers || { handles: [] };
  const evidenceHost = String(opts.evidenceHost || '').replace(/^www\./, '');
  const customQuestion = opts.customQuestion || '';

  for (const v of instruction.variants || []) add(v.q);
  if (quoted) add(quoted);
  if (classification.type === 'person' && quoted) add(quoted + ' (profile OR official OR website)');
  if (classification.context) {
    add(quoted + ' ' + classification.context);
    const syn = contextualSynonyms(classification.context, classification.relation);
    if (syn) add(quoted + ' ' + syn);
  }
  if (classification.type === 'technique') add(seed + ' tutorial OR diagram');
  if (classification.type === 'skill' || classification.type === 'project') add(seed + ' procedure OR safety');
  if (classification.type === 'product' || classification.type === 'vehicle') add(quoted + ' (official OR spec OR manual OR review)');
  if (classification.type === 'organization') add(quoted + ' (official OR about OR website)');
  for (const v of pathSearchVariants(seed, selectedPaths, classification)) add(v.q);
  const graph = discoveryLanes(classification, opts.depth || classification.researchDepth);
  for (const lane of graph.lanes) {
    if (lane.kind === 'web') {
      for (const q of lane.queries || []) add(q);
    }
  }
  add(seed + ' reddit');
  if (expanded || selectedIds.has('images') || selectedIds.has('visuals') || resolvedAll) {
    add(imageSearchQuery(classification.subject || seed, classification));
  }
  if (expanded || selectedIds.has('videos') || resolvedAll) {
    add((classification.subject || seed) + (adult === 'on' || adult === 'both' ? ' video OR scene OR clip' : ' youtube OR video OR interview'));
  }
  for (const h of (identifiers.handles || []).slice(0, 2)) add(h);
  if (evidenceHost && userAskedForSourceRestriction(customQuestion)) {
    add(quoted + ' site:' + evidenceHost);
  }
  return extra;
}

function diveRetrievalQueue(opts) {
  opts = opts || {};
  const cap = opts.retrieveCap || 6;
  const adult = opts.adult || 'off';
  const evidenceUrl = opts.evidenceUrl || '';
  const evidenceHost = hostOf(evidenceUrl).replace(/^www\./, '');
  const out = [];
  const seen = new Set();
  const push = (url) => {
    if (!url || seen.has(url) || out.length >= cap) return;
    seen.add(url);
    out.push(url);
  };
  push(evidenceUrl);
  const rows = opts.discoveryResults || [];
  for (const r of rows) {
    if (out.length >= cap) break;
    if (!r || !r.url) continue;
    const h = hostOf(r.url).replace(/^www\./, '');
    if (TUBE_INDEX_RE.test(h) && r.url !== evidenceUrl && adult === 'off') continue;
    if (evidenceHost && h === evidenceHost) continue;
    push(r.url);
  }
  for (const r of rows) {
    if (out.length >= cap) break;
    if (!r || !r.url) continue;
    const h = hostOf(r.url).replace(/^www\./, '');
    if (TUBE_INDEX_RE.test(h) && r.url !== evidenceUrl && adult === 'off') continue;
    push(r.url);
  }
  for (const p of (opts.profileUrls || []).slice(0, 3)) push(p);
  for (const g of (opts.galleryUrls || []).slice(0, 2)) push(g);
  return out;
}

function buildSelectedEntity(classification, candidate, identity, extras) {
  extras = extras || {};
  const c = classification || {};
  const r = candidate || {};
  const id = identity || {};
  const name = String(extras.canonicalName || id.canonicalName || c.subject || '').trim();
  const type = c.type || r.entityType || '';
  const evidence = extras.discoveryEvidence || discoveryEvidenceFrom(r);
  return {
    entityId: extras.entityId || entityIdFor(type, name),
    canonicalName: name,
    type,
    aliases: id.aliases || r.aliases || [],
    handles: id.handles || [],
    confidence: r.confidence || extras.confidence || 'low',
    discoveryEvidence: evidence,
    sourceRefs: evidence && evidence.url ? [evidence.url] : [],
    url: (evidence && evidence.url) || r.url || '',
    image: (evidence && evidence.image) || r.image || ((r.images || [])[0]) || '',
    images: (evidence && evidence.images) || [...new Set([r.image, ...(r.images || [])].filter(Boolean))].slice(0, 8),
    provenance: (evidence && evidence.provenance) || r.provenance || 'DISCOVERED',
    reason: r.reason || '',
    sourceUrls: evidence && evidence.url ? [evidence.url] : [r.url].filter(Boolean),
    domains: id.domains || (evidence && evidence.domain ? [evidence.domain] : (r.domain ? [r.domain] : [])),
    originalQuery: extras.originalQuery || '',
    context: extraContext(c) || extras.context || '',
    adultContent: c.adultContent || extras.adultContent || 'off',
    lens: extras.lens || '',
    depth: extras.depth || c.researchDepth || '',
    selectedAt: new Date().toISOString(),
    visualLikenessIsNotIdentityProof: true,
  };
}

function resolveDivePaths(type, body = {}, classification) {
  const all = researchPaths(type, classification);
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

function pathSearchVariants(seed, selectedPaths, classification) {
  const extra = [];
  const ids = new Set((selectedPaths || []).map(p => p.id));
  const add = (q, why) => {
    const t = String(q || '').trim();
    if (!t || extra.some(x => x.q === t)) return;
    extra.push({ q: t, why });
  };
  const subject = (classification && classification.subject) || seed;
  const adult = (classification && classification.adultContent) || 'off';
  const ctx = (classification && classification.context) || '';
  if (ids.has('images') || ids.has('visuals')) {
    if (adult === 'on' || adult === 'both') add(imageSearchQuery(subject, classification || {}), 'contextual visual evidence');
    else add(seed + ' photos OR images OR gallery OR portrait', 'visual evidence');
  }
  if (ids.has('videos')) {
    if (adult === 'on' || adult === 'both' || (ctx && (detectRelation(ctx) === 'bondage' || detectRelation(ctx) === 'video'))) {
      add('"' + subject.replace(/"/g, '') + '" ' + (ctx && !/adult content/i.test(ctx) ? ctx + ' ' : '') + 'video OR scene OR clip', 'contextual video sources');
    } else add(seed + ' video OR youtube OR interview', 'video sources');
  }
  if (ids.has('timeline') || ids.has('history')) add(seed + ' timeline OR history', 'chronology');
  if (ids.has('presence') || ids.has('official')) add(seed + ' official OR profile OR website', 'public presence');
  if (ids.has('tutorials') || ids.has('steps')) add(seed + ' tutorial OR procedure OR how to', 'instructional sources');
  if (ids.has('safety')) add(seed + ' safety', 'safety context');
  if (ids.has('identity')) {
    if (adult === 'on') add('"' + subject.replace(/"/g, '') + '" (performer OR profile OR "official site" OR models)', 'identity in the active research context');
    else add(seed + ' biography OR profile OR "who is"', 'identity sources');
  }
  if (ids.has('reviews')) add(seed + ' review OR reviews', 'reviews');
  if (ids.has('pricing')) add(seed + ' price OR pricing OR history', 'pricing history');
  if (ids.has('issues') || ids.has('trouble')) add(seed + ' problems OR issues OR common problems', 'known issues');
  if (ids.has('related') || ids.has('entities')) add(seed + ' related OR associated', 'related entities');
  if (ids.has('context') && ctx && !/adult content/i.test(ctx)) add('"' + subject.replace(/"/g, '') + '" ' + ctx, 'requested context intersection');
  if (ids.has('career')) add('"' + subject.replace(/"/g, '') + '" (credits OR filmography OR career)', 'career and credits');
  if (ids.has('projects') || ids.has('productions')) add('"' + subject.replace(/"/g, '') + '" ' + (ctx && !/adult content/i.test(ctx) ? ctx + ' ' : '') + '(scene OR title OR production)', 'projects and productions');
  if (ids.has('interviews')) add('"' + subject.replace(/"/g, '') + '" interview OR podcast OR feature', 'interviews and features');
  if (ids.has('organizations')) add('"' + subject.replace(/"/g, '') + '" (studio OR production OR company)', 'associated organizations');
  if (ids.has('evidence')) add(seed + ' evidence OR documentation OR source', 'evidence');
  if (ids.has('concepts')) add(seed + ' explained OR concept OR overview', 'concepts');
  if (ids.has('variations') || ids.has('variants')) add(seed + ' variants OR generations OR versions', 'variants');
  if (ids.has('alternatives')) add(seed + ' alternative OR vs OR compared', 'alternatives');
  if ((adult === 'on' || adult === 'both') && (ids.has('presence') || ids.has('identity') || ids.has('images') || ids.has('videos'))) {
    for (const v of adultSemanticVariants(subject, /adult content/i.test(ctx) ? '' : ctx)) add(v.q, v.why);
  }
  return extra.slice(0, 12);
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

function collectDiveVideos(retrieved, results, classification) {
  const out = [];
  const seen = new Set();
  const adult = (classification && classification.adultContent) || 'off';
  const extraCtx = String((classification && classification.context) || '').replace(/adult content/i, '').trim().toLowerCase();
  const add = (url, pageUrl, title, thumb) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    const yt = youtubeId(url);
    const vim = vimeoId(url);
    const host = hostOf(url).replace(/^www\./, '');
    const embedUrl = yt ? ('https://www.youtube.com/embed/' + yt) : (vim ? ('https://player.vimeo.com/video/' + vim) : '');
    const restrictedHost = /(onlyfans|patreon|substack)\.com/i.test(host);
    const playable = !!embedUrl && !restrictedHost;
    const blob = (String(title || '') + ' ' + url + ' ' + host + ' ' + String(pageUrl || '')).toLowerCase();
    let relevance = playable ? 3 : 1;
    let reason = playable ? 'Playable public embed. Not identity proof.' : 'Public video reference. Open the source to watch — Carmen does not invent playback.';
    let confidence = playable ? 'medium' : 'low';
    if (adult === 'on' || adult === 'both') {
      if (ADULT_HOST_RE.test(host) || ADULT_PATH_RE.test(url) || ADULT_EVIDENCE_RE.test(blob)) {
        relevance += 5;
        reason = 'Public adult-context video from ' + host + '. Visual likeness is not identity proof.';
        confidence = 'medium';
      }
      if (GENERIC_BIO_HOST_RE.test(host) || /biography|wikipedia|interview highlight/i.test(blob)) {
        relevance -= 3;
      }
    }
    if (extraCtx && extraCtx.split(/\s+/).filter(t => t.length > 2).some(t => blob.includes(t))) {
      relevance += 5;
      reason = 'Video context matches “' + extraCtx + '”. Visual likeness is not identity proof.';
      confidence = 'medium';
    } else if (extraCtx && adult === 'on') {
      relevance -= 2;
    }
    out.push({
      url,
      pageUrl: pageUrl || url,
      title: title || host,
      domain: host,
      thumbnail: thumb || (yt ? ('https://i.ytimg.com/vi/' + yt + '/hqdefault.jpg') : ''),
      embedUrl: playable ? embedUrl : '',
      playable,
      accessState: restrictedHost ? 'PAYWALLED' : (playable ? 'DIRECTLY_RETRIEVED' : 'REFERENCED'),
      accessNote: restrictedHost
        ? 'Playback requires a paid or logged-in account. Carmen cannot retrieve it.'
        : (playable ? '' : 'No public embed is available. Open the source to watch — Carmen does not invent playback.'),
      retrievedAt: new Date().toISOString(),
      relevance,
      reason,
      confidence,
      contextLane: (ADULT_HOST_RE.test(host) || ADULT_EVIDENCE_RE.test(blob)) ? 'adult' : 'general',
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
  out.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
  if (adult === 'on') {
    const contextual = out.filter(x => (x.relevance || 0) >= 5);
    if (contextual.length) return contextual.slice(0, 12);
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
  const subject = classification.subject || clean;
  const context = classification.context || '';
  const extraCtx = /adult content/i.test(context) ? '' : context;
  const adult = classification.adultContent || 'off';
  if (extraCtx && classification.type === 'person') {
    add('"' + subject.replace(/"/g, '') + '" ' + extraCtx, 'person + requested context');
    const syn = contextualSynonyms(extraCtx, classification.relation);
    if (syn) add('"' + subject.replace(/"/g, '') + '" ' + syn, 'contextual visual/source synonyms');
    add(subject + ' official OR website OR profile', 'official/profile pages for the person');
  } else if (extraCtx) {
    add('"' + subject.replace(/"/g, '') + '" ' + extraCtx, 'entity + requested context');
    const syn = contextualSynonyms(extraCtx, classification.relation);
    if (syn) add('"' + subject.replace(/"/g, '') + '" ' + syn, 'contextual synonyms');
  } else if (classification.type === 'person' && /\s/.test(clean)) {
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
  if (adult === 'on' || adult === 'both') {
    for (const v of adultSemanticVariants(subject, extraCtx)) add(v.q, v.why);
  }
  if (adult === 'both' && extraCtx) {
    add('"' + subject.replace(/"/g, '') + '" biography OR profile OR interview', 'general-context lane');
  }
  return out.slice(0, adult === 'off' ? 5 : 6);
}

function buildExpandedVariants(q, classification) {
  const clean = String(q || '').trim().replace(/\s+/g, ' ').slice(0, 200);
  const out = [];
  const add = (query, why) => {
    const t = String(query || '').trim();
    if (!t || t === clean) return;
    if (!out.some(x => x.q === t)) out.push({ q: t, why });
  };
  const subject = (classification && classification.subject) || clean;
  const context = (classification && classification.context) || '';
  const extraCtx = /adult content/i.test(context) ? '' : context;
  add('"' + subject.replace(/"/g, '') + '" interview OR feature OR "press"', 'public interviews and features as alternatives');
  add(clean + ' site:.org OR wikipedia OR "official site"', 'public indexes and official pages');
  add('"' + subject.replace(/"/g, '') + '" (cited OR according OR reported)', 'public citations and reporting');
  add('"' + subject.replace(/"/g, '') + '" photos OR images OR gallery', 'public image indexes as alternatives');
  add(clean + ' youtube OR video OR interview', 'public video indexes as alternatives');
  if (extraCtx) {
    add('"' + subject.replace(/"/g, '') + '" ' + extraCtx + ' interview OR feature OR review', 'contextual public alternatives');
    const syn = contextualSynonyms(extraCtx, classification && classification.relation);
    if (syn) add('"' + subject.replace(/"/g, '') + '" ' + syn, 'contextual synonyms');
  }
  if (classification && (classification.adultContent === 'on' || classification.adultContent === 'both')) {
    for (const v of adultSemanticVariants(subject, extraCtx)) add(v.q, v.why);
  }
  add(clean + ' reddit OR forum OR discussion', 'public discussion alternatives');
  if (classification && classification.type === 'person') {
    add(subject + ' news OR press OR homepage', 'editorial and official coverage');
  }
  if (classification && (classification.type === 'technique' || classification.type === 'skill')) {
    add(clean + ' diagram OR tutorial OR demonstrated', 'instructional visual sources');
  }
  return out.slice(0, 10);
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
  let intersection = false;
  const subjTokens = String((classification && classification.subject) || '').toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const nameTokens = subjTokens.length ? subjTokens : tokens.filter(t => t.length > 2).slice(0, 3);
  if (classification.isUrl && classification.url && (item.url === classification.url || item.url === classification.url.replace(/\/$/, ''))) {
    score += 50; bits.push('submitted URL');
  }
  const aggregator = isAggregatorPage(item);
  const specialist = isSpecialistSource(item);
  const specific = isSpecificEvidence(item, classification);
  if (q && title.includes(q)) {
    if (aggregator) { score += 8; bits.push('keyword overlap on an index page'); }
    else { score += 42; bits.push('exact query in title'); }
  } else if (tokens.length && tokens.every(t => title.includes(t))) {
    if (aggregator) { score += 6; bits.push('query tokens on an index page'); }
    else { score += 24; bits.push('all query tokens in title'); }
  } else if (nameTokens.length && nameTokens.every(t => title.includes(t))) { score += 24; bits.push('entity name in title'); }
  else if (tokens.some(t => title.includes(t))) { score += 8; bits.push('partial name match'); }
  if (!aggregator && tokens.length && tokens.every(t => host.includes(t) || url.includes(t))) { score += 20; bits.push('name tokens in URL/domain'); }
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
    const missing = nameTokens.filter(t => t.length > 2 && !title.includes(t) && !url.includes(t) && !snip.includes(t));
    if (classification.type === 'person' && missing.length) { score -= 36; bits.push('encyclopedia hit missing name tokens'); }
    else if (tokens.length && tokens.every(t => !title.includes(t))) { score -= 40; bits.push('encyclopedia hit unrelated to query'); }
    else { score += 16; bits.push('encyclopedia source'); }
  }
  if (PROFILE_HOST_RE.test(host)) { score += 14; bits.push('public profile host'); }
  if (host === 'reddit.com' || host.endsWith('.reddit.com')) { score += 12; bits.push('Reddit thread'); }
  const hasVisual = !!(item.image || (item.images && item.images.length));
  if (hasVisual) { score += 6; bits.push('has visual evidence'); }
  if (classification.type === 'person' && hasVisual && !aggregator && nameTokens.length && nameTokens.every(t => title.includes(t) || url.includes(t) || snip.includes(t))) {
    score += 14; bits.push('public visual reference for the person');
  }
  if ((classification.type === 'technique' || classification.type === 'skill') && INSTRUCTIONAL_HOST_RE.test(host)) {
    score += 16; bits.push('instructional source');
  }
  if ((classification.type === 'technique' || classification.type === 'skill') && /tutorial|how to|guide|explained|diagram|procedure|safety/i.test(title + ' ' + snip)) {
    score += 12; bits.push('instructional title');
  }
  if (classification.type === 'technique' && (item.image || (item.images && item.images.length))) {
    score += 8; bits.push('visual reference');
  }
  let contextPenalized = false;
  if (classification.context) {
    const ctxTerms = contextTermsForScore(classification);
    const blob = title + ' ' + snip + ' ' + url;
    const hasEntity = nameTokens.length ? nameTokens.every(t => blob.includes(t)) : tokens.filter(t => t.length > 2).slice(0, 2).every(t => blob.includes(t));
    const matchedCtx = ctxTerms.filter(t => blob.includes(t));
    const hasContext = matchedCtx.length > 0;
    if (hasEntity && hasContext) {
      if (aggregator) {
        score += 8; bits.push('keyword co-occurrence on an index, not verified relationship');
      } else {
        score += specific ? 40 : 32;
        bits.push('entity ∩ context (' + matchedCtx.slice(0, 3).join(', ') + ')');
        intersection = true;
        if (specialist) { score += 12; bits.push('specialist/public database for the intersection'); }
        else if (specific) { score += 10; bits.push('specific production/title/project evidence'); }
      }
    } else if (ctxTerms.length && hasEntity && classification.adultContent !== 'both') {
      score -= 18; bits.push('entity without requested context');
      contextPenalized = true;
    } else if (ctxTerms.length && hasContext && !hasEntity) {
      score -= 12; bits.push('context without the entity');
    }
  }
  const adult = (classification && classification.adultContent) || 'off';
  const adultish = isAdultishSource(item);
  const genericBio = GENERIC_BIO_HOST_RE.test(host);
  let contextLane = (adultish && !genericBio) ? 'adult' : 'general';
  if (adult === 'on' || adult === 'both') {
    if (adultish && !genericBio) { score += 24; bits.push('adult-context source'); }
    if (genericBio && adult === 'on') {
      score -= contextPenalized ? 8 : 24;
      bits.push('generic biography, weak for adult-context research');
    } else if (genericBio && adult === 'both') {
      score -= 6; bits.push('general biography lane');
    }
  }
  if (NAV_TITLE_RE.test(String(item.title || '').trim())) { score -= 45; bits.push('generic nav title'); }
  if (SEO_JUNK_RE.test(host) || SEO_JUNK_RE.test(url)) { score -= 30; bits.push('SEO/name-mill site'); }
  if (aggregator || TUBE_INDEX_RE.test(host) || (adult === 'off' && /\/pornstar\//i.test(url))) {
    const extra = extraContext(classification);
    const tubePen = (adult === 'on' || adult === 'both') ? (extra ? 34 : 8) : 22;
    score -= tubePen;
    bits.push('aggregator/index, not a primary source');
  }
  if (/\/(top|playlists?|search)\//i.test(url)) { score -= 14; bits.push('search/index page'); }
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
  const hasEntityFlag = nameTokens.length ? nameTokens.every(tok => (title + ' ' + snip + ' ' + url).includes(tok)) : false;
  const hasContextFlag = extraContext(classification) ? contextTermsForScore(classification).some(term => (title + ' ' + snip + ' ' + url).includes(term)) : false;
  const resultKind = classifyResultKind(item, classification, {
    intersection,
    hasEntity: hasEntityFlag,
    hasContext: hasContextFlag,
    hasVisual,
    relationship: /follow-|production|title/.test(String(item.discoveryLane || '')),
  });
  if (resultKind === 'AGGREGATOR' && /Strong match/.test(reason)) {
    reason = 'Index page — keyword overlap, not a verified relationship';
  }
  return { score, confidence, reason, signals: bits, contextLane, intersection, resultKind };
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
      contextLane: s.contextLane || 'general',
      adultContent: classification.adultContent || 'off',
      intersection: !!s.intersection,
      discoveryLane: item.discoveryLane || '',
      resultKind: s.resultKind || 'WEAK_MATCH',
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
  const take = classification.type === 'person' || classification.isUrl ? 6 : 3;
  const picked = results.slice(0, take);
  for (const r of results.slice(take, 14)) {
    if (picked.length >= take + 3) break;
    const host = (r.domain || hostOf(r.url)).replace(/^www\./, '');
    if ((PROFILE_HOST_RE.test(host) || r.image || ((classification.adultContent === 'on' || classification.adultContent === 'both') && isAdultishSource(r))) && !picked.includes(r)) picked.push(r);
  }
  const galleryExtra = [];
  await Promise.all(picked.map(async (item) => {
    if (item.retrievalStatus) return;
    if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) return;
    SEARCH_BUDGET.used++;
    try {
      const retrieved = await retrieveSource(item.url);
      item.retrievalStatus = retrieved.status;
      item.accessState = retrieved.accessState || (retrieved.status === 'RETRIEVED' ? 'DIRECTLY_RETRIEVED' : 'UNAVAILABLE');
      item.accessNote = retrieved.accessNote || retrieved.error || '';
      item.retrievedAt = retrieved.retrievedAt || null;
      if (retrieved.status === 'RETRIEVED') {
        if (retrieved.title && retrieved.title.length > 4 && (!item.title || item.title.length < retrieved.title.length)) {
          item.title = item.title || retrieved.title;
        }
        if ((!item.snippet || item.snippet.length < 40) && retrieved.description) item.snippet = retrieved.description;
        const imgs = rankImages([retrieved.ogImage, ...(retrieved.images || []), ...(item.images || [])], retrieved.finalUrl || item.url);
        item.images = imgs.slice(0, 12);
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
        if (retrieved.galleryUrls && (classification.type === 'person' || classification.type === 'social')) {
          for (const g of retrieved.galleryUrls) galleryExtra.push(g);
        }
      } else {
        item.provenance = item.accessState === 'PAYWALLED' || item.accessState === 'AUTHENTICATION_REQUIRED' ? 'RETRIEVAL_FAILED' : (item.provenance || 'DISCOVERED');
        item.retrievalError = retrieved.error || 'retrieval failed';
        if (retrieved.ogImage || (retrieved.images && retrieved.images.length)) {
          const imgs = rankImages([retrieved.ogImage, ...(retrieved.images || []), ...(item.images || [])], item.url);
          item.images = imgs.slice(0, 6);
          item.image = item.image || imgs[0] || '';
          item.publicEvidence = retrieved.publicEvidence || 'Public thumbnail or snippet only — protected content was not retrieved.';
        }
      }
    } catch (e) {
      item.provenance = 'DISCOVERED';
      item.accessState = item.accessState || 'UNAVAILABLE';
      item.retrievalError = String(e?.message || e).slice(0, 160);
    }
    if (item.provenance === 'RETRIEVED' && /official|profile|models\//i.test(item.reason || item.url)) {
      item.score = (item.score || 0) + 4;
    }
  }));
  for (const g of galleryExtra.slice(0, 2)) {
    if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) break;
    if (results.some(r => r.url === g)) continue;
    SEARCH_BUDGET.used++;
    try {
      const retrieved = await retrieveSource(g);
      if (retrieved.status !== 'RETRIEVED') continue;
      const imgs = rankImages([retrieved.ogImage, ...(retrieved.images || [])], retrieved.finalUrl || g);
      const parent = results.find(r => hostOf(r.url) === hostOf(g));
      if (parent && imgs.length) {
        parent.images = rankImages([...(parent.images || []), ...imgs], parent.url).slice(0, 12);
        parent.image = parent.image || parent.images[0] || '';
      }
    } catch {}
  }
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
      row.accessState = retrieved.accessState || 'DIRECTLY_RETRIEVED';
      row.accessNote = retrieved.accessNote || '';
      row.textExcerpt = String(retrieved.textExcerpt || retrieved.text || '').slice(0, 1800);
      row.images = imgs;
      row.image = imgs[0] || row.image;
      row.fingerprint = retrieved.fingerprint;
      if (retrieved.identifiers) {
        row.aliases = [...new Set([...(row.aliases || []), ...(retrieved.identifiers.aliases || []), ...(retrieved.identifiers.handles || [])])].slice(0, 6);
        row.profiles = retrieved.identifiers.profiles;
      }
    }
  } else {
    diagnostics.DirectURL.accessState = retrieved.accessState || 'UNAVAILABLE';
    if (classification.isImage) {
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
  const expanded = opts.expanded === true || opts.expanded === 'true' || opts.expanded === 1;
  const adult = normalizeAdult(opts.adult || opts.adultContent);
  const q = String(query || '').trim().slice(0, 500);
  const classification = applyResearchFilter(classifyQuery(q, opts.hint), adult, q);
  const depth = normalizeDepth(opts.depth, classification);
  classification.researchDepth = depth;
  SEARCH_BUDGET = { used: 0, max: opts.budget || (expanded ? 80 : (depth === 'deep' ? 72 : depth === 'contextual' ? 56 : 48)) };
  const graph = discoveryLanes(classification, depth);
  const variants = [];
  const addVar = (qv, why, lane, kind) => {
    const t = String(qv || '').trim();
    if (!t || variants.some(v => v.q === t)) return;
    variants.push({ q: t, why: why || '', lane: lane || '', kind: kind || 'web' });
  };
  if (classification.isUrl) {
    for (const v of buildSearchVariants(opts.displayQuery || q, classification)) addVar(v.q, v.why, 'url', 'web');
  } else if (depth === 'broad') {
    for (const v of buildSearchVariants(q, classification)) addVar(v.q, v.why, 'identity', 'web');
  } else {
    addVar(q, 'primary query', 'primary', 'web');
    for (const lane of graph.lanes) {
      for (const qv of lane.queries) addVar(qv, lane.why, lane.id, lane.kind || 'web');
    }
  }
  if (expanded) {
    for (const v of buildExpandedVariants(q, classification)) addVar(v.q, v.why, 'expanded', 'web');
  }
  if (Array.isArray(opts.extraQueries)) {
    for (const extra of opts.extraQueries) {
      const t = typeof extra === 'string' ? extra : extra && extra.q;
      addVar(t, (extra && extra.why) || 'deep-dive expansion', 'dive', 'web');
    }
  }
  const results = [], seen = new Set(), diagnostics = {};
  if (!q) return { query: q, classification, variants, results, providers: diagnostics, count: 0, expanded, adultContent: adult, depth, lanes: graph.lanes };

  async function runVariant(variant, includeSocial) {
    const jobs = [
      ddg(variant.q, results, seen, diagnostics),
      bing(variant.q, results, seen, diagnostics),
    ];
    if (includeSocial) {
      jobs.push(reddit(variant.q, results, seen, diagnostics));
      if (adult !== 'on') jobs.push(wikipedia(variant.q, results, seen, diagnostics, classification));
    }
    await Promise.all(jobs);
    for (const r of results) {
      if (r.queryVariant === variant.q && !r.discoveryLane) r.discoveryLane = variant.lane || '';
    }
  }

  if (classification.isUrl) {
    const direct = await inspectDirectUrl(classification, results, seen, diagnostics);
    const follow = variants.filter(v => v.q && v.q !== classification.url).slice(0, expanded ? 3 : 2);
    if (!follow.length) {
      const host = hostOf(classification.url).replace(/^www\./, '');
      const pathName = humanizePath(classification.url);
      if (pathName && /[a-z]/i.test(pathName) && pathName.toLowerCase() !== host.split('.')[0]) follow.push({ q: pathName, why: 'name inferred from URL path' });
    }
    if (direct && direct.status !== 'RETRIEVED') {
      diagnostics.ContinuedSearch = { reason: 'submitted URL inaccessible (' + (direct.accessState || direct.error || 'failed') + ') — searching public alternatives' };
    }
    for (const variant of follow) {
      addVar(variant.q, variant.why, variant.lane || 'url', 'web');
      await Promise.all([
        ddg(variant.q, results, seen, diagnostics),
        bing(variant.q, results, seen, diagnostics),
        reddit(variant.q, results, seen, diagnostics),
      ]);
    }
  } else {
    const webVariants = variants.filter(v => (v.kind || 'web') === 'web');
    const cap = expanded ? 10 : (depth === 'deep' ? 10 : depth === 'contextual' ? 8 : 5);
    const mustRun = new Set(['primary', 'intersection', 'identity']);
    for (let i = 0; i < Math.min(webVariants.length, cap); i++) {
      if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) break;
      await runVariant(webVariants[i], i === 0);
      const remainingMust = webVariants.slice(i + 1).some(v => mustRun.has(v.lane));
      if (depth === 'broad' && !expanded && results.length >= MAX_RESULTS && !remainingMust) break;
    }
    if (results.length < 6 && SEARCH_BUDGET.used < SEARCH_BUDGET.max) {
      await startpage(q, results, seen, diagnostics);
    }
  }

  const imgQ = imageSearchQuery(q, classification);
  const mediaVariants = variants.filter(v => v.kind === 'image' || v.kind === 'video');
  if (expanded) {
    const jobs = [];
    if (SEARCH_BUDGET.used < SEARCH_BUDGET.max) jobs.push(bingImages(imgQ, results, seen, diagnostics));
    if (SEARCH_BUDGET.used < SEARCH_BUDGET.max) jobs.push(bingVideos(imgQ, results, seen, diagnostics));
    if (SEARCH_BUDGET.used < SEARCH_BUDGET.max) jobs.push(google(q, results, seen, diagnostics));
    if (SEARCH_BUDGET.used < SEARCH_BUDGET.max) jobs.push(mojeek(q, results, seen, diagnostics));
    if (jobs.length) await Promise.all(jobs);
    if (classification.context && SEARCH_BUDGET.used < SEARCH_BUDGET.max) {
      const extraCtx = extraContext(classification);
      if (extraCtx) await bingImages(quoteName(classification.subject || q) + ' ' + extraCtx, results, seen, diagnostics);
    }
  } else {
    for (const m of mediaVariants) {
      if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) break;
      if (m.kind === 'image') await bingImages(m.q, results, seen, diagnostics);
      if (m.kind === 'video') await bingVideos(m.q, results, seen, diagnostics);
    }
    if (!mediaVariants.length && (classification.type === 'person' || classification.type === 'technique' || classification.context) && SEARCH_BUDGET.used < SEARCH_BUDGET.max - 2) {
      await bingImages(imgQ, results, seen, diagnostics);
      if (adult === 'both' && SEARCH_BUDGET.used < SEARCH_BUDGET.max) {
        await bingImages(quoteName(classification.subject || q) + ' (portrait OR headshot OR official)', results, seen, diagnostics);
      }
      if (SEARCH_BUDGET.used < SEARCH_BUDGET.max && (adult === 'on' || adult === 'both' || classification.relation === 'video' || classification.relation === 'interview')) {
        await bingVideos(imgQ, results, seen, diagnostics);
      }
    }
  }

  let ranked = rankResults(classification.isUrl ? (humanizePath(classification.url) || q) : q, results, classification);
  if (opts.enrich !== false) ranked = await enrichTopResults(ranked, classification);

  const retrievedN = ranked.filter(r => r.retrievalStatus === 'RETRIEVED' || r.provenance === 'RETRIEVED').length;
  const restricted = ranked.filter(r => r.accessState === 'PAYWALLED' || r.accessState === 'AUTHENTICATION_REQUIRED' || r.accessState === 'AGE_RESTRICTED' || r.accessState === 'BLOCKED').length;
  if (!expanded && (ranked.length < 3 || retrievedN === 0 || restricted >= Math.max(2, ranked.length - 1)) && SEARCH_BUDGET.used < SEARCH_BUDGET.max - 4) {
    diagnostics.ContinuedSearch = {
      reason: ranked.length < 3 ? 'few public results on the first pass' : (restricted ? 'obvious sources were restricted' : 'obvious sources were not retrievable'),
      philosophy: 'Escalating to public alternatives — not retrying the same wall.',
    };
    const more = buildExpandedVariants(q, classification).slice(0, 3);
    for (const v of more) {
      if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) break;
      addVar(v.q, v.why, 'expanded', 'web');
      await Promise.all([ddg(v.q, results, seen, diagnostics), bing(v.q, results, seen, diagnostics)]);
    }
    if (SEARCH_BUDGET.used < SEARCH_BUDGET.max) await bingImages(imgQ, results, seen, diagnostics);
    ranked = rankResults(classification.isUrl ? (humanizePath(classification.url) || q) : q, results, classification);
    if (opts.enrich !== false) ranked = await enrichTopResults(ranked, classification);
  }

  let graphLeads = [];
  if (depth !== 'broad' && SEARCH_BUDGET.used < SEARCH_BUDGET.max - 4) {
    graphLeads = extractGraphLeads(
      ranked.filter(r => r.provenance === 'RETRIEVED' || r.textExcerpt).map(r => ({
        title: r.title,
        url: r.url,
        textExcerpt: r.textExcerpt || r.snippet || '',
        identifiers: { aliases: r.aliases || [], handles: [], profiles: r.profiles || [] },
      })),
      ranked,
      classification
    );
    const follow = graphLeads.filter(l => {
      if (!(l.kind === 'production' || l.kind === 'title' || l.kind === 'alias')) return false;
      const lab = String(l.label || '').trim();
      const subj = String((classification && classification.subject) || '').trim();
      if (lab.split(/\s+/).length < 2 && l.kind !== 'alias') return false;
      if (l.kind === 'alias' && (/^(videos?|photos?|images?|gallery|search|model|performer|official|profile|porn|xxx|bondage|bdsm|clips?)$/i.test(lab.replace(/^@/, '')) || lab.replace(/^@/, '').length < 4)) return false;
      if (q && lab.toLowerCase() === q.toLowerCase()) return false;
      if (subj && lab.toLowerCase() === subj.toLowerCase()) return false;
      return true;
    }).slice(0, depth === 'deep' ? 4 : 2);
    if (follow.length) {
      diagnostics.RelationshipFollow = { followed: follow.map(l => l.label), reason: 'Following titles, productions, and aliases observed on retrieved sources.' };
      for (const l of follow) {
        if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) break;
        addVar(l.q, l.why, 'follow-' + l.kind, 'web');
        await Promise.all([ddg(l.q, results, seen, diagnostics), bing(l.q, results, seen, diagnostics)]);
      }
      ranked = rankResults(classification.isUrl ? (humanizePath(classification.url) || q) : q, results, classification);
      if (opts.enrich !== false) ranked = await enrichTopResults(ranked, classification);
    }
  }

  for (const r of ranked) {
    if (!r.provenance) r.provenance = r.retrievalStatus === 'RETRIEVED' ? 'RETRIEVED' : 'DISCOVERED';
    if (!r.accessState) {
      r.accessState = r.retrievalStatus === 'RETRIEVED' ? 'DIRECTLY_RETRIEVED' : (r.retrievalStatus === 'RETRIEVAL_FAILED' ? 'REFERENCED' : 'UNVERIFIED');
    }
    if (!r.images) r.images = r.image ? [r.image] : [];
    r.observedAt = r.observedAt || new Date().toISOString();
    r.adultContent = adult;
  }

  const identity = buildEntityIdentity(classification, [], ranked, graphLeads);
  const intersectionCount = ranked.filter(r => r.intersection).length;

  let warning = ranked.length ? undefined : 'No public-web results were returned. Provider diagnostics are included for troubleshooting.';
  if (classification.isUrl && diagnostics.DirectURL && !diagnostics.DirectURL.ok) {
    const fail = 'Submitted URL could not be retrieved (' + (diagnostics.DirectURL.accessState ? accessLabel(diagnostics.DirectURL.accessState) : (diagnostics.DirectURL.error || 'blocked or failed')) + '). Carmen did not pretend to inspect it and kept looking for public alternatives.';
    warning = warning ? fail + ' ' + warning : fail;
  }
  if (diagnostics.ContinuedSearch && !expanded) {
    const note = 'Restricted or incomplete sources triggered a public-alternative search. Carmen does not bypass paywalls or logins.';
    warning = warning ? warning + ' ' + note : note;
  }

  return {
    query: q,
    classification,
    variants,
    results: ranked,
    providers: diagnostics,
    count: ranked.length,
    paths: researchPaths(classification.type, classification),
    warning,
    expanded,
    continued: !!diagnostics.ContinuedSearch,
    adultContent: adult,
    depth,
    lanes: graph.lanes,
    vocab: graph.vocab,
    identity,
    graphLeads,
    intersectionCount,
    lenses: interestLenses(classification.type, classification),
    visualCandidates: visualCandidatesFor(ranked, classification),
    selectedEntity: buildSelectedEntity(classification, ranked[0], identity, { originalQuery: q, depth, adultContent: adult }),
  };
}

function classifyHandler(req) {
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') || '').trim().slice(0, 500);
  const hint = (u.searchParams.get('type') || u.searchParams.get('subject') || '').trim();
  const adult = normalizeAdult(u.searchParams.get('adult') || u.searchParams.get('adultContent'));
  const classification = applyResearchFilter(classifyQuery(q, hint), adult, q);
  const depth = normalizeDepth(u.searchParams.get('depth') || '', classification);
  return json({
    classification,
    depth,
    lenses: interestLenses(classification.type, classification),
    paths: researchPaths(classification.type, classification),
  }, 200, req);
}

async function searchWeb(req) {
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') || '').trim().slice(0, 500);
  const hint = (u.searchParams.get('type') || u.searchParams.get('subject') || '').trim();
  const expanded = u.searchParams.get('expanded') === '1' || u.searchParams.get('expanded') === 'true';
  const adult = normalizeAdult(u.searchParams.get('adult') || u.searchParams.get('adultContent'));
  const depth = u.searchParams.get('depth') || '';
  if (!q) return json({ results: [], query: '', count: 0, providers: {}, classification: applyResearchFilter(classifyQuery(''), adult, ''), expanded: false, adultContent: adult, depth: normalizeDepth(depth) }, 200, req);
  const discovery = await runDiscovery(q, { hint, enrich: true, expanded, adult, depth });
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

const CARMEN_SYSTEM = 'You are Carmen, a conservative AI research assistant for adult users. Be concise and useful. Clearly distinguish OBSERVED (directly stated/visible), INFERRED (labeled interpretation), and UNKNOWN. Never invent facts, sources, URLs, dates, or evidence. Never claim something was saved or sent unless the user explicitly requested it. Never autonomously contact people, send messages, post, comment, submit forms, make purchases, create accounts, perform transactions, or take any external action. You may research, analyze, organize, and prepare information only. Never bypass, evade, or circumvent paywalls, logins, age gates, CAPTCHAs, DRM, robots, or other access controls. Never claim you retrieved paywalled, login-gated, age-gated, or blocked content. Public titles, search snippets, and thumbnails are not the protected content — label them as referenced public evidence only. If the original source cannot be accessed, say so honestly and look for legitimate public alternatives. If the only remaining relevant source is paywalled, say clearly: Absolutely cannot retrieve due to paywall. Adult Content is a research-context filter, not an entity type — when it is ON, do not silently fall back to generic biography. Adult context does not lower evidence discipline. For sexual or self-bondage topics, do not provide explicit step-by-step sexual or self-bondage instructions; you may organize public sources, terminology, visual references, and research questions. For general skills and crafts you may outline procedures only when they are grounded in retrieved sources. Visual likeness is not identity proof.';

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

function collectDiveImages(retrieved, results, classification) {
  const out = [], seen = new Set();
  const adult = (classification && classification.adultContent) || 'off';
  const extraCtx = extraContext(classification).toLowerCase();
  const ctxTerms = contextTermsForScore(classification);
  const subject = String((classification && classification.subject) || '').toLowerCase();
  const add = (url, pageUrl, source, extra = {}) => {
    const u = usableImage(url);
    if (!u) return;
    const key = u.replace(/[?#].*$/, '');
    if (seen.has(key)) return;
    seen.add(key);
    const stock = isStockImage(u);
    const domain = hostOf(pageUrl || u).replace(/^www\./, '');
    const blob = ((pageUrl || '') + ' ' + domain + ' ' + (source || '') + ' ' + (extra.caption || '')).toLowerCase();
    let relevance = stock ? 0 : extra.kind === 'og' ? 4 : extra.kind === 'page' ? 3 : extra.kind === 'index' ? 2 : 1;
    let reason = extra.caption || (stock ? 'Possible stock/generic image — not identity proof' : 'Image keeps page provenance. Visual likeness is not identity proof.');
    let confidence = 'medium';
    const entityOnPage = !subject || subject.split(/\s+/).filter(t => t.length > 1).every(t => blob.includes(t));
    const matchedCtx = ctxTerms.filter(t => blob.includes(t));
    if (adult === 'on' || adult === 'both') {
      if (ADULT_HOST_RE.test(domain) || ADULT_PATH_RE.test(pageUrl || '') || ADULT_EVIDENCE_RE.test(blob)) {
        relevance += 5;
        reason = 'Public adult-context visual from ' + domain + '. Visual likeness is not identity proof.';
        confidence = 'medium';
      }
      if (GENERIC_BIO_HOST_RE.test(domain) || /portrait|headshot|wiki/i.test(blob)) {
        relevance -= 4;
        reason = 'Generic/biographical image — weak for the requested adult context. Not identity proof.';
        confidence = 'low';
      }
    }
    if (matchedCtx.length && entityOnPage) {
      relevance += 6;
      reason = 'Image from a page linking the entity to “' + matchedCtx.slice(0, 2).join(', ') + '”. Visual likeness is not identity proof.';
      confidence = 'medium';
    } else if (ctxTerms.length && extraCtx && (adult === 'on')) {
      relevance -= 3;
    }
    out.push({
      url: u,
      sourceUrl: u,
      pageUrl: pageUrl || '',
      domain,
      source: source || 'retrieved page',
      kind: extra.kind || (stock ? 'stock' : source === 'og:image' ? 'og' : 'page'),
      stock,
      caption: reason,
      reason,
      confidence,
      relevance,
      accessState: extra.accessState || 'DISCOVERED',
      provenance: extra.provenance || (extra.kind === 'page' ? 'RETRIEVED' : 'DISCOVERED'),
      retrievedAt: new Date().toISOString(),
      relationshipToEntity: entityOnPage ? 'page associates this image with the entity' : 'entity association not established',
      relationshipToContext: matchedCtx.length ? 'page associates this image with ' + matchedCtx.slice(0, 3).join(', ') : (extraCtx ? 'requested context not observed on the source page' : ''),
    });
  };
  for (const page of retrieved || []) {
    if (page.ogImage) add(page.ogImage, page.finalUrl || page.url, 'og:image', { kind: 'og', accessState: page.accessState, provenance: page.status });
    for (const img of page.images || []) add(img, page.finalUrl || page.url, page.accessState === 'DIRECTLY_RETRIEVED' ? 'retrieved page' : 'public preview', { kind: 'page', accessState: page.accessState, provenance: page.status });
  }
  for (const r of results || []) {
    if (r.image) add(r.image, r.url, r.source || 'search', { kind: r.imageOrigin === 'image-index' ? 'index' : 'search', accessState: r.accessState, provenance: r.provenance });
    for (const img of r.images || []) add(img, r.url, r.source || 'search', { kind: r.imageOrigin === 'image-index' ? 'index' : 'search', accessState: r.accessState, provenance: r.provenance });
  }
  out.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
  if (adult === 'on') {
    const contextual = out.filter(x => x.relevance >= 5);
    if (contextual.length) return contextual.slice(0, 36);
  }
  return out.slice(0, 36);
}

async function deepDiveHandler(req, env) {
  try {
    const b = await req.json().catch(() => ({}));
    const query = String(b.query || b.subjectQuery || '').trim().slice(0, 500);
    const candidate = b.candidate && typeof b.candidate === 'object' ? b.candidate : null;
    const hint = String(b.subject || b.type || '').trim();
    const selectedEntityIn = (b.selectedEntity && typeof b.selectedEntity === 'object') ? b.selectedEntity : null;
    const originalQuery = String(b.originalQuery || (selectedEntityIn && selectedEntityIn.originalQuery) || query || '').trim();
    const canonical = String((selectedEntityIn && selectedEntityIn.canonicalName) || '').trim();
    if (!query && !(candidate && candidate.url) && !canonical) {
      return json({ error: 'Select a candidate or enter a subject before running Deep Dive.' }, 400, req);
    }
    const evidenceIn = (selectedEntityIn && selectedEntityIn.discoveryEvidence) || discoveryEvidenceFrom(candidate) || discoveryEvidenceFrom(selectedEntityIn);
    const evidenceUrl = String((evidenceIn && evidenceIn.url) || (candidate && candidate.url) || '').trim();
    const adult = normalizeAdult(b.adult || b.adultContent || (selectedEntityIn && selectedEntityIn.adultContent));
    const typeHint = hint || (selectedEntityIn && selectedEntityIn.type) || '';
    const rawForClassify = originalQuery || query || canonical;
    const classifyInput = (/^https?:\/\//i.test(rawForClassify) && canonical) ? canonical : (rawForClassify || canonical);
    const classification = applyResearchFilter(classifyQuery(classifyInput, typeHint), adult, classifyInput);
    if (canonical) classification.subject = canonical;
    const carriedCtx = String((selectedEntityIn && selectedEntityIn.context) || b.context || '').trim();
    if (carriedCtx && !extraContext(classification)) classification.context = carriedCtx;
    const seed = diveSeedQuery(classification, originalQuery, canonical, query);
    const expanded = b.expanded === true || b.expanded === 'true' || b.expanded === 1;
    const depth = normalizeDepth(b.all === true || b.all === 'true' || b.depth === 'deep' ? 'deep' : (b.depth || (selectedEntityIn && selectedEntityIn.depth) || 'contextual'), classification);
    classification.researchDepth = depth;
    const resolved = resolveDivePaths(classification.type, b, classification);
    const selectedPaths = resolved.selected;
    const selectedIds = new Set(selectedPaths.map(p => p.id));
    const customQuestion = resolved.custom || String(b.customQuestion || b.instructions || '').trim();
    const instruction = parseInvestigativeQuestion(customQuestion, classification);
    for (const id of instruction.paths) selectedIds.add(id);
    const retrieved = [];
    const seenUrl = new Set();
    const retrieveCap = expanded || resolved.all || depth === 'deep' ? 10 : 6;
    const pushRet = async (url) => {
      if (!url || seenUrl.has(url) || retrieved.length >= retrieveCap) return;
      seenUrl.add(url);
      retrieved.push(await retrieveSource(url));
    };
    if (evidenceUrl) await pushRet(evidenceUrl);
    const focus = retrieved[0];
    const ids = (focus && focus.identifiers) || { profiles: [], handles: [], aliases: [] };
    const graph = discoveryLanes(classification, depth);
    const extra = diveExpansionQueries({
      classification,
      seed,
      instruction,
      selectedPaths,
      selectedIds,
      identifiers: ids,
      customQuestion,
      evidenceHost: hostOf(evidenceUrl),
      expanded,
      resolvedAll: resolved.all,
      adult,
      depth,
    });
    const focusBlocked = !!(focus && focus.status !== 'RETRIEVED');
    const plan = {
      subject: classification.subject || seed,
      type: classification.type,
      why: classification.reason,
      selectedEntity: buildSelectedEntity(classification, candidate || evidenceIn, { canonicalName: canonical || classification.subject, aliases: ids.aliases, handles: ids.handles }, {
        originalQuery,
        context: classification.context,
        adultContent: adult,
        depth,
        canonicalName: canonical || classification.subject,
        entityId: (selectedEntityIn && selectedEntityIn.entityId) || '',
        discoveryEvidence: evidenceIn,
        lens: (selectedEntityIn && selectedEntityIn.lens) || b.lens || '',
      }),
      discoveryEvidence: evidenceIn || null,
      instruction,
      focusUrl: evidenceUrl || '',
      all: resolved.all,
      selectedPaths: selectedPaths.map(p => p.id),
      customQuestion,
      expanded,
      adultContent: adult,
      context: classification.context || '',
      relation: classification.relation || '',
      depth,
      lanes: graph.lanes.map(l => l.id),
      investigating: [
        resolved.all ? 'Investigate ALL research paths for this entity type, active context, and question — including paths discovered for this investigation' : ('Investigate selected paths: ' + selectedPaths.map(p => p.label).join(', ')),
        customQuestion ? ('Investigative instruction (' + (instruction.intent || 'directed') + (instruction.topic ? ': ' + instruction.topic : '') + '): ' + customQuestion.slice(0, 180)) : 'No custom question — follow the selected paths',
        'Research depth: ' + depth + (depth === 'deep' ? ' — follow productions, people, organizations, and references discovered in the intersection' : (depth === 'contextual' ? ' — find material about the entity ∩ requested context, not name-only hits' : ' — identify the entity/domain')),
        adult === 'off' ? 'Adult content filter is OFF — general public research' : (adult === 'on' ? 'Adult content filter is ON — keep adult-industry public context through retrieval, media, and synthesis' : 'Adult content filter is BOTH — keep general and adult-context lanes distinguishable'),
        classification.context ? ('Requested context: ' + (classification.subject || seed) + ' in relation to “' + classification.context + '” (' + (classification.relation || 'context') + ')') : 'Subject-only research (no extra visual/contextual relation requested)',
        evidenceUrl ? (focusBlocked ? ('Identifying source is inaccessible (' + accessLabel(focus.accessState) + '). That page is provenance only — researching the canonical entity across other public sources.') : 'Identifying source kept as provenance/evidence, not as a research boundary. Investigating the canonical entity across public sources.') : 'Retrieve the strongest public sources for the canonical entity',
        'A Browse/Search result identifies the entity. Deep Dive does not restrict discovery to that source, domain, or result set.',
        selectedIds.has('images') || selectedIds.has('visuals') || resolved.all ? 'Collect images relevant to the entity AND the active context, with provenance. Visual likeness is not identity proof.' : 'Images collected only when they appear on retrieved pages',
        selectedIds.has('videos') || resolved.all ? 'Collect playable or openable public videos relevant to the active context. No fake playback.' : 'Video collection skipped unless a source page includes one',
        expanded ? 'Expanded Research is on — public alternatives for restricted/incomplete sources, not a bypass' : 'Normal research already searches multiple providers, variants, and public media.',
        'Separate OBSERVED / INFERRED / UNKNOWN — visual likeness is not identity proof',
        'Never treat paywalled or login-gated content as retrieved evidence. Never bypass access controls.',
      ],
      variants: extra.slice(0, resolved.all || expanded ? 12 : 8),
      identifiers: ids,
      safety: 'Read-only public research. Carmen will not contact anyone, send messages, post, log in, bypass paywalls, or take external actions.',
    };

    const extraLimit = resolved.all || expanded || depth === 'deep' ? 10 : 6;
    const discovery = await runDiscovery(seed, {
      hint: classification.type,
      extraQueries: extra.slice(0, extraLimit),
      enrich: true,
      expanded: expanded || focusBlocked,
      adult,
      depth,
    });
    const rankedForRetrieve = [...discovery.results].sort((a, b) => {
      let sa = 0, sb = 0;
      if (selectedIds.has('videos') || resolved.all) { sa += isVideoHost(a.url) ? 10 : 0; sb += isVideoHost(b.url) ? 10 : 0; }
      if (selectedIds.has('images') || selectedIds.has('visuals') || resolved.all) { sa += a.image ? 3 : 0; sb += b.image ? 3 : 0; }
      if (classification.context) {
        const ctx = classification.context.toLowerCase();
        if (String(a.title || '').toLowerCase().includes(ctx) || String(a.snippet || '').toLowerCase().includes(ctx)) sa += 8;
        if (String(b.title || '').toLowerCase().includes(ctx) || String(b.snippet || '').toLowerCase().includes(ctx)) sb += 8;
      }
      if (adult === 'on' || adult === 'both') {
        if (a.contextLane === 'adult' || isAdultishSource(a)) sa += 10;
        if (b.contextLane === 'adult' || isAdultishSource(b)) sb += 10;
      }
      return sb - sa || (b.score || 0) - (a.score || 0);
    });
    const retrieveQueue = diveRetrievalQueue({
      evidenceUrl,
      discoveryResults: rankedForRetrieve,
      profileUrls: ids.profiles,
      galleryUrls: (focus && focus.galleryUrls) || [],
      retrieveCap,
      adult,
    });
    for (const url of retrieveQueue) await pushRet(url);
    const images = collectDiveImages(retrieved, discovery.results, classification);
    const videos = (resolved.all || selectedIds.has('videos')) ? collectDiveVideos(retrieved, discovery.results, classification) : [];
    const access = summarizeAccess(retrieved, discovery.results);

    let analysis = '';
    let analysisError = '';
    const excerpts = retrieved.filter(x => x.status === 'RETRIEVED').map(x => ({
      title: x.title, url: x.url, provenance: 'RETRIEVED',
      accessState: x.accessState || 'DIRECTLY_RETRIEVED',
      excerpt: String(x.textExcerpt || x.text || '').slice(0, 1800),
    }));
    const inaccessible = (access.inaccessible || []).map(x => ({
      title: x.title, url: x.url, accessState: x.accessState, label: x.label, note: x.note, publicEvidence: x.publicEvidence,
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
Canonical entity: ${classification.subject || seed} (${classification.type})
Discovery evidence (provenance only — not a research boundary): ${evidenceUrl || 'none'}
Requested context: ${classification.context || '(none — subject only)'}
Adult content filter: ${adult} (this is a research-context filter, not an entity type)
Expanded research: ${expanded || focusBlocked ? 'yes — public alternatives for restricted sources' : 'no — normal research already covers multiple providers and variants'}
Access summary: ${access.headline || 'Public sources retrieved where possible.'}

Rules:
- Investigate ONLY the selected research paths. If ALL is selected, cover every listed heading. Do not pad unselected areas.
- Separate OBSERVED / INFERRED / UNKNOWN as labeled headings under each path.
- Organize the writeup using these research headings, in order:
${selectedPaths.map(p => p.label).join('\n')}
- Prefer DIRECTLY RETRIEVED excerpts over search snippets.
- Never invent URLs, dates, or identities.
- Never claim you retrieved paywalled, login-gated, age-gated, or blocked content. Inaccessible sources are listed separately.
- Public titles, snippets, and thumbnails of inaccessible sources are REFERENCED public evidence, not retrieved page content.
- If the only remaining relevant source is paywalled, say clearly: Absolutely cannot retrieve due to paywall. Then list what public evidence exists elsewhere and what remains UNKNOWN.
- If a visual/contextual relation was requested (person + context), treat that as a different problem from identity-only search. Rank and discuss sources that actually associate the person with the requested context — entity ∩ context, not entity results plus random context results.
- If Adult content = ON, do not silently fall back to generic biography. Keep adult-context public sources, images, and videos in the writeup, labeled honestly. Adult context does not lower OBSERVED/INFERRED/UNKNOWN discipline.
- If Adult content = BOTH, distinguish the general lane from the adult-context lane.
- Never bypass paywalls, logins, age gates, CAPTCHAs, or other access controls. Work around the information gap with public alternatives only.
- Images showing similar appearance across sources are OBSERVED visual consistency, NOT identity proof. Never say they are definitely the same person.
- List publicly visible handles, domains, and aliases only if they appear in the sources.
- Suggest research leads as questions/sources to review, never as actions to take.
- After the writeup, list related public aspects the user could investigate next as:
RELATED
- kind: label — why
Kinds: person, technique, object, place, source, product, video. Only from retrieved material. Never invent.

Retrieved sources:
${JSON.stringify(excerpts)}

Inaccessible sources (do not treat as retrieved evidence):
${JSON.stringify(inaccessible)}

Discovery results (may be snippets only):
${JSON.stringify(discovery.results.slice(0, 8).map(r => ({ title: r.title, url: r.url, source: r.source, snippet: r.snippet, reason: r.reason, provenance: r.provenance, accessState: r.accessState })))}` },
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
    const related = parsedRelated.length ? parsedRelated : relatedFromDiscovery(discovery.results, evidenceIn || candidate);
    for (const lead of (discovery.graphLeads || []).slice(0, 6)) {
      if (related.some(r => String(r.label || '').toLowerCase() === lead.label.toLowerCase())) continue;
      related.push({ kind: lead.kind, label: lead.label, why: lead.why, url: '' });
    }
    const suggestions = [];
    if (discovery.results.length) suggestions.push('Carmen found ' + discovery.results.length + ' public sources that may be relevant.');
    if (videos.length) suggestions.push(videos.length + ' public video source' + (videos.length === 1 ? '' : 's') + ' surfaced.');
    if (related.length) suggestions.push('Would you like to investigate a related entity without leaving this case?');
    if (access.headline) suggestions.push(access.headline);
    if (focusBlocked && !expanded) suggestions.push('The identifying source was inaccessible. That page is provenance only — Deep Dive continues across other public sources. Expanded Research can keep looking.');
    if (!expanded && (access.paywalled || access.authenticationRequired)) suggestions.push('Protected sources were not retrieved. Public alternatives and references are labeled honestly.');

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
      access,
      paths: selectedPaths,
      availablePaths: researchPaths(classification.type, classification),
      selectedPathIds: selectedPaths.map(p => p.id),
      all: resolved.all,
      customQuestion,
      expanded: expanded || discovery.expanded || false,
      adultContent: adult,
      depth,
      identity: discovery.identity,
      graphLeads: discovery.graphLeads || [],
      intersectionCount: discovery.intersectionCount || 0,
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
    const adult = normalizeAdult(b.adult || b.adultContent);
    const classification = applyResearchFilter(classifyQuery(query, hint), adult, query);
    const paths = researchPaths(classification.type, classification);
    const discovery = await runDiscovery(query, { hint: classification.type, enrich: true, adult });
    const retrieved = [];
    const seen = new Set();
    for (const r of discovery.results) {
      if (retrieved.length >= 5) break;
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      retrieved.push(await retrieveSource(r.url));
    }
    const images = collectDiveImages(retrieved, discovery.results, classification);
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
      adultContent: adult,
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
        version: '46',
        build: 'workspace',
        schemaVersion: 2,
        provider: ai.provider,
        model: ai.model,
        configured: ai.configured,
        routes: ['/health', '/search', '/classify', '/retrieve', '/source', '/img', '/dive', '/learn', '/chat', '/analyze', '/synthesize'],
        searchProviders: ['DuckDuckGo', 'Bing', 'Reddit', 'Wikipedia', 'Startpage'],
        assets: !!(env.ASSETS && typeof env.ASSETS.fetch === 'function'),
        features: ['discovery', 'retrieve', 'provenance', 'ranking', 'images', 'videos', 'deep-dive', 'dive-select', 'learn', 'collections', 'adaptive-paths', 'branching', 'instructions', 'timeline', 'evidence', 'leads', 'expanded-research', 'access-states', 'adult-filter', 'research-context', 'discovery-graph', 'research-depth', 'relationship-follow', 'result-kinds', 'interest-lenses', 'visual-identity', 'selected-entity', 'dive-workspace', 'entity-source-separation'],
      }, 200, req);
    }
    if (u.pathname === '/search' && req.method === 'GET') return searchWeb(req);
    if (u.pathname === '/classify' && req.method === 'GET') return classifyHandler(req);
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
  const ogImage = (html.match(/<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:image(?::url)?["']/i) ||
    html.match(/<meta[^>]+(?:name|property)=["']twitter:image(?::src)?["'][^>]+content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']twitter:image/i) || [])[1] || '';
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

async function retrieveWayback(url) {
  try {
    const r = await fetchText('https://archive.org/wayback/available?url=' + encodeURIComponent(url), {
      headers: { accept: 'application/json', 'user-agent': 'CarmenResearch/41 (investigation workspace)' },
    }, 8000);
    if (!r.ok) return null;
    const j = await r.json();
    const snap = j?.archived_snapshots?.closest;
    if (!snap || !snap.available || !snap.url) return null;
    return snap.url;
  } catch { return null; }
}

function decorateAccess(base, access) {
  return {
    ...base,
    status: access.status || base.status,
    accessState: access.accessState,
    accessNote: access.note || base.accessNote || '',
    error: access.error || base.error,
  };
}

async function retrieveSource(targetUrl, opts = {}) {
  const url = normalizeUrlForStore(targetUrl);
  if (!url) return { status: 'RETRIEVAL_FAILED', accessState: 'UNVERIFIED', error: 'Invalid URL', url: targetUrl };
  let host = '';
  try { host = new URL(url).hostname; } catch { return { status: 'RETRIEVAL_FAILED', accessState: 'UNVERIFIED', error: 'Invalid URL', url }; }
  if (PRIVATE_HOST_RE.test(host) || BLOCKED_HOSTS.has(host.toLowerCase())) {
    return { status: 'RETRIEVAL_FAILED', accessState: 'BLOCKED', error: 'Private or blocked host', url, host, accessNote: 'Carmen does not retrieve private or blocked hosts.' };
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
            accessState: 'DIRECTLY_RETRIEVED',
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
    if (!r.ok) {
      const access = classifyAccess({ httpStatus: r.status, html: '', url, host, error: 'HTTP ' + r.status });
      const failed = decorateAccess({ url, host, httpStatus: r.status, error: 'HTTP ' + r.status }, access);
      const canAlt = !opts.skipAlt && (access.accessState === 'BLOCKED' || access.accessState === 'UNAVAILABLE') && access.accessState !== 'PAYWALLED' && access.accessState !== 'AUTHENTICATION_REQUIRED' && access.accessState !== 'AGE_RESTRICTED';
      if (canAlt && (r.status === 404 || r.status === 410)) {
        const snap = await retrieveWayback(url);
        if (snap) {
          const alt = await retrieveSource(snap, { skipAlt: true });
          if (alt.status === 'RETRIEVED') {
            return {
              ...alt,
              url,
              accessState: 'PUBLIC_ALTERNATIVE',
              accessNote: 'Original page was unavailable. Public archived snapshot retrieved. This is not a paywall bypass.',
              alternativeOf: url,
              alternativeSource: 'Internet Archive',
              alternativeUrl: snap,
            };
          }
        }
      }
      return failed;
    }
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_RETRIEVE_BYTES) {
      return { status: 'RETRIEVAL_FAILED', accessState: 'BLOCKED', error: 'Response too large', url, bytes: buf.byteLength, accessNote: 'The response was too large to retrieve safely.' };
    }
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.startsWith('image/')) {
      return {
        status: 'RETRIEVED',
        accessState: 'DIRECTLY_RETRIEVED',
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
    const access = classifyAccess({ httpStatus: r.status, html, url, host });
    const meta = extractMeta(html);
    const text = cleanText(html).slice(0, MAX_TEXT_CHARS);
    const extraImgs = extractImagesFromHtml(html, r.url || url);
    const images = rankImages([meta.ogImage, ...extraImgs], r.url || url).slice(0, 18);
    const identifiers = extractPublicIdentifiers(html, r.url || url);
    let ogAbs = meta.ogImage;
    try { if (ogAbs) ogAbs = new URL(decodeEntities(ogAbs), r.url || url).href; } catch {}
    let ogVideo = meta.ogVideo || '';
    try { if (ogVideo) ogVideo = new URL(decodeEntities(ogVideo), r.url || url).href; } catch {}
    const publicBits = [meta.title, meta.description, ogAbs].filter(Boolean).join(' · ').slice(0, 400);
    const base = {
      url,
      finalUrl: r.url || url,
      title: meta.title,
      description: meta.description,
      ogImage: ogAbs || images[0] || '',
      ogVideo,
      images,
      fingerprint: simpleFingerprint(text),
      retrievedAt: new Date().toISOString(),
      bytes: buf.byteLength,
      contentType: r.headers.get('content-type') || '',
      identifiers,
      galleryUrls: galleryLinks(html, r.url || url),
    };
    if (access.status !== 'RETRIEVED') {
      return {
        ...base,
        status: 'RETRIEVAL_FAILED',
        accessState: access.accessState,
        accessNote: access.note,
        error: access.error || 'inaccessible',
        httpStatus: r.status,
        publicEvidence: publicBits,
        text: '',
        textExcerpt: '',
      };
    }
    return {
      ...base,
      status: 'RETRIEVED',
      accessState: access.accessState,
      accessNote: access.note,
      text,
      textExcerpt: text,
      publicEvidence: access.accessState === 'PARTIALLY_RETRIEVED' ? publicBits : '',
    };
  } catch (e) {
    const err = e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 300);
    const access = classifyAccess({ html: '', url, host, error: err });
    const failed = decorateAccess({ url, error: err }, access);
    if (!opts.skipAlt && err === 'timeout') {
      const snap = await retrieveWayback(url);
      if (snap) {
        const alt = await retrieveSource(snap, { skipAlt: true });
        if (alt.status === 'RETRIEVED') {
          return {
            ...alt,
            url,
            accessState: 'PUBLIC_ALTERNATIVE',
            accessNote: 'Original page timed out. Public archived snapshot retrieved. This is not a paywall bypass.',
            alternativeOf: url,
            alternativeSource: 'Internet Archive',
            alternativeUrl: snap,
          };
        }
      }
    }
    return failed;
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

export { classifyQuery, scoreResult, buildSearchVariants, buildExpandedVariants, decodeEntities, rankResults, humanizePath, researchPaths, resolveDivePaths, inferPathsFromQuestion, parseInvestigativeQuestion, pathSearchVariants, youtubeId, collectDiveVideos, collectDiveImages, parseRelated, classifyAccess, accessLabel, parseQueryContext, attachContext, applyResearchFilter, normalizeAdult, adultSemanticVariants, imageSearchQuery, isAdultishSource, extraContext, normalizeDepth, contextVocabulary, discoveryLanes, extractGraphLeads, contextTermsForScore, isAggregatorPage, isSpecificEvidence, classifyResultKind, interestLenses, visualCandidatesFor, buildSelectedEntity, entityIdFor, discoveryEvidenceFrom, diveSeedQuery, diveExpansionQueries, diveRetrievalQueue, userAskedForSourceRestriction };
