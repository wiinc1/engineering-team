# Standards Compliance Checklist

## Change Metadata
- Change or task ID: Issue #203, Projects as task planning containers.
- Owner: Codex implementation agent.
- Date: 2026-05-15.
- Scope summary: Added tenant-scoped Projects, task membership, task workspace project filtering, RBAC, persistence, docs, diagrams, and verification coverage.

## Standards Alignment
- Standards baseline reviewed: `docs/standards/software-development-standards.md`.
- Applicable standards areas: architecture and design; coding and code quality; testing and quality assurance; deployment and release; observability and monitoring; team and process.
- Evidence expected for this change: Project API and UI implementation diffs, tenant-scoped migration and rollback, OpenAPI/runbook/diagram documentation, RBAC and tenant-isolation tests, project performance coverage, browser visual baseline updates for changed navigation, and standards gate output.
- Gap observed: Legacy browser shell and audit HTTP source still contain baselined long functions. Documented rationale: This change isolates new Projects code in new modules and avoids expanding legacy long functions beyond baseline (source https://github.com/wiinc1/engineering-team/blob/main/docs/standards/software-development-standards.md).

## Architecture and Design
- Evidence: `lib/task-platform/projects.js`, `lib/task-platform/projects-postgres.js`, `lib/audit/projects-http.js`, `src/app/routes/ProjectsRoute.jsx`, and diagrams under `docs/diagrams/*projects-planning-containers.mmd`.
- Data model: `db/migrations/012_projects.sql` adds `projects`, `tasks.project_id`, and `project_mutations`; rollback is in `012_projects.down.sql`.
- Tenant isolation: all Project API calls derive `tenantId` from authenticated claims and include it in persistence keys/queries.

## Coding and Code Quality
- Evidence: New authored modules are below source-file caps and avoid adding to legacy maintainability debt.
- RBAC: `projects:write` is granted only to PM/Admin roles in `lib/audit/authz.js`; readers use state-read only.
- Feature flag: `FF_PROJECTS=0|false|off|disabled` disables Project routes with `feature_disabled`.

## Testing and QA
- Tests added:
  - `tests/unit/task-platform-projects.test.js`
  - `tests/contract/projects-openapi.contract.test.js`
  - `tests/security/projects-security.test.js`
  - `tests/performance/projects-performance.test.js`
  - `src/app/AppRouteModel.test.tsx` updated for `project` query state
- Coverage areas: CRUD, optimistic concurrency, task membership, tenant isolation, reader write denial, OpenAPI/migration contract, and list/hydration performance.

## Deployment and Release
- Apply `npm run audit:migrate` before enabling Projects in Postgres-backed environments.
- Rollback: set `FF_PROJECTS=0` to disable the API/UI workflow, then apply `db/migrations/012_projects.down.sql` only after confirming no active task membership is needed.
- Runbook updated: `docs/runbooks/task-platform-rollout.md`.

## Observability and Monitoring
- Evidence: Project HTTP wrapper increments `feature_projects_requests_total`, `feature_projects_errors_total`, and `feature_projects_audit_errors_total` when the audit store supports metrics.
- Audit provenance: `project_mutations` records create/update/attach/detach metadata; task attach/detach also attempts audit events.

## Authentication and Secret Handling
- AuthN: uses existing bearer/cookie-session path through `getRequestContext`.
- AuthZ: reader can list/read; PM/Admin can create/update/attach/detach.
- PII/secrets: no new secret storage or token logging added.

## Required Evidence
- Commands run: `node scripts/check-maintainability.js --json`; `node --test tests/unit/task-platform-projects.test.js`; `node --test tests/contract/projects-openapi.contract.test.js`; `node --test tests/security/projects-security.test.js`; `node --test tests/performance/projects-performance.test.js`; `npx vitest run src/app/AppRouteModel.test.tsx src/app/AppNavigation.test.tsx`; `npm run lint`; `npm run typecheck`; `npm run ownership:lint`; `npm run change:check`; `npm run test:contract`; `npm run test:security`; `npm run test:performance`; `npm run test:ui:vitest`; `npm run standards:check`; `npm run test:unit`; `node scripts/run-playwright.js tests/browser/browser-quality-visual.browser.spec.ts --project=chromium --update-snapshots --grep "Task workspace|Role inbox"`; `npm run test:browser`.
- Tests added or updated: `tests/unit/task-platform-projects.test.js`; `tests/contract/projects-openapi.contract.test.js`; `tests/security/projects-security.test.js`; `tests/performance/projects-performance.test.js`; `src/app/AppRouteModel.test.tsx`; `src/app/AppNavigation.test.tsx`.
- Rollout or rollback notes: Apply `npm run audit:migrate` before enabling Postgres Projects; set `FF_PROJECTS=0` to disable routes; apply `db/migrations/012_projects.down.sql` only after confirming membership data is no longer needed.
- Docs updated: `docs/api/task-platform-openapi.yml`; `docs/api/task-owner-surfaces-openapi.yml`; `docs/runbooks/task-platform-rollout.md`; `CONTEXT.md`; `DESIGN.md`; `docs/diagrams/*projects-planning-containers.mmd`; `docs/reports/test_report_ISSUE-203.md`; browser screenshot baselines under `tests/browser/__screenshots__/browser-quality-visual.browser.spec.ts/`.
- Final command results are recorded in `docs/reports/test_report_ISSUE-203.md`.
