# engineering-team

## Standards Governance

This repo now includes a standards enforcement baseline for task planning and change review:
- canonical standards reference: `docs/standards/software-development-standards.md`
- reusable review template: `docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md`
- PR gate: `.github/PULL_REQUEST_TEMPLATE.md`
- CI presence check: `npm run standards:check`
- branch protection policy: `.github/BRANCH_PROTECTION.md`

Every task file under `tasks/` is expected to carry `## Standards Alignment` and `## Required Evidence` so the repo has a durable record of which standards applied, what evidence was produced, and which gaps remain.

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
- For managed Postgres providers like Supabase, prefer verified TLS. If your environment must temporarily accept a self-signed chain, set `PGSSL_ACCEPT_SELF_SIGNED=1` explicitly instead of relying on `sslmode=no-verify` in the URL.
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

Task-detail contract notes for approval readiness:
- `GET /tasks/:id/detail` is the canonical read model for the page. Raw history, relationships, and telemetry remain backing inputs, not the UI source of truth.
- Server-side omission/redaction is authoritative. Restricted callers receive empty/omitted comments, audit log, linked PR metadata, child-task relationships, and telemetry sections in the `/detail` payload instead of relying on client-side hiding.
- Child-task detail summaries are resolved from projected task summaries, not per-child history fetches, to avoid child-history N+1 fanout on detail loads.
- Local performance budget: the detail view model should resolve in one `/detail` request, and the browser smoke budget stays under 1s for local mock-backed first contentful paint / DOMContentLoaded checks.
- Freshness semantics: `summary.freshness` is the workflow/read-model freshness source of truth, `telemetry.lastUpdatedAt` is telemetry-specific recency, and stale/degraded telemetry must be rendered explicitly instead of being treated as fresh.
- Rollout flag: `FF_TASK_DETAIL_PAGE=0` disables the `/tasks/:id/detail` surface and returns a standardized `feature_disabled` response referencing `ff_task_detail_page`.
- Deterministic status precedence for the detail view is `done` > `blocked` > `waiting` > `active`.
- Detail payload truncation for v1 is explicit: comments are capped at 10 entries and audit log items at 20 entries in the `/detail` response.
- Manual refresh is the v1 consistency model. Live updates are not required in this pass.
- See `docs/reports/ISSUE_7_COMPLETION_AUDIT.md` for the issue-7 completion mapping, derivation rules, permissions behavior, and freshness notes.

- Browser entry: `index.html`
- App runtime: `src/app/`
- Route/page module still lives at `src/features/task-detail/route.js`
- Feature shell still lives at `src/features/task-detail/`
- Production browser sign-in now starts at `/sign-in` and uses a hosted OIDC Authorization Code + PKCE flow. The callback route is `/auth/callback`, and the resulting provider-issued access token is stored in `sessionStorage`.
- The trusted browser auth code exchange on `POST /auth/session` remains available only as an internal/local fallback when explicitly enabled.
- The app protects `/tasks`, `/tasks?view=board`, `/overview/pm`, `/inbox/:role`, and `/tasks/:taskId`; unauthenticated or expired sessions are redirected back to `/sign-in`.
- PM/admin tokens also unlock the task assignment control, which reads `GET /ai-agents` and writes `PATCH /tasks/:taskId/assignment`.
- Reader-level tokens still see owner metadata on `GET /tasks/:taskId` and `GET /tasks`; they just do not get assignment controls.

Run it locally:
- `npm install`
- `npm run dev`
- open `http://127.0.0.1:5173/`
- configure `VITE_OIDC_DISCOVERY_URL` and `VITE_OIDC_CLIENT_ID` for enterprise sign-in, or keep `VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED=true` to use the internal bootstrap fallback in local/internal environments

Point the browser app at the API:
- same-origin default: leave `VITE_TASK_API_BASE_URL` empty
- separate API origin: set `VITE_TASK_API_BASE_URL=http://127.0.0.1:3000`
- or use the dev proxy: set `VITE_TASK_API_PROXY_TARGET=http://127.0.0.1:3000`
- operators can override the API origin at runtime from the session panel without rebuilding
- browser auth env vars:
- `VITE_OIDC_DISCOVERY_URL`
- `VITE_OIDC_CLIENT_ID`
- optional `VITE_OIDC_REDIRECT_URI`, `VITE_OIDC_SCOPE`, `VITE_OIDC_LOGOUT_URL`, and `VITE_OIDC_LOGOUT_REDIRECT_URI`
- set `VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED=false` for production browser builds so the internal fallback form is hidden

### Vercel deployment
- This repo can now run on a single Vercel project with the SPA plus serverless API routes.
- The Vercel API adapter lives under `api/` and wraps `lib/audit/http.js`.
- Vercel also includes an explicit `api/v1/[...route].js` entry so `/api/v1/*` versioned task-platform routes resolve consistently in production.
- Vercel additionally exposes explicit `api/v1/tasks.js`, `api/v1/tasks/[...route].js`, and `api/v1/ai-agents.js` handlers so the versioned task-platform routes do not depend on nested catch-all matching quirks.
- To avoid route collisions between SPA paths like `/tasks/...` and API paths like `/tasks/...`, set `VITE_TASK_API_BASE_URL=/backend` in Vercel.
- `vercel.json` rewrites `/backend/*` to the Vercel API functions and falls back non-API browser routes to `index.html`.
- Required backend env vars in Vercel: `DATABASE_URL`, `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`, `AUTH_JWT_JWKS_URL`.
- Keep `AUTH_JWT_SECRET` and `AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP=false` only if you still need compatibility tokens for a non-production fallback path; the default production browser flow should use provider-issued tokens directly.

Build/package the thin browser app:
- `npm run build:browser`
- `npm run serve:browser` → serves the built SPA with `/tasks/:taskId` fallback on port `4173`
- `npm run docker:browser` → builds `Dockerfile.browser`
- deploy the browser app behind the same origin as the audit API when possible so `/tasks/*` stays simple

### Browser quality coverage for SF-019
A thin jsdom-based UI harness now covers the mounted task-detail route via `npm run test:ui`.
A Playwright browser harness now adds route-level verification via `npm run test:browser`.

It currently includes:
- ready-state structural snapshot coverage
- restricted-state structural snapshot coverage
- axe-core smoke coverage for the mounted route semantics
- a small render-budget smoke check for the ready state
- Chromium and Firefox verification that the task-detail shell preserves its core structure across supported browser engines
- Chromium and mobile Chrome verification that tablet task-detail summaries stay visible without horizontal overflow
- Chromium and mobile Chrome verification that mobile task-activity tabs collapse into the intended 2-column accessible pattern
- Chromium and mobile Chrome verification that compressed board owner metadata remains readable on mobile
- browser `performance` timing evidence for local route render latency beyond request-count-only smoke

Current default browser matrix:
- Desktop Chrome (`chromium`)
- Desktop Firefox (`firefox`)
- Mobile Chrome (`mobile-chrome`)
- Optional Mobile Safari (`PLAYWRIGHT_INCLUDE_WEBKIT=1 npm run test:browser`)

### Specialist delegation and truthful attribution
- A new specialist delegation coordinator now routes clear specialist-owned software-factory requests to the matching specialist (`architect`, `engineer`, `qa`, `sre`) instead of letting the coordinator claim specialist handling without delegation evidence.
- Delegation artifacts are written to `observability/specialist-delegation.jsonl`.
- Structured logs for attempts, success, fallback, and attribution mismatches are written to `observability/workflow-audit.log`.
- Rollout is controlled by `FF_SPECIALIST_DELEGATION` and documented in `docs/runbooks/specialist-delegation.md`.

### Issue #30 architecture package
- Canonical task persistence and AI agent ownership redesign artifacts now live in:
- `docs/adr/ADD-2026-04-12-task-persistence-and-agent-ownership.md`
- `db/migrations/006_canonical_task_persistence.sql`
- `docs/api/task-platform-openapi.yml`
- `docs/reports/ISSUE_30_TASK_PLATFORM_REDESIGN.md`
- This package is additive only. The current audit-backed assignment/runtime behavior remains the active implementation until follow-up execution tasks are completed.

### Canonical task-platform API (initial executable slice)
- The audit server now also exposes an additive versioned task-platform surface at `/api/v1`.
- Current routes:
- `GET /api/v1/ai-agents`
- `GET /api/v1/tasks`
- `POST /api/v1/tasks`
- `GET /api/v1/tasks/{taskId}`
- `PATCH /api/v1/tasks/{taskId}`
- `PATCH /api/v1/tasks/{taskId}/owner`
- This slice introduces optimistic concurrency at the canonical task layer and currently uses a file-backed local service while coexisting with the audit/event runtime.

### Remaining verification gap
- This is still lightweight internal-use coverage, not full cross-browser visual regression.
- No Lighthouse/Core Web Vitals run is wired yet; performance evidence is now browser-timing based, but still local/mock-backed rather than a deployed environment measurement.
- WebKit coverage remains opt-in rather than part of the default local matrix.
- The browser app now includes a shared authenticated shell, sign-in flow, task list/board/PM overview/inbox navigation, and task detail routing. Production identity-provider integration is still pending; the current auth flow is an internal trusted auth-code exchange.
