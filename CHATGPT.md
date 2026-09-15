# Connecting ChatGPT to Carmen’s Machine API

Carmen does **not** let a normal ChatGPT chat call arbitrary HTTP.
There is no Carmen-side switch that makes the default ChatGPT composer
POST JSON to this Worker.

What Carmen *does* expose is a live, OpenAPI 3.0.3, read-only
investigation API that a ChatGPT **Custom GPT Action** (or any other
HTTP agent) can invoke.

Production origin: `https://carmen-iphone-v25.94bwfd5grv.workers.dev`

## Exact connection procedure (Custom GPT Actions)

This is the only ChatGPT product path that can actually invoke Carmen
today without building a separate MCP/OAuth server.

1. Confirm the Worker is reachable:
   `GET https://carmen-iphone-v25.94bwfd5grv.workers.dev/api/v1/health`
2. Import the Action schema from this URL:
   `https://carmen-iphone-v25.94bwfd5grv.workers.dev/api/v1/openapi.json`
   In the GPT editor: **Create** → **Actions** → **Import from URL**.
3. Authentication in the GPT editor (not in the schema):
   - If `machineAuthConfigured` is `false` (current production):
     **Authentication = None**. Machine routes are open.
   - If `CARMEN_API_KEY` has been set on the Worker:
     **Authentication = API Key**
     **Auth Type = Bearer**
     **API Key = the CARMEN_API_KEY value** (never the provider `API_KEY`)
     Alternate: Auth Type = Custom, header name `X-Carmen-Api-Key`.
4. Use a **non-reasoning / non-Pro** GPT model. OpenAI documents that
   Custom GPT Actions are unavailable on Pro mode and on reasoning
   models such as GPT-5.1 / GPT-5.2.
5. Paste the agent contract below into the GPT Instructions.
6. Test with: “Search Carmen for Drea Morgan, then Deep Dive bondage,
   then inspect the investigation state.” Confirm the GPT actually
   calls `machineSearch` and receives JSON.

### GPT Instructions (paste)

```
You are connected to Carmen, a read-only investigation API.
Never try to message, post, comment, follow, purchase, or submit forms.

Canonical sequence:
1. GET capabilities.
2. POST /api/v1/machine/search with query/subject.
3. Save investigationId AND investigationState from the JSON.
4. POST /api/v1/machine/dive with lens plus both id and state.
5. Use the results array. Do not parse HTML.
6. POST /api/v1/machine/investigations/{id}/analyze with a public url plus both id and state.
7. To inspect later, POST /api/v1/machine/investigations/{id} with the echoed state.
   GET is best-effort only and returns 404 when Worker memory has dropped it.
8. Continue every later search/dive with the latest investigationState.

If you cannot resend the nested investigationState object, send
investigationStateJson (string) instead.
Worker memory is not durable. Always echo state. Never invent URLs.
```

## Auth type and header name

| GPT editor field | Value |
|---|---|
| Authentication | None until `CARMEN_API_KEY` exists; then API Key |
| Preferred auth type | Bearer |
| Header sent | `Authorization: Bearer <CARMEN_API_KEY>` |
| Alternate header | `X-Carmen-Api-Key: <CARMEN_API_KEY>` |
| Must configure key first? | Only after the Worker secret is set. Check `machineAuthConfigured` on `/api/v1/health`. |
| Never send | provider `API_KEY` / OpenRouter credentials |

OpenAPI documents both Bearer and `X-Carmen-Api-Key`. ChatGPT Actions
**do not send custom headers from the schema**; the editor Authentication
panel is what actually attaches the key. Do not add `X-Carmen-Api-Key`
as a request parameter.

## Operation sequence

1. `GET /api/v1/machine/capabilities`
2. `POST /api/v1/machine/search`
3. Save `investigationId` + `investigationState`
4. `POST /api/v1/machine/dive` with both
5. Inspect `results`
6. Optional `POST .../confirm-identity`
7. `POST .../analyze` with a public `url` + both
8. `POST /api/v1/machine/investigations/{id}` with echoed state
9. Continue using the **returned** state from each response

## What this environment cannot do

This Grok/Carmen workspace cannot log into ChatGPT, create a Custom GPT,
or click “Test” in the GPT editor. Carmen-side work stops at: live
OpenAPI, live JSON routes, auth contract, and production smoke tests.

ChatGPT itself (a default conversation, Agent browsing, or Developer
Mode MCP) cannot call this REST API unless the user configures one of:

* a Custom GPT Action that imports the OpenAPI URL above, or
* a remote MCP server + OAuth connector (not provided; ChatGPT custom
  connectors currently expect OAuth, not a bearer header)

## ChatGPT Action limitations that remain

* Custom headers cannot be declared as OpenAPI parameters.
* Request/response payloads must stay under 100,000 characters.
* Actions time out after 45 seconds. Live discovery can be slow.
* Responses are text/JSON only (no images/video bytes).
* Endpoint `summary`/`description` ≤ 300 characters.
* Parameter descriptions ≤ 700 characters.
* Actions are unavailable in Pro mode and on several reasoning models.
* Custom GPTs are being migrated toward Plugins (OpenAI: Sep 17, 2026
  migration experience). The OpenAPI URL remains the Carmen contract
  those surfaces import.

No further OpenAPI change on the Carmen side removes those ChatGPT
product limits.
