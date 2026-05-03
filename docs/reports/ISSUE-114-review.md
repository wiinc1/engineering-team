# Issue 114 Closeout Review

## Closeout Summary

Issue #114 is ready for ship review. The change adds a versioned GitHub `Merge readiness` check-run emitter that is driven by structured `MergeReadinessReview` records and fails closed for missing, stale, blocked, or errored review states.

## Implemented

- Added `merge-readiness-github-check.v1` mapping and payload construction for GitHub check runs named `Merge readiness`.
- Added check-run client support for creating and updating GitHub check runs through the REST checks API.
- Added service-factory emission and persistence of `githubCheckRunId` plus GitHub gate metadata when a check-run client is configured.
- Added event derivation for PR open, synchronize, reopen, check result, workflow status, preview, deployment, and deployment status refresh signals.
- Added commit SHA and readiness evidence fingerprint invalidation so previously passing reviews become stale and the GitHub check returns to pending.
- Documented rollout, verification, observability, and rollback expectations in OpenAPI and the task-platform rollout runbook.

## Pre-Ship Audit

The acceptance criteria audit in `docs/reports/ISSUE-114-verification.md` marks all six issue requirements passed. The out-of-scope items, branch-protection setup and source-inventory policy internals, were not implemented.

## Rollback

This change is additive. Rollback by removing or disabling the configured GitHub check-run client or token so review creation continues without emitting external check runs. If a code rollback is required, revert the check-run module and service-factory wrapper; existing review rows and prior metadata remain plain JSON evidence.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring.
- Evidence in this report: closeout summary, implemented surface list, acceptance-audit pointer, rollback posture, and explicit out-of-scope confirmation.
- Gap observed: No closeout gap remains for issue #114. Documented rationale: all acceptance criteria are audited and the implementation includes code, tests, docs, and passing verification before ship (source https://github.com/wiinc1/engineering-team/issues/114).

## Required Evidence

- Commands run: focused GitHub check unit and integration tests; task-platform regression tests; `npm run coverage`; `npm run standards:check`; `npm run change:check`; `npm run ownership:lint`; `npm run typecheck`; `npm run test:unit`; `npm run test:browser`; `npm test`.
- Tests added or updated: `tests/unit/task-platform-github-check.test.js`; `tests/integration/task-platform-github-check.integration.test.js`; `package.json`; `scripts/run-coverage.js`; `config/change-ownership-map.json`.
- Rollout or rollback notes: additive rollout through existing task-platform review creation when check-run configuration is supplied; rollback by disabling the GitHub check-run client or reverting the additive wrapper.
- Docs updated: `docs/reports/ISSUE-114-review.md`, `docs/reports/ISSUE-114-verification.md`, `docs/reports/test_report_ISSUE-114.md`, `docs/reports/security_audit_ISSUE-114.md`, `docs/reports/customer_review_ISSUE-114.md`, `docs/api/task-platform-openapi.yml`, `docs/runbooks/task-platform-rollout.md`.
