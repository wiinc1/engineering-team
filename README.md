# engineering-team

## Canonical Architecture And Operations

- Architecture source of truth: `docs/architecture.md`
- Operator runbook: `docs/runbook.md`

The README summarizes the main developer entry points. Runtime boundaries,
state ownership, release evidence, rollback posture, and monitoring operations
belong in the canonical architecture and runbook docs.

## Standards Governance

This repo now includes a standards enforcement baseline for task planning and change review:
- canonical standards reference: `docs/standards/software-development-standards.md`
- reusable review template: `docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md`
- PR gate: `.github/PULL_REQUEST_TEMPLATE.md`
- CI presence check: `npm run standards:check`
- full local ship gate: `make verify`
- standards-only local gate: `make standards-policy-gates`
- branch protection policy: `.github/BRANCH_PROTECTION.md`

Every task file under `tasks/` is expected to carry `## Standards Alignment` and `## Required Evidence` so the repo has a durable record of which standards applied, what evidence was produced, and which gaps remain.

### Tracked-file linting

`npm run lint` discovers tracked and untracked, non-ignored authored source files
with `git ls-files --cached --others --exclude-standard`. It scans `.js`,
`.jsx`, `.mjs`, `.cjs`, `.ts`, and `.tsx` files under `api/`, `lib/`,
`scripts/`, `src/`, and `tests/`.

Excluded authored-source boundaries are explicit: dependency, generated,
coverage, build, dist, third-party, vendor, report, and temporary artifact
directories are skipped before rules run. The gate checks trailing whitespace,
tabs, and readability signals for generated, bundled, or minified-looking
authored source. Diagnostics report rule, path, and line only; they do not print
source lines.

Legitimate compact or generated-source exceptions must be documented in
`config/lint-source-allowlist.json` with rule, owner, reason, and follow-up.
Allowlist entries are exact and stale-sensitive: entries for missing files,
excluded files, unsupported rules, or readability findings that no longer exist
fail lint until removed or corrected.

`make verify` is the aggregate local gate for this React/Vite/Node/PostgreSQL
application. It runs DESIGN.md gates, standards policy validators, `npm run
lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:browser`, `npm
run build`, `npm run standards:check`, and Python standards test/artifact
validators. Use `make standards-policy-gates` only when you need the
standards-policy slice without the runtime app checks.

## Visual Design Tokens

`DESIGN.md` is the visual design source of truth. GitHub Actions is not required for DESIGN.md enforcement; the local source of truth is `make verify`. Before UI changes, read `DESIGN.md`; change reusable visual tokens there first; regenerate committed CSS outputs with `npm run design:tokens`; do not add hard-coded visual values to migrated CSS. Verify UI token work with `npm run design:tokens:check`, `npm run design:tokens:enforce`, `npm run design:audit:check`, `npm run design:change-guard`, and `make verify`.

Rare one-off values in migrated CSS must use `DESIGN-TOKEN-EXCEPTION: <short reason and follow-up if reusable>`. Reusable exceptions must become `DESIGN.md` tokens.

The enforced authored CSS scope is tracked in `docs/design/design-md-adoption.config.json` and generated into `docs/design/DESIGN_MD_ADOPTION_AUDIT.md`. Update the config when a new UI component family or authored CSS module enters token enforcement, then run `npm run design:audit`.

Install local hooks with:

```bash
scripts/setup-local-hooks.sh
```

This configures `core.hooksPath` to `scripts/hooks`. The pre-commit hook runs the local DESIGN.md gates, and the pre-push hook runs `make verify`.

If a UI file changes with no design impact, create a local `docs/design/no-design-impact.txt` containing a short reason. Keep the marker local and remove it after the change is complete; reusable visual decisions still belong in `DESIGN.md`.

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
- `docs/runbooks/execution-contract-refinement.md` — reviewer routing, approval, artifact, and dispatch readiness runbook
- `docs/api/execution-contract-refinement-openapi.yml` — versioned Execution Contract refinement API surface

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
- Use `DATABASE_URL=postgres://<local-user>:<local-password>@127.0.0.1:5432/<local-database>` for host-run scripts/tests against the Docker database.
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
- Next-action rollout flag: `ff_task_detail_next_action_redesign` controls the client-side role-specific next-action panel. The panel is derived from the existing `/detail` payload, preserves deep links to lifecycle sections, emits sanitized impression/click events, and can be disabled without changing server contracts.
- Deterministic status precedence for the detail view is `done` > `blocked` > `waiting` > `active`.
- Detail payload truncation for v1 is explicit: comments are capped at 10 entries and audit log items at 20 entries in the `/detail` response.
- Manual refresh is the v1 consistency model. Live updates are not required in this pass.
- See `docs/reports/ISSUE_7_COMPLETION_AUDIT.md` for the issue-7 completion mapping, derivation rules, permissions behavior, and freshness notes.

- Browser entry: `index.html`
- App runtime: `src/app/`
- Route/page module still lives at `src/features/task-detail/route.js`
- Feature shell still lives at `src/features/task-detail/`
- Browser source ownership after `ff_frontend_source_modularization`:
- `src/app/App.jsx` owns app bootstrapping, session lifecycle, and route orchestration.
- `src/app/app-model.jsx` owns shared route matching, auth query-state helpers, task workspace filters, and view-model formatting helpers used by the extracted routes.
- `src/app/routes/AuthRoute.jsx` owns sign-in, registration, verification, reset, and callback route rendering.
- `src/app/routes/CreateTaskRoute.jsx` owns `/tasks/create` integration with the task-creation feature.
- `src/app/routes/AdminUsersRoute.jsx` owns the admin user-management route.
- `src/app/routes/TaskWorkspaceRoute.jsx` owns `/tasks`, role inboxes, PM overview, governance, deferred-consideration, and board/list workspace rendering.
- `src/app/routes/TaskDetailRoute.jsx` owns `/tasks/:taskId` rendering and mutation wiring against the task-detail feature model.
- `src/features/task-detail/*` and `src/features/task-creation/*` remain feature-owned adapters, schemas, shells, and form surfaces used by the app route modules.
- `npm run lint` includes `scripts/check-browser-source-readability.js`, which scans production browser source in `src/app/` and `src/features/` without the repo readability allowlist.
- Production browser sign-in now starts at `/sign-in` and supports registration email/password auth, with hosted OIDC Authorization Code + PKCE retained when explicitly selected. The current production-auth source of truth is `docs/runbooks/production-auth-status.md`.
- The trusted browser auth code exchange on `POST /auth/session` remains available only as an internal/local fallback when explicitly enabled.
- The app protects `/tasks`, `/tasks?view=board`, `/overview/pm`, `/inbox/:role`, and `/tasks/:taskId`; unauthenticated or expired sessions are redirected back to `/sign-in`.
- PM/admin tokens also unlock the task assignment control, which reads `GET /ai-agents` and writes `PATCH /tasks/:taskId/assignment`.
- Reader-level tokens still see owner metadata on `GET /tasks/:taskId` and `GET /tasks`; they just do not get assignment controls.

Run it locally:
- `npm install`
- `npm run dev`
- open `http://127.0.0.1:5173/`
- configure `VITE_AUTH_PRODUCTION_AUTH_STRATEGY=registration` for the credential UI, configure `VITE_OIDC_DISCOVERY_URL` and `VITE_OIDC_CLIENT_ID` for enterprise sign-in, or keep `VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED=true` to use the internal bootstrap fallback in local/internal environments
- validate production auth before release with `npm run auth:config:check`; for local fallback validation use `node scripts/check-auth-config.js --target development`

Point the browser app at the API:
- same-origin default: leave `VITE_TASK_API_BASE_URL` empty
- separate API origin: set `VITE_TASK_API_BASE_URL=http://127.0.0.1:3000`
- or use the dev proxy: set `VITE_TASK_API_PROXY_TARGET=http://127.0.0.1:3000`
- operators can override the API origin at runtime from the session panel without rebuilding
- browser auth env vars:
- `VITE_OIDC_DISCOVERY_URL`
- `VITE_OIDC_CLIENT_ID`
- optional `VITE_OIDC_REDIRECT_URI`, `VITE_OIDC_SCOPE`, `VITE_OIDC_LOGOUT_URL`, and `VITE_OIDC_LOGOUT_REDIRECT_URI`
- set `VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED=false` for OIDC production browser builds so the internal fallback form is hidden
- if no production IdP exists, use registration auth: set `AUTH_PRODUCTION_AUTH_STRATEGY=registration`, expose `VITE_AUTH_PRODUCTION_AUTH_STRATEGY=registration`, configure email/session/registration variables, and keep both internal bootstrap flags disabled

### Vercel deployment
- This repo can now run on a single Vercel project with the SPA plus serverless API routes.
- The Vercel API adapter lives under `api/` and wraps `lib/audit/http.js`.
- Vercel also includes an explicit `api/v1/[...route].js` entry so `/api/v1/*` versioned task-platform routes resolve consistently in production.
- Vercel additionally exposes explicit `api/v1/tasks.js`, `api/v1/tasks/[...route].js`, and `api/v1/ai-agents.js` handlers so the versioned task-platform routes do not depend on nested catch-all matching quirks.
- To avoid route collisions between SPA paths like `/tasks/...` and API paths like `/tasks/...`, set `VITE_TASK_API_BASE_URL=/backend` in Vercel.
- `vercel.json` rewrites `/backend/*` to the Vercel API functions and falls back non-API browser routes to `index.html`.
- Required backend env vars in Vercel: `DATABASE_URL` plus either OIDC verifier vars (`AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`, `AUTH_JWT_JWKS_URL`) or registration vars (`AUTH_PRODUCTION_AUTH_STRATEGY=registration`, `AUTH_SESSION_SECRET`, `AUTH_EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `AUTH_PUBLIC_APP_URL`, `AUTH_REGISTRATION_MODE`, `AUTH_REGISTRATION_DEFAULT_TENANT`, `AUTH_SESSION_TTL_HOURS=8`, `AUTH_EMAIL_VERIFICATION_TTL_HOURS=24`, `AUTH_PASSWORD_RESET_TTL_MINUTES=30`, and either `VITE_AUTH_PRODUCTION_AUTH_STRATEGY=registration` or documented runtime-config evidence via `AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY=registration`).
- Keep `AUTH_PRODUCTION_AUTH_STRATEGY=registration` for the no-IdP production path. Use `AUTH_PRODUCTION_AUTH_STRATEGY=oidc` only when a provider exists; reserve `internal-bootstrap` for explicitly approved emergency or local/internal fallback use.
- `npm run build` runs `npm run auth:deploy:bootstrap` first. When `DATABASE_URL` is present, that bootstrap applies database migrations under a Postgres advisory lock. When `AUTH_ADMIN_EMAIL` is also present, it seeds or updates the admin account; when `AUTH_ADMIN_INITIAL_PASSWORD` is present with `AUTH_ADMIN_SEED_CREDENTIAL=true`, it also creates/resets the optional seeded password credential. Missing optional admin seed values are logged without blocking migrations.
- Seed the first production registration admin manually only for repair/debugging with `npm run auth:admin:seed` to inspect a redacted dry-run plan, then `npm run auth:admin:seed -- --apply` after the production owner confirms the target identifiers.
- Production `npm run build` then runs the auth gate before Vite emits deployable assets and writes `observability/auth-config-diagnostics.json` with boolean presence status only.
- Validate Vercel production env names with `npm run auth:config:check:vercel`; the script uses name-only `vercel env ls production --format json` output and never pulls or prints values.
- Validate the canonical production auth status and evidence with `npm run auth:status:check`; before moving a production-auth issue to ship, run `npm run auth:status:check -- --require-complete`.
- Capture registration production smoke with `npm run auth:registration:production-smoke`; it writes `observability/registration-auth-production-smoke.json`.
- If production switches to OIDC, use `npm run auth:oidc:production-smoke -- --require-complete` as the OIDC-equivalent production smoke and attach the redacted `observability/oidc-production-smoke.json` artifact.
- After Vercel auth changes, trigger a new production deployment and attach deployment URL or ID, commit, Ready status, build timestamp, selected auth strategy, sign-in smoke result, post-login data check, monitoring evidence, and rollback evidence to the issue or PR.

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
- visual screenshot baselines for sign-in, task workspace, QA role inbox, task creation, and task detail at mobile and desktop breakpoints
- real-browser accessibility gates for keyboard order, focus-visible states, activation keys, labels, landmarks, live-region status text, axe, and contrast
- Chromium Core Web Vitals budget gates for sign-in, task workspace, and task detail using FCP, LCP, CLS, total blocking time, and DOMContentLoaded timing

Current default browser matrix:
- Desktop Chrome (`chromium`)
- Desktop Firefox (`firefox`)
- Mobile Chrome (`mobile-chrome`)
- Mobile Safari / WebKit (`mobile-safari`) in CI through `PLAYWRIGHT_INCLUDE_WEBKIT=1`; local runs can opt in with `PLAYWRIGHT_INCLUDE_WEBKIT=1 npm run test:browser` or opt out with `PLAYWRIGHT_SKIP_WEBKIT=1`.

Browser verification commands and artifacts:
- `npm run test:browser` runs the full Playwright suite with the local default matrix.
- `npm run test:browser:quality` runs the visual, accessibility, and Core Web Vitals quality-gate subset.
- `npm run test:browser:ci` forces the WebKit/Safari project on for CI-equivalent local checks when WebKit is installed.
- Committed visual baselines live under `tests/browser/__screenshots__/browser-quality-visual.browser.spec.ts/`.
- Failure artifacts, traces, screenshots, and attached Core Web Vitals JSON reports are written under `test-results/browser/**`; CI also uploads `playwright-report/**`.

Latest local browser verification evidence from 2026-05-15:
- `npm run test:browser:quality` passed with 35 passing checks and 13 expected skips across Chromium, Firefox accessibility, and mobile Chrome.
- `node scripts/run-playwright.js tests/browser/browser-quality-visual.browser.spec.ts --project=chromium` passed all 10 committed screenshot baselines.

Browser gate flake policy:
- A failing visual, accessibility, or performance gate must stay blocking unless a tracked issue documents an environmental cause and a short-lived advisory downgrade.
- Dynamic fixture data must be stabilized in `tests/browser/browser-quality-fixtures.ts`; production secrets or live credentials are not allowed in browser gate fixtures.
- CI WebKit failures may be opted out only with `PLAYWRIGHT_SKIP_WEBKIT=1` and an explicit issue or PR rationale.

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
- `/api/v1` is the canonical task-platform read/write surface for production, staging, and standard local development.
- Current routes:
- `GET /api/v1/ai-agents`
- `GET /api/v1/tasks`
- `POST /api/v1/tasks`
- `GET /api/v1/tasks/{taskId}`
- `PATCH /api/v1/tasks/{taskId}`
- `PATCH /api/v1/tasks/{taskId}/owner`
- The canonical task layer uses optimistic concurrency and Postgres-backed task records by default.
- Standard local development starts Dockerized Postgres with `npm run dev:postgres:up` and runs host scripts with `DATABASE_URL=postgres://<local-user>:<local-password>@127.0.0.1:5432/<local-database>`.
- File-backed runtime is limited to isolated local/test fallback harnesses and requires an explicit opt-in such as `AUDIT_STORE_BACKEND=file ALLOW_FILE_AUDIT_BACKEND=true`. Production and staging reject file backend startup.
- Compatibility paths such as audit-owned `/tasks/*` workflow routes remain during rollout. They sync through canonical task-platform adapters or are documented in `docs/runbooks/task-platform-rollout.md` until migration criteria allow disabling them behind a flag.
- Drift checks run through `npm run task-platform:verify`; failures include remediation for missing checkpoints, version mismatches, stale projection sequence numbers, and failed sync states.

### Remaining browser verification constraints
- Core Web Vitals budgets run against the local Vite preview fixture routes. Production RUM comparison is still handled after deploy through the production-auth and synthetic-monitoring evidence paths.
- Visual screenshot baselines are pinned to Chromium for deterministic pixel comparison. Firefox, mobile Chrome, and CI WebKit still execute route behavior and accessibility coverage.
- The browser app includes a shared authenticated shell, sign-in flow, task list/board/PM overview/inbox navigation, and task detail routing. Production auth status is tracked in `docs/runbooks/production-auth-status.md`; production-auth issue closure is blocked until `npm run auth:status:check -- --require-complete` passes with fresh redacted smoke evidence for the selected strategy.
