# Issue 113 Customer Review

## Customer Outcome

Merge readiness now records the exact evidence sources humans need to review for a pull request instead of implying that every available log must be inspected. Required missing or inaccessible evidence blocks the review before ship.

## Acceptance Review

- Required sources are selected from changed files, required checks, Execution Contract evidence, preview/deployment presence, and risk flags.
- Each review created through the task-platform service factory receives a versioned source inventory.
- Missing required evidence blocks review.
- Inaccessible required evidence fails closed with `reviewStatus=error`.
- Permission and configuration failures raise `policy_blocked` with an owner for follow-up.
- Optional logs outside the required inventory remain optional.

## Customer-Facing Risk

No customer-facing UI changed in this issue. The main operational risk is upstream automation failing to provide source references, which now results in an explicit blocked or error review rather than silent merge-readiness ambiguity.

## Standards Alignment

- Applicable standards areas: architecture and design, testing and quality assurance, deployment and release, team and process.
- Evidence in this report: customer outcome, acceptance review, and operational risk statement.
- Gap observed: No customer-readiness gap remains for issue #113. Documented rationale: the policy makes merge-readiness evidence explicit and fail-closed while avoiding unnecessary human review of unrelated optional logs (source https://github.com/wiinc1/engineering-team/issues/113).

## Required Evidence

- Commands run: `npm run coverage`; `npm run standards:check`; `npm run test:unit`; `npm run test:browser`; `npm test`.
- Tests added or updated: `tests/unit/task-platform-source-policy.test.js`; `tests/integration/task-platform-source-policy.integration.test.js`.
- Rollout or rollback notes: additive rollout through existing task-platform review creation; rollback by reverting source policy code.
- Docs updated: `docs/reports/customer_review_ISSUE-113.md`, `docs/api/task-platform-openapi.yml`, `docs/runbooks/task-platform-rollout.md`.
