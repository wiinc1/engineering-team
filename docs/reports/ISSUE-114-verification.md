# Issue 114 Verification

## Summary

Issue #114 is implemented as an additive GitHub check-run integration for the authoritative `MergeReadinessReview`. The task-platform service factory can now emit a GitHub check run named `Merge readiness`, persist the returned check-run identifier, and invalidate prior reviews when the pull request commit SHA or readiness evidence changes.

## Acceptance Criteria Audit

| # | Requirement | Verification |
| --- | --- | --- |
| 1 | A passing structured `MergeReadinessReview` makes the GitHub `Merge readiness` check run pass. | Passed: `mapReviewToCheckRun` maps current `reviewStatus=passed` reviews to a completed `success` conclusion, and the service wrapper emits and persists that check run. Covered by unit and integration tests. |
| 2 | `blocked`, `error`, `stale`, or missing reviews do not pass. | Passed: blocked and error reviews map to completed `failure`; stale, pending, missing, and commit/evidence mismatches map to in-progress checks without a conclusion. Covered by unit tests. |
| 3 | PR open, synchronize, reopen, new check results, and preview/deployment evidence updates run or refresh the gate. | Passed: `deriveMergeReadinessEvent` recognizes pull request, check run, check suite, status, workflow run, deployment, and deployment status events, while ignoring recursive `Merge readiness` check-run events. |
| 4 | A PR HEAD commit SHA change after a passing review marks the prior review stale and returns `Merge readiness` to pending. | Passed: `refreshMergeReadinessForEvent` detects a changed latest commit SHA, updates the review to stale metadata, and emits an in-progress check for the new SHA. Covered by unit tests. |
| 5 | Required check result, blocking log, preview, or deployment evidence changes invalidate the prior review and return `Merge readiness` to pending. | Passed: readiness evidence is fingerprinted from required checks, blocking logs, preview URLs, and deployment evidence; changed fingerprints mark the prior review stale and emit pending. Covered by unit tests. |
| 6 | Tests cover emission, mapping, event handling, and SHA/evidence invalidation. | Passed: `tests/unit/task-platform-github-check.test.js` covers mapping, payload emission, event derivation, SHA invalidation, and evidence invalidation; `tests/integration/task-platform-github-check.integration.test.js` covers service-factory emission and persistence. |

## Commands

- `node --test tests/unit/task-platform-github-check.test.js`
- `node --test tests/integration/task-platform-github-check.integration.test.js`
- `node --test tests/unit/task-platform-api.test.js tests/unit/task-platform-source-policy.test.js tests/unit/task-platform-github-check.test.js`
- `node --test tests/integration/task-assignment-integration.test.js tests/integration/task-platform-source-policy.integration.test.js tests/integration/task-platform-github-check.integration.test.js`
- `npm run maintainability:check`
- `npm run lint`
- `npm run ownership:lint`
- `npm run typecheck`
- `npm run test:contract`
- `npm run coverage`
- `npm run test:unit`
- `npm run test:browser`
- `npm test`
- `npm run standards:check`
- `npm run change:check`

## Evidence Paths

- `lib/task-platform/merge-readiness-github-check.js`
- `lib/task-platform/index.js`
- `tests/unit/task-platform-github-check.test.js`
- `tests/integration/task-platform-github-check.integration.test.js`
- `docs/api/task-platform-openapi.yml`
- `docs/runbooks/task-platform-rollout.md`
- `.artifacts/coverage-summary.json`

## Coverage

- Node/API line coverage: 87.28%
- UI line coverage: 89.56%
- Minimum suite line coverage: 87.28%
- Policy floor: 80%

## Gaps

No issue acceptance gap remains. Branch-protection setup and source-inventory policy internals remain out of scope for issue #114.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring, team and process.
- Evidence in this report: acceptance-criteria audit, focused unit and integration coverage, OpenAPI/runbook documentation, coverage summary, and full repo verification commands.
- Gap observed: No standards gap remains for issue #114. Documented rationale: the implementation includes code, tests, docs, audit evidence, rollback notes, and passing repo gates for the GitHub Merge readiness check-run emitter (source https://github.com/wiinc1/engineering-team/issues/114).

## Required Evidence

- Commands run: focused unit and integration tests; task-platform regression tests; `npm run maintainability:check`; `npm run lint`; `npm run ownership:lint`; `npm run typecheck`; `npm run test:contract`; `npm run coverage`; `npm run test:unit`; `npm run test:browser`; `npm test`; `npm run standards:check`; `npm run change:check`.
- Tests added or updated: `tests/unit/task-platform-github-check.test.js`; `tests/integration/task-platform-github-check.integration.test.js`; `package.json`; `scripts/run-coverage.js`; `config/change-ownership-map.json`.
- Rollout or rollback notes: rollout is additive through the task-platform service factory when a GitHub check-run client or token is configured. Roll back by disabling that client configuration or reverting the additive check-run module; stored review records remain readable.
- Docs updated: `docs/api/task-platform-openapi.yml`, `docs/runbooks/task-platform-rollout.md`, and issue #114 reports.
