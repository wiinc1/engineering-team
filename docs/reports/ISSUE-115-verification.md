# Issue 115 Verification

## Summary

Issue #115 is implemented as a read-only branch-protection verifier for the GitHub `Merge readiness` gate. The verifier parses default-branch required status checks, records `enforced=true` only when `Merge readiness` is required, and reports `policy_blocked` or `error` when enforcement cannot be proven.

## Acceptance Criteria Audit

| # | Requirement | Verification |
| --- | --- | --- |
| 1 | `.github/BRANCH_PROTECTION.md` lists `Merge readiness` as required once the check is emitted. | Passed: `.github/BRANCH_PROTECTION.md` now lists `Merge readiness` under exact required status checks and documents that enforced representation depends on branch protection requiring it. |
| 2 | Setup or verification reports `policy_blocked` or `error` when the default branch does not require `Merge readiness`. | Passed: `evaluateMergeReadinessBranchProtection` returns `policy_blocked` for missing required status checks and `error` for unreadable or missing branch-protection evidence; `scripts/verify-merge-readiness-branch-protection.js` exits non-zero until enforcement is present. |
| 3 | Setup or verification can represent the gate as enforced when the default branch requires `Merge readiness`. | Passed: branch-protection evidence containing `Merge readiness` produces `status=enforced`, `enforced=true`, and persisted review metadata/classification. |
| 4 | Tests cover required and missing branch-protection configurations. | Passed: `tests/unit/task-platform-branch-protection.test.js` covers required checks parsing, enforced state, missing required check `policy_blocked`, unreadable protection `error`, and the GitHub branch-protection client. `tests/integration/task-platform-branch-protection.integration.test.js` covers persisted enforced and blocked states through the service factory. |

## Live Repository Check

- Command: `gh api repos/wiinc1/engineering-team/branches/main/protection`
- Result: HTTP 404, `Branch not protected`
- Interpretation: current repository settings do not yet enforce `Merge readiness`; this is an operator/admin configuration state and is out of scope for automatic mutation. The implemented verifier reports this condition as non-enforced instead of claiming the control-plane gate is enforced.

## Commands

- `node --test tests/unit/task-platform-branch-protection.test.js`
- `node --test tests/integration/task-platform-branch-protection.integration.test.js`
- `node --test tests/unit/task-platform-github-check.test.js tests/unit/task-platform-source-policy.test.js tests/unit/task-platform-branch-protection.test.js`
- `node --check scripts/verify-merge-readiness-branch-protection.js`
- `node --test tests/unit/task-platform-api.test.js tests/unit/task-platform-source-policy.test.js tests/unit/task-platform-github-check.test.js tests/unit/task-platform-branch-protection.test.js`
- `node --test tests/integration/task-assignment-integration.test.js tests/integration/task-platform-source-policy.integration.test.js tests/integration/task-platform-github-check.integration.test.js`
- `npm run maintainability:check`
- `npm run ownership:lint`
- `npm run lint`
- `npm run typecheck`
- `npm run test:contract`
- `npm run coverage`
- `npm test`
- `gh api repos/wiinc1/engineering-team/branches/main/protection`

## Evidence Paths

- `.github/BRANCH_PROTECTION.md`
- `lib/task-platform/merge-readiness-branch-protection.js`
- `lib/task-platform/index.js`
- `scripts/verify-merge-readiness-branch-protection.js`
- `tests/unit/task-platform-branch-protection.test.js`
- `tests/integration/task-platform-branch-protection.integration.test.js`
- `docs/api/task-platform-openapi.yml`
- `docs/runbooks/task-platform-rollout.md`
- `.artifacts/coverage-summary.json`

## Coverage

- Node/API line coverage: 87.64%
- UI line coverage: 89.56%
- Minimum suite line coverage: 87.64%
- Policy floor: 80%

## Gaps

Live repository branch protection is not currently enabled for `main`. The implementation detects and reports that state, but automatic repository settings mutation is explicitly out of scope for issue #115.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring, team and process.
- Evidence in this report: acceptance-criteria audit, focused unit coverage, live branch-protection API check, OpenAPI/runbook documentation, coverage summary, and repo verification commands.
- Gap observed: Live branch protection currently returns HTTP 404 for `main`; no implementation standards gap remains. Documented rationale: issue #115 explicitly excludes automatic branch-protection mutation, and the implemented read-only verifier reports the missing enforcement state as `error` or `policy_blocked` instead of representing the gate as enforced (source https://github.com/wiinc1/engineering-team/issues/115).

## Required Evidence

- Commands run: focused branch-protection unit tests; adjacent merge-readiness tests; task-platform regression tests; `node --check scripts/verify-merge-readiness-branch-protection.js`; `npm run maintainability:check`; `npm run ownership:lint`; `npm run lint`; `npm run typecheck`; `npm run test:contract`; `npm run coverage`; `npm test`; live `gh api` branch-protection check.
- Tests added or updated: `tests/unit/task-platform-branch-protection.test.js`; `tests/integration/task-platform-branch-protection.integration.test.js`; `package.json`; `scripts/run-coverage.js`; `config/change-ownership-map.json`.
- Rollout or rollback notes: rollout is additive and read-only. Roll back by reverting the branch-protection verifier and CLI; do not change repository branch-protection settings without explicit operator/admin approval.
- Docs updated: `.github/BRANCH_PROTECTION.md`, `docs/api/task-platform-openapi.yml`, `docs/runbooks/task-platform-rollout.md`, and issue #115 reports.
