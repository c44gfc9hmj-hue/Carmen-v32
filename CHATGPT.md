# Connecting ChatGPT to Carmen

Carmen does **not** let a normal ChatGPT chat call arbitrary HTTP.
This Grok session **cannot** log into ChatGPT, create a GPT, or click
Connect. `chatgptCanInvokeFromThisGrokSession` is **false**.

What Carmen *does* expose on the live Worker:

* an authenticated, read-only REST machine API (`/api/v1/machine/*`)
* OpenAPI 3.0.3 at `/api/v1/openapi.json`
* Streamable-HTTP MCP at `/mcp` (same `runDiscovery` pipeline as the iPhone UI)
* MCP OAuth 2.1 (PKCE, DCR) so ChatGPT Developer Mode can actually connect
* Setup JSON at `/api/v1/chatgpt-setup` (never returns secrets)
* Privacy page at `/privacy`

Production origin: `https://carmen-iphone-v25.94bwfd5grv.workers.dev`

Live check: `GET /api/v1/health` → `machineAuthConfigured` must be `true`
before ChatGPT can be pointed at a locked API.

## Distinction

| Layer | Status |
|---|---|
| A. Carmen has an authenticated machine API | Yes, once `CARMEN_API_KEY` is on the Worker |
| B. ChatGPT can invoke that API **from this Grok session** | **No** |
| B. ChatGPT can invoke that API **after you add a connector/Action with a key you hold** | Yes — that is the product path |

Do not treat an OpenAPI file as ChatGPT access.

## Path 1 (current ChatGPT product): Developer Mode MCP

ChatGPT’s current way to call a generic HTTP API is a **Developer Mode
custom MCP connector**, not a default chat.

ChatGPT custom connectors prefer **OAuth**. Carmen implements the missing
layer: RFC 9728 protected-resource metadata, RFC 8414 authorization-server
metadata, RFC 7591 dynamic client registration, and PKCE. The authorize
page asks for **`CARMEN_API_KEY` only** — never your ChatGPT/OpenAI
password, never the provider `API_KEY`.

1. Confirm `GET /api/v1/health` has `machineAuthConfigured: true`.
2. In ChatGPT: **Settings → Apps & Connectors (or Plugins) → Developer mode** on.
3. Create a connector.
   * MCP server URL: `https://carmen-iphone-v25.94bwfd5grv.workers.dev/mcp`
   * Authentication: **OAuth** (ChatGPT will discover
     `/.well-known/oauth-protected-resource`).
   * On the Carmen authorize page, paste `CARMEN_API_KEY`.
   * If that UI offers Header / API key instead: `Authorization: Bearer <CARMEN_API_KEY>`.
4. Enable the connector on the chat.
5. Ask: “Search Carmen for Drea Morgan, then Deep Dive bondage, then inspect diagnostics.”

Tools ChatGPT gets (all read-only, all `runDiscovery`):

`carmen_capabilities`, `carmen_search`, `carmen_candidates`,
`carmen_confirm`, `carmen_dive` (bondage / visuals / accounts),
`carmen_find_more`, `carmen_ask`, `carmen_diagnostics`,
`carmen_inspect`, `carmen_analyze`.

Denied: posting, messaging, purchasing, account creation, login/paywall bypass.

## Path 2 (still works until Custom GPTs retire): Actions

OpenAI is retiring Custom GPTs (Enterprise: no **new** GPTs after about
2026-09-25; they stop running 2026-12-11). Existing Actions still work
until then. Custom actions **do not** migrate to plugins.

1. Import
   `https://carmen-iphone-v25.94bwfd5grv.workers.dev/api/v1/openapi.json`
2. Authentication = **API Key**, Auth Type = **Bearer**,
   API Key = `CARMEN_API_KEY` (never `API_KEY`)
3. Privacy policy URL: `https://carmen-iphone-v25.94bwfd5grv.workers.dev/privacy`
4. Use a non-reasoning / non-Pro model (Actions are unavailable on Pro and several reasoning models)
5. Paste the agent contract below

### GPT Instructions (paste)

```
You are connected to Carmen, a read-only investigation API.
Never try to message, post, comment, follow, purchase, or submit forms.

Canonical sequence:
1. GET capabilities.
2. POST /api/v1/machine/search with query/subject.
3. Save investigationId AND investigationState from the JSON.
3b. POST /api/v1/machine/candidates to inspect person cards (thumbnailUrl, sourceUrl, whySelected).
3c. POST /api/v1/machine/confirm with candidateId plus both id and state.
4. POST /api/v1/machine/dive with lens plus both id and state. Use stage=initial for first useful results.
5. Use the results array, images, and visualPipeline. Do not parse HTML.
5b. POST /api/v1/machine/diagnostics with echoed state to inspect timings and filter/verify counts.
6. POST /api/v1/machine/investigations/{id}/analyze with a public url plus both id and state.
7. To inspect later, POST /api/v1/machine/investigations/{id} with the echoed state.
   GET is best-effort only and returns 404 when Worker memory has dropped it.
8. Continue every later search/dive with the latest investigationState.

If you cannot resend the nested investigationState object, send
investigationStateJson (string) instead.
Worker memory is not durable. Always echo state. Never invent URLs.
```

## Auth type and header name

| Surface | Auth |
|---|---|
| REST machine API | `Authorization: Bearer <CARMEN_API_KEY>` or `X-Carmen-Api-Key` |
| Custom GPT Actions | API Key → Bearer (editor panel, not an OpenAPI parameter) |
| ChatGPT MCP connector | OAuth (authorize page) or Header Bearer if the UI offers it |
| Never send | provider `API_KEY` / OpenRouter credentials |
| PWA iPhone UI | no machine key |

## How to hold the key (required for ChatGPT)

This environment cannot write GitHub Actions secrets (`403`). Deploy will
**generate** a Worker secret if none exists so the API is not left open.
A generated Worker key is **not recoverable** from logs.

To use ChatGPT you must hold the same value the Worker has:

1. GitHub → `c44gfc9hmj-hue/Carmen-v32` → **Settings → Secrets and variables → Actions**
2. New repository secret named exactly **`CARMEN_API_KEY`**
   (do **not** reuse `API_KEY`)
3. Re-run **Deploy to Cloudflare Workers** so `wrangler secret put` updates the Worker
4. Confirm `GET /api/v1/health` → `machineAuthConfigured: true`
5. Paste that same value into ChatGPT OAuth / Bearer. Never commit it.

## Limits

* Investigation guard ~24s; Cloudflare Worker CPU; ChatGPT Actions timeout 45s
* Use `stage=initial` on Deep Dive, then continue with echoed state
* No published RPM quota
* Worker memory is not durable — echo `investigationId` + `investigationState`
* Responses are JSON (no image bytes). Thumbnails are URLs from that candidate’s own source
* Official ChatGPT Apps SDK does not present arbitrary customer API keys;
  that is why Carmen hosts OAuth for MCP

Live setup JSON (no secrets): `/api/v1/chatgpt-setup`
