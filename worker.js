// Carmen — canonical Cloudflare Worker backend.
// Routes: GET /health, GET /search, POST /chat, POST /analyze, POST /synthesize.
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
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&/g, '&').replace(/"/g, '"').replace(/&#39;/g, "'")
    .replace(/</g, '<').replace(/>/g, '>').replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Resolve redirect-wrapped URLs (DuckDuckGo uddg=, etc.).
function unwrap(raw) {
  let url = String(raw || '').trim();
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
  let t = cleanText(title);
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
  results.push({
    title: title.slice(0, 240),
    url: key,
    source: String(item.source || 'Public web').slice(0, 120),
    snippet: cleanText(item.snippet || '').slice(0, 600),
    image: typeof item.image === 'string' && item.image.startsWith('http') ? item.image : '',
    observedAt: new Date().toISOString(),
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

async function htmlSearch(url, source, parser, results, seen, diagnostics) {
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
}

async function ddg(q, results, seen, diagnostics) {
  await htmlSearch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q) + '&kp=-2', 'DuckDuckGo', parseDDG, results, seen, diagnostics);
  if (results.length < 8) {
    await htmlSearch('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q), 'DuckDuckGo Lite', parseAnchors.bind(null), results, seen, diagnostics);
  }
}

async function bing(q, results, seen, diagnostics) {
  await htmlSearch('https://www.bing.com/search?q=' + encodeURIComponent(q) + '&adlt=off', 'Bing', parseBing, results, seen, diagnostics);
}

async function google(q, results, seen, diagnostics) {
  await htmlSearch('https://www.google.com/search?q=' + encodeURIComponent(q) + '&safe=off&num=10', 'Google', parseGoogle, results, seen, diagnostics);
}

async function mojeek(q, results, seen, diagnostics) {
  await htmlSearch('https://www.mojeek.com/search?q=' + encodeURIComponent(q), 'Mojeek', parseMojeek, results, seen, diagnostics);
}

async function startpage(q, results, seen, diagnostics) {
  await htmlSearch('https://www.startpage.com/sp/search?query=' + encodeURIComponent(q) + '&cat=web', 'Startpage', parseStartpage, results, seen, diagnostics);
}

async function yahoo(q, results, seen, diagnostics) {
  await htmlSearch('https://search.yahoo.com/search?p=' + encodeURIComponent(q), 'Yahoo', parseYahoo, results, seen, diagnostics);
}

async function reddit(q, results, seen, diagnostics) {
  try {
    const r = await fetchText('https://www.reddit.com/search.json?q=' + encodeURIComponent(q) + '&limit=25&sort=relevance&t=all&include_over_18=on', {
      headers: { accept: 'application/json', 'user-agent': 'CarmenResearch/3.0' },
    });
    diagnostics.Reddit = { status: r.status, ok: r.ok };
    if (!r.ok) return;
    const j = await r.json();
    for (const child of j?.data?.children || []) {
      const d = child?.data;
      if (!d?.permalink) continue;
      uniqueAdd(results, seen, {
        title: d.title || 'Reddit result',
        url: 'https://www.reddit.com' + d.permalink,
        source: d.subreddit_name_prefixed || (d.subreddit ? 'Reddit · r/' + d.subreddit : 'Reddit'),
        snippet: d.selftext || '',
        image: typeof d.thumbnail === 'string' && d.thumbnail.startsWith('http') ? d.thumbnail : '',
      });
      if (results.length >= MAX_RESULTS) break;
    }
  } catch (e) { diagnostics.Reddit = { error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 200) }; }
}

function searchVariants(q) {
  const clean = q.trim().replace(/\s+/g, ' ');
  const variants = [clean];
  if (/\s/.test(clean) && !/^".*"$/.test(clean)) variants.push('"' + clean.replace(/"/g, '') + '"');
  return [...new Set(variants)];
}

async function searchWeb(req) {
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') || '').trim().slice(0, 500);
  if (!q) return json({ results: [], query: '', count: 0, providers: {} }, 200, req);

  const results = [], seen = new Set(), diagnostics = {};
  for (const variant of searchVariants(q)) {
    await Promise.all([
      ddg(variant, results, seen, diagnostics),
      bing(variant, results, seen, diagnostics),
      google(variant, results, seen, diagnostics),
      mojeek(variant, results, seen, diagnostics),
      startpage(variant, results, seen, diagnostics),
      yahoo(variant, results, seen, diagnostics),
      reddit(variant, results, seen, diagnostics),
    ]);
    if (results.length >= MAX_RESULTS) break;
  }

  return json({
    results: results.slice(0, MAX_RESULTS),
    query: q,
    count: Math.min(results.length, MAX_RESULTS),
    providers: diagnostics,
    warning: results.length ? undefined : 'No public-web results were returned. Provider diagnostics are included for troubleshooting.',
  }, 200, req);
}

// --- AI provider --------------------------------------------------------------

/** Resolve AI secret: prefer API_KEY, fall back to Api_key (existing CF binding name). */
function getApiKey(env) {
  return env.API_KEY || env.Api_key || '';
}

async function provider(env, messages, temperature = 0.2) {
  const apiKey = getApiKey(env);
  if (!apiKey) throw Error('AI provider is not configured. Add the API_KEY Worker secret before using Carmen AI.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const r = await fetch(env.API_URL || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: env.MODEL || 'gpt-4.1-mini', temperature, messages }),
    });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { throw Error(text || `AI provider returned HTTP ${r.status}`); }
    if (!r.ok) throw Error(j?.error?.message || `AI provider returned HTTP ${r.status}`);
    return j;
  } finally { clearTimeout(timer); }
}

const CARMEN_SYSTEM = 'You are Carmen, a conservative AI research assistant for adult users. Be concise and useful. Clearly distinguish OBSERVED (directly stated/visible), INFERRED (labeled interpretation), and UNKNOWN. Never invent facts, sources, URLs, dates, or evidence. Never claim something was saved or sent unless the user explicitly requested it. Never autonomously contact people, send messages, post, comment, submit forms, make purchases, create accounts, perform transactions, or take any external action. You may research, analyze, organize, and prepare information only.';

async function chat(req, env) {
  try {
    const b = await req.json();
    const subject = b.subject ? `Investigation subject: ${JSON.stringify(b.subject)}. ` : '';
    const messages = [{ role: 'system', content: CARMEN_SYSTEM + ' ' + subject + 'Context: ' + JSON.stringify(b.context || {}) }];
    for (const m of Array.isArray(b.messages) ? b.messages : []) {
      if (m && typeof m.content === 'string') messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content.slice(0, 20000) });
    }
    const j = await provider(env, messages, 0.3);
    return json({ text: j?.choices?.[0]?.message?.content || '' }, 200, req);
  } catch (e) { return json({ error: e?.name === 'AbortError' ? 'AI provider timed out.' : e?.message || String(e) }, 500, req); }
}

function validateImage(x) {
  if (typeof x !== 'string' || !x.startsWith('data:image/')) throw Error('imageDataUrl must be an image data URL');
  if (x.length > 16000000) throw Error('Image is too large. Use a smaller screenshot.');
}

function parseModelJson(raw) {
  const clean = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(clean); } catch {}
  const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(clean.slice(a, b + 1)); } catch {} }
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
  return parseModelJson(j?.choices?.[0]?.message?.content || '');
}

async function analyze(req, env) { try { return json(await structuredVision(req, env, await req.json(), 'analyze'), 200, req); } catch (e) { return json({ error: e?.name === 'AbortError' ? 'AI provider timed out.' : e?.message || String(e) }, 500, req); } }
async function synthesize(req, env) { try { return json(await structuredVision(req, env, await req.json(), 'synthesize'), 200, req); } catch (e) { return json({ error: e?.name === 'AbortError' ? 'AI provider timed out.' : e?.message || String(e) }, 500, req); } }

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response('', { headers: cors(req) });
    if (u.pathname === '/health' && req.method === 'GET') return json({
      ok: true,
      worker: 'carmen',
      version: '37',
      build: 'phase2-retrieve',
      schemaVersion: 2,
      provider: getApiKey(env) ? 'configured' : 'not-configured',
      model: env.MODEL || 'gpt-4.1-mini',
      routes: ['/health', '/search', '/retrieve', '/source', '/chat', '/analyze', '/synthesize'],
      searchProviders: PROVIDERS,
      assets: !!(env.ASSETS && typeof env.ASSETS.fetch === 'function'),
      features: ['discovery', 'retrieve', 'provenance', 'instructions', 'timeline', 'evidence', 'leads'],
    }, 200, req);
    if (u.pathname === '/search' && req.method === 'GET') return searchWeb(req);
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
  return { title: cleanText(title).slice(0, 300), description: cleanText(desc).slice(0, 600), ogImage };
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
  try {
    const r = await fetchText(url, { headers: BROWSER_HEADERS, redirect: 'follow' }, RETRIEVE_TIMEOUT_MS);
    if (!r.ok) return { status: 'RETRIEVAL_FAILED', error: `HTTP ${r.status}`, url, httpStatus: r.status };
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_RETRIEVE_BYTES) {
      return { status: 'RETRIEVAL_FAILED', error: 'Response too large', url, bytes: buf.byteLength };
    }
    const html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    const meta = extractMeta(html);
    const text = cleanText(html).slice(0, MAX_TEXT_CHARS);
    const images = [];
    const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;
    let m;
    while ((m = imgRe.exec(html)) && images.length < MAX_IMAGES) {
      try {
        const abs = new URL(m[1], url).href;
        if (/^https?:/i.test(abs)) images.push(abs);
      } catch {}
    }
    if (meta.ogImage && !images.includes(meta.ogImage)) images.unshift(meta.ogImage);
    return {
      status: 'RETRIEVED',
      url,
      finalUrl: r.url || url,
      title: meta.title,
      description: meta.description,
      text,
      images: images.slice(0, MAX_IMAGES),
      fingerprint: simpleFingerprint(text),
      retrievedAt: new Date().toISOString(),
      bytes: buf.byteLength,
      contentType: r.headers.get('content-type') || '',
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
