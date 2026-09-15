function describeCarmenEnvironment(env, ai) {
  const testKeyRequired = !!(env && env.CARMEN_TEST_KEY);
  return {
    name: (env && (env.CARMEN_ENV || env.ENVIRONMENT)) || 'cloudflare-worker',
    worker: 'carmen',
    workerBinding: 'carmen-iphone-v25',
    assetsBound: !!(env && env.ASSETS && typeof env.ASSETS.fetch === 'function'),
    aiConfigured: !!(ai && ai.configured),
    testKeyRequired,
    secretsExposed: false,
  };
}

function browserTestDescriptor(env) {
  return {
    available: true,
    sameUiAsIphone: true,
    samePipelineAsIphoneUi: true,
    primary: '/test',
    routes: ['/test', '/browser-test'],
    session: '/api/v1/browser-test-session',
    testKeyRequired: !!(env && env.CARMEN_TEST_KEY),
    access: (env && env.CARMEN_TEST_KEY)
      ? 'Open /test. If API JSON routes require it, send X-Carmen-Test-Key. The UI itself uses the same /search /dive routes as the iPhone app.'
      : 'Open /test or /browser-test on this origin — no extra authentication.',
  };
}

function issueBrowserTestSession(req, env) {
  const sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ('bt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
  return json({
    ok: true,
    mode: 'browser-test',
    sessionId,
    issuedAt: new Date().toISOString(),
    expiresInSeconds: 86400,
    ui: '/test',
    aliases: ['/test', '/browser-test'],
    sameUiAsIphone: true,
    samePipelineAsIphoneUi: true,
    testKeyRequired: !!(env && env.CARMEN_TEST_KEY),
    capabilities: ['research', 'retrieve', 'save internal investigation state', 'analyze', 'branch'],
    forbidden: ['send messages', 'post', 'follow accounts', 'purchase', 'submit external forms'],
    note: 'Optional correlation id for a remote browser agent. Does not grant extra privileges. Never returns secrets or production credentials.',
  }, 200, req, {
    'set-cookie': 'carmen_browser_test=' + sessionId + '; Path=/; Max-Age=86400; SameSite=Lax',
  });
}

const BROWSER_TEST_UI = new Set(['/test', '/browser-test']);

function browserTestRewritePath(pathname) {
  const raw = String(pathname || '/');
  const trimmed = raw.replace(/\/+$/, '') || '/';
  if (BROWSER_TEST_UI.has(trimmed)) return '/index.html';
  for (const prefix of ['/test/', '/browser-test/']) {
    if (raw === prefix) return '/index.html';
    if (raw.startsWith(prefix)) {
      const rest = raw.slice(prefix.length);
      if (!rest || rest === 'index.html') return '/index.html';
      if (rest.includes('..') || rest.includes('\\')) return null;
      return '/' + rest.replace(/^\/+/ , '');
    }
  }
  return null;
}

async function serveBrowserTestSurface(req, env) {
  const u = new URL(req.url);
  const rewrite = browserTestRewritePath(u.pathname);
  if (!rewrite) return null;
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    return new Response('Carmen static assets binding is missing. Set the ASSETS binding in wrangler.jsonc.', {
      status: 500,
      headers: { ...cors(req), 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  const assetUrl = new URL(req.url);
  assetUrl.pathname = rewrite;
  if (rewrite !== '/index.html') assetUrl.search = '';
  const assetReq = new Request(assetUrl.toString(), { method: 'GET', headers: req.headers });
  const res = await env.ASSETS.fetch(assetReq);
  const headers = new Headers(res.headers);
  headers.set('x-carmen-browser-test', '1');
  headers.set('x-carmen-version', PLANNER_VERSION);
  headers.set('x-carmen-build', PLANNER_BUILD);
  headers.set('cache-control', 'no-store');
  const corsHeaders = cors(req);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  if (rewrite === '/index.html') {
    let html = await res.text();
    const metaRe = new RegExp('<' + 'meta\\s+name=["\']carmen-browser-test["\']', 'i');
    const headRe = new RegExp('<' + 'head([^>]*)>', 'i');
    if (!metaRe.test(html)) {
      html = html.replace(headRe, '<' + 'head$1>\n  <base href="/">\n  <' + 'meta name="carmen-browser-test" content="1">');
    }
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('set-cookie', 'carmen_browser_test=1; Path=/; Max-Age=86400; SameSite=Lax');
    return new Response(html, { status: res.status || 200, headers });
  }
  return new Response(res.body, { status: res.status, headers });
}
