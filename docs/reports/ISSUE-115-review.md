# Issue 115 Closeout Review

## Closeout Summary

Issue #115 is ready for ship review. The change adds a read-only GitHub branch-protection verifier that prevents the control plane from representing the `Merge readiness` gate as enforced unless default-branch protection actually requires that exact status check.

## Implemented

- Added `merge-readiness-branch-protection.v1` evaluation for GitHub required status checks.
- Added read-only GitHub branch-protection client and CLI verification command.
- Added merge-readiness review classification and metadata for branch-protection enforcement state.
- Added `policy_blocked` findings for missing `Merge readiness` required-check enforcement and `error` findings for unreadable branch-protection evidence.
- Updated `.github/BRANCH_PROTECTION.md` to list `Merge readiness` as a required status check.
- Documented API and rollout expectations for branch-protection enforcement state.

## Pre-Ship Audit

The acceptance criteria audit in `docs/reports/ISSUE-115-verification.md` marks all four issue requirements implemented. The live repo check currently returns `404 Branch not protected` for `main`, which is an operator/admin setting outside the automatic-change scope and is now detected as non-enforced.

## Rollback

This change is additive and read-only. Rollback by reverting the verifier module, service-factory wrapper call, CLI, and documentation updates. No repository settings are mutated by this work.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring.
- Evidence in this report: closeout summary, implemented surface list, acceptance-audit pointer, live branch-protection note, and rollback posture.
- Gap observed: Live branch protection is not currently enabled for `main`; no code closeout gap remains. Documented rationale: the code now detects this exact non-enforced state and avoids representing the gate as enforced, while repository settings mutation remains out of scope (source https://github.com/wiinc1/engineering-team/issues/115).

## Required Evidence

- Commands run: focused branch-protection unit tests; adjacent task-platform tests; `node --check scripts/verify-merge-readiness-branch-protection.js`; `npm run coverage`; `npm run ownership:lint`; `npm run lint`; `npm run typecheck`; `npm run test:contract`; `npm test`; live `gh api` branch-protection check.
- Tests added or updated: `tests/unit/task-platform-branch-protection.test.js`; `tests/integration/task-platform-branch-protection.integration.test.js`; `package.json`; `scripts/run-coverage.js`; `config/change-ownership-map.json`.
- Rollout or rollback notes: additive read-only rollout through task-platform review creation and the operator CLI; rollback by reverting the additive verifier and docs.
- Docs updated: `docs/reports/ISSUE-115-review.md`, `docs/reports/ISSUE-115-verification.md`, `docs/reports/test_report_ISSUE-115.md`, `docs/reports/security_audit_ISSUE-115.md`, `docs/reports/customer_review_ISSUE-115.md`, `.github/BRANCH_PROTECTION.md`, `docs/api/task-platform-openapi.yml`, `docs/runbooks/task-platform-rollout.md`.
