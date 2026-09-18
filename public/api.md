# Carmen machine-readable API (v50)

ChatGPT and other authorized assistants can drive Carmen through a **secure,
read-only** HTTP API. The routes execute the same `runDiscovery` / retrieve /
analyze / investigation-state pipeline as the iPhone PWA. There is no mock and
no browser-test simulation.

Production origin:

`https://carmen-iphone-v25.94bwfd5grv.workers.dev`

OpenAPI: `GET /api/v1/openapi.json`

ChatGPT connection procedure: [CHATGPT.md](CHATGPT.md)

v50 additions: `personCandidates` (id, displayName, sourceUrl, sourceTitle, thumbnailUrl, confidence, whySelected), `requestId`, `timings`, `visualPipeline` (provider/retrieved/filtered/verified/unverified/rejected/duplicates/finalVisuals + `zeroReason`), `diagnostics`, and dedicated routes for candidates / confirm / diagnostics. Deep Dive accepts `stage: "initial"` so an agent can inspect first useful results without waiting for every provider.

## Safety

- Read-only investigation API.
- Secrets and provider keys (`API_KEY` / OpenRouter) are never returned.
- Provider secrets are **rejected** if sent as the machine credential.
- Carmen never messages, posts, comments, follows, purchases, or submits forms.
- External-action paths return **403** with `error: "External action denied"`.
- Investigation IDs are unguessable. Do not publish private investigation JSON.

## Authentication

Configure a Worker secret named **`CARMEN_API_KEY`**. This is separate from
`API_KEY` (the AI provider / OpenRouter secret).

Send one of:

- `Authorization: Bearer <CARMEN_API_KEY>` (preferred for ChatGPT Actions)
- `X-Carmen-Api-Key: <CARMEN_API_KEY>`
- `X-Carmen-Test-Key: <CARMEN_TEST_KEY>` (alias if that secret is set)

If no machine key is configured, `/api` remains open (same as v49.3). The PWA
`GET /search`, `POST /dive`, and `POST /analyze` routes never require the
machine key.

Never send `API_KEY` / OpenRouter credentials to these routes.

One-time secret configuration (do this once; do not commit the value):

```bash
npx wrangler secret put CARMEN_API_KEY --name carmen-iphone-v25
```

Also set the GitHub Actions secret `CARMEN_API_KEY` so deploy can push it.
Do not reuse `API_KEY`.

`GET /api/v1/health` and `GET /api/v1/machine/capabilities` report
`machineAuthConfigured` (boolean only — never the secret).

## Canonical machine-agent sequence

Worker memory is **not durable**. Every continuation must send both
`investigationId` and `investigationState` (or `investigationStateJson`).

1. `GET /api/v1/machine/capabilities`
2. `POST /api/v1/machine/search` with `query` / `subject`
3. Save returned `investigationId` + `investigationState`
3b. Optional: `POST /api/v1/machine/candidates` to inspect person cards (thumbnailUrl, sourceUrl, whySelected)
3c. Optional: `POST /api/v1/machine/confirm` with `candidateId` plus both
4. `POST /api/v1/machine/dive` with `lens` plus both (`stage: "initial"` for first useful results)
5. Inspect the structured `results` array, `images`, `visualPipeline` (no HTML)
5b. `POST /api/v1/machine/diagnostics` with echoed state to inspect timings/provider/filter/verify counts
6. Optional: `POST /api/v1/machine/investigations/{id}/confirm-identity`
7. `POST /api/v1/machine/investigations/{id}/analyze` with a public `url` plus both
8. `POST /api/v1/machine/investigations/{id}` with the echoed state (inspect)
9. Continue another search/dive using the **latest** returned state

`GET /api/v1/machine/investigations/{id}` is best-effort only and returns
**404** if this isolate no longer holds the investigation.

If a client cannot resend the nested object, send `investigationStateJson`
(the JSON string returned on the previous envelope when it fits).

## Minimal ChatGPT endpoint set

| Purpose | Method | Path |
|---|---|---|
| OpenAPI | GET | `/api/v1/openapi.json` |
| capabilities | GET | `/api/v1/machine/capabilities` |
| health | GET | `/api/v1/health` |
| search | POST | `/api/v1/machine/search` |
| person candidates | POST | `/api/v1/machine/candidates` |
| confirm person | POST | `/api/v1/machine/confirm` |
| Deep Dive | POST | `/api/v1/machine/dive` |
| diagnostics | POST | `/api/v1/machine/diagnostics` |
| investigation state | GET or POST | `/api/v1/machine/investigations/{id}` |
| results | GET or POST | `/api/v1/machine/investigations/{id}/results` |
| analyze | POST | `/api/v1/machine/investigations/{id}/analyze` |
| confirm identity | POST | `/api/v1/machine/investigations/{id}/confirm-identity` |

The full investigation catalog remains available and uses the same
`handleCarmenApi` → `runDiscovery` path as the PWA.

## ChatGPT request examples

### Search (same pipeline as GET /search)

```http
POST /api/v1/machine/search
Host: carmen-iphone-v25.94bwfd5grv.workers.dev
Content-Type: application/json
Authorization: Bearer $CARMEN_API_KEY

{
  "query": "Drea Morgan bondage",
  "subject": "Drea Morgan",
  "topic": "bondage",
  "type": "person",
  "adult": "on"
}
```

### Deep Dive

```http
POST /api/v1/machine/dive
Content-Type: application/json
Authorization: Bearer $CARMEN_API_KEY

{
  "lens": "bondage",
  "subject": "Drea Morgan",
  "topic": "bondage",
  "adult": "on",
  "investigationId": "inv_…",
  "investigationState": { }
}
```

`lens` is one of `bondage`, `people`, `clothing`. Always send `investigationState`.

### Investigation state / results

```http
GET /api/v1/machine/investigations/inv_…
Authorization: Bearer $CARMEN_API_KEY
```

```http
POST /api/v1/machine/investigations/inv_…
Content-Type: application/json
Authorization: Bearer $CARMEN_API_KEY

{
  "investigationId": "inv_…",
  "investigationState": { }
}
```

```http
GET /api/v1/machine/investigations/inv_…/results
Authorization: Bearer $CARMEN_API_KEY
```

### Analyze a public page

```http
POST /api/v1/machine/investigations/inv_…/analyze
Content-Type: application/json
Authorization: Bearer $CARMEN_API_KEY

{
  "url": "https://example.com/interview",
  "title": "Interview",
  "kind": "webpage",
  "investigationId": "inv_…",
  "investigationState": { }
}
```

## Response envelope

Successful search / dive responses include:

- `results` — structured evidence items with provenance
- `evidenceSummary` — subject / topic / intersection buckets
- `identityState` — confirmed / rejected / candidates / ambiguity
- `relationships` — related people, parent, derivedFrom, discovery seeds
- `retrievalLanes` — variants, query classes, topic map, expansion
- `investigationState` — opaque state to send back on the next call
- `investigationStateJson` — string form of that state when it is small enough
- `corpusDiagnosis` — live vs blocked vs thin
- `expansion` — Deep Dive expansion metadata
- `pipeline.function` — always `runDiscovery`
- `samePipelineAsIphoneUi` — always `true`
- `capabilities` — allowed vs denied actions
- `readOnly` — always `true`
- `personCandidates` — identity cards: id, displayName, sourceUrl, sourceDomain, sourceTitle, thumbnailUrl, thumbnailOrigin, confidence, whySelected, observationState
- `requestId` — unique per discovery run
- `timings` — discovery/retrieval/image/video/filter/verify/dedupe/synthesis milliseconds
- `visualPipeline` — providerResults, retrieved, filtered, verified, unverified, rejected, duplicatesRemoved, finalVisuals, zeroReason
- `diagnostics` — the same counts plus providerStatuses and errors
- `diveStage` / `partial` / `nextStage` — progressive Deep Dive markers

`visualPipeline.zeroReason` is one of: `providers_returned_zero`, `retrieval_failed`, `filtered_out`, `incorrectly_classified_or_rejected`, `ui_or_serialization_dropped`, `all_rejected_by_visual_gate`, `no_usable_results`. Empty when `finalVisuals > 0`.

Thumbnails on `personCandidates` come only from that candidate's own source (attached image → profile/og:image → that page's images → image-index hits whose pageUrl is THAT candidate). Carmen never copies the first search image onto a different person.

### Person candidates

```http
POST /api/v1/machine/candidates
Content-Type: application/json
Authorization: Bearer $CARMEN_API_KEY

{
  "query": "Drea Morgan",
  "subject": "Drea Morgan",
  "type": "person",
  "adult": "on"
}
```

### Confirm a candidate

```http
POST /api/v1/machine/confirm
Content-Type: application/json
Authorization: Bearer $CARMEN_API_KEY

{
  "candidateId": "cand_1_iafdcom",
  "investigationId": "inv_…",
  "investigationState": { }
}
```

### Diagnostics (echoed state — no extra live search)

```http
POST /api/v1/machine/diagnostics
Content-Type: application/json
Authorization: Bearer $CARMEN_API_KEY

{
  "investigationId": "inv_…",
  "investigationState": { }
}
```

Pass `query` on diagnostics to re-run the live pipeline instead.

### Progressive Deep Dive

```http
POST /api/v1/machine/dive
Content-Type: application/json
Authorization: Bearer $CARMEN_API_KEY

{
  "lens": "bondage",
  "subject": "Drea Morgan",
  "topic": "bondage",
  "adult": "on",
  "stage": "initial",
  "investigationId": "inv_…",
  "investigationState": { }
}
```

Inspect `images` + `visualPipeline`. Then POST again without `stage` (or `stage: "continue"`) with the returned `investigationState` for the remaining providers.

Each result item includes: investigationId, subject, topic, intent,
sourceClass, sourceUrl, canonicalUrl, title, publisher, host, creator,
originalSource, reposter, mirror, imageUrl, identityEvidence, topicEvidence,
confidence, observationState (OBSERVED / SUPPORTED / INFERRED / UNKNOWN),
foundThrough, parent, relatedTo, retrievalRun, timestamps,
deduplicationStatus, rejectionReason, candidateIdentity, provider, latency,
failureReason, isEvidenceItem, isDiscoveryLead, ownershipClass, accessState.

Ownership classes: CONFIRMED CREATOR-OWNED, LIKELY CREATOR-OWNED,
DIRECTORY CLAIM, FAN/REPOSTER, MIRROR, UNVERIFIED, UNKNOWN.

## ChatGPT Custom GPT / Actions setup

See [CHATGPT.md](CHATGPT.md). Short version:

1. Import `https://carmen-iphone-v25.94bwfd5grv.workers.dev/api/v1/openapi.json`
2. Auth: None until `CARMEN_API_KEY` exists; then API Key → Bearer
3. Instruct the GPT to echo `investigationState` on every subsequent call
4. A normal ChatGPT chat cannot call this API until that Action is configured

Smoke test:

```bash
node machine-smoke.mjs --fixture
CARMEN_API_KEY=… node machine-smoke.mjs
```

## Full action catalog

You can also `POST /api/v1` with `{ "action": "search", ... }`.

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

## Browser-test surface (same UI as iPhone)

Remote browser agents can still drive the **real** Carmen PWA at `/test` and
`/browser-test`. That is not the machine API. The machine API is the JSON
routes above.
