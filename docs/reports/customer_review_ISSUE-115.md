# Issue 115 Customer Review

## Customer Outcome

The control plane no longer treats the GitHub `Merge readiness` check as truly enforced just because the check can be emitted. It now requires evidence that default-branch protection actually requires `Merge readiness` before showing the gate as enforced.

## Acceptance Review

- Branch-protection guidance lists `Merge readiness` as a required status check.
- Missing `Merge readiness` in required status checks reports `policy_blocked`.
- Unreadable or absent branch protection reports `error`.
- Required `Merge readiness` status checks produce `enforced=true` in review metadata and classification.
- Tests cover missing, unreadable, and required branch-protection configurations.

## Customer-Facing Risk

No customer-facing UI changed in this issue. The operational risk is that GitHub branch protection is currently not enabled for `main`, so the live repository is not yet enforcing `Merge readiness`; the new verifier makes that visible instead of silently overstating enforcement.

## Standards Alignment

- Applicable standards areas: architecture and design, testing and quality assurance, deployment and release, observability and monitoring, team and process.
- Evidence in this report: customer outcome, acceptance review, live operational risk statement, and fail-closed behavior summary.
- Gap observed: Live branch protection is not currently enabled for `main`; no customer-readiness implementation gap remains. Documented rationale: the control plane now exposes that non-enforced state and avoids claiming enforcement until GitHub branch protection requires `Merge readiness` (source https://github.com/wiinc1/engineering-team/issues/115).

## Required Evidence

- Commands run: `node --test tests/unit/task-platform-branch-protection.test.js`; `npm run coverage`; `npm run lint`; `npm run test:contract`; `npm test`; live `gh api` branch-protection check.
- Tests added or updated: `tests/unit/task-platform-branch-protection.test.js`; `tests/integration/task-platform-branch-protection.integration.test.js`.
- Rollout or rollback notes: additive read-only rollout; rollback by reverting the branch-protection verifier and docs. Repo settings changes require explicit operator/admin action.
- Docs updated: `docs/reports/customer_review_ISSUE-115.md`, `.github/BRANCH_PROTECTION.md`, `docs/api/task-platform-openapi.yml`, `docs/runbooks/task-platform-rollout.md`.
