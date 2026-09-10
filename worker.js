// Carmen V35 — consolidated backend fix
// ADDITIVE BUILD: use this as a new Worker entry point; it does not require
// modifying the existing Carmen UI files.

const MAX_RESULTS = 20;
const SEARCH_TIMEOUT_MS = 8000;
const AI_TIMEOUT_MS = 30000;

function cors(req) {
  const origin = req.headers.get('Origin');
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
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
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function unwrap(raw) {
  let url = String(raw || '').trim();
  if (url.startsWith('//')) url = 'https:' + url;
  try {
    const u = new URL(url);
    for (const key of ['uddg', 'url', 'u']) {
      const target = u.searchParams.get(key);
      if (target && /^https?:\/\//i.test(target)) return decodeURIComponent(target);
    }
  } catch {}
  return url;
}

function validUrl(url) {
  try { return /^https?:$/i.test(new URL(url).protocol); } catch { return false; }
}

function uniqueAdd(results, seen, item) {
  const url = unwrap(item.url);
  const title = cleanText(item.title);
  if (!validUrl(url) || !title || title.length < 2) return false;
  let key;
  try { key = new URL(url).href.replace(/#.*$/, ''); } catch { return false; }
  if (seen.has(key)) return false;
  seen.add(key);
  results.push({
    title: title.slice(0, 240),
    url: key,
    source: String(item.source || 'Public web').slice(0, 120),
    snippet: cleanText(item.snippet || '').slice(0, 600),
    image: typeof item.image === 'string' ? item.image : '',
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

function parseAnchors(html, source, results, seen, limit) {
  // Generic parser: search engines change CSS classes frequently, so Carmen
  // deliberately extracts ordinary result links instead of relying on one class.
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && results.length < limit) {
    const title = cleanText(m[2]);
    const url = unwrap(m[1]);
    if (!title || title.length < 3 || title.length > 300 || !validUrl(url)) continue;
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (['duckduckgo.com','www.duckduckgo.com','bing.com','www.bing.com','microsoft.com','www.microsoft.com','google.com','www.google.com','search.yahoo.com','yahoo.com','mojeek.com','www.mojeek.com','startpage.com','www.startpage.com'].includes(host)) continue;
      if (host === 'reddit.com' || host.endsWith('.reddit.com')) continue;
    } catch { continue; }
    uniqueAdd(results, seen, { title, url, source });
  }
}

async function htmlSearch(url, source, results, seen, diagnostics, limit) {
  try {
    const r = await fetchText(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    diagnostics[source] = { status: r.status, ok: r.ok };
    if (r.ok) parseAnchors(await r.text(), source, results, seen, limit);
  } catch (e) {
    diagnostics[source] = { error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e) };
  }
}

async function ddg(q, results, seen, diagnostics) {
  await htmlSearch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q) + '&kp=-2', 'DuckDuckGo', results, seen, diagnostics, 12);
  if (results.length < 8) {
    await htmlSearch('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q), 'DuckDuckGo Lite', results, seen, diagnostics, 16);
  }
}

async function bing(q, results, seen, diagnostics) {
  await htmlSearch('https://www.bing.com/search?q=' + encodeURIComponent(q) + '&adlt=off', 'Bing', results, seen, diagnostics, 18);
}

async function google(q, results, seen, diagnostics) {
  // Google is an additional public-web source, not a replacement. If it blocks
  // Cloudflare, the other providers still work.
  await htmlSearch('https://www.google.com/search?q=' + encodeURIComponent(q) + '&safe=off&num=10', 'Google', results, seen, diagnostics, 16);
}

async function mojeek(q, results, seen, diagnostics) {
  await htmlSearch('https://www.mojeek.com/search?q=' + encodeURIComponent(q), 'Mojeek', results, seen, diagnostics, 16);
}

async function startpage(q, results, seen, diagnostics) {
  await htmlSearch('https://www.startpage.com/sp/search?query=' + encodeURIComponent(q) + '&cat=web', 'Startpage', results, seen, diagnostics, 16);
}

async function yahoo(q, results, seen, diagnostics) {
  await htmlSearch('https://search.yahoo.com/search?p=' + encodeURIComponent(q), 'Yahoo', results, seen, diagnostics, 16);
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
        source: d.subreddit ? 'Reddit · r/' + d.subreddit : 'Reddit',
        snippet: d.selftext || '',
        image: typeof d.thumbnail === 'string' && d.thumbnail.startsWith('http') ? d.thumbnail : '',
      });
      if (results.length >= MAX_RESULTS) break;
    }
  } catch (e) { diagnostics.Reddit = { error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e) }; }
}

function searchVariants(q) {
  const clean = q.trim().replace(/\s+/g, ' ');
  const variants = [clean];
  // Exact-phrase search helps names and unusual terms; normal search remains first.
  if (/\s/.test(clean) && !/^".*"$/.test(clean)) variants.push('"' + clean.replace(/"/g, '') + '"');
  return [...new Set(variants)];
}

async function searchWeb(req) {
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') || '').trim().slice(0, 500);
  if (!q) return json({ results: [], query: '', count: 0, providers: {} }, 200, req);

  const results = [], seen = new Set(), diagnostics = {};
  // Broad public-web coverage. No client VPN is required: these requests run
  // from Cloudflare, so the phone's VPN cannot change their source IP.
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
    adult_research: true,
    warning: results.length ? undefined : 'No public-web results were returned. Provider diagnostics are included for troubleshooting.',
  }, 200, req);
}

async function provider(env, messages, temperature = 0.2) {
  if (!env.API_KEY) throw Error('AI provider is not configured. Add the API_KEY Worker secret before using Carmen AI.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const r = await fetch(env.API_URL || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.API_KEY}` },
      body: JSON.stringify({ model: env.MODEL || 'gpt-4.1-mini', temperature, messages }),
    });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { throw Error(text || `AI provider returned HTTP ${r.status}`); }
    if (!r.ok) throw Error(j?.error?.message || `AI provider returned HTTP ${r.status}`);
    return j;
  } finally { clearTimeout(timer); }
}

async function chat(req, env) {
  try {
    const b = await req.json();
    const messages = [{ role: 'system', content: 'You are Carmen, a conservative AI research assistant. Be concise and useful. Distinguish observations, inferences, and unknowns. Never invent facts. Never claim something was saved unless the user explicitly requested it. Never autonomously contact people, send messages, post, comment, submit forms, purchase anything, or take external actions. Investigation context: ' + JSON.stringify(b.context || {}) }];
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
  if (!env.API_KEY) throw Error('AI provider is not configured. Add the API_KEY Worker secret before using Carmen AI.');
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
      worker: 'carmen-v35-bigfix',
      provider: env.API_KEY ? 'configured' : 'not-configured',
      model: env.MODEL || 'gpt-4.1-mini',
      routes: ['/health', '/search', '/chat', '/analyze', '/synthesize'],
      search: ['DuckDuckGo', 'Bing', 'Yahoo', 'Reddit'],
      assets: !!(env.ASSETS && typeof env.ASSETS.fetch === 'function'),
    }, 200, req);
    if (u.pathname === '/search' && req.method === 'GET') return searchWeb(req);
    if (u.pathname === '/chat' && req.method === 'POST') return chat(req, env);
    if (u.pathname === '/analyze' && req.method === 'POST') return analyze(req, env);
    if (u.pathname === '/synthesize' && req.method === 'POST') return synthesize(req, env);
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(req);
    return new Response('Carmen static assets binding is missing.', { status: 500, headers: { ...cors(req), 'content-type': 'text/plain; charset=utf-8' } });
  },
};
