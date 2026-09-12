# Carmen

Carmen is an iPhone-first personal investigation and research workspace for adult
users. It lets you investigate people, topics, websites, claims, products/
entities, and positions/instructions using public information and AI-assisted
analysis.

This is the single canonical Carmen application. There are no separate V25/V32/
V33/V34/V35 builds — those accumulated during earlier development and have been
consolidated into this one project.


## Investigation workspace (v43)

v43 hardens v42 discovery so entity + context is a research graph, not a keyword dump:

- **Discovery lanes** run independently (identity, exact intersection, related terminology, interviews, productions, specialist sources, media) and are reconciled afterward.
- **Intersection ranking** prefers sources that support entity ∩ context. A name-only biography is not a contextual hit.
- **Relationship following** (Deep / Deep Dive ALL) extracts titles, aliases, and productions observed on retrieved pages and searches those as leads.
- **Research depth** — Broad / Contextual / Deep. Contextual is the default when a context is active. Deep follows the graph; it is not more explicit generated content.
- Adult Content remains a research filter, not an entity type. Expanded Research remains restricted-source escalation, not a bypass.

## Investigation workspace (v42)

v42 hardens the live v41 workspace. It does not replace the v38 engine, v39 shell, v40 Deep Dive planner, or v41 Expanded Research / access states.

- **Adult Content research filter** — investigation-level OFF / ON / BOTH. It is a research context, not an entity type. The setting persists through search, ranking, images, videos, Deep Dive, and branches.
- When Adult Content is **ON**, Carmen keeps adult-industry public context through query planning, retrieval, ranking, and media. It does not silently fall back to generic biography, and it does not blindly append the word “adult” to every query.
- **BOTH** retrieves general and adult-context material and keeps the two lanes distinguishable.
- **ENTITY → CONTEXT → QUESTION** — a person + requested context (interview, clothing, bondage, etc.) is a different research problem from identity-only search. The same architecture applies to products, vehicles, techniques, and skills.
- **Default research already works hard** — multiple providers, useful variants, contextual image/video indexes, continue-when-blocked. Expanded Research is *not* “finally start researching.”
- **Expanded Research** = restricted/incomplete-source escalation: legitimate public alternatives, not a bypass and not a retry of the same wall.
- **Honest access boundary** — Carmen does not bypass paywalls, logins, age gates, CAPTCHAs, DRM, or private APIs. Inaccessible sources are labeled. Public alternatives are labeled as alternatives.

## Investigation workspace (v41)

v41 hardens the v40 workspace and v38 engine without replacing them:

- **Expanded Research** — an explicit “try harder across the public web” mode. Broader variants, image/video indexes, public alternatives. One blocked website is not the end of the investigation.
- **Access states** — every source is labeled DIRECTLY RETRIEVED, PUBLIC ALTERNATIVE, PARTIALLY RETRIEVED, REFERENCED BUT INACCESSIBLE, PAYWALLED, AUTHENTICATION REQUIRED, AGE/ACCESS RESTRICTION, BLOCKED/UNAVAILABLE, or COULD NOT VERIFY. Paywalled content is never treated as retrieved evidence.
- **Honest access boundary** — Carmen does not log in, bypass paywalls, defeat CAPTCHAs, or scrape private APIs. If the only remaining source is protected, it says so.
- **Aggressive public image pipeline** for people (official pages, features, image indexes, video thumbnails, gallery links) with provenance. Visual likeness is not identity proof.
- **Contextual visual research** — a person + context query (interview, clothing, event, technique) is planned as a relation, not a concatenated keyword dump.
- Deep Dive planner, ALL=ALL, workspace, videos, branching, and v38 ranking are preserved.

v40 is a product-architecture correction of the v39 shell around the v38 engine:

- Deep Dive asks **what to investigate** first: ALL, multi-select research paths, or a custom question. Selections change retrieval and synthesis.
- Deep Dive is a workspace (findings, images, videos, sources, leads, related) rather than a single dump.
- Videos are playable when a public embed exists; otherwise thumbnail + Open source.
- Related-entity branching keeps the original investigation.
- Search stays ephemeral until Keep or Deep Dive. Collections stay explicit-only.

v38 engine (search, ranking, retrieve, image proxy, OBSERVED/INFERRED/UNKNOWN) is preserved.
- Search providers (v38): DuckDuckGo, Bing, Reddit, Wikipedia, Startpage fallback. Google/Mojeek/Yahoo remain implemented but are not on the default path (Cloudflare subrequest budget).
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
  position), and Carmen classifies the query, searches public sources (DuckDuckGo,
  Bing, Reddit, Wikipedia, Startpage fallback), and ranks reviewable candidates
  with images, provenance, match reasons, and confidence.
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
| `worker.js` | Cloudflare Worker backend: `/health`, `/search`, `/retrieve`, `/source`, `/img`, `/dive`, `/learn`, `/chat`, `/analyze`, `/synthesize` + static asset serving via the `ASSETS` binding. |
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
npx wrangler secret put Api_key
```
(`API_KEY` is also accepted as a compatibility alias.) Carmen uses OpenRouter's
free router by default:

- endpoint: `https://openrouter.ai/api/v1/chat/completions`
- model: `openrouter/free`

Until the runtime secret is set, `/chat`, `/analyze`, and `/synthesize` return a
clear "AI provider is not configured" error. `/health` and `/search` work without
it. `/health` reports `provider`, `model`, and `configured` without exposing the
secret.

## Local testing

```bash
node test-server.js   # serves worker routes + static files on http://localhost:8787
```
