# Issue 114 Test Report

## Scope

This report covers automated verification for the GitHub Merge readiness check-run emitter introduced for issue #114.

## Test Results

| Command | Result | Notes |
| --- | --- | --- |
| `node --test tests/unit/task-platform-github-check.test.js` | Pass | Covers pass/fail/incomplete mapping, check-run payload shape, event derivation, commit SHA invalidation, and evidence invalidation. |
| `node --test tests/integration/task-platform-github-check.integration.test.js` | Pass | Verifies service-factory emission, persisted `githubCheckRunId`, and failure mapping through injected check-run clients. |
| `node --test tests/unit/task-platform-api.test.js tests/unit/task-platform-source-policy.test.js tests/unit/task-platform-github-check.test.js` | Pass | Confirms the new emitter remains compatible with the existing task-platform API and source policy. |
| `node --test tests/integration/task-assignment-integration.test.js tests/integration/task-platform-source-policy.integration.test.js tests/integration/task-platform-github-check.integration.test.js` | Pass | Focused task-platform integration regression coverage. |
| `npm run maintainability:check` | Pass | Authored source, tests, and changed support scripts remain below hard line-count thresholds. |
| `npm run lint` | Pass | ESLint completed successfully. |
| `npm run ownership:lint` | Pass | Ownership map lint completed successfully. |
| `npm run typecheck` | Pass | TypeScript compile check completed successfully. |
| `npm run test:contract` | Pass | OpenAPI contract regression coverage passed. |
| `npm run coverage` | Pass | Coverage artifact minimum suite line coverage is 87.28%. |
| `npm run test:unit` | Pass | Full Node unit plus UI-vitest suite passed. |
| `npm run test:browser` | Pass | Playwright browser suite passed, 66 tests. |
| `npm test` | Pass | Full aggregate repo test command passed. |
| `npm run standards:check` | Pass | Standards, maintainability, and coverage policy passed. |
| `npm run change:check` | Pass | Change-completeness requirements for task-platform runtime, unit test, integration test, and docs evidence passed. |

## Coverage

- Node/API: 87.28% line coverage
- UI: 89.56% line coverage
- Minimum suite line coverage: 87.28%
- Required floor: 80%

## Residual Risk

No issue-specific test gap remains. During development, coverage and unit commands exposed transient unrelated UI assertions and a missing coverage-runner entry for the new tests; the coverage runner was updated and the final coverage, unit, browser, and aggregate test commands passed.

## Standards Alignment

- Applicable standards areas: testing and quality assurance, coding and code quality, deployment and release.
- Evidence in this report: focused and full-suite command results, coverage numbers, maintainability verification, and residual-risk note.
- Gap observed: No testing gap remains for issue #114. Documented rationale: check-run emission, mapping, event handling, SHA invalidation, evidence invalidation, service integration, browser regressions, coverage, and aggregate repo tests passed before ship (source https://github.com/wiinc1/engineering-team/issues/114).

## Required Evidence

- Commands run: all commands listed in Test Results.
- Tests added or updated: `tests/unit/task-platform-github-check.test.js`; `tests/integration/task-platform-github-check.integration.test.js`; `package.json`; `scripts/run-coverage.js`; `config/change-ownership-map.json`.
- Rollout or rollback notes: no data migration required; rollback by disabling the GitHub check-run client configuration or reverting the additive emitter and service wrapper.
- Docs updated: `docs/reports/test_report_ISSUE-114.md`.
