# Issue 114 Customer Review

## Customer Outcome

Pull requests can now surface the authoritative merge-readiness decision as a GitHub check named `Merge readiness`. Passing reviews complete successfully, while blocked, errored, stale, missing, or invalidated reviews stay visibly non-passing until the underlying structured review is current again.

## Acceptance Review

- A passing structured review produces a successful `Merge readiness` check-run payload.
- Blocked and errored reviews produce failing check-run payloads.
- Missing, pending, stale, commit-mismatched, and evidence-mismatched reviews remain incomplete instead of passing.
- Pull request, check-result, workflow status, preview, deployment, and deployment-status events can refresh the gate.
- Commit SHA and evidence changes invalidate prior reviews and return the GitHub check to pending.
- Unit and integration tests cover check-run emission, mapping, event handling, SHA invalidation, and evidence invalidation.

## Customer-Facing Risk

No customer-facing UI changed in this issue. The operational risk is GitHub check-run configuration being absent or misconfigured; in that case, merge-readiness review creation remains available, but the external GitHub check does not falsely pass.

## Standards Alignment

- Applicable standards areas: architecture and design, testing and quality assurance, deployment and release, observability and monitoring, team and process.
- Evidence in this report: customer outcome, acceptance review, operational risk statement, and fail-closed behavior summary.
- Gap observed: No customer-readiness gap remains for issue #114. Documented rationale: pull requests receive a structured, fail-closed readiness signal that refreshes on PR, check, preview, deployment, commit, and evidence changes (source https://github.com/wiinc1/engineering-team/issues/114).

## Required Evidence

- Commands run: `npm run coverage`; `npm run standards:check`; `npm run test:unit`; `npm run test:browser`; `npm test`.
- Tests added or updated: `tests/unit/task-platform-github-check.test.js`; `tests/integration/task-platform-github-check.integration.test.js`.
- Rollout or rollback notes: additive rollout through configured GitHub check-run emission; rollback by disabling the check-run client or reverting the additive emitter.
- Docs updated: `docs/reports/customer_review_ISSUE-114.md`, `docs/api/task-platform-openapi.yml`, `docs/runbooks/task-platform-rollout.md`.
