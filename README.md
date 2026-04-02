# engineering-team

## Audit foundation slice

This repo now includes a materially more production-shaped `SF-017` slice:
- canonical workflow audit envelope
- append-only event persistence with pluggable file/PostgreSQL store interface
- idempotent ingestion
- task history + current-state + relationship projections
- async projection queue + checkpointed worker
- durable outbox queue + worker surface
- role-based authorization on audit APIs
- structured observability hooks plus `/metrics` export
- tenant-aware HTTP query APIs for history/state/relationships/observability summary
- projection rebuild tooling for recovering from drift
- unit tests for sync, async, API authz, and PostgreSQL store contracts
- live PostgreSQL integration test covering migration -> ingest -> projection queue -> outbox -> metrics

### Key paths
- `lib/audit/` — audit store, authz, worker, logger, event taxonomy
- `data/` — generated append-only event stream, queues, checkpoints, and projections
- `observability/workflow-audit.log` — structured telemetry log
- `docs/runbooks/audit-foundation.md` — operator notes

### Backend model
- **Supabase Postgres**: canonical production/staging backend.
- **Dockerized Postgres**: canonical local development/testing backend. The checked-in compose stack is disposable-first so local state is easy to reset.
- **File backend**: fallback-only local dev/test harness for isolated runs, not the standard local workflow.
- **Projected history reads**: Postgres history queries now read from the `audit_task_history` projection instead of raw source-of-truth events.

### New in this pass
- `lib/audit/http.js` enforces bearer-token auth and role-based access.
- `lib/audit/workers.js` exposes checkpointed projection and outbox workers.
- `/metrics` exports numeric audit telemetry in Prometheus text format.
- `/projections/process` lets an admin trigger bounded projection catch-up.
- `scripts/process-audit-projection-queue.js` and `scripts/process-audit-outbox.js` provide worker entrypoints.
- Postgres metrics now advance on writes, reads, projection processing, outbox publication, and rebuilds.

### Running locally
- Default local path: **Dockerized Postgres with disposable state**.
- Start the local database: `npm run dev:postgres:up`
- Reset the local database completely: `npm run dev:postgres:reset`
- Start the full local stack (Postgres + Pushgateway + API + workers): `npm run dev:audit:up`
- Stop the local stack: `npm run dev:audit:down`
- Use `DATABASE_URL=postgres://audit:audit@127.0.0.1:5432/engineering_team` for host-run scripts/tests against the Docker database.
- `npm test`
- `npm run test:contract`
- `npm run test:performance`
- `npm run test:security`
- `npm run test:chaos`
- `npm run test:integration:docker`
- `npm run audit:migrate` (with `DATABASE_URL` pointed at your target Postgres)
- `npm run audit:rebuild -- /path/to/repo-root`
- `npm run audit:project -- /path/to/repo-root [batchSize]`
- `npm run audit:outbox -- /path/to/repo-root [batchSize]`
- File backend is **not** the standard local path anymore. Use it only as a fallback dev/test harness: `AUDIT_STORE_BACKEND=file NODE_ENV=development ...`

### Validation matrix added in this pass
- `tests/contract/` — OpenAPI/runtime contract checks for documented endpoints and auth model.
- `tests/e2e/` — explicit end-to-end API scenarios for the must-have acceptance criteria that are currently implemented in this repo.
- `tests/property/` — generated coverage for ordering, payload validation, and idempotency invariants.
- `tests/performance/` — baseline append/query/projection throughput budgets for the file-backed store.
- `tests/security/` — negative auth/body-handling coverage for JWT enforcement and legacy-header fallback.
- `chaos/` — retry/dead-letter validation for outbox worker failure scenarios.

### Browser task-detail runtime (#26)
A minimal Vite + React browser surface now mounts the task-detail feature through the existing adapter + route layer.

- Browser entry: `index.html`
- App runtime: `src/app/`
- Route/page module still lives at `src/features/task-detail/route.js`
- Feature shell still lives at `src/features/task-detail/`
- Internal-use auth bootstrap is intentionally minimal: paste a bearer JWT into the session panel and the browser stores it in `sessionStorage` for the current tab only.
- PM/admin tokens also unlock the task assignment control, which reads `GET /ai-agents` and writes `PATCH /tasks/:taskId/assignment`.
- Reader-level tokens still see owner metadata on `GET /tasks/:taskId` and `GET /tasks`; they just do not get assignment controls.

Run it locally:
- `npm install`
- `npm run dev`
- open `http://127.0.0.1:5173/tasks/TSK-42`
- if the API requires auth, paste a JWT into the **Session bootstrap** panel

Point the browser app at the API:
- same-origin default: leave `VITE_TASK_API_BASE_URL` empty
- separate API origin: set `VITE_TASK_API_BASE_URL=http://127.0.0.1:3000`
- or use the dev proxy: set `VITE_TASK_API_PROXY_TARGET=http://127.0.0.1:3000`
- operators can override the API origin at runtime from the session panel without rebuilding

Build/package the thin browser app:
- `npm run build:browser`
- `npm run serve:browser` → serves the built SPA with `/tasks/:taskId` fallback on port `4173`
- `npm run docker:browser` → builds `Dockerfile.browser`
- deploy the browser app behind the same origin as the audit API when possible so `/tasks/*` stays simple

### Browser quality coverage for SF-019
A thin jsdom-based UI harness now covers the mounted task-detail route via `npm run test:ui`.

It currently includes:
- ready-state structural snapshot coverage
- restricted-state structural snapshot coverage
- axe-core smoke coverage for the mounted route semantics
- a small render-budget smoke check for the ready state

### Remaining verification gap
- This is still lightweight internal-use coverage, not full cross-browser visual regression.
- No Lighthouse/Core Web Vitals run is wired yet; the current performance check is a fast render-budget smoke test in jsdom.
- The task-detail browser runtime is still intentionally thin: no broader app shell, login flow, or external identity provider integration has been added beyond the minimum needed to render `/tasks/:taskId`.
