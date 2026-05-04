# Issue 117 Verification

## Summary

Issue #117 adds cross-cutting automated coverage for the reusable merge-readiness gate. The new `merge-readiness-gate.v1` helper centralizes finding classification and blocking-finding deferral validation while the test suite exercises the existing source policy, GitHub check-run, branch-protection, and PR-summary modules together.

## Acceptance Criteria Audit

| # | Requirement | Verification |
| --- | --- | --- |
| 1 | Source-inventory policy covers changed files, required checks, Execution Contract evidence expectations, preview/deployment presence, and risk flags. | Passed: `tests/unit/task-platform-merge-readiness-gate.test.js` asserts all reusable source selectors produce required source ids. |
| 2 | Status transitions cover `pending`, `passed`, `blocked`, `stale`, and `error`. | Passed: the gate test maps each status through `mapReviewToCheckRun` and verifies incomplete, success, and failure outcomes. |
| 3 | SHA invalidation covers a new commit invalidating the prior review and returning `Merge readiness` to pending. | Passed: the gate test refreshes a prior passing review with a new PR head SHA and asserts the review becomes `stale` and the emitted check is `in_progress`. |
| 4 | Inaccessible evidence produces `error`, prevents the GitHub check from passing, and raises `policy_blocked` for missing configuration or permissions. | Passed: the gate test evaluates inaccessible security evidence, asserts `reviewStatus=error`, a failing check mapping, and a `repo-admin` `policy_blocked` exception. |
| 5 | Blocking and non-blocking findings are distinguished with required rationale and ownership. | Passed: `evaluateMergeReadinessFindingPolicy` classifies blockers and non-blockers, requires ownership for findings, and requires rationale for non-blocking findings. |
| 6 | Blocking-finding deferral covers Product Manager risk acceptance, technical-owner risk acceptance, follow-up link, policy permission, and Principal/SRE high-risk approval rules. | Passed: `evaluateBlockingFindingDeferral` validates the full approval set and reports each missing requirement when policy permission, follow-up, PM acceptance, technical-owner acceptance, and high-risk approval are absent. |
| 7 | GitHub check-run emission covers pass/fail/incomplete behavior. | Passed: the gate test builds `Merge readiness` check-run payloads for passed, blocked, and pending reviews and verifies success, failure, and in-progress states. |
| 8 | Branch-protection enforcement detection covers required and missing configurations. | Passed: the gate test evaluates branch protection with and without required `Merge readiness`, asserting enforced and `policy_blocked` behavior. |
| 9 | PR summary rendering covers content allowlist and no-full-logs behavior. | Passed: the gate test renders a summary with raw log fields present and asserts allowed sections render while full log strings do not. |

## Commands

- `node --test tests/unit/task-platform-merge-readiness-gate.test.js`
- `node --check lib/task-platform/merge-readiness-gate.js`
- `node --test tests/unit/task-platform-merge-readiness-gate.test.js tests/unit/task-platform-source-policy.test.js tests/unit/task-platform-github-check.test.js tests/unit/task-platform-branch-protection.test.js tests/unit/task-platform-pr-summary.test.js`
- `node --test tests/integration/task-platform-source-policy.integration.test.js tests/integration/task-platform-github-check.integration.test.js tests/integration/task-platform-branch-protection.integration.test.js tests/integration/task-platform-pr-summary.integration.test.js`
- `node --test tests/integration/task-platform-pr-summary.integration.test.js`
- `npm run maintainability:check`
- `npm run ownership:lint`
- `npm run lint`
- `npm run typecheck`
- `npm run test:contract`
- `npm run coverage`
- `npm test`
- `npm run standards:check`

## Evidence Paths

- `lib/task-platform/merge-readiness-gate.js`
- `lib/task-platform/index.js`
- `tests/unit/task-platform-merge-readiness-gate.test.js`
- `tests/integration/task-platform-pr-summary.integration.test.js`
- `package.json`
- `scripts/run-coverage.js`
- `config/change-ownership-map.json`
- `docs/api/task-platform-openapi.yml`
- `docs/runbooks/task-platform-rollout.md`
- `.artifacts/coverage-summary.json`

## Coverage

- Node/API line coverage: 89.06%
- UI line coverage: 89.56%
- Minimum suite line coverage: 89.06%
- Policy floor: 80%

## Gaps

No implementation gap remains for issue #117. This work adds reusable gate-level coverage and keeps the feature-level tests from prior slices in place.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring.
- Evidence in this report: acceptance-criteria audit, focused reusable gate test, adjacent regressions, coverage summary, OpenAPI/runbook documentation, and rollout notes.
- Gap observed: none for issue #117. Documented rationale: the reusable gate now has automated coverage across every issue acceptance area without replacing the feature-level tests from prior slices (source https://github.com/wiinc1/engineering-team/issues/117).

## Required Evidence

- Commands run: focused reusable gate unit test; public export integration regression; `node --check lib/task-platform/merge-readiness-gate.js`; adjacent merge-readiness unit/integration regressions; `npm run maintainability:check`; `npm run ownership:lint`; `npm run lint`; `npm run typecheck`; `npm run test:contract`; `npm run coverage`; `npm test`; `npm run standards:check`.
- Tests added or updated: `tests/unit/task-platform-merge-readiness-gate.test.js`; `tests/integration/task-platform-pr-summary.integration.test.js`; `package.json`; `scripts/run-coverage.js`; `config/change-ownership-map.json`.
- Rollout or rollback notes: rollout is additive. Roll back by reverting the gate helper, consolidated test, and docs; feature-specific tests remain unchanged.
- Docs updated: `docs/api/task-platform-openapi.yml`, `docs/runbooks/task-platform-rollout.md`, and issue #117 reports.
