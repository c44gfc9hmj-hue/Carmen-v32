# Carmen machine-readable API (v49.4)

ChatGPT and other authorized assistants can drive Carmen through a **secure,
read-only** HTTP API. The routes execute the same `runDiscovery` / retrieve /
analyze / investigation-state pipeline as the iPhone PWA. There is no mock and
no browser-test simulation.

Production origin:

`https://carmen-iphone-v25.94bwfd5grv.workers.dev`

OpenAPI: `GET /api/v1/openapi.json`

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

- `X-Carmen-Api-Key: <CARMEN_API_KEY>`
- `Authorization: Bearer <CARMEN_API_KEY>`
- `X-Carmen-Test-Key: <CARMEN_TEST_KEY>` (alias if that secret is set)

If no machine key is configured, `/api` remains open (same as v49.3). The PWA
`GET /search`, `POST /dive`, and `POST /analyze` routes never require the
machine key.

Never send `API_KEY` / OpenRouter credentials to these routes.

## Minimal ChatGPT endpoint set

| Purpose | Method | Path |
|---|---|---|
| OpenAPI | GET | `/api/v1/openapi.json` |
| capabilities | GET | `/api/v1/machine/capabilities` |
| health | GET | `/api/v1/health` |
| search | POST | `/api/v1/machine/search` |
| Deep Dive | POST | `/api/v1/machine/dive` |
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
X-Carmen-Api-Key: $CARMEN_API_KEY

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
X-Carmen-Api-Key: $CARMEN_API_KEY
```

```http
POST /api/v1/machine/investigations/inv_…
Content-Type: application/json
X-Carmen-Api-Key: $CARMEN_API_KEY

{
  "investigationId": "inv_…",
  "investigationState": { }
}
```

```http
GET /api/v1/machine/investigations/inv_…/results
X-Carmen-Api-Key: $CARMEN_API_KEY
```

### Analyze a public page

```http
POST /api/v1/machine/investigations/inv_…/analyze
Content-Type: application/json
X-Carmen-Api-Key: $CARMEN_API_KEY

{
  "url": "https://example.com/interview",
  "title": "Interview",
  "kind": "webpage",
  "investigationId": "inv_…",
  "investigationState": { }
}
```

Pass **`investigationState` plus `investigationId`** from the previous
response so identity confirmation, rejections, and the trail persist.
Worker memory is **not durable**. `GET /api/v1/machine/investigations/{id}`
is best-effort only and returns **404** if this isolate no longer holds the
investigation. ChatGPT / external agents should `POST` the same path with
`{ "investigationId", "investigationState" }` to inspect state or results.

`GET /api/v1/health` and `GET /api/v1/machine/capabilities` report
`machineAuthConfigured` (boolean only — never the secret). Until the
`CARMEN_API_KEY` Worker secret exists, machine routes stay open.

## Response envelope

Successful search / dive responses include:

- `results` — structured evidence items with provenance
- `evidenceSummary` — subject / topic / intersection buckets
- `identityState` — confirmed / rejected / candidates / ambiguity
- `relationships` — related people, parent, derivedFrom, discovery seeds
- `retrievalLanes` — variants, query classes, topic map, expansion
- `investigationState` — opaque state to send back on the next call
- `pipeline.function` — always `runDiscovery`
- `samePipelineAsIphoneUi` — always `true`
- `capabilities` — allowed vs denied actions
- `readOnly` — always `true`

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

1. Set Cloudflare Worker secret `CARMEN_API_KEY`:
   `npx wrangler secret put CARMEN_API_KEY --name carmen-iphone-v25`
   Also set the GitHub Actions secret `CARMEN_API_KEY` so deploy can push it.
   Do not reuse `API_KEY`.
2. Create a ChatGPT Action. Import
   `https://carmen-iphone-v25.94bwfd5grv.workers.dev/api/v1/openapi.json`.
3. Authentication: API Key, header name `X-Carmen-Api-Key`, secret value =
   `CARMEN_API_KEY`.
4. Allow only search, dive, state, results, analyze, and confirm-identity.
5. Instruct the GPT that Carmen is read-only and must never attempt messaging,
   posting, following, purchasing, or form submission. Instruct it to echo
   `investigationState` on every subsequent call.

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
