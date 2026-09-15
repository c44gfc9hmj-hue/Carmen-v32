#!/usr/bin/env python3
"""Route-only patch: expose /test + /browser-test as the real Carmen PWA.
Does not change retrieval, ranking, Deep Dive, or the iPhone UI.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
worker = ROOT / "worker.js"
src = worker.read_text()
if "serveBrowserTestSurface" in src:
    print("browser-test surface already applied")
    sys.exit(0)

helper = (Path(__file__).with_name("browser-test-helpers.js")).read_text()
if "function serveBrowserTestSurface" not in helper:
    raise SystemExit("patches/browser-test-helpers.js is missing serveBrowserTestSurface")


def must_replace(text, old, new, label):
    if old not in text:
        raise SystemExit("patch failed: %s not found" % label)
    return text.replace(old, new, 1)

src = must_replace(
    src,
    "// Routes: GET /health, GET /search, GET /img, POST /dive, GET|POST /retrieve, GET|POST /source,\n// POST /chat, POST /analyze, POST /synthesize.\n// Everything else is served from static assets (the Carmen frontend) via the ASSETS binding.\n",
    "// Routes: GET /health, GET /search, GET /img, POST /dive, GET|POST /retrieve, GET|POST /source,\n// POST /chat, POST /analyze, POST /synthesize, GET /test, GET /browser-test.\n// /test and /browser-test serve the SAME frontend as / via ASSETS (no parallel UI).\n// Everything else is served from static assets (the Carmen frontend) via the ASSETS binding.\n",
    "header comment",
)
src = must_replace(
    src,
    "    liveVsFixture: 'A live provider timeout/block is BLOCKED, never PASS. Use fixture=provider-blocked to verify Carmen reports search_failed.',\n  };\n}\n",
    "    liveVsFixture: 'A live provider timeout/block is BLOCKED, never PASS. Use fixture=provider-blocked to verify Carmen reports search_failed.',\n    browserTest: {\n      available: true,\n      sameUiAsIphone: true,\n      samePipelineAsIphoneUi: true,\n      primary: '/test',\n      routes: ['/test', '/browser-test'],\n      session: '/api/v1/browser-test-session',\n      access: 'Open /test or /browser-test on this origin. Loads the real Carmen PWA and the real backend. No extra auth unless CARMEN_TEST_KEY is configured.',\n      capabilities: ['open Carmen', 'enter searches', 'new investigation', 'select subject', 'deep dive', 'bondage', 'people', 'clothing', 'find more', 'inspect result cards', 'inspect images and source URLs', 'follow discovered sources', 'save/keep results', 'branch investigations', 'identity confirmation/rejection', 'how I got here', 'repeat searches', 'observe loading/error states', 'inspect returned evidence'],\n      forbidden: ['send messages', 'post', 'follow accounts', 'purchase', 'submit external forms', 'any other external action'],\n    },\n  };\n}\n",
    "apiDocsPayload end",
)
src = must_replace(
    src,
    "  if ((path === '/api' || path === '/api/v1' || path === '/api/v1/docs') && req.method === 'GET') {\n    return json(apiDocsPayload(), 200, req);\n  }\n",
    "  if ((path === '/api' || path === '/api/v1' || path === '/api/v1/docs') && req.method === 'GET') {\n    const payload = apiDocsPayload();\n    const ai = getAiConfig(env);\n    payload.environment = describeCarmenEnvironment(env, ai);\n    payload.browserTest = browserTestDescriptor(env);\n    payload.testRoutes = ['/test', '/browser-test', '/api/v1/browser-test-session'];\n    return json(payload, 200, req);\n  }\n",
    "GET /api",
)
src = must_replace(
    src,
    "      secretsExposed: false,\n    }, 200, req);\n  }\n\n  let body = {};\n",
    "      secretsExposed: false,\n      environment: describeCarmenEnvironment(env, ai),\n      browserTest: browserTestDescriptor(env),\n      testRoutes: ['/test', '/browser-test', '/api/v1/browser-test-session'],\n    }, 200, req);\n  }\n\n  if ((path === '/api/v1/browser-test-session' || path === '/api/browser-test-session') && (req.method === 'GET' || req.method === 'POST')) {\n    return issueBrowserTestSession(req, env);\n  }\n\n  let body = {};\n",
    "API health + session",
)
src = must_replace(
    src,
    "export default {\n  async fetch(req, env) {",
    helper.rstrip() + "\n\nexport default {\n  async fetch(req, env) {",
    "export default insert",
)
src = must_replace(
    src,
    "        schemaVersion: 2,\n        provider: ai.provider,\n        model: ai.model,\n        configured: ai.configured,\n        routes: ['/health', '/search', '/classify', '/retrieve', '/source', '/img', '/dive', '/learn', '/chat', '/analyze', '/synthesize', '/api', '/api/v1'],\n",
    "        schemaVersion: 2,\n        environment: describeCarmenEnvironment(env, ai),\n        provider: ai.provider,\n        model: ai.model,\n        configured: ai.configured,\n        browserTest: browserTestDescriptor(env),\n        testRoutes: ['/test', '/browser-test', '/api/v1/browser-test-session'],\n        routes: ['/health', '/search', '/classify', '/retrieve', '/source', '/img', '/dive', '/learn', '/chat', '/analyze', '/synthesize', '/api', '/api/v1', '/test', '/browser-test'],\n",
    "GET /health",
)
src = must_replace(
    src,
    "    if (u.pathname === '/api' || u.pathname === '/api/' || u.pathname.startsWith('/api/')) return handleCarmenApi(req, env);\n    // SPA fallback: serve static assets for everything else.\n    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(req);\n",
    "    if (u.pathname === '/api' || u.pathname === '/api/' || u.pathname.startsWith('/api/')) return handleCarmenApi(req, env);\n    // Browser-test surface: same PWA + same backend as /. No parallel UI.\n    const browserTestPage = await serveBrowserTestSurface(req, env);\n    if (browserTestPage) return browserTestPage;\n    // SPA fallback: serve static assets for everything else.\n    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(req);\n",
    "SPA fallback hook",
)

worker.write_text(src)
print("applied browser-test surface to worker.js")
