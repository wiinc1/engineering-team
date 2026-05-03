# Issue 115 Test Report

## Scope

This report covers automated verification for the GitHub branch-protection enforcement verifier introduced for issue #115.

## Test Results

| Command | Result | Notes |
| --- | --- | --- |
| `node --test tests/unit/task-platform-branch-protection.test.js` | Pass | Covers parsing, enforced state, missing required check `policy_blocked`, unreadable protection `error`, service persistence, and GitHub client behavior. |
| `node --test tests/integration/task-platform-branch-protection.integration.test.js` | Pass | Verifies enforced and blocked branch-protection state persists through `createTaskPlatformService`. |
| `node --test tests/unit/task-platform-github-check.test.js tests/unit/task-platform-source-policy.test.js tests/unit/task-platform-branch-protection.test.js` | Pass | Adjacent merge-readiness policy coverage. |
| `node --check scripts/verify-merge-readiness-branch-protection.js` | Pass | CLI syntax check passed. |
| `node --test tests/unit/task-platform-api.test.js tests/unit/task-platform-source-policy.test.js tests/unit/task-platform-github-check.test.js tests/unit/task-platform-branch-protection.test.js` | Pass | Focused task-platform unit regression coverage. |
| `node --test tests/integration/task-assignment-integration.test.js tests/integration/task-platform-source-policy.integration.test.js tests/integration/task-platform-github-check.integration.test.js` | Pass | Existing task-platform integration regression coverage. |
| `npm run maintainability:check` | Pass | Authored source, tests, and support script remain below hard line-count thresholds. |
| `npm run ownership:lint` | Pass | Ownership map lint completed successfully. |
| `npm run lint` | Pass | Repository lint completed successfully. |
| `npm run typecheck` | Pass | TypeScript compile check completed successfully. |
| `npm run test:contract` | Pass | OpenAPI contract regression coverage passed. |
| `npm run coverage` | Pass | Coverage artifact minimum suite line coverage is 87.64%. |
| `npm test` | Pass | Full aggregate repository suite passed, including the 66-test browser matrix. |
| `gh api repos/wiinc1/engineering-team/branches/main/protection` | Non-enforced live state | GitHub returned HTTP 404, `Branch not protected`; verifier behavior covers this as non-enforced. |

## Coverage

- Node/API: 87.64% line coverage
- UI: 89.56% line coverage
- Minimum suite line coverage: 87.64%
- Required floor: 80%

## Residual Risk

No implementation-specific test gap remains. The live repository still needs an explicit operator/admin branch-protection settings change before `main` actually requires `Merge readiness`; this code intentionally does not perform that mutation.

## Standards Alignment

- Applicable standards areas: testing and quality assurance, coding and code quality, deployment and release.
- Evidence in this report: focused and regression command results, coverage numbers, live branch-protection result, and residual-risk note.
- Gap observed: Live branch protection is currently absent on `main`; no testing gap remains for issue #115. Documented rationale: automated tests cover both required and missing branch-protection configurations, while the live settings change is an explicit out-of-scope operator action (source https://github.com/wiinc1/engineering-team/issues/115).

## Required Evidence

- Commands run: all commands listed in Test Results.
- Tests added or updated: `tests/unit/task-platform-branch-protection.test.js`; `tests/integration/task-platform-branch-protection.integration.test.js`; `package.json`; `scripts/run-coverage.js`; `config/change-ownership-map.json`.
- Rollout or rollback notes: no data migration or settings mutation required; rollback by reverting the additive verifier and CLI.
- Docs updated: `docs/reports/test_report_ISSUE-115.md`.
