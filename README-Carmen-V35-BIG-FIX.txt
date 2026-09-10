CARMEN V35 — BIG BACKEND FIX

This is an ADD-ON package. It does not overwrite Carmen's existing files.

Files:
- Carmen-V35-worker.js — consolidated backend
- wrangler-V35.jsonc — V35 deployment configuration

WHAT THIS FIXES
- Search no longer depends on one brittle DDG HTML pattern.
- Four independent public-web providers are queried concurrently: DuckDuckGo, Bing, Yahoo, Reddit.
- Provider failures are reported in /search diagnostics instead of being silently swallowed.
- One provider failing cannot prevent other providers from returning results.
- Search URLs are normalized/deduplicated.
- /health explicitly reports Worker identity, AI configuration, assets binding, and search providers.
- AI requests have timeouts and clearer errors.
- AI JSON parsing tolerates fenced JSON and surrounding text.
- Existing Carmen safety rule remains: no autonomous contacting, posting, commenting, purchases, form submission, or other external actions.
- Existing frontend/UI is not redesigned by this package.

IMPORTANT ACTIVATION NOTE
Adding a second Worker file to GitHub does not automatically make Cloudflare execute it.
The active Worker entry point must be changed to Carmen-V35-worker.js (or the V35 config must be used).
This package intentionally keeps the existing files untouched because you asked for an additive fix.

DO NOT delete the existing V34 files. Keep them as rollback copies.
