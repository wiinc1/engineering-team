# LangGraph-01 internal API contract

The existing API version and authentication system are unchanged. Both routes require authenticated actor and server-derived tenant context, return the standard `request_id`/`requestId` error envelope, and set `cache-control: no-store`.

## `GET /api/v1/internal/langgraph/health`

Roles: `admin`, `system`, `sre`, or `observability`. Query `deep=true` requests the synthetic write/read/delete probe. Successful `data` contains status, schema, graph/state versions, active/stale counts, aggregate checkpoint bytes, deep flag, and duration. It never contains connection strings or checkpoint values. Unavailable storage, timeout, or migration mismatch returns 503 with a stable LangGraph code.

## `GET /api/v1/internal/langgraph/checkpoints`

Roles: authenticated read-capable factory roles. The server always filters by the authenticated tenant. Optional `status` is one of `active`, `paused`, `completed`, `failed`, or `expired`; `limit` is clamped to 1–100.

Each summary contains thread/factory-run identity, namespace, graph/state versions, status, latest node, byte count, checkpoint/retention/create/update timestamps. Raw state, channel values, writes, metadata, credentials, and tenant fields are intentionally absent. Unsupported query state returns 400; cross-tenant access returns 403; unavailable storage returns 503.

Resume authorization and user-facing controls remain deferred to LANGGRAPH-03 (#282). No user-facing route or screen ships here.
