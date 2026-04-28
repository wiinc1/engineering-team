# Test Report US-003

## Unit And Contract Testing

- `tests/unit/audit-api.test.js` covers raw intake creation, default title, PM routing, list/detail visibility, malformed raw input rejection, overlong title rejection, pre-refinement stage-transition blocking, failure responses and compensating events for incomplete creation steps, and history without implementation-start events.
- `tests/unit/task-schema.test.js`, `tests/unit/task-creation-adapter.test.js`, and `tests/unit/features/task-creation/adapter.test.js` cover raw intake validation, optional title limits, and adapter behavior.
- `tests/unit/task-detail-adapter.test.js` covers intake context propagation into the detail screen model.
- `tests/contract/audit-openapi.contract.test.js` verifies the documented intake request/response, title limit, `task.refinement_requested`, and `task.intake_creation_failed` contract.

## UI And Browser Testing

- `tests/unit/task-creation-form.test.tsx` covers raw requirements input, optional title, title length validation, and loading/error states.
- `src/app/App.test.tsx` covers creating an Intake Draft from `/tasks/create`, cookie-session CSRF headers, opening the resulting detail page, and hiding generic workflow transition controls for Intake Drafts.
- `tests/browser/task-detail.browser.spec.ts` covers Intake Draft labeling, PM refinement next action, and operator intake requirements in real Chromium, Firefox, and mobile Chrome browser runs.

## E2E Testing

- `tests/e2e/audit-foundation.e2e.test.js` covers raw operator requirements creating a DRAFT task routed only to PM refinement.

## Regression Testing

- Legacy refined-field task creation remains accepted by `POST /tasks`.
- Existing task creation adapter behavior still generates a local task id when a legacy caller passes a sequence number.
- Failed PM refinement routing and failed canonical task persistence no longer return successful creation responses or normal actionable intake projections.
- Legacy refined-field DRAFT tasks can still use valid workflow transitions.

## Standards Alignment

- Applicable standards areas: testing and quality assurance
- Evidence in this report: unit, contract, UI, browser, e2e, and regression testing summary for Intake Draft creation
- Gap observed: production smoke and live operator UAT were not performed in this session. Documented rationale: repo-local automation proves the implemented contract; release confidence still needs deployment-specific evidence (source https://sre.google/books/).

## Required Evidence

- Commands run: see `docs/reports/US-003-verification.md`
- Tests added or updated: files listed in this report
- Rollout or rollback notes: feature-flag rollback through `FF_INTAKE_DRAFT_CREATION`
- Docs updated: US-003 test report
