# Standards Compliance Checklist

## Linked Standards
- Standards document: `docs/standards/software-development-standards.md`
- Required gap statement format: `Gap observed: X. Documented rationale: Y (source Z).`

## Change Metadata
- Change or task ID: Issue #155, canonical task runtime and persistence consolidation.
- Owner: Codex implementation agent.
- Date: 2026-05-15.
- Scope summary: Tightened runtime backend guardrails, made Postgres the guarded runtime default, added canonical task-platform drift detection, updated rollout docs, diagrams, feature flags, monitoring contracts, and verification tests.

## Standards Alignment
- Applicable standards areas: architecture and design; coding and code quality; testing and quality assurance; deployment and release; observability and monitoring; authentication and secret handling; team and process.
- Standards baseline reviewed: `docs/standards/software-development-standards.md`.
- Evidence expected for this change: runtime config checks, drift checks, compatibility/deprecation documentation, local Postgres setup docs, monitoring artifacts, and automated tests.
- Gap observed: Full production rollout, live dashboard screenshots, and load evidence require deployment environment access beyond local repo execution. Documented rationale: Changes must be verifiable, reversible, and low-risk through progressive rollout and operational evidence (source https://github.com/wiinc1/engineering-team/blob/main/docs/standards/software-development-standards.md).

## Architecture and Design
- Applicable: Yes.
- Evidence in this change: `docs/architecture.md`, `docs/runbooks/task-platform-rollout.md`, `docs/diagrams/workflow-canonical-runtime-persistence-consolidation.mmd`, and `docs/diagrams/architecture-canonical-runtime-persistence-consolidation.mmd` identify Postgres-backed `/api/v1` as the canonical source of truth and document compatibility route owners.
- Gap observed: Compatibility routes remain during migration. Documented rationale: Progressive rollout with reversible changes reduces deployment risk (source https://github.com/wiinc1/engineering-team/blob/main/docs/standards/software-development-standards.md).
- Documented rationale and source: Compatibility retirement is gated on client migration, zero drift, and rollback independence.

## Coding and Code Quality
- Applicable: Yes.
- Evidence in this change: Runtime backend guard logic is centralized in `lib/audit/config.js`; drift rules are isolated in `lib/task-platform/drift.js`; rollout verification consumes the shared drift module.
- Gap observed: Legacy compact audit/task-platform files remain in the maintainability baseline. Documented rationale: The repo uses a maintainability ratchet to avoid a high-risk big-bang rewrite of existing runtime surfaces (source https://github.com/wiinc1/engineering-team/blob/main/docs/standards/software-development-standards.md).
- Documented rationale and source: New authored files stay small and focused; legacy compaction is not expanded.

## Testing and Quality Assurance
- Applicable: Yes.
- Evidence in this change: `tests/unit/audit-config.test.js`, `tests/unit/task-platform-drift.test.js`, and `tests/property/task-platform-drift.property.test.js` cover runtime backend defaults, file fallback guardrails, structured fallback warning metadata, drift categories, and generated drift invariants.
- Gap observed: Docker Postgres integration and full browser/performance/load suites must be run in the target environment for final production evidence. Documented rationale: Testing should combine unit, integration, end-to-end, performance, security, and failure testing (source https://github.com/wiinc1/engineering-team/blob/main/docs/standards/software-development-standards.md).
- Documented rationale and source: Local focused evidence is recorded in the final handoff; production evidence is required before rollout closeout.

## Deployment and Release
- Applicable: Yes.
- Evidence in this change: `docs/runbook.md` and `docs/runbooks/task-platform-rollout.md` document Dockerized Postgres local setup, startup failure behavior, rollback posture, drift remediation, and `FF_CANONICAL_TASK_RUNTIME`.
- Gap observed: No production deployment was executed in this local workflow. Documented rationale: Progressive rollouts and reversible changes reduce risk (source https://github.com/wiinc1/engineering-team/blob/main/docs/standards/software-development-standards.md).
- Documented rationale and source: Roll out local Postgres default, then staging, then production after drift and synthetic checks are green.

## Observability and Monitoring
- Applicable: Yes.
- Evidence in this change: Backend selection emits structured `ff_canonical_task_runtime` logs; monitoring contracts include backend mode, drift, and fallback metrics in `monitoring/dashboards/audit-foundation.json` and `monitoring/alerts/audit-foundation.yml`.
- Gap observed: Live dashboard/alert screenshots were not captured locally. Documented rationale: Observability must measure user experience and alerts must map to user pain (source https://github.com/wiinc1/engineering-team/blob/main/docs/standards/software-development-standards.md).
- Documented rationale and source: Verify metrics after deployment and attach dashboard evidence to the rollout issue or PR.

## Authentication and Secret Handling
- Applicable: Yes.
- AuthN/AuthZ surfaces changed: No authentication or authorization logic changed.
- Secret, token, cookie, password, or PII redaction evidence: Docs use placeholder database URLs and do not include secrets.
- Abuse-control or rate-limit evidence: Not applicable; no auth or rate-limit surface changed.
- Rollback or removal impact: Revert runtime guard/doc/drift changes or disable canonical cutover only when compatibility paths remain safe.
- Gap observed: No auth behavior gap observed. Documented rationale: Threat modeling and security-by-design reviews must protect production config and secrets (source https://github.com/wiinc1/engineering-team/blob/main/docs/standards/software-development-standards.md).
- Documented rationale and source: Production/staging file backend is rejected by startup guard tests.

## Team and Process
- Applicable: Yes.
- Evidence in this change: README, feature-flag docs, architecture/runbook updates, diagrams, and this checklist publish the canonical source-of-truth statement and handoff details.
- Gap observed: Operator signoff and live rollout evidence remain follow-up. Documented rationale: Documentation as code must be versioned and reviewed with the code it describes (source https://github.com/wiinc1/engineering-team/blob/main/docs/standards/software-development-standards.md).
- Documented rationale and source: Handoff includes commands, docs, rollback, and remediation paths.

## Required Evidence
- Commands run:
  - `npm run dev:postgres:up` attempted; blocked because an existing unrelated local container already owned host port `5432`.
  - `docker run --rm -d --name engineering-team-postgres-155 -e POSTGRES_USER=audit -e POSTGRES_PASSWORD=audit -e POSTGRES_DB=engineering_team -p 15432:5432 postgres:16`
  - `docker exec engineering-team-postgres-155 pg_isready -U audit -d engineering_team`
  - `PGSSLMODE=disable DATABASE_URL=postgres://audit:audit@127.0.0.1:15432/engineering_team npm run audit:migrate`
  - `PGSSLMODE=disable DATABASE_URL=postgres://audit:audit@127.0.0.1:15432/engineering_team npm run task-platform:verify` (`database.drift.ok=true`; API smoke skipped because no local bearer token/base URL was configured)
  - `PGSSLMODE=disable DATABASE_URL=postgres://audit:audit@127.0.0.1:15432/engineering_team npm run test:integration:postgres`
  - `npm run test:integration:api`
  - `npm run test:e2e`
  - `npm run test:contract`
  - `npm run test:security`
  - `npm run test:performance`
  - `npm test`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run standards:check`
- Tests added or updated:
  - `tests/unit/audit-config.test.js`
  - `tests/unit/task-platform-drift.test.js`
  - `tests/property/task-platform-drift.property.test.js`
- Rollout or rollback notes:
  - Standard local and production runtime uses Postgres. File fallback requires explicit local/test opt-in and is rejected in production/staging.
  - Rollback keeps compatibility routes available, disables canonical cutover only when safe, and runs projection rebuild/backfill after root-cause review.
- Docs updated:
  - `README.md`
  - `docs/architecture.md`
  - `docs/runbook.md`
  - `docs/runbooks/task-platform-rollout.md`
  - `docs/feature-flags.md`
  - `docs/diagrams/workflow-canonical-runtime-persistence-consolidation.mmd`
  - `docs/diagrams/architecture-canonical-runtime-persistence-consolidation.mmd`
