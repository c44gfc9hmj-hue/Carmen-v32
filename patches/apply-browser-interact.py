#!/usr/bin/env python3
"""Make the real Carmen PWA operable by an external browser agent.

Does not change retrieval, ranking, Deep Dive logic, or visual design.
"""
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]


def must_replace(text, old, new, label):
    if old not in text:
        raise SystemExit('patch failed: %s not found' % label)
    if text.count(old) != 1:
        raise SystemExit('patch failed: %s matched %d times' % (label, text.count(old)))
    return text.replace(old, new, 1)


def patch_html(html: str) -> str:
    html = must_replace(
        html,
        '<html lang="en">',
        '<html lang="en" data-testid="carmen-app" data-carmen-status="idle" data-carmen-view="home" data-carmen-busy="false" data-carmen-results="0">',
        'html root',
    )
    html = must_replace(
        html,
        '<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="icon.svg">',
        '<base href="/">\n<link rel="manifest" href="/manifest.webmanifest">\n<link rel="apple-touch-icon" href="/icon.svg">',
        'asset links',
    )
    html = must_replace(
        html,
        '<script src="app.js"></script>',
        '<script src="/app.js"></script>',
        'app.js src',
    )
    html = must_replace(
        html,
        '@media (prefers-reduced-motion:reduce){.skeleton{animation:none}}\n</style>',
        '''@media (prefers-reduced-motion:reduce){.skeleton{animation:none}}
[inert]{pointer-events:none}
.carmen-agent-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
</style>''',
        'agent css',
    )
    html = must_replace(
        html,
        '<body>\n<header class="appbar">',
        '''<body>
<div id="carmenAgentStatus" class="carmen-agent-status" data-testid="carmen-status" aria-live="polite" data-status="idle" data-view="home" data-busy="false">idle · home</div>
<header class="appbar">''',
        'agent status node',
    )
    html = must_replace(
        html,
        '<button class="btn ghost" id="newInvestigationBtn" type="button">New investigation</button>',
        '<button class="btn ghost" id="newInvestigationBtn" type="button" data-testid="new-investigation">New investigation</button>',
        'new investigation testid',
    )
    html = must_replace(
        html,
        '''    <div class="searchbox stack">
      <input id="homeQuery" placeholder="A name, question, URL, photo, topic — anything public" enterkeyhint="search" autocapitalize="words">
      <button class="btn primary" id="homeSearchBtn">Search</button>
    </div>''',
        '''    <form class="searchbox stack" id="homeSearchForm" data-testid="search-form" action="#" method="get">
      <input id="homeQuery" data-testid="search-input" name="q" placeholder="A name, question, URL, photo, topic — anything public" enterkeyhint="search" autocapitalize="words" autocomplete="off">
      <button class="btn primary" id="homeSearchBtn" type="submit" data-testid="search-submit">Search</button>
    </form>''',
        'home search form',
    )
    html = must_replace(
        html,
        '<section id="searchView" class="view hidden">',
        '<section id="searchView" class="view hidden" hidden inert aria-hidden="true">',
        'searchView inert',
    )
    html = must_replace(
        html,
        '<textarea id="searchQuery" placeholder="A name, question, URL, photo, topic — anything public"></textarea>',
        '<textarea id="searchQuery" data-testid="search-input-workspace" placeholder="A name, question, URL, photo, topic — anything public"></textarea>',
        'searchQuery testid',
    )
    html = must_replace(
        html,
        '<button class="btn primary" id="discoverBtn">Search</button>\n      <button class="btn" id="deepDiveBtn" disabled>Deep Dive</button>\n      <button class="btn" id="keepBtn">Keep</button>',
        '<button class="btn primary" id="discoverBtn" data-testid="search-submit-workspace">Search</button>\n      <button class="btn" id="deepDiveBtn" data-testid="deep-dive" disabled>Deep Dive</button>\n      <button class="btn" id="keepBtn" data-testid="save">Keep</button>',
        'search view ctas',
    )
    html = must_replace(
        html,
        '<div id="results"></div>',
        '<div id="results" data-testid="results"></div>',
        'results testid',
    )
    html = must_replace(
        html,
        '<section id="diveView" class="view hidden">',
        '<section id="diveView" class="view hidden" hidden inert aria-hidden="true">',
        'diveView inert',
    )
    html = must_replace(
        html,
        '<input id="diveSearchQuery" placeholder="Search this investigation…" enterkeyhint="search">\n      <button class="btn primary" id="diveSearchBtn" type="button">Search</button>',
        '<input id="diveSearchQuery" data-testid="search-input-dive" placeholder="Search this investigation…" enterkeyhint="search" autocomplete="off">\n      <button class="btn primary" id="diveSearchBtn" type="button" data-testid="search-submit-dive">Search</button>',
        'dive search',
    )
    html = must_replace(
        html,
        '<button class="btn primary" id="diveBondageBtn" type="button">Bondage</button>\n        <button class="btn" id="divePeopleBtn" type="button">People</button>\n        <button class="btn" id="diveClothingBtn" type="button">Clothing</button>',
        '<button class="btn primary" id="diveBondageBtn" type="button" data-testid="dive-bondage">Bondage</button>\n        <button class="btn" id="divePeopleBtn" type="button" data-testid="dive-people">People</button>\n        <button class="btn" id="diveClothingBtn" type="button" data-testid="dive-clothing">Clothing</button>',
        'dive lenses',
    )
    html = must_replace(
        html,
        '<button class="btn ghost" id="diveFindMoreBtn" type="button">Find More</button>',
        '<button class="btn ghost" id="diveFindMoreBtn" type="button" data-testid="find-more">Find More</button>',
        'find more',
    )
    html = must_replace(
        html,
        '<button class="btn ghost" id="howGotHereBtn" type="button">How I got here?</button>',
        '<button class="btn ghost" id="howGotHereBtn" type="button" data-testid="how-i-got-here">How I got here?</button>',
        'how i got here',
    )
    html = must_replace(
        html,
        '<div id="howHerePanel" class="card hidden">',
        '<div id="howHerePanel" class="card hidden" data-testid="how-i-got-here-panel" hidden>',
        'how here panel',
    )
    html = must_replace(
        html,
        '<div id="howHereList"><p class="muted">Start an investigation to see the trail.</p></div>',
        '<div id="howHereList" data-testid="how-i-got-here-list"><p class="muted">Start an investigation to see the trail.</p></div>',
        'how here list',
    )
    html = must_replace(
        html,
        '<section id="collectionsView" class="view hidden">',
        '<section id="collectionsView" class="view hidden" hidden inert aria-hidden="true">',
        'collectionsView inert',
    )
    html = must_replace(
        html,
        '<section id="investigationsView" class="view hidden">',
        '<section id="investigationsView" class="view hidden" hidden inert aria-hidden="true">',
        'investigationsView inert',
    )
    html = must_replace(
        html,
        '<section id="learnView" class="view hidden">',
        '<section id="learnView" class="view hidden" hidden inert aria-hidden="true">',
        'learnView inert',
    )
    html = must_replace(
        html,
        '<div id="legacyTools" class="hidden">',
        '<div id="legacyTools" class="hidden" hidden inert aria-hidden="true">',
        'legacyTools inert',
    )
    html = must_replace(
        html,
        '<div id="toast" class="toast hidden"></div>',
        '<div id="toast" class="toast hidden" data-testid="toast" hidden inert aria-hidden="true"></div>',
        'toast',
    )
    html = must_replace(
        html,
        '<div id="lightbox" class="lightbox hidden" role="dialog" aria-modal="true">',
        '<div id="lightbox" class="lightbox hidden" role="dialog" aria-modal="true" data-testid="result-lightbox" hidden inert aria-hidden="true">',
        'lightbox',
    )
    html = must_replace(
        html,
        '<button class="btn" id="lightboxSource">Open source</button>',
        '<button class="btn" id="lightboxSource" data-testid="lightbox-source">Open source</button>',
        'lightbox source',
    )
    html = must_replace(
        html,
        '<button class="btn ghost" id="lightboxClose">Close</button>',
        '<button class="btn ghost" id="lightboxClose" data-testid="lightbox-close">Close</button>',
        'lightbox close',
    )
    html = must_replace(
        html,
        '<div id="saveSheet" class="sheet hidden">',
        '<div id="saveSheet" class="sheet hidden" data-testid="save-sheet" hidden inert aria-hidden="true">',
        'save sheet',
    )
    html = must_replace(
        html,
        '<button class="btn primary" id="saveSheetConfirm" style="flex:0 0 auto">Save</button>',
        '<button class="btn primary" id="saveSheetConfirm" style="flex:0 0 auto" data-testid="save-confirm">Save</button>',
        'save confirm',
    )
    html = must_replace(
        html,
        '<button id="navHome" class="active">',
        '<button id="navHome" class="active" data-testid="nav-home">',
        'nav home',
    )
    html = must_replace(
        html,
        '<button id="navSearch">',
        '<button id="navSearch" data-testid="nav-search">',
        'nav search',
    )
    html = must_replace(
        html,
        '<button id="navDive">',
        '<button id="navDive" data-testid="nav-dive">',
        'nav dive',
    )
    html = must_replace(
        html,
        '<button id="navCollections">',
        '<button id="navCollections" data-testid="nav-saved">',
        'nav saved',
    )
    html = must_replace(
        html,
        '<button class="btn primary" id="startDiveBtn">Deep Dive</button>',
        '<button class="btn primary" id="startDiveBtn" data-testid="deep-dive-more">Deep Dive</button>',
        'startDiveBtn distinct testid',
    )
    html = must_replace(
        html,
        '<button class="btn ghost" id="cancelDiveBtn">Back to Search</button>',
        '<button class="btn ghost" id="cancelDiveBtn" data-testid="back-to-search">Back to Search</button>',
        'back to search',
    )
    html = must_replace(
        html,
        '<button class="btn" id="lightboxSave">Save</button>',
        '<button class="btn" id="lightboxSave" data-testid="lightbox-save">Save</button>',
        'lightbox save',
    )
    html = must_replace(
        html,
        '<button class="btn" id="lightboxNotPerson">Not this person</button>',
        '<button class="btn" id="lightboxNotPerson" data-testid="identity-reject-lightbox">Not this person</button>',
        'lightbox not person',
    )
    return html


HELPERS = r'''
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
    interaction: 'real-dom',
    selectors: {
      searchInput: '[data-testid="search-input"]',
      searchSubmit: '[data-testid="search-submit"]',
      newInvestigation: '[data-testid="new-investigation"]',
      deepDive: '[data-testid="deep-dive"]',
      diveBondage: '[data-testid="dive-bondage"]',
      divePeople: '[data-testid="dive-people"]',
      diveClothing: '[data-testid="dive-clothing"]',
      findMore: '[data-testid="find-more"]',
      save: '[data-testid="save"]',
      howIGotHere: '[data-testid="how-i-got-here"]',
      results: '[data-testid="results"]',
      status: '[data-testid="carmen-status"]',
    },
    wait: 'document.documentElement[data-carmen-status] and document.documentElement[data-carmen-busy]',
    testKeyRequired: !!(env && env.CARMEN_TEST_KEY),
    access: (env && env.CARMEN_TEST_KEY)
      ? 'Open /test. If API JSON routes require it, send X-Carmen-Test-Key. The UI itself uses the same /search /dive routes as the iPhone app.'
      : 'Open /test or /browser-test on this origin — no extra authentication. No redirect, no Continue click.',
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
    capabilities: ['research', 'retrieve', 'save internal investigation state', 'analyze', 'branch', 'click', 'type', 'wait for async state', 'inspect DOM'],
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
      return '/' + rest.replace(/^\/+/, '');
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
  headers.delete('location');
  const corsHeaders = cors(req);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  if (rewrite === '/index.html') {
    let html = await res.text();
    if (/location\.replace\s*\(\s*["']\//i.test(html) || /http-equiv=["']refresh["']/i.test(html)) {
      const fallbackUrl = new URL(req.url);
      fallbackUrl.pathname = '/index.html';
      const fallback = await env.ASSETS.fetch(new Request(fallbackUrl.toString(), { method: 'GET', headers: req.headers }));
      html = await fallback.text();
    }
    if (!/name=["']carmen-browser-test["']/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, '<head$1>\n  <meta name="carmen-browser-test" content="1">');
    }
    if (!/<base\s/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, '<head$1>\n  <base href="/">');
    }
    html = html.replace(/<html([^>]*)>/i, (m, attrs) => {
      if (/data-carmen-browser-test=/i.test(attrs)) return m;
      return '<html' + attrs + ' data-carmen-browser-test="1">';
    });
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('set-cookie', 'carmen_browser_test=1; Path=/; Max-Age=86400; SameSite=Lax');
    return new Response(html, { status: 200, headers });
  }
  return new Response(res.body, { status: res.status, headers });
}

'''


def patch_worker(src: str) -> str:
    if 'async function serveBrowserTestSurface' in src and 'html_handling' not in src:
        pass
    src = must_replace(
        src,
        """// Routes: GET /health, GET /search, GET /img, POST /dive, GET|POST /retrieve, GET|POST /source,
// POST /chat, POST /analyze, POST /synthesize.
// Everything else is served from static assets (the Carmen frontend) via the ASSETS binding.
""",
        """// Routes: GET /health, GET /search, GET /img, POST /dive, GET|POST /retrieve, GET|POST /source,
// POST /chat, POST /analyze, POST /synthesize, GET /test, GET /browser-test.
// /test and /browser-test serve the SAME frontend as / via ASSETS (no parallel UI, no redirect).
// Everything else is served from static assets (the Carmen frontend) via the ASSETS binding.
""",
        'header comment',
    )
    src = must_replace(
        src,
        """    liveVsFixture: 'A live provider timeout/block is BLOCKED, never PASS. Use fixture=provider-blocked to verify Carmen reports search_failed.',
  };
}
""",
        """    liveVsFixture: 'A live provider timeout/block is BLOCKED, never PASS. Use fixture=provider-blocked to verify Carmen reports search_failed.',
    browserTest: {
      available: true,
      sameUiAsIphone: true,
      samePipelineAsIphoneUi: true,
      primary: '/test',
      routes: ['/test', '/browser-test'],
      session: '/api/v1/browser-test-session',
      access: 'Open /test or /browser-test on this origin. Loads the real Carmen PWA and the real backend with no redirect and no extra auth unless CARMEN_TEST_KEY is configured.',
      capabilities: ['open Carmen', 'enter searches', 'new investigation', 'select subject', 'deep dive', 'bondage', 'people', 'clothing', 'find more', 'inspect result cards', 'inspect images and source URLs', 'follow discovered sources', 'save/keep results', 'branch investigations', 'identity confirmation/rejection', 'how I got here', 'repeat searches', 'observe loading/error states', 'inspect returned evidence'],
      forbidden: ['send messages', 'post', 'follow accounts', 'purchase', 'submit external forms', 'any other external action'],
    },
  };
}
""",
        'apiDocsPayload end',
    )
    src = must_replace(
        src,
        """  if ((path === '/api' || path === '/api/v1' || path === '/api/v1/docs') && req.method === 'GET') {
    return json(apiDocsPayload(), 200, req);
  }
""",
        """  if ((path === '/api' || path === '/api/v1' || path === '/api/v1/docs') && req.method === 'GET') {
    const payload = apiDocsPayload();
    const ai = getAiConfig(env);
    payload.environment = describeCarmenEnvironment(env, ai);
    payload.browserTest = browserTestDescriptor(env);
    payload.testRoutes = ['/test', '/browser-test', '/api/v1/browser-test-session'];
    return json(payload, 200, req);
  }
""",
        'GET /api',
    )
    src = must_replace(
        src,
        """      secretsExposed: false,
    }, 200, req);
  }

  let body = {};
""",
        """      secretsExposed: false,
      environment: describeCarmenEnvironment(env, ai),
      browserTest: browserTestDescriptor(env),
      testRoutes: ['/test', '/browser-test', '/api/v1/browser-test-session'],
    }, 200, req);
  }

  if ((path === '/api/v1/browser-test-session' || path === '/api/browser-test-session') && (req.method === 'GET' || req.method === 'POST')) {
    return issueBrowserTestSession(req, env);
  }

  let body = {};
""",
        'API health + session',
    )
    if 'async function serveBrowserTestSurface' not in src:
        src = must_replace(
            src,
            'export default {\n  async fetch(req, env) {',
            HELPERS.rstrip() + '\n\nexport default {\n  async fetch(req, env) {',
            'export default insert',
        )
    src = must_replace(
        src,
        """        schemaVersion: 2,
        provider: ai.provider,
        model: ai.model,
        configured: ai.configured,
        routes: ['/health', '/search', '/classify', '/retrieve', '/source', '/img', '/dive', '/learn', '/chat', '/analyze', '/synthesize', '/api', '/api/v1'],
""",
        """        schemaVersion: 2,
        environment: describeCarmenEnvironment(env, ai),
        provider: ai.provider,
        model: ai.model,
        configured: ai.configured,
        browserTest: browserTestDescriptor(env),
        testRoutes: ['/test', '/browser-test', '/api/v1/browser-test-session'],
        routes: ['/health', '/search', '/classify', '/retrieve', '/source', '/img', '/dive', '/learn', '/chat', '/analyze', '/synthesize', '/api', '/api/v1', '/test', '/browser-test'],
""",
        'GET /health',
    )
    src = must_replace(
        src,
        """    if (u.pathname === '/api' || u.pathname === '/api/' || u.pathname.startsWith('/api/')) return handleCarmenApi(req, env);
    // SPA fallback: serve static assets for everything else.
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(req);
""",
        """    if (u.pathname === '/api' || u.pathname === '/api/' || u.pathname.startsWith('/api/')) return handleCarmenApi(req, env);
    // Browser-test surface: same PWA + same backend as /. No parallel UI. No redirect.
    const browserTestPage = await serveBrowserTestSurface(req, env);
    if (browserTestPage) return browserTestPage;
    // SPA fallback: serve static assets for everything else.
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(req);
""",
        'SPA fallback hook',
    )
    src = must_replace(
        src,
        "'access-control-expose-headers': 'x-carmen-version, x-carmen-build',",
        "'access-control-expose-headers': 'x-carmen-version, x-carmen-build, x-carmen-browser-test',",
        'cors expose headers',
    )
    return src


APP_HELPER = r'''
/* Browser-agent observability. Does not change retrieval, ranking, or Deep Dive. */
function carmenNewInvestigationId() {
  try { return (crypto.randomUUID && crypto.randomUUID()) || ('inv-' + Date.now().toString(36)); }
  catch { return 'inv-' + Date.now().toString(36); }
}
let liveInvestigationId = carmenNewInvestigationId();
function setAgentState(patch) {
  const root = document.documentElement;
  if (!root) return;
  const next = {
    status: root.getAttribute('data-carmen-status') || 'idle',
    view: root.getAttribute('data-carmen-view') || 'home',
    busy: root.getAttribute('data-carmen-busy') === 'true',
    results: root.getAttribute('data-carmen-results') || '0',
    error: root.getAttribute('data-carmen-error') || '',
    lens: root.getAttribute('data-carmen-lens') || '',
    saved: root.getAttribute('data-carmen-saved') || '',
    howHere: root.getAttribute('data-carmen-how-here') || 'closed',
  };
  if (patch) Object.assign(next, patch);
  if (patch && patch.investigation) liveInvestigationId = patch.investigation;
  root.setAttribute('data-carmen-status', next.status);
  root.setAttribute('data-carmen-view', next.view);
  root.setAttribute('data-carmen-busy', next.busy ? 'true' : 'false');
  root.setAttribute('data-carmen-results', String(next.results == null ? '0' : next.results));
  root.setAttribute('data-carmen-error', next.error || '');
  root.setAttribute('data-carmen-lens', next.lens || '');
  root.setAttribute('data-carmen-saved', next.saved || '');
  root.setAttribute('data-carmen-how-here', next.howHere || 'closed');
  root.setAttribute('data-carmen-investigation', liveInvestigationId);
  root.setAttribute('aria-busy', next.busy ? 'true' : 'false');
  const results = $('results');
  if (results) {
    results.setAttribute('data-testid', 'results');
    results.setAttribute('aria-busy', next.busy ? 'true' : 'false');
    results.setAttribute('data-carmen-status', next.status);
  }
  const el = $('carmenAgentStatus');
  if (el) {
    el.setAttribute('data-status', next.status);
    el.setAttribute('data-view', next.view);
    el.setAttribute('data-busy', next.busy ? 'true' : 'false');
    el.setAttribute('data-results', String(next.results == null ? '0' : next.results));
    el.setAttribute('data-error', next.error || '');
    el.setAttribute('data-lens', next.lens || '');
    el.setAttribute('data-saved', next.saved || '');
    el.setAttribute('data-how-here', next.howHere || 'closed');
    el.setAttribute('data-investigation', liveInvestigationId);
    const bits = [next.status, next.view];
    if (next.busy) bits.push('loading');
    if (next.lens) bits.push('lens:' + next.lens);
    if (next.error) bits.push('error:' + String(next.error).slice(0, 180));
    el.textContent = bits.join(' · ');
  }
  window.__carmenAgent = {
    status: next.status,
    view: next.view,
    busy: !!next.busy,
    results: Number(next.results) || 0,
    error: next.error || '',
    lens: next.lens || '',
    saved: next.saved || '',
    howHere: next.howHere || 'closed',
    investigation: liveInvestigationId,
  };
}
function syncViewAvailability(activeView) {
  for (const [, v] of TABS) {
    const node = $(v);
    if (!node) continue;
    const on = v === activeView;
    node.classList.toggle('hidden', !on);
    if (on) {
      node.removeAttribute('hidden');
      node.removeAttribute('inert');
      node.removeAttribute('aria-hidden');
    } else {
      node.setAttribute('hidden', '');
      node.setAttribute('inert', '');
      node.setAttribute('aria-hidden', 'true');
    }
  }
  ['lightbox', 'saveSheet', 'toast', 'legacyTools'].forEach(id => {
    const node = $(id);
    if (!node) return;
    const on = !node.classList.contains('hidden');
    if (on) {
      node.removeAttribute('hidden');
      node.removeAttribute('inert');
      node.removeAttribute('aria-hidden');
    } else {
      node.setAttribute('hidden', '');
      node.setAttribute('inert', '');
      node.setAttribute('aria-hidden', 'true');
    }
  });
}

'''


def patch_app(src: str) -> str:
    src = must_replace(
        src,
        "let lastClothingEvidence = [];\n",
        "let lastClothingEvidence = [];\n" + APP_HELPER,
        'insert agent helper',
    )
    src = must_replace(
        src,
        """  const view = map[name] || 'homeView';
  for (const [nav, v] of TABS) {
    $(nav)?.classList.toggle('active', v === view);
    $(v)?.classList.toggle('hidden', v !== view);
  }
  if (view === 'investigationsView') mountTools();
  if (view === 'homeView') renderHome();
  if (view === 'collectionsView') renderCollections();
  if (view === 'investigationsView') renderInvestigations();
  if (view === 'diveView') {
    renderDiveIdentity();
    renderDiveStream();
    if (lastDivePayload) renderDiveWorkspace(lastDivePayload, lastDivePayload.query || lastDivePayload.plan?.subject || '');
  }
}
""",
        """  const view = map[name] || 'homeView';
  for (const [nav, v] of TABS) {
    $(nav)?.classList.toggle('active', v === view);
  }
  syncViewAvailability(view);
  const viewName = view.replace(/View$/, '');
  setAgentState({ view: viewName === 'home' ? 'home' : viewName });
  if (view === 'investigationsView') mountTools();
  if (view === 'homeView') renderHome();
  if (view === 'collectionsView') renderCollections();
  if (view === 'investigationsView') renderInvestigations();
  if (view === 'diveView') {
    renderDiveIdentity();
    renderDiveStream();
    if (lastDivePayload) renderDiveWorkspace(lastDivePayload, lastDivePayload.query || lastDivePayload.plan?.subject || '');
  }
}
""",
        'setTab observability',
    )
    src = must_replace(
        src,
        """  $('resultsEmpty').classList.add('hidden');
  $('searchDiagnostics').textContent = expanded
""",
        """  $('resultsEmpty').classList.add('hidden');
  setAgentState({ status: 'loading', busy: true, error: '', lens: opts.diveLens || activeDiveLens || '' });
  $('searchDiagnostics').textContent = expanded
""",
        'discover loading',
    )
    src = must_replace(
        src,
        """    toast(data.noNewSources
      ? (data.noNewSourcesMessage || 'No new sources found from this angle.')
      : (data.noNewMedia
      ? 'No new media — pivoted to the next query class.'
      : (lastResults.length || lastVisuals.length || lastVideos.length
      ? (visualMode || visualMore || videoMore ? 'Corpus updated — ' + scale : (opts.progressive ? scale : (expanded ? 'Looked further — ' + scale : (data.expansion && data.expansion.genuinelyNew ? ('Learned ' + data.expansion.genuinelyNew + ' new source' + (data.expansion.genuinelyNew === 1 ? '' : 's')) : scale))))
      : 'No public results. See diagnostics.')));
""",
        """    setAgentState({
      status: 'complete',
      busy: false,
      results: lastResults.length,
      error: '',
      lens: opts.diveLens || activeDiveLens || '',
    });
    toast(data.noNewSources
      ? (data.noNewSourcesMessage || 'No new sources found from this angle.')
      : (data.noNewMedia
      ? 'No new media — pivoted to the next query class.'
      : (lastResults.length || lastVisuals.length || lastVideos.length
      ? (visualMode || visualMore || videoMore ? 'Corpus updated — ' + scale : (opts.progressive ? scale : (expanded ? 'Looked further — ' + scale : (data.expansion && data.expansion.genuinelyNew ? ('Learned ' + data.expansion.genuinelyNew + ' new source' + (data.expansion.genuinelyNew === 1 ? '' : 's')) : scale))))
      : 'No public results. See diagnostics.')));
""",
        'discover complete',
    )
    src = must_replace(
        src,
        """    $('resultsEmpty').textContent = 'Discovery failed: ' + e.message;
    $('resultsEmpty').classList.remove('hidden');
    $('searchDiagnostics').textContent = '';
    toast('Discovery failed: ' + e.message);
""",
        """    $('resultsEmpty').textContent = 'Discovery failed: ' + e.message;
    $('resultsEmpty').classList.remove('hidden');
    $('searchDiagnostics').textContent = '';
    setAgentState({ status: 'error', busy: false, error: e.message || String(e), results: lastResults.length });
    toast('Discovery failed: ' + e.message);
""",
        'discover error',
    )
    src = must_replace(
        src,
        """      if ($('diveSearchBtn')) $('diveSearchBtn').disabled = false;
      updateDeepDiveState();
    }
  }
}
function renderExpandedCard(data) {
""",
        """      if ($('diveSearchBtn')) $('diveSearchBtn').disabled = false;
      updateDeepDiveState();
      const root = document.documentElement;
      if (root && root.getAttribute('data-carmen-status') === 'loading') {
        setAgentState({ status: lastResults.length ? 'complete' : 'idle', busy: false, results: lastResults.length });
      } else {
        setAgentState({ busy: false, results: lastResults.length });
      }
    }
  }
}
function renderExpandedCard(data) {
""",
        'discover finally busy',
    )
    src = must_replace(
        src,
        """    return `<article class="person-tile${selected ? ' selected' : ''}" data-identify="${idx}" data-i="${idx}">
      ${hero ? `<img class="hero" data-identify="${idx}" src="${esc(imgSrc(hero))}" alt="${esc(subjectName)}" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ''}
      <div class="rbody">
        <p class="pname">${esc(subjectName)}</p>
        <div class="subtle">${esc(r.domain || hostOf(r.url))}</div>
        ${r.reason ? `<div class="rwhy">${esc(r.reason)}</div>` : ''}
        <p class="hint" style="margin:8px 0 0">A picture is not proof of identity.</p>
        <div class="racts">
          <button data-ract="select" data-i="${idx}">${selected ? 'That’s the one' : 'That’s the one'}</button>
          <button data-ract="dive" data-i="${idx}">Deep Dive</button>
          <button data-ract="notperson" data-i="${idx}">Not this one</button>
        </div>
      </div>
    </article>`;
""",
        """    return `<article class="person-tile${selected ? ' selected' : ''}" data-testid="person-tile" data-identify="${idx}" data-i="${idx}" data-source-url="${esc(r.url || '')}">
      ${hero ? `<img class="hero" data-testid="result-image" data-identify="${idx}" src="${esc(imgSrc(hero))}" alt="${esc(subjectName)}" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ''}
      <div class="rbody">
        <p class="pname">${esc(subjectName)}</p>
        <div class="subtle">${esc(r.domain || hostOf(r.url))}</div>
        ${r.reason ? `<div class="rwhy">${esc(r.reason)}</div>` : ''}
        <p class="hint" style="margin:8px 0 0">A picture is not proof of identity.</p>
        <div class="racts">
          <button data-ract="select" data-testid="identity-confirm" data-i="${idx}">${selected ? 'That’s the one' : 'That’s the one'}</button>
          <button data-ract="dive" data-testid="result-deep-dive" data-i="${idx}">Deep Dive</button>
          <button data-ract="notperson" data-testid="identity-reject" data-i="${idx}">Not this one</button>
        </div>
      </div>
    </article>`;
""",
        'person tile testids',
    )
    src = must_replace(
        src,
        """  return `<div class="result${selected ? ' selected' : ''}${personCard ? ' person' : ''}${r.intersection ? ' direct' : ''}" data-i="${i}"${personCard ? ` data-identify="${i}"` : ''}>
      ${hero ? `<img class="hero"${personCard ? ` data-identify="${i}"` : ''} data-full="${esc(imgSrc(hero))}" data-cap="${esc((r.domain || '') + ' · ' + (r.url || ''))}" src="${esc(imgSrc(hero))}" alt="${esc(displayName)}" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ''}
""",
        """  return `<div class="result${selected ? ' selected' : ''}${personCard ? ' person' : ''}${r.intersection ? ' direct' : ''}" data-testid="result-card" data-source-url="${esc(r.url || '')}" data-i="${i}"${personCard ? ` data-identify="${i}"` : ''}>
      ${hero ? `<img class="hero" data-testid="result-image"${personCard ? ` data-identify="${i}"` : ''} data-full="${esc(imgSrc(hero))}" data-cap="${esc((r.domain || '') + ' · ' + (r.url || ''))}" src="${esc(imgSrc(hero))}" alt="${esc(displayName)}" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ''}
""",
        'result card attrs',
    )
    src = must_replace(
        src,
        """        <div class="racts">
          <button data-ract="select" data-i="${i}">${selected ? (personCard ? 'That’s the one' : 'Selected') : (personCard ? 'That’s the one' : 'Select')}</button>
          <button data-ract="dive" data-i="${i}">Deep Dive</button>
          <button data-ract="save" data-i="${i}">Save</button>
          <button data-ract="open" data-i="${i}">Open source</button>
          ${personCard ? `<button data-ract="notperson" data-i="${i}">Not this person</button>` : ''}
        </div>
""",
        """        <div class="racts">
          <button data-ract="select" data-testid="${personCard ? 'identity-confirm' : 'result-select'}" data-i="${i}">${selected ? (personCard ? 'That’s the one' : 'Selected') : (personCard ? 'That’s the one' : 'Select')}</button>
          <button data-ract="dive" data-testid="result-deep-dive" data-i="${i}">Deep Dive</button>
          <button data-ract="save" data-testid="result-save" data-i="${i}">Save</button>
          <button data-ract="open" data-testid="result-open" data-source-url="${esc(r.url || '')}" data-i="${i}">Open source</button>
          ${personCard ? `<button data-ract="notperson" data-testid="identity-reject" data-i="${i}">Not this person</button>` : ''}
        </div>
""",
        'result card actions',
    )
    src = must_replace(
        src,
        """  persistSession();
  if (!opts.silent) toast('New investigation. Saved collections stay. Live search state is cleared.');
  if (!opts.stay) setTab('home');
}
""",
        """  persistSession();
  setAgentState({
    status: 'idle',
    busy: false,
    results: 0,
    error: '',
    lens: '',
    saved: '',
    howHere: 'closed',
    investigation: carmenNewInvestigationId(),
  });
  if (!opts.silent) toast('New investigation. Saved collections stay. Live search state is cleared.');
  if (!opts.stay) setTab('home');
}
""",
        'new investigation state',
    )
    src = must_replace(
        src,
        """  setTab('dive');
  await discover({
    keepSubject: true,
    entity,
    topic,
    append: true,
    diveLens: id,
    mode: 'dive-' + id,
    findMore: false,
  });
}
""",
        """  setTab('dive');
  setAgentState({ view: 'dive', lens: id, status: 'loading', busy: true });
  await discover({
    keepSubject: true,
    entity,
    topic,
    append: true,
    diveLens: id,
    mode: 'dive-' + id,
    findMore: false,
  });
}
""",
        'runDiveLens state',
    )
    src = must_replace(
        src,
        """    panel.classList.toggle('hidden', !open);
    if (open) renderHowHere();
""",
        """    panel.classList.toggle('hidden', !open);
    if (open) {
      panel.removeAttribute('hidden');
      renderHowHere();
    } else {
      panel.setAttribute('hidden', '');
    }
    setAgentState({ howHere: open ? 'open' : 'closed' });
""",
        'how here toggle',
    )
    src = must_replace(
        src,
        """  $('keepBtn').onclick = async () => {
    const p = await keepInvestigation();
    toast(p ? 'Investigation kept on this phone.' : 'Nothing to keep yet.');
    await refresh();
  };
""",
        """  $('keepBtn').onclick = async () => {
    const p = await keepInvestigation();
    setAgentState({ saved: p ? (p.id || 'kept') : '' });
    toast(p ? 'Investigation kept on this phone.' : 'Nothing to keep yet.');
    await refresh();
  };
""",
        'keep saved state',
    )
    src = must_replace(
        src,
        """  $('homeSearchBtn').onclick = () => {
    const q = $('homeQuery').value.trim();
    hardNewInvestigation({ silent: true, stay: true });
    if ($('searchQuery')) $('searchQuery').value = q;
    if ($('homeQuery')) $('homeQuery').value = q;
    setTab('search');
    if (q) discover();
  };
""",
        """  if ($('homeSearchForm')) $('homeSearchForm').onsubmit = e => { e.preventDefault(); $('homeSearchBtn').click(); };
  $('homeSearchBtn').onclick = () => {
    const q = $('homeQuery').value.trim();
    hardNewInvestigation({ silent: true, stay: true });
    if ($('searchQuery')) $('searchQuery').value = q;
    if ($('homeQuery')) $('homeQuery').value = q;
    setTab('search');
    if (q) discover();
  };
""",
        'home form submit',
    )
    src = must_replace(
        src,
        "  box.classList.remove('hidden');\n}\nfunction showLightboxSlide() {",
        "  box.classList.remove('hidden');\n  box.removeAttribute('hidden');\n  box.removeAttribute('inert');\n  box.removeAttribute('aria-hidden');\n}\nfunction showLightboxSlide() {",
        'open lightbox attrs',
    )
    src = must_replace(
        src,
        """  box.classList.add('hidden');
  $('lightboxImg').src = '';
  lightboxGallery = [];
}
""",
        """  box.classList.add('hidden');
  box.setAttribute('hidden', '');
  box.setAttribute('inert', '');
  box.setAttribute('aria-hidden', 'true');
  $('lightboxImg').src = '';
  lightboxGallery = [];
}
""",
        'close lightbox attrs',
    )
    src = src.replace(
        "$('saveSheet').classList.remove('hidden');",
        "$('saveSheet').classList.remove('hidden'); $('saveSheet').removeAttribute('hidden'); $('saveSheet').removeAttribute('inert'); $('saveSheet').removeAttribute('aria-hidden');",
    )
    # saveSheet add hidden appears twice; replace_all for close path is risky.
    # Only the cancel/close uses classList.add('hidden') on saveSheet.
    src = src.replace(
        "$('saveSheet').classList.add('hidden');",
        "$('saveSheet').classList.add('hidden'); if ($('saveSheet')) { $('saveSheet').setAttribute('hidden',''); $('saveSheet').setAttribute('inert',''); $('saveSheet').setAttribute('aria-hidden','true'); }",
    )
    if 'setAgentState({ status: \'idle\'' not in src and 'function wire()' in src:
        src = must_replace(
            src,
            'function wire() {\n  $(\'navHome\').onclick = () => setTab(\'home\');',
            'function wire() {\n  setAgentState({ status: \'idle\', view: \'home\', busy: false, investigation: liveInvestigationId });\n  $(\'navHome\').onclick = () => setTab(\'home\');',
            'wire init state',
        )
    return src


def patch_test_server(src: str) -> str:
    src = must_replace(
        src,
        """      try {
        const body = await readFile(full);
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jsonc': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8' };
        return new Response(body, { status: 200, headers: { 'content-type': types[extname(full)] || 'application/octet-stream' } });
      } catch { return new Response('Not found', { status: 404 }); }
""",
        """      try {
        const body = await readFile(full);
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jsonc': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8' };
        return new Response(body, { status: 200, headers: { 'content-type': types[extname(full)] || 'application/octet-stream' } });
      } catch {
        const wantsHtml = !extname(path) || path.endsWith('/') || path.endsWith('.html');
        if (wantsHtml) {
          const body = await readFile(resolve(DIR, 'index.html'));
          return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
        }
        return new Response('Not found', { status: 404 });
      }
""",
        'test-server spa fallback',
    )
    return src


def main():
    html_path = ROOT / 'public' / 'index.html'
    html = html_path.read_text()
    if 'data-testid="carmen-app"' in html:
        print('html already has agent testids')
    else:
        html = patch_html(html)
        html_path.write_text(html)
        (ROOT / 'index.html').write_text(html)

    worker_path = ROOT / 'worker.js'
    worker = worker_path.read_text()
    if 'async function serveBrowserTestSurface' in worker and 'data-carmen-browser-test' in worker:
        print('worker already has interactable browser-test surface')
    else:
        worker_path.write_text(patch_worker(worker))

    app_path = ROOT / 'app.js'
    app = app_path.read_text()
    if 'function setAgentState(' in app:
        print('app.js already has agent state')
    else:
        app = patch_app(app)
        app_path.write_text(app)
        (ROOT / 'public' / 'app.js').write_text(app)
    if 'function setAgentState(' in app_path.read_text():
        (ROOT / 'public' / 'app.js').write_text(app_path.read_text())

    wrangler = ROOT / 'wrangler.jsonc'
    w = wrangler.read_text()
    if '"html_handling": "none"' not in w:
        w = must_replace(
            w,
            '"html_handling": "auto-trailing-slash"',
            '"html_handling": "none"',
            'html_handling',
        )
        wrangler.write_text(w)

    ts = ROOT / 'test-server.js'
    tsrc = ts.read_text()
    if 'wantsHtml' not in tsrc:
        ts.write_text(patch_test_server(tsrc))

    sw = ROOT / 'sw.js'
    swsrc = sw.read_text()
    if 'carmen-v49.4-browser-interact' not in swsrc:
        swsrc = swsrc.replace(
            "const CACHE = 'carmen-v49.4-deep-dive-lenses';",
            "const CACHE = 'carmen-v49.4-browser-interact';",
        )
        sw.write_text(swsrc)
        (ROOT / 'public' / 'sw.js').write_text(swsrc)

    for stub in [ROOT / 'public' / 'test' / 'index.html', ROOT / 'public' / 'browser-test' / 'index.html']:
        if stub.exists():
            stub.unlink()
            print('removed stub', stub)

    # Keep empty dirs out of assets
    for d in [ROOT / 'public' / 'test', ROOT / 'public' / 'browser-test']:
        if d.exists() and not any(d.iterdir()):
            d.rmdir()
            print('removed dir', d)

    print('browser-interact patches applied')


if __name__ == '__main__':
    main()
