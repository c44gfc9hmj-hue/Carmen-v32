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
  'support.google.com', 'support.microsoft.com', 'support.apple.com',
  'accounts.google.com', 'myaccount.google.com', 'policies.google.com',
  'go.microsoft.com', 'www.msn.com', 'msn.com',
  'support.startpage.com', 'support.duckduckgo.com',
]);

const NAV_LINK_RE = /^(images?|videos?|news|maps|shopping|mail|sign in|sign up|log in|login|more|web|all|finance|sports|weather|travel|games?|apps?|about|help|privacy|terms|settings|preferences|account|home|search|filter|tools?|feedback|learn more|learn|mobile|desktop|menu|skip|close|open|back|next|previous|continue|submit|cancel|yes|no)$/i;

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

// TEMPORARY RESTORE STUB - full baseline will be restored in next commit
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response('', { headers: cors(req) });
    if (u.pathname === '/health' && req.method === 'GET') return json({
      ok: true,
      worker: 'carmen',
      version: '36-restore',
      provider: env.API_KEY ? 'configured' : 'not-configured',
      model: env.MODEL || 'gpt-4.1-mini',
      routes: ['/health', '/search', '/chat', '/analyze', '/synthesize'],
      searchProviders: PROVIDERS,
      assets: !!(env.ASSETS && typeof env.ASSETS.fetch === 'function'),
      note: 'Temporary restore after placeholder - full worker next',
    }, 200, req);
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(req);
    return new Response('Worker temporarily restored. Redeploy pending.', { status: 503 });
  },
};
