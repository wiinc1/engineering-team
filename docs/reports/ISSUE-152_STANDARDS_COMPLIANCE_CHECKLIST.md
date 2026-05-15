# Standards Compliance Checklist

## Linked Standards

- Standards document: `docs/standards/software-development-standards.md`
- Required gap statement format: `Gap observed: X. Documented rationale: Y (source Z).`

## Change Metadata

- Change or task ID: Issue #152, Build Execution Contract Refinement Workflow.
- Owner: Codex implementation agent.
- Date: 2026-05-15.
- Scope summary: Added the versioned Execution Contract section-review route, route-level role enforcement, reviewer contribution persistence, issue-required OpenAPI/diagram/monitoring/runbook artifacts, and focused unit/contract/security coverage.

## Standards Alignment

- Applicable standards areas: architecture and design; coding and code quality; testing and quality assurance; deployment and release; observability and monitoring; authentication and secret handling; team and process.
- Standards baseline reviewed: `docs/standards/software-development-standards.md`.
- Evidence expected for this change: issue-required API, workflow, schema, architecture, monitoring, alert, runbook, and compliance artifacts; reviewer routing and approval persistence tests; stale-version and reviewer-spoofing negative tests; full local verification matrix.
- Gap observed: None. Documented rationale: issue #152 requires reviewer-owned Execution Contract refinement with durable audit history before implementation dispatch (source https://github.com/wiinc1/engineering-team/issues/152).

## Architecture and Design

- Applicable: yes.
- Evidence in this change: `lib/audit/execution-contract-refinement.js` isolates section-review request normalization and reviewer role checks; `lib/audit/http.js` exposes the `/api/v1/tasks/{taskId}/execution-contract/{version}/sections/{sectionId}/review` workflow route; architecture, schema, and workflow diagrams document the route, data, and dispatch gate.
- Gap observed: None. Documented rationale: the new route builds on existing append-only Execution Contract versioning rather than introducing a parallel persistence model (source `docs/standards/software-development-standards.md`).

## Coding and Code Quality

- Applicable: yes.
- Evidence in this change: reviewer role normalization and draft-body construction are in a small focused module; HTTP changes delegate to that module and reuse existing contract versioning, task locking, feature flag, and canonical task sync helpers.
- Gap observed: The legacy audit HTTP file remains compact/minified and allowlisted. Documented rationale: this change adds a narrow route to the existing server surface while avoiding a high-risk broad reformat of unrelated audit HTTP logic (source `config/lint-source-allowlist.json`).

## Testing and Quality Assurance

- Applicable: yes.
- Evidence in this change: `tests/unit/execution-contract-refinement.test.js` covers section-review draft construction and role resolution; `tests/contract/execution-contract-refinement.contract.test.js` covers OpenAPI tokens plus runtime section review, reload persistence, stale-version rejection, and approved-version invalidation; `tests/security/execution-contract-refinement.security.test.js` covers non-reviewer and role-spoofing rejection.
- Gap observed: None. Documented rationale: issue #152 requires acceptance coverage for reviewer contribution persistence, blocking/stale states, and role boundaries (source https://github.com/wiinc1/engineering-team/issues/152).

## Deployment and Release

- Applicable: yes.
- Evidence in this change: the route is behind existing `ff_execution_contracts` enforcement and audit task locking; rollback is documented in `docs/runbooks/execution-contract-refinement.md`.
- Gap observed: Production deployment verification has not been run in this local issue workflow. Documented rationale: production deployment checks require post-merge deploy URL, runtime smoke evidence, dashboard review, and alert watch after CI release (source `docs/runbooks/execution-contract-refinement.md`).

## Observability and Monitoring

- Applicable: yes.
- Evidence in this change: section-review and material-version counters are recorded in audit store metrics; dashboard and alert artifacts were added at `monitoring/dashboards/execution-contract-refinement.json` and `monitoring/alerts/execution-contract-refinement.yml`.
- Gap observed: Event-type-specific Prometheus counters are not introduced for every Execution Contract audit event. Documented rationale: the existing audit store records immutable event history while focused metrics cover the new section-review path and existing audit metrics cover write failures/projection lag (source `docs/runbooks/audit-foundation.md`).

## Authentication and Secret Handling

- Applicable: yes.
- AuthN/AuthZ surfaces changed: the new section-review route accepts bearer-authenticated reviewer, PM, or admin callers.
- Secret, token, cookie, password, or PII redaction evidence: no raw token or secret logging was added; security tests verify unauthorized and spoofed reviewer submissions are rejected.
- Abuse-control or rate-limit evidence: the route reuses existing request body size limits, task lock checks, tenant-scoped auth context, and idempotent audit writes.
- Rollback or removal impact: remove the route and route tests, keep existing contract versions readable; fallback PM-owned versioning remains on `POST /tasks/{id}/execution-contract`.
- Gap observed: None. Documented rationale: reviewer mutations must be role-scoped to prevent cross-role approval spoofing (source issue #152).

## Team and Process

- Applicable: yes.
- Evidence in this change: README, root runbook, audit runbook, dedicated refinement runbook, OpenAPI, diagrams, monitoring, alerts, and this checklist were updated together.
- Gap observed: None. Documented rationale: workflow changes need durable operator and reviewer documentation (source `docs/standards/software-development-standards.md`).

## Required Evidence

- Commands run:
  - `node -c lib/audit/execution-contract-refinement.js` - passed.
  - `node -c lib/audit/http.js` - passed.
  - `node --test tests/unit/execution-contract-refinement.test.js tests/contract/execution-contract-refinement.contract.test.js tests/security/execution-contract-refinement.security.test.js` - passed, 6 tests.
  - `npm run lint` - passed.
  - `npm run typecheck` - passed.
  - `npm run standards:check` - passed.
  - `npm run ownership:lint` - passed.
  - `npm run change:check` - passed.
  - `git diff --check` - passed.
  - `npm run test:unit` - passed, including 329 Node unit tests and 144 Vitest/UI tests.
  - `npm run test:contract` - passed, 13 tests.
  - `npm run test:e2e` - passed, 30 tests.
  - `npm run test:ui` - passed, 144 Vitest/UI tests plus 4 role/PM integration tests.
  - `npm run test:browser` - passed, 105 Playwright tests.
  - `npm run test:security` - passed, 29 tests.
  - `npm test` - passed.
  - `npm run build` - passed; deploy auth bootstrap remained disabled by local env.
- Tests added or updated:
  - `lib/audit/execution-contract-refinement.js`
  - `tests/unit/execution-contract-refinement.test.js`
  - `tests/contract/execution-contract-refinement.contract.test.js`
  - `tests/security/execution-contract-refinement.security.test.js`
  - `package.json` unit test wiring.
- Rollout or rollback notes: rollout follows existing `ff_execution_contracts`; rollback removes reviewer section submissions and uses PM-owned contract versioning until the route is restored.
- Docs updated: README, root runbook, audit runbook, dedicated refinement runbook, OpenAPI, workflow/schema/architecture diagrams, dashboard, alerts, and this checklist.
