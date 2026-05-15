# Standards Compliance Checklist

## Linked Standards
- Standards document: `docs/standards/software-development-standards.md`
- Required gap statement format: `Gap observed: X. Documented rationale: Y (source Z).`

## Standards Alignment
- Applicable standards areas: UI/UX, accessibility, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring.
- Evidence expected for this change: role/action mapping, updated task detail UI, visual/a11y/performance/browser/security evidence, feature-flag rollback notes, and no task-detail contract regression.
- Gap observed: Task detail lacked a role-specific primary action above the fold. Documented rationale: issue #153 requires a role-aware next-action panel that makes status and available action obvious without adding server contract fields (source https://github.com/wiinc1/engineering-team/issues/153).

## Change Metadata
- Change or task ID: Issue #153
- Owner: Codex
- Date: 2026-05-15
- Scope summary: Redesign task detail around a feature-flagged, role-specific next-action panel derived from the existing task detail read model.

## Architecture and Design
- Applicable: Yes
- Evidence in this change: `src/features/task-detail/next-action.mjs`, `src/features/task-detail/TaskDetailNextActionPanel.jsx`, `src/app/routes/TaskDetailRoute.jsx`, `docs/diagrams/workflow-task-detail-next-action-redesign.mmd`, `docs/diagrams/architecture-task-detail-next-action-redesign.mmd`.
- Gap observed: Task detail had dense lifecycle sections without a role-prioritized next action. Documented rationale: operational tools should prioritize scannable hierarchy, role-relevant status, and immediate action over undifferentiated information density (source `docs/product/software-factory-control-plane-prd.md` and issue #153).
- Documented rationale and source: The resolver keeps the architecture client-side and backwards-compatible with `GET /tasks/:id/detail`, matching issue #153 Section 6 and Section 7.

## Coding and Code Quality
- Applicable: Yes
- Evidence in this change: Next-action behavior is isolated in a feature-owned resolver and panel, with route changes limited to anchors and panel placement.
- Gap observed: `src/app/routes/TaskDetailRoute.jsx` remains a compacted legacy route file. Documented rationale: issue #153 only requires next-action hierarchy changes; broad route decompression/refactor would increase unrelated risk (source `src/app/routes/TaskDetailRoute.jsx` and `scripts/check-maintainability.js` existing baseline).
- Documented rationale and source: New logic lives in `src/features/task-detail/` to avoid adding more decision logic to the compacted route.

## Testing and Quality Assurance
- Applicable: Yes
- Evidence in this change: Unit resolver matrix, task-detail state integration tests, client-derivation contract tests, Playwright role/state browser matrix, accessibility/visual/performance updates, and security tests for hidden controls plus endpoint rejection.
- Gap observed: Manual testing is not used as completion evidence. Documented rationale: issue #153 Definition of Done requires automated evidence through UI, browser, security, typecheck, and full test commands (source issue #153).
- Documented rationale and source: Required commands are tracked below and should pass before handoff.

## Deployment and Release
- Applicable: Yes
- Evidence in this change: README and audit-foundation runbook document `ff_task_detail_next_action_redesign`, progressive rollout, synthetic monitoring, and rollback.
- Gap observed: No server-side rollout migration is needed. Documented rationale: next-action selection is derived client-side and can be disabled without API/schema rollback (source `docs/api/task-detail-history-telemetry-openapi.yml`).
- Documented rationale and source: Rollback is `ff_task_detail_next_action_redesign=0`.

## Observability and Monitoring
- Applicable: Yes
- Evidence in this change: `TaskDetailNextActionPanel` emits sanitized CustomEvent payloads for impressions and clicks; runbook lists target metrics.
- Gap observed: This change emits browser-side metric events but does not add a production collector. Documented rationale: issue #153 requires action-click metric evidence; existing runtime collectors can subscribe to sanitized events without changing the task-detail API contract (source `src/features/task-detail/TaskDetailNextActionPanel.jsx`).
- Documented rationale and source: Metrics are role/action/tone only; no task payloads, raw tokens, or user content are emitted.

## Authentication and Secret Handling
- Applicable: Yes
- AuthN/AuthZ surfaces changed: No server auth changes. The UI hides unauthorized next-action controls for reader-only sessions and existing endpoints still enforce authorization.
- Secret, token, cookie, password, or PII redaction evidence: Client metric payloads contain only `role`, `action`, and `tone`.
- Abuse-control or rate-limit evidence: Existing workflow endpoint authz remains authoritative; `tests/security/task-detail-next-action.security.test.js` verifies reader QA submission rejection.
- Rollback or removal impact: Disabling `ff_task_detail_next_action_redesign` removes the panel without changing session handling.
- Gap observed: No new secrets or credentials are introduced. Documented rationale: the implementation consumes existing browser session claims and read-model fields only (source `src/app/session` and issue #153 Section 8a).
- Documented rationale and source: Unauthorized action prevention is enforced by both UI display rules and existing API authz.

## Team and Process
- Applicable: Yes
- Evidence in this change: Issue branch, diagrams, checklist, README/runbook/API notes, and test coverage are included in the same change set.
- Gap observed: None.
- Documented rationale and source: Handoff should include role/action matrix, verification commands, and rollback instructions per issue #153 Section 17.

## Required Evidence
- Commands run: `npm run typecheck` - passed; `npm run test:security` - passed; `npm run test:ui` - passed; `npm run test:browser` - passed; `npm test` - passed; `npm run lint` - passed; `npm run change:check` - passed; `npm run ownership:lint` - passed; `npm run standards:check` - passed; `npm run design:change-guard` - passed; `node scripts/run-playwright.js tests/browser/task-detail-next-action.browser.spec.ts --project=chromium` - passed after maintainability refactor.
- Tests added or updated: `tests/unit/task-detail-next-action.test.js`; `tests/integration/task-detail-next-action.integration.test.js`; `tests/contract/task-detail-next-action.contract.test.js`; `tests/browser/task-detail-next-action.browser.spec.ts`; `tests/security/task-detail-next-action.security.test.js`; `tests/accessibility/task-assignment.a11y.spec.ts`; `tests/visual/task-assignment.visual.spec.ts`; `tests/performance/lighthouse-task-detail.spec.ts`.
- Rollout or rollback notes: Roll out `ff_task_detail_next_action_redesign` through staging, internal PM/QA/SRE, then all authenticated users. Roll back by setting the flag to `0`.
- Docs updated: `DESIGN.md`; `README.md`; `docs/runbooks/audit-foundation.md`; `docs/api/task-detail-history-telemetry-openapi.yml`; `docs/design/ISSUE-153-design.md`; `docs/diagrams/workflow-task-detail-next-action-redesign.mmd`; `docs/diagrams/architecture-task-detail-next-action-redesign.mmd`; `config/change-ownership-map.json`.
