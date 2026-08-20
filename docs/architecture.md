# Architecture

## Scope

This repository is the Engineering Team Software Factory control plane. It is a
production-affecting internal application that combines:

- a Vite/React browser app for sign-in, task creation, task workspaces, role
  inboxes, task detail, assignment, workflow evidence, and admin user flows
- Node HTTP/API adapters under `api/` for the operator-hosted audit API
- audit/event, auth, task-platform, and software-factory services under `lib/`
- PostgreSQL migrations and rollout/backfill scripts under `db/` and `scripts/`
- monitoring dashboards and alerts under `monitoring/`
- repo-governance and software-development standards under `dev-standards/`

The factory runtime of record is the **operator-hosted coordinated stack**
(Dockerized Postgres, audit API, audit workers, UI, forgeadapter, live OpenClaw).
**Hermes is non-critical** for Simple factory claims and live factory-of-record
proof (GitLab #272 / factory autonomy decision Q7): hermes-mock (`:14002`) is
opt-in non-claim smoke only and is not part of required claim topology. Vercel
and cloud Supabase are **not** part of the factory tech stack. Local development
uses Vite for the browser and Docker Compose for PostgreSQL, Pushgateway, audit
API, and audit workers.

Host-persistent launchd services are owned by one canonical repository checkout.
The stack stores that binding outside repository worktrees, records it as
`FACTORY_STACK_REPO_ROOT`, and rejects installation or startup from temporary or
conflicting checkouts. Moving the factory of record requires the explicit
`factory:stack:* -- --rebind-root` operator action; staging uses separate labels
and ports instead of replacing this binding.
Stack health includes configuration integrity: installed launchd definitions
must reference existing paths and agree with the canonical root even when an old
process is still temporarily responding.

In the live coordinated-stack profile, delegated intake/contract Phase 1 remains
separate from the downstream all-agent mode. After Simple policy approval, the API generates the
required repository artifacts and delegates the architect-to-engineer assignment
through live OpenClaw before Forge readiness is evaluated. Forge remains
fail-closed when that immutable assignment event is absent; fixture and non-live
profiles do not inherit these launchd defaults.

Factory execution uses a distinct Forge-facing task record. Its durable seed is
not an API approval request, so the factory explicitly calls the canonical
`POST /tasks/:taskId/execution-contract/architect-engineer-assignment` endpoint
with delegation enabled after seeding and before polling Forge readiness.
PostgreSQL projection catch-up conflicts are retried; other API failures stop the
delivery. Real-evidence mode also verifies that new or previously recorded
assignment events contain live OpenClaw delegation attribution.

## Runtime Model

| Layer | Primary paths | Runtime | Responsibility |
|---|---|---|---|
| Browser app | `src/app/`, `src/features/`, `src/components/` | Vite, React, TypeScript/JavaScript | Authenticated UI, protected routes, task workspace, task detail, role inboxes, task creation, visual token adoption |
| HTTP/API adapters | `api/` | Node HTTP handlers (operator-hosted) | Route requests to auth, audit, and task-platform handlers for the coordinated stack |
| Auth services | `lib/auth/`, `api/auth/`, `db/migrations/009_*`, `db/migrations/011_*` | Node, PostgreSQL | Registration auth, OIDC compatibility, sessions, CSRF, admin seeding, production auth diagnostics |
| Audit/event runtime | `lib/audit/`, `lib/http/`, audit scripts | Node, PostgreSQL by default; file fallback only for explicit isolated dev/test harnesses | Append-only workflow events, projections, outbox, metrics, task detail read models |
| Canonical task platform | `lib/task-platform/`, `db/migrations/006_*`, `db/migrations/010_*` | Node, PostgreSQL by default; file fallback only for explicit isolated dev/test harnesses | `/api/v1` task records, AI-agent ownership, merge-readiness reviews, GitHub check integration |
| Software-factory delegation | `lib/software-factory/`, delegation scripts | Node, optional external runtime bridge | Specialist delegation routing, fallback attribution, live-smoke validation |
| Standards governance | `dev-standards/`, `repo-contract.yaml`, `agent-policy.yaml`, `check-manifest.yaml`, `scripts/verify-*` | Python, Node, Make | Policy validation, change evidence, traceability, docs freshness, design token gates |
| Observability assets | `monitoring/`, `observability/` | Prometheus/Grafana-style JSON/YAML plus generated evidence files | Dashboards, alerts, smoke artifacts, workflow audit logs |

## Request Boundaries

### Browser request path

1. Vite serves the SPA in development; the operator-hosted stack serves `dist`
   (or the Vite dev server) in factory environments.
2. Browser routes such as `/tasks`, `/tasks/create`, `/inbox/:role`, and
   `/tasks/:taskId` are protected by the browser session layer.
3. Browser API calls use same-origin routes by default (coordinated-stack proxy).
4. Authenticated requests carry registration/OIDC session credentials or bearer
   headers built by the browser session utilities.

### API request path

1. The coordinated stack and operator-hosted reverse proxy map browser `/backend/*`
   and `/auth/*` paths to the Node audit API under `api/` / shared `lib/` handlers.
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

### GP-023 validation boundary

GP-023 validates an autonomous delivery after merge by running the repository
lint, unit, and standards scripts. The factory orchestrator carries live
PostgreSQL, auth, feature-flag, OpenClaw, Forge, and trusted-delivery settings,
but those settings are not part of the test contract. Validation subprocesses
therefore receive only operating-system process essentials such as `PATH`,
`HOME`, locale, and temporary-directory values, plus
`ALLOW_FILE_AUDIT_BACKEND=true` and `NODE_ENV=test`. Credentials and product
runtime modes never cross this boundary. This keeps post-merge verification
equivalent to a clean-checkout test run and prevents live service state from
changing unit-test defaults.

## State Ownership

| State | Owner path | Source of truth | Recovery notes |
|---|---|---|---|
| Auth users, credentials, sessions, CSRF | `lib/auth/registration.js`, auth migrations | PostgreSQL in production | `npm run auth:deploy:bootstrap`, `npm run auth:admin:seed`, and production auth smoke scripts |
| Workflow audit events | `lib/audit/` | Append-only audit store, PostgreSQL in production | `npm run audit:migrate`, `npm run audit:rebuild`, projection/outbox workers |
| Task history/detail projections | `lib/audit/` projections | Derived from audit events | Rebuild projections from audit events; stale/degraded freshness must be shown in UI |
| Canonical task records and AI-agent owners | `lib/task-platform/` | PostgreSQL task-platform tables for production, staging, and standard local development | `npm run task-platform:rollout`, `npm run task-platform:backfill`, `npm run task-platform:verify` |
| Merge-readiness reviews | `lib/task-platform/merge-*` | PostgreSQL `merge_readiness_reviews` | GitHub check-run emission is derived; structured review remains authoritative |
| Browser route/session config | `src/app/session.browser.js` | Browser storage plus runtime/build env | Production must hide internal bootstrap unless explicitly approved |
| Design tokens | `DESIGN.md`, generated CSS | `DESIGN.md` | Regenerate with `npm run design:tokens`; enforce with design gates |
| Governance policy | `repo-contract.yaml`, `agent-policy.yaml`, `check-manifest.yaml`, `dev-standards/` | Checked-in policy files | Protected-path changes require human-plus-evidence review |
| Generated evidence | `observability/`, `.artifacts/` | Generated by smoke, test, and standards scripts | Do not commit raw secrets; generated artifacts must be redacted |

## Critical Paths

| Critical path | Entry points | Required evidence |
|---|---|---|
| Production registration auth | `/sign-in`, `/auth/login`, `/auth/me`, `/auth/logout`, password reset and email verification routes | `npm run auth:config:check`, `npm run auth:registration:production-smoke`, `npm run auth:status:check -- --require-complete` |
| Task workspace and detail | `/tasks`, `/tasks?view=board`, `/inbox/:role`, `/tasks/:taskId` | `npm run test:ui`, `npm run test:browser`, task-detail unit/integration tests |
| Audit API and projections | `/tasks/*` audit endpoints, `/metrics`, projection/outbox scripts | audit unit, contract, e2e, security, performance, and chaos tests |
| Canonical task-platform API | `/api/v1/tasks`, `/api/v1/ai-agents`, merge-readiness review routes | task-platform unit/integration/contract/security tests and rollout verification |
| Coordinated factory stack deploy | Docker Compose / operator host, `api/`, `dist/`, workers | `npm run dev:golden-path:up` (local), `npm run build`, auth deploy bootstrap, stack smokes |
| Design-token enforcement | `DESIGN.md`, token-generated CSS, migrated CSS modules | `npm run design:tokens:check`, `npm run design:tokens:enforce`, `npm run design:audit:check`, `npm run design:change-guard` |
| Governance/protected paths | `repo-contract.yaml`, `agent-policy.yaml`, `check-manifest.yaml`, `dev-standards/`, `.github/workflows/`, `Makefile`, `DESIGN.md` | `make verify`, `npm run standards:check`, change metadata, approval proof, traceability, docs freshness |

## Governance Runtime Contract

The governance contract is intentionally aligned to the application runtime, not
only to the Python standards tooling. `repo-contract.yaml` declares the
JavaScript/TypeScript/Node/Vite/React/PostgreSQL and Python standards runtime,
the owned app/API/auth/audit/task-platform/browser/monitoring paths, and the
source files that can drift when runtime gates change.

`check-manifest.yaml` declares the merge-check command set. The Makefile maps
those checks to the real local commands:

| Make target | Runtime and standards gates |
|---|---|
| `make lint` | standards policy validators and `npm run lint` |
| `make typecheck` | Python standards compile check and `npm run typecheck` |
| `make test` | Python standards tests, `npm run test:unit`, and `npm run test:browser` |
| `make build` | Python standards compile check and `npm run build` |
| `make verify` | design gates, lint, typecheck, test, build, `npm run standards:check`, artifact provenance, and test policy |

## External Systems

| System | Used by | Failure posture |
|---|---|---|
| Operator-hosted coordinated stack | Browser UI, API, workers, forgeadapter, OpenClaw | Restart stack services, fix env, rerun auth/build and factory smokes |
| Operator-hosted PostgreSQL | Auth, audit, task platform, projections | Stop rollout, inspect migrations/backfill, run rebuild/verify scripts before retry |
| Docker Compose Postgres | Local development, integration tests, factory proofs | The launchd watcher starts a stopped active OrbStack VM with `orbctl start --all`, waits for Docker, and restores the named-volume container; fail closed if engine recovery fails |
| Resend | Registration email verification and password reset when configured | Preserve generic responses; inspect redacted auth smoke and registration alert metrics |
| OIDC provider | Explicit OIDC production strategy only | Registration remains canonical unless production switches to OIDC with fresh evidence |
| GitHub | Issues, PRs, merge-readiness checks, branch protection evidence | GitHub check emission must fail closed; branch-protection verifier is read-only |
| Pushgateway | Local audit metrics push | Metrics push failure should not corrupt audit state; inspect worker logs |
| Browser engines | Playwright verification | Chromium, Firefox, and mobile Chrome run by default; WebKit is opt-in unless promoted |

## Canonical Task Runtime Consolidation

The canonical task source of truth is the Postgres-backed `/api/v1` task
platform. Production, staging, and standard local development must use
`DATABASE_URL` with Dockerized or other operator-hosted Postgres. Cloud Supabase
is not part of the factory stack. Runtime startup guards reject missing Postgres
configuration unless a local/test file fallback is explicitly enabled with
`AUDIT_STORE_BACKEND=file` and `ALLOW_FILE_AUDIT_BACKEND=true`.

Compatibility routes are temporary adapters:

| Route family | Owner | Current behavior | Deprecation criteria |
|---|---|---|---|
| `/tasks/*` audit workflow routes | Audit/event runtime owner | Remain for workflow history, task detail, assignment, and legacy clients; write events sync into canonical task records where supported | Active clients are migrated to `/api/v1` or documented projection-only use, drift stays zero for the agreed window, and rollback no longer depends on projection-first reads |
| `/api/tasks/*` and `/api/ai-agents` compatibility prefixes | API adapter owner | Delegate to the same shared handler as the documented task routes for browser/docs compatibility | Browser and docs use `/backend/api/v1` or `/api/v1` consistently and route telemetry shows no compatibility traffic |
| File-backed store/service factories | Test harness owner | Available only through explicit fallback flags or direct isolated test construction | No production/staging usage; local standard workflow stays Dockerized Postgres |

Drift is governed by `npm run task-platform:verify`, which compares canonical
task rows with sync checkpoints and reports remediation for missing
checkpoints, version mismatches, stale projection sequence numbers, and failed
sync statuses.

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
- `make standards-policy-gates` runs the standards-only policy validators.
- `make verify` runs the aggregate local ship gate for design, standards, Node/Vite/browser, and Python standards evidence.

## Diagrams

- Workflow: `docs/diagrams/workflow-architecture-runbooks.mmd`
- Container architecture: `docs/diagrams/architecture-architecture-runbooks.mmd`
- Governance runtime workflow: `docs/diagrams/workflow-governance-runtime-gates.mmd`
- Governance runtime architecture: `docs/diagrams/architecture-governance-runtime-gates.mmd`
- Existing domain diagrams: `docs/diagrams/`
### Prospective trusted Simple cohort policy

`simple-trusted-cohort.v2` applies to closeouts generated on or after 2026-08-19. Earlier evidence keeps its v1 evaluation. A v2 closeout is trusted only when it points to a repository-contained `trusted-simple-close-evidence.v1` package by relative path and SHA-256; the package must validate as a real merged PR and carry the same task id. This makes the cohort reproducible without rewriting historical decisions.
### Trusted-close authority timeline

Prospective cohort rows retain the authoritative `task.pm_architect_human_review_recorded` and `task.execution_contract_approved` event identities, actor provenance, roles, and timestamps from task history. The closeout classifies intervention events against the approval timestamp. Missing human role provenance, missing approval identity, ambiguous intervention time, or any post-approval intervention makes a v2 row untrusted.
### Trusted Simple execution boundary

Trusted Simple execution is a PR lifecycle guarantee, not a hosted-deployment claim. After the human PM/Architect approval event, live OpenClaw owns implementation in an isolated worktree. The coordinator admits only the agent-returned real branch, head SHA, and PR URL; verifies protected checks for that exact head; emits the factory-owned `Merge readiness` check directly or through the permissioned workflow-dispatch fallback; merges through GitHub; and records a content-addressed close package before closeout. Hosted staging artifacts, soak evidence, and runtime-cutover manifests remain separate release gates and cannot be inferred from a trusted local close.

Durable queue ownership spans the complete trusted delivery attempt. The shared one-hour lease default exceeds the implementer's 31-minute runtime allowance, leaving headroom for hosted checks while preserving fail-closed release semantics if ownership is actually lost.

The queued delivery scope is also the source of truth for the implementer's
first pull-request submission. Phase-runner options carry the repository,
source issue URL, and expected changed-file list into the trusted OpenClaw
prompt. The prompt requires the complete governed PR-body schema before the PR
is opened, a closing reference to the source issue, and evidence paths drawn
only from the real diff. This makes a passing initial metadata run part of the
trusted execution contract instead of relying on a later body-repair cycle.

Trusted QA is an evidence-review boundary, not a synthetic approval. The coordinator supplies the exact repository, branch, implementation SHA, PR URL, and expected file scope to the live QA agent. QA may inspect those artifacts through read-only Git and GitHub commands, but cannot mutate the PR or release gates; a rejection routes the same immutable PR identity to the Sr correction agent. Both runtime roles therefore require scoped unattended gateway execution while the coordinator continues to reject missing or malformed branch, SHA, and PR evidence.

### Cohort residual arithmetic

The trusted Simple residual solves both thresholds under an explicit all-future-closes-are-trusted assumption. It reports the larger of the count shortfall and `ceil((targetRate × closed - trusted) / (1 - targetRate))`, plus projected totals and rate. A 100% target is reported as unreachable by adding closes when any existing close is untrusted.
### Stable cohort report provenance

The canonical cohort report lives at `docs/reports/SIMPLE_TRUSTED_COHORT_REPORT.md`. Its JSON and Markdown carry the exact Git revision, policy and generator identity, a sorted source inventory with per-file SHA-256 and byte size, and an aggregate source-set digest. A caller-supplied generation timestamp supports deterministic rebuilds; dated legacy reports remain immutable historical snapshots.
### Dependency installation boundary

The repository commits `package.json` and `package-lock.json`, not `node_modules/`. Persistent launchd and staging deployments install dependencies with `npm ci` at the exact revision. This prevents stale native binaries or package metadata from silently changing startup behavior while preserving reproducible dependency resolution.

### Isolated staging factory profile

The hosted staging release uses `FACTORY_STACK_PROFILE=staging`. That profile has independent launchd
labels, ports, root binding, state, logs, and database configuration; it cannot replace the default
factory-of-record binding. The deployer accepts only an exact commit SHA in a persistent release root,
then requires both local topology health and a non-local HTTPS `/health` response before it emits
revision-bound staging evidence.
