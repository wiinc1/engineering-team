# Standards Compliance Checklist

## Change Metadata
- Change or task ID: Issue #210, Autonomous delivery metrics MVP.
- Owner: Codex implementation agent.
- Date: 2026-05-17.
- Scope summary: Added audit-derived retrospective signal generation, intervention taxonomy, autonomous delivery metric aggregation/rebuild, tenant-scoped API routes, an authorized browser report, additive Postgres projection tables, and verification coverage.

## Standards Alignment
- Standards baseline reviewed: `docs/standards/software-development-standards.md`.
- Applicable standards areas: architecture and design; coding and code quality; testing and quality assurance; deployment and release; observability and monitoring; team and process.
- Evidence expected for this change: Metric taxonomy, retrospective signal schema, aggregation and rebuild tests, tenant isolation and authz tests, API/browser evidence, OpenAPI, runbook, workflow diagram, and standards gate output.
- Gap observed: Full #156 analytics, soak dashboards, and production pilot comparison remain outside this MVP. Documented rationale: Issue #210 explicitly scopes a pilot metrics MVP while deferring the broader analytics platform to #156 (source https://github.com/wiinc1/engineering-team/issues/210).

## Architecture and Design
- Evidence: `lib/audit/autonomous-delivery-metrics*.js`, `lib/audit/autonomous-delivery-http.js`, `src/app/routes/AutonomyMetricsRoute.jsx`, and `docs/diagrams/workflow-autonomous-delivery-metrics-mvp.mmd`.
- Data model: `db/migrations/013_autonomous_delivery_metrics.sql` adds retrospective signal and metric snapshot tables with rollback in `013_autonomous_delivery_metrics.down.sql`.
- UI contract: the report uses compact metric cards, tables, and task-level facts documented in `DESIGN.md`.

## Coding and Code Quality
- Evidence: The classifier, builder, aggregation, HTTP wrapper, and route UI are isolated from legacy large modules except for narrow wiring.
- Feature flag: `FF_AUTONOMOUS_DELIVERY_METRICS_MVP=false` disables the MVP routes.
- Idempotency: signal IDs and rebuild IDs are derived from tenant, filters, and evidence fingerprints rather than rebuild wall-clock time.

## Testing and Quality Assurance
- Evidence: Added unit, integration, contract, security, performance, property, browser, and Vitest accessibility coverage for the issue scope.
- Migration evidence: `tests/integration/audit-migrations.integration.test.js` verifies apply, rollback, and reapply for migration 013.
- UI evidence: Playwright covers Chromium, Firefox, and mobile Chromium for the autonomy metrics report with overflow checks.

## Deployment and Release
- Evidence: The runbook documents migration, feature-flag rollout, rebuild, production validation, and rollback.
- Rollback: disable `FF_AUTONOMOUS_DELIVERY_METRICS_MVP`; keep raw audit history; apply the down migration only after retaining required review evidence.

## Observability and Monitoring
- Evidence: Runtime metrics include autonomous delivery rate, operator intervention totals, policy block totals, retrospective signal errors, API request/error counts, and rebuild counters.
- Gap observed: MVP alerting remains manual until #156 production analytics work defines a durable dashboard/alert target. Documented rationale: Issue #210 requires a simple authorized dashboard/report panel, not the full analytics platform (source https://github.com/wiinc1/engineering-team/issues/210).

## Authentication and Secret Handling
- AuthN/AuthZ surfaces changed: PM/product-owner/SRE/admin roles can read metrics through `metrics:read`; rebuild remains admin-only through `projections:rebuild`.
- Secret handling: no new secrets, tokens, or credentials are stored; tests assert cross-tenant and missing-auth failures do not leak protected data.
- Abuse-control or rate-limit evidence: MVP routes rely on existing internal authenticated API controls; no public unauthenticated surface was added.
- Rollback or removal impact: disabling the feature flag removes route access without deleting audit source data.
- Gap observed: No unresolved secret-handling gap remains for this MVP. Documented rationale: The change adds tenant-scoped operational analytics without introducing new secret material (source https://github.com/wiinc1/engineering-team/issues/210).

## Team and Process
- Evidence: This checklist, API spec, runbook, workflow diagram, and ownership-map updates provide review and handoff evidence.
- Gap observed: Production pilot comparison against #209 is a post-merge validation step. Documented rationale: Issue #210 requires validating first against the pilot task from #209 after deployment, not blocking local implementation on live data replay (source https://github.com/wiinc1/engineering-team/issues/210).

## Required Evidence
- Commands run: `node --test tests/unit/autonomous-delivery-metrics.test.js tests/integration/autonomous-delivery-metrics.integration.test.js tests/contract/autonomous-delivery-metrics.contract.test.js tests/security/autonomous-delivery-metrics.security.test.js tests/performance/autonomous-delivery-metrics.performance.test.js tests/property/autonomous-delivery-metrics.property.test.js tests/integration/audit-migrations.integration.test.js`; `npx vitest run --testTimeout=10000 src/app/AutonomyMetricsRoute.test.tsx`; `node scripts/run-playwright.js tests/browser/autonomous-delivery-metrics.browser.spec.ts`; `npm run lint`; `npm run typecheck`; `npm run ownership:lint`; `npm run change:check`; `npm run test:unit`; `npm run test:integration:api`; `npm run test:contract`; `npm run test:security`; `npm run test:performance`; `npm run test:property`; `npm run test:ui`; `npm run test:browser`; `npm run build`; `npm run standards:check`; `npm run design:tokens:enforce`; `npm test`.
- Tests added or updated: `tests/unit/autonomous-delivery-metrics.test.js`; `tests/integration/autonomous-delivery-metrics.integration.test.js`; `tests/contract/autonomous-delivery-metrics.contract.test.js`; `tests/security/autonomous-delivery-metrics.security.test.js`; `tests/performance/autonomous-delivery-metrics.performance.test.js`; `tests/property/autonomous-delivery-metrics.property.test.js`; `src/app/AutonomyMetricsRoute.test.tsx`; `tests/browser/autonomous-delivery-metrics.browser.spec.ts`; `tests/integration/audit-migrations.integration.test.js`.
- Rollout or rollback notes: Apply `npm run audit:migrate`, enable `FF_AUTONOMOUS_DELIVERY_METRICS_MVP`, rebuild after pilot closeout, compare with #209 evidence, and disable the flag for rollback.
- Docs updated: `docs/api/autonomous-delivery-metrics-openapi.yml`; `docs/api/audit-foundation-openapi.yml`; `docs/runbooks/autonomous-delivery-metrics.md`; `docs/runbooks/audit-foundation.md`; `docs/diagrams/workflow-autonomous-delivery-metrics-mvp.mmd`; `DESIGN.md`; this checklist.
