# Carmen machine-readable API (v49.4)


ChatGPT and other assistants can drive Carmen through these routes. They exercise
the **same** `runDiscovery` / retrieve / analyze / learn pipeline as the iPhone UI.
There is no fake test implementation.

Base URL: the Carmen origin (same host as the app).

## Safety

- Secrets and API keys are never returned.
- Carmen never messages, posts, comments, follows, purchases, or submits forms.
- Investigation IDs are unguessable. Do not publish private investigation JSON.
- If `CARMEN_TEST_KEY` is configured, send `X-Carmen-Test-Key`.
- CORS: localhost, `*.workers.dev`, grok.app, chatgpt.com, and no-Origin (server-to-server).

## Quick start

```
GET  /health
GET  /api
POST /api/v1/investigations
POST /api/v1/investigations/:id/search
```

Example:

```http
POST /api/v1/search
Content-Type: application/json

{
  "query": "Drea Morgan bondage",
  "subject": "Drea Morgan",
  "topic": "bondage",
  "type": "person",
  "adult": "on"
}
```

Pass `investigationState` from the previous response (or `investigationId`) so
identity confirmation, rejections, and the trail persist.

## Actions

| Action | Method | Path |
|---|---|---|
| health | GET | `/api/v1/health` |
| docs | GET | `/api` |
| new investigation | POST | `/api/v1/investigations` |
| search | POST | `/api/v1/investigations/:id/search` |
| identify | POST | `/api/v1/investigations/:id/identify` |
| topic search | POST | `/api/v1/investigations/:id/topic` |
| intersection | POST | `/api/v1/investigations/:id/intersection` |
| find everything | POST | `/api/v1/investigations/:id/find-everything` |
| premium accounts | POST | `/api/v1/investigations/:id/premium-accounts` |
| find more | POST | `/api/v1/investigations/:id/find-more` |
| dive bondage | POST | `/api/v1/investigations/:id/dive-bondage` |
| dive people | POST | `/api/v1/investigations/:id/dive-people` |
| dive clothing | POST | `/api/v1/investigations/:id/dive-clothing` |
| more like this | POST | `/api/v1/investigations/:id/more-like-this` |

| find different | POST | `/api/v1/investigations/:id/find-different` |
| find similar | POST | `/api/v1/investigations/:id/find-similar` |
| search this visual | POST | `/api/v1/investigations/:id/search-this-visual` |
| confirm identity | POST | `/api/v1/investigations/:id/confirm-identity` |
| reject identity | POST | `/api/v1/investigations/:id/reject-identity` |
| reject image | POST | `/api/v1/investigations/:id/reject-image` |
| retrieve / source | POST | `/api/v1/investigations/:id/retrieve` |
| analyze | POST | `/api/v1/investigations/:id/analyze` |
| learn | POST | `/api/v1/investigations/:id/learn` |
| trail | GET | `/api/v1/investigations/:id/trail` |
| branch | POST | `/api/v1/investigations/:id/branch` |

You can also `POST /api/v1` with `{ "action": "search", ... }`.

The existing `GET /search` query-string interface still works and is what the
iPhone UI uses.

## Diagnostic / fixture mode

If a live provider times out or blocks:

- Carmen reports `corpusDiagnosis.status = search_failed` (or `source_inaccessible`)
- That is **BLOCKED**, not a Carmen PASS

Deterministic fixtures (same ranking/evidence path, no live providers):

```
fixture=provider-blocked
fixture=drea-intersection
fixture=premium-accounts
fixture=site-blocked
fixture=ashley-anderson
```

Pass `"fixture": "provider-blocked"` in the JSON body or `?fixture=provider-blocked`.

## Result fields

Each item includes: investigationId, subject, topic, intent, sourceClass,
sourceUrl, canonicalUrl, title, publisher, host, creator, originalSource,
reposter, mirror, imageUrl, identityEvidence, topicEvidence, confidence,
observationState (OBSERVED / SUPPORTED / INFERRED / UNKNOWN), foundThrough,
parent, relatedTo, retrievalRun, timestamps, deduplicationStatus,
rejectionReason, candidateIdentity, provider, latency, failureReason,
isEvidenceItem vs isDiscoveryLead, ownershipClass, accessState.

Ownership classes: CONFIRMED CREATOR-OWNED, LIKELY CREATOR-OWNED,
DIRECTORY CLAIM, FAN/REPOSTER, MIRROR, UNVERIFIED, UNKNOWN.

A directory mention is never a confirmed account.

## Browser-test surface (same UI as iPhone)

Remote browser agents (ChatGPT, etc.) can drive the **real** Carmen PWA — not a
mock — at:

- `/test` (stable primary)
- `/browser-test` (alias)

Those paths load the same `public/index.html` / `app.js` and the same Worker
routes (`/search`, `/dive`, `/retrieve`, `/api/v1/...`) as `/`. There is no
parallel test implementation, no redirect stub, no Continue click, and no
change to retrieval, ranking, or Deep Dive.

The page is the real DOM. Agents can click, type, submit, wait, and inspect:

- `[data-testid="search-input"]` / `[data-testid="search-submit"]`
- `[data-testid="deep-dive"]`, `[data-testid="dive-bondage"]`, `[data-testid="dive-people"]`, `[data-testid="dive-clothing"]`, `[data-testid="find-more"]`
- `[data-testid="save"]`, `[data-testid="new-investigation"]`, `[data-testid="how-i-got-here"]`
- `[data-testid="result-card"]` with `data-source-url`
- Wait on `document.documentElement[data-carmen-status]` (`idle|loading|complete|error`) and `[data-carmen-busy]`

Access: open `https://carmen-iphone-v25.94bwfd5grv.workers.dev/test`. No extra
authentication unless `CARMEN_TEST_KEY` is configured (then send
`X-Carmen-Test-Key` on `/api` JSON routes). Optional session:
`GET /api/v1/browser-test-session`.

`GET /health` and `GET /api` advertise `browserTest` and `testRoutes`.
