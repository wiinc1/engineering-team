# Standards Compliance Checklist

## Linked Standards
- Standards document: `docs/standards/software-development-standards.md`
- Required gap statement format: `Gap observed: X. Documented rationale: Y (source Z).`

## Change Metadata
- Change or task ID: GitHub issue #211
- Owner: Codex implementation agent
- Date: 2026-05-17
- Scope summary: Add polling-based live Task and Project freshness updates for pilot workflow routes.

## Standards Alignment
- Applicable standards areas: Architecture and Design; Coding and Code Quality; Testing and Quality Assurance; Deployment and Release; Observability and Monitoring; Team and Process.
- Evidence expected for this change: Narrow API and UI implementation, documented rollout and rollback controls, route-level freshness behavior, protected payloads, metrics, and required validation commands.
- Gap observed: Active workflow users relied on manual refresh for coordination-sensitive task state. Documented rationale: Issue #211 requires a polling MVP with route freshness indicators, restricted update payloads, metrics, and fallback behavior before introducing streaming transports (source https://github.com/wiinc1/engineering-team/issues/211).

## Architecture and Design
- Applicable: Yes
- Evidence in this change: `lib/audit/live-task-updates.js`, `lib/audit/live-task-updates-http.js`, `src/app/live-task-freshness.js`, and route integrations in task detail, Projects, workspace, and inbox surfaces.
- Gap observed: Active workflow users relied on manual refresh for coordination-sensitive task state.
- Documented rationale and source: Autonomous workflow pilots can create duplicate or incorrect operator actions when task state is stale (source GitHub issue #211 and README freshness semantics).

## Coding and Code Quality
- Applicable: Yes
- Evidence in this change: Narrow route wrapper, shared reconciliation helper, and scoped UI component/style additions.
- Gap observed: Project membership freshness was not represented by canonical task timestamps alone.
- Documented rationale and source: Project membership writes persist Project mutations, so cursor positions include membership mutation timestamps to avoid missed updates (source `lib/task-platform/projects.js`).

## Testing and Quality Assurance
- Applicable: Yes
- Evidence in this change: Unit, integration, contract, security, performance, property, accessibility, visual, and browser tests for the polling endpoint and route freshness behavior.
- Gap observed: Prior browser coverage validated manual refresh and route rendering, but not automatic stale/out-of-order reconciliation.
- Documented rationale and source: Issue #211 requires out-of-order update handling, restricted payload checks, and browser route auto-update evidence.

## Deployment and Release
- Applicable: Yes
- Evidence in this change: Server rollback flag `FF_LIVE_TASK_FRESHNESS_POLLING`; browser rollout flag `VITE_FF_LIVE_TASK_FRESHNESS_POLLING`; runbook rollback steps.
- Gap observed: No production streaming transport is introduced in this MVP.
- Documented rationale and source: Issue #211 explicitly prefers polling before SSE/WebSockets until hosting constraints are proven.

## Observability and Monitoring
- Applicable: Yes
- Evidence in this change: Endpoint metrics `feature_live_task_updates_events_total`, `feature_live_task_updates_latency_seconds`, `feature_live_task_updates_poll_errors_total`, and `feature_live_task_updates_stale_views_total`; structured success/error logs with sanitized cursors.
- Gap observed: Browser-side stale-view counts are approximated by endpoint payload freshness for this MVP.
- Documented rationale and source: MVP uses existing audit metrics plumbing and route indicators before adding a client telemetry collector (source issue #211 monitoring requirements).

## Authentication and Secret Handling
- Applicable: Yes
- AuthN/AuthZ surfaces changed: New `GET /api/v1/tasks/updates` route requires bearer/session tenant and actor context plus `state:read`.
- Secret, token, cookie, password, or PII redaction evidence: Update payloads omit comments, audit logs, telemetry, orchestration, relationship detail, and context fields; logs include sanitized cursor metadata, not payload values.
- Abuse-control or rate-limit evidence: Client uses route-scoped polling, hidden-tab/browser backoff-compatible hook structure, and manual rollback flags. No server rate limiter is added in this slice.
- Rollback or removal impact: Disabling flags preserves existing manual refresh behavior.
- Gap observed: Dedicated server-side rate limiting is not part of this MVP.
- Documented rationale and source: Issue #211 calls for polling/backoff and performance evidence first; broader abuse controls can be layered after pilot load is measured.

## Team and Process
- Applicable: Yes
- Evidence in this change: API docs, Mermaid workflow diagram, runbook, README, feature flag docs, and this checklist.
- Gap observed: None for issue #211 handoff artifacts.
- Documented rationale and source: N/A.

## Required Evidence
- Commands run: `npm run test:unit`; `npm run test:integration:api`; `npm run test:contract`; `npm run test:security`; `npm run test:performance`; `npm run test:ui`; `npm run test:browser`; `npm test`; `npm run standards:check`.
- Tests added or updated: `tests/unit/live-task-updates.test.js`, `src/app/live-task-freshness.test.tsx`, `tests/integration/live-task-updates.integration.test.js`, `tests/contract/live-task-updates.contract.test.js`, `tests/security/live-task-updates.security.test.js`, `tests/performance/live-task-updates.performance.test.js`, `tests/property/live-task-reconciler.property.test.js`, `tests/accessibility/live-task-freshness.a11y.spec.tsx`, `tests/visual/live-task-freshness.visual.spec.tsx`, `tests/browser/live-task-freshness.browser.spec.ts`.
- Rollout or rollback notes: See `docs/runbooks/live-task-freshness.md` and `docs/feature-flags.md`.
- Docs updated: `README.md`, `DESIGN.md`, `docs/api/live-task-freshness-updates-openapi.yml`, `docs/diagrams/workflow-live-task-freshness-polling-mvp.mmd`, `docs/runbooks/live-task-freshness.md`, `docs/feature-flags.md`.
