# Carmen

Carmen is an iPhone-first personal investigation and research workspace for adult
users. It lets you investigate people, topics, websites, claims, products/
entities, and positions/instructions using public information and AI-assisted
analysis.

This is the single canonical Carmen application. There are no separate V25/V32/
V33/V34/V35 builds — those accumulated during earlier development and have been
consolidated into this one project.


## Phase 2 (v37) additions

- `/retrieve` and `/source` — real public source retrieval with metadata, text excerpt, images, fingerprints, and explicit `RETRIEVED` / `RETRIEVAL_FAILED` status.
- Provenance states on evidence: DISCOVERED, RETRIEVED, RETRIEVAL_FAILED (OBSERVED / INFERRED / UNKNOWN remain in AI analysis).
- First-class **Instructions** field on every investigation (research direction only; never external actions).
- Visible save state + last-updated timestamp; multi-discovery history with unique IDs.
- Chronological investigation timeline driven by durable events.
- Intentional CORS allowlist; private-network retrieval blocked.
- Deep Dive prefers retrieved source excerpts over search snippets and includes user instructions when present.
- Clearer AI-unavailable messaging when `API_KEY` is not configured (search/evidence still work).

## What it does

- **Discovery hub** — enter a subject (person / topic / website / claim / product /
  position), and Carmen searches public sources (DuckDuckGo, Bing, Google, Mojeek,
  Startpage, Yahoo, Reddit), surfacing 10–20 reviewable results with URL, title,
  source, snippet, timestamp, and image where available.
- **Deep dive** — Carmen reviews the subject and discovery context and separates
  OBSERVED, INFERRED, and UNKNOWN findings.
- **Capture** — screenshot or screen-capture evidence, then run vision analysis.
- **Evidence** — archive, source ledger, pattern board, compare/synthesize,
  backup/restore.
- **Leads** — reviewable follow-ups generated from synthesis and discovery.
- **Save & resume** — investigations are stored locally (IndexedDB) and can be
  resumed at any point. Discovery state is saved per investigation.

Carmen is a research/analysis tool only. It never contacts people, sends messages,
posts, comments, submits forms, makes purchases, creates accounts, performs
transactions, or takes any external action on a user's behalf.

## Files

Frontend assets live in `public/` and are served by Cloudflare Workers Static
Assets via the `ASSETS` binding. The Worker entry point, config, and dev tools
stay at the project root and are never served as static assets.

| File | Purpose |
|------|---------|
| `worker.js` | Cloudflare Worker backend: `/health`, `/search`, `/chat`, `/analyze`, `/synthesize` + static asset serving via the `ASSETS` binding. |
| `wrangler.jsonc` | Cloudflare deployment config (`assets.directory: public`). |
| `public/index.html` | Single-page frontend (inline styles). |
| `public/app.js` | Frontend logic (IndexedDB, discovery, capture, analysis, synthesis). |
| `public/sw.js` | Service worker (app-shell cache, network-first, never caches API routes). |
| `public/manifest.webmanifest` | PWA manifest. |
| `public/icon.svg` | App icon. |
| `test-server.js` | Local Node dev server (reuses `worker.js` logic). |

## Deploy to Cloudflare Workers

```bash
npx wrangler deploy
```

Required config (already in `wrangler.jsonc`):
- `main: worker.js`
- `assets.directory: "public"` with `binding: ASSETS`
- `run_worker_first`: the five API routes

Required secret (not in code):
```bash
npx wrangler secret put API_KEY
```
Optional: set `MODEL` and `API_URL` to use a non-default OpenAI-compatible model.

Until `API_KEY` is set, `/chat`, `/analyze`, and `/synthesize` return a clear
"AI provider is not configured" error. `/health` and `/search` work without it.

## Local testing

```bash
node test-server.js   # serves worker routes + static files on http://localhost:8787
```
