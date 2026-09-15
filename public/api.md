# Carmen machine-readable API (v49.4)

See repository root API.md and CHATGPT.md.

Machine routes: POST /api/v1/machine/search, POST /api/v1/machine/dive, GET|POST /api/v1/machine/investigations/{id}, GET|POST /api/v1/machine/investigations/{id}/results, POST /api/v1/machine/investigations/{id}/analyze, POST /api/v1/machine/investigations/{id}/confirm-identity.

Auth: Authorization Bearer CARMEN_API_KEY (preferred) or X-Carmen-Api-Key. Never send API_KEY.

OpenAPI: GET /api/v1/openapi.json

Continuity: echo investigationId + investigationState (or investigationStateJson) on every continuation. Worker memory is not durable.
