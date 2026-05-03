# Issue 113 Closeout Review

## Closeout Summary

Issue #113 is ready for ship review. The change adds a versioned source-inventory policy for Merge Readiness Review creation and persists the policy result with every review created through the task-platform service factory.

## Implemented

- Added `merge-readiness-source-inventory.v1` source policy evaluation.
- Added required-source selection from changed files, required checks, Execution Contract evidence expectations, preview/deployment presence, and risk flags.
- Added missing-source blocker findings and blocked review status.
- Added inaccessible-evidence error status plus failing merge-readiness check conclusion.
- Added `policy_blocked` exceptions for missing configuration and permission failures, assigned to repo admin or SRE owner classes.
- Preserved optional logs outside the required source inventory without requiring human review.
- Documented policy inputs and operator expectations in OpenAPI and rollout docs.

## Pre-Ship Audit

The acceptance criteria audit in `docs/reports/ISSUE-113-verification.md` marks all seven issue requirements passed. The out-of-scope items, PR comment rendering and GitHub check-run emission, were not implemented.

## Rollback

This change is additive. Rollback by reverting the policy module and task-platform factory wrapper. Existing review rows can remain as historical evidence because the persisted inventory is plain JSONB attached to the review record.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, security and compliance.
- Evidence in this report: closeout summary, implemented surface list, acceptance-audit pointer, and rollback posture.
- Gap observed: No closeout gap remains for issue #113. Documented rationale: all acceptance criteria are audited and the implementation includes code, tests, docs, and passing verification before ship (source https://github.com/wiinc1/engineering-team/issues/113).

## Required Evidence

- Commands run: `node --test tests/unit/task-platform-source-policy.test.js`; `node --test tests/integration/task-platform-source-policy.integration.test.js`; focused API/contract/security/e2e tests; `npm run coverage`; `npm run standards:check`; `npm run change:check`; `npm run ownership:lint`; `npm run typecheck`; `npm run test:unit`; `npm run test:browser`; `npm test`.
- Tests added or updated: `tests/unit/task-platform-source-policy.test.js`; `tests/integration/task-platform-source-policy.integration.test.js`; `package.json`; `config/change-ownership-map.json`.
- Rollout or rollback notes: additive rollout through existing task-platform review creation; rollback by reverting the source policy and wrapper.
- Docs updated: `docs/reports/ISSUE-113-review.md`, `docs/reports/ISSUE-113-verification.md`, `docs/reports/test_report_ISSUE-113.md`, `docs/reports/security_audit_ISSUE-113.md`, `docs/reports/customer_review_ISSUE-113.md`, `docs/api/task-platform-openapi.yml`, `docs/runbooks/task-platform-rollout.md`.
