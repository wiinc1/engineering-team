# Architecture

## Scope

This repository is the Engineering Team Software Factory control plane. It is a
production-affecting internal application that combines:

- a Vite/React browser app for sign-in, task creation, task workspaces, role
  inboxes, task detail, assignment, workflow evidence, and admin user flows
- Node serverless/API adapters under `api/`
- audit/event, auth, task-platform, and software-factory services under `lib/`
- PostgreSQL migrations and rollout/backfill scripts under `db/` and `scripts/`
- monitoring dashboards and alerts under `monitoring/`
- repo-governance and software-development standards under `dev-standards/`

The primary hosted deployment unit is the Vercel project declared in
`vercel.json`. Local development uses Vite for the browser and the Docker
Compose stack for PostgreSQL, Pushgateway, audit API, and audit workers.

## Runtime Model

| Layer | Primary paths | Runtime | Responsibility |
|---|---|---|---|
| Browser app | `src/app/`, `src/features/`, `src/components/` | Vite, React, TypeScript/JavaScript | Authenticated UI, protected routes, task workspace, task detail, role inboxes, task creation, visual token adoption |
| Serverless API adapters | `api/` | Vercel Node functions | Route requests to auth, audit, and task-platform handlers while preserving SPA rewrites |
| Auth services | `lib/auth/`, `api/auth/`, `db/migrations/009_*`, `db/migrations/011_*` | Node, PostgreSQL | Registration auth, OIDC compatibility, sessions, CSRF, admin seeding, production auth diagnostics |
| Audit/event runtime | `lib/audit/`, `lib/http/`, audit scripts | Node, PostgreSQL or file fallback for isolated tests | Append-only workflow events, projections, outbox, metrics, task detail read models |
| Canonical task platform | `lib/task-platform/`, `db/migrations/006_*`, `db/migrations/010_*` | Node, PostgreSQL or explicit local fallback | `/api/v1` task records, AI-agent ownership, merge-readiness reviews, GitHub check integration |
| Software-factory delegation | `lib/software-factory/`, delegation scripts | Node, optional external runtime bridge | Specialist delegation routing, fallback attribution, live-smoke validation |
| Standards governance | `dev-standards/`, `repo-contract.yaml`, `agent-policy.yaml`, `check-manifest.yaml`, `scripts/verify-*` | Python, Node, Make | Policy validation, change evidence, traceability, docs freshness, design token gates |
| Observability assets | `monitoring/`, `observability/` | Prometheus/Grafana-style JSON/YAML plus generated evidence files | Dashboards, alerts, smoke artifacts, workflow audit logs |

## Request Boundaries

### Browser request path

1. Vite serves the SPA in development; Vercel serves `dist` in production.
2. Browser routes such as `/tasks`, `/tasks/create`, `/inbox/:role`, and
   `/tasks/:taskId` are protected by the browser session layer.
3. Browser API calls use same-origin routes by default or `/backend` on Vercel.
4. Authenticated requests carry registration/OIDC session credentials or bearer
   headers built by the browser session utilities.

### API request path

1. Vercel rewrites `/backend/*` to `/api/*` and `/auth/*` to `/api/auth/*`.
2. API adapters delegate to shared Node handlers instead of duplicating
   business logic.
3. Auth checks derive tenant, actor, and role claims before task or audit reads.
4. Write paths append durable audit events, update canonical task records, or
   both, depending on the endpoint.

### Worker path

1. Audit projection and outbox workers run through `scripts/run-audit-workers.js`
   or the `audit-workers` Docker Compose service.
2. Projection workers update task history/state/read-model data.
3. Outbox workers publish durable side effects and metrics.
4. Pushgateway integration is local/development support for metrics export.

## State Ownership

| State | Owner path | Source of truth | Recovery notes |
|---|---|---|---|
| Auth users, credentials, sessions, CSRF | `lib/auth/registration.js`, auth migrations | PostgreSQL in production | `npm run auth:deploy:bootstrap`, `npm run auth:admin:seed`, and production auth smoke scripts |
| Workflow audit events | `lib/audit/` | Append-only audit store, PostgreSQL in production | `npm run audit:migrate`, `npm run audit:rebuild`, projection/outbox workers |
| Task history/detail projections | `lib/audit/` projections | Derived from audit events | Rebuild projections from audit events; stale/degraded freshness must be shown in UI |
| Canonical task records and AI-agent owners | `lib/task-platform/` | PostgreSQL task-platform tables for production/staging | `npm run task-platform:rollout`, `npm run task-platform:backfill`, `npm run task-platform:verify` |
| Merge-readiness reviews | `lib/task-platform/merge-*` | PostgreSQL `merge_readiness_reviews` | GitHub check-run emission is derived; structured review remains authoritative |
| Browser route/session config | `src/app/session.browser.js` | Browser storage plus runtime/build env | Production must hide internal bootstrap unless explicitly approved |
| Design tokens | `DESIGN.md`, generated CSS | `DESIGN.md` | Regenerate with `npm run design:tokens`; enforce with design gates |
| Governance policy | `repo-contract.yaml`, `agent-policy.yaml`, `check-manifest.yaml`, `dev-standards/` | Checked-in policy files | Protected-path changes require human-plus-evidence review |
| Generated evidence | `observability/`, `.artifacts/` | Generated by smoke, test, and standards scripts | Do not commit raw secrets; generated artifacts must be redacted |

## Critical Paths

| Critical path | Entry points | Required evidence |
|---|---|---|
| Production registration auth | `/sign-in`, `/auth/login`, `/auth/me`, `/auth/logout`, password reset and email verification routes | `npm run auth:config:check`, `npm run auth:config:check:vercel`, `npm run auth:registration:production-smoke`, `npm run auth:status:check -- --require-complete` |
| Task workspace and detail | `/tasks`, `/tasks?view=board`, `/inbox/:role`, `/tasks/:taskId` | `npm run test:ui`, `npm run test:browser`, task-detail unit/integration tests |
| Audit API and projections | `/tasks/*` audit endpoints, `/metrics`, projection/outbox scripts | audit unit, contract, e2e, security, performance, and chaos tests |
| Canonical task-platform API | `/api/v1/tasks`, `/api/v1/ai-agents`, merge-readiness review routes | task-platform unit/integration/contract/security tests and rollout verification |
| Vercel deployment | `vercel.json`, `api/`, `dist/` | `npm run build`, auth deploy bootstrap, production smoke evidence |
| Design-token enforcement | `DESIGN.md`, token-generated CSS, migrated CSS modules | `npm run design:tokens:check`, `npm run design:tokens:enforce`, `npm run design:audit:check`, `npm run design:change-guard` |
| Governance/protected paths | `repo-contract.yaml`, `agent-policy.yaml`, `check-manifest.yaml`, `dev-standards/`, `.github/workflows/`, `Makefile`, `DESIGN.md` | `make verify`, `npm run standards:check`, change metadata, approval proof, traceability, docs freshness |

## External Systems

| System | Used by | Failure posture |
|---|---|---|
| Vercel | Browser and serverless deployment | Roll back to previous deployment or fix env names, then rerun auth/build gates |
| PostgreSQL or Supabase Postgres | Auth, audit, task platform, projections | Stop rollout, inspect migrations/backfill, run rebuild/verify scripts before retry |
| Docker Compose Postgres | Local development and integration tests | Reset with `npm run dev:postgres:reset` if local state is disposable |
| Resend | Registration email verification and password reset when configured | Preserve generic responses; inspect redacted auth smoke and registration alert metrics |
| OIDC provider | Explicit OIDC production strategy only | Registration remains canonical unless production switches to OIDC with fresh evidence |
| GitHub | Issues, PRs, merge-readiness checks, branch protection evidence | GitHub check emission must fail closed; branch-protection verifier is read-only |
| Pushgateway | Local audit metrics push | Metrics push failure should not corrupt audit state; inspect worker logs |
| Browser engines | Playwright verification | Chromium, Firefox, and mobile Chrome run by default; WebKit is opt-in unless promoted |

## Protected Paths

Protected paths are declared in `repo-contract.yaml` and `agent-policy.yaml`:

- `repo-contract.yaml`
- `agent-policy.yaml`
- `check-manifest.yaml`
- `dev-standards/`
- `.github/workflows/`
- `Makefile`
- `DESIGN.md`

Changes to these paths require a human-plus-evidence review posture, current
change metadata, approval proof, traceability, and documentation freshness
evidence. Emergency changes must preserve evidence first, even when the
implementation is a rollback.

## Verification Map

Use `docs/runbook.md` for exact operator commands. At the architecture level:

- `npm run lint` checks repository lint targets.
- `npm run typecheck` runs TypeScript type checking.
- `npm run test:unit` runs Node and Vitest unit/UI coverage.
- `npm run test:browser` runs Playwright browser coverage.
- `npm test` runs the full Node/browser quality suite.
- `npm run standards:check` runs standards, maintainability, and coverage policy checks.
- `make verify` runs the standards governance gate and DESIGN.md local gates.

## Diagrams

- Workflow: `docs/diagrams/workflow-architecture-runbooks.mmd`
- Container architecture: `docs/diagrams/architecture-architecture-runbooks.mmd`
- Existing domain diagrams: `docs/diagrams/`
