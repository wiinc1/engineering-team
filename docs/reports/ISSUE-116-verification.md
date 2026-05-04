# Issue 116 Verification

## Summary

Issue #116 is implemented with a derived PR-summary renderer for structured `MergeReadinessReview` records. The summary is human-facing only: merge readiness evaluation continues to read the structured review, and conflicting PR comment text is reported as stale comment content rather than authority.

## Acceptance Criteria Audit

| # | Requirement | Verification |
| --- | --- | --- |
| 1 | PR summaries include only review status, commit SHA, required sources reviewed, blocking findings, non-blocking findings with rationale, deferred blocking findings with approvals, inaccessible evidence, follow-up links, and the structured `MergeReadinessReview` link. | Passed: `renderMergeReadinessPrSummary` emits only those sections from allowlisted structured fields. |
| 2 | Full logs are not pasted into the comment. | Passed: renderer tests include copied log fields under reviewed sources, required-source objects, and metadata, and assert those strings and raw-log field names are absent from the rendered summary. |
| 3 | Conflicts between a PR comment summary and the structured review resolve in favor of the structured review. | Passed: `evaluateMergeReadinessSummaryPrecedence` always returns `sourceOfTruth=structured_review` and maps the gate from the structured review even when comment status conflicts. |
| 4 | Automated tests cover summary rendering, content allowlist, no-full-logs behavior, and source-of-truth precedence. | Passed: `tests/unit/task-platform-pr-summary.test.js` covers all four behaviors, and `tests/integration/task-platform-pr-summary.integration.test.js` covers persisted review rendering plus conflict precedence through the service export. |

## Commands

- `node --test tests/unit/task-platform-pr-summary.test.js tests/integration/task-platform-pr-summary.integration.test.js`
- `node --check lib/task-platform/merge-readiness-pr-summary.js`
- `node --test tests/unit/task-platform-github-check.test.js tests/unit/task-platform-pr-summary.test.js tests/unit/task-platform-branch-protection.test.js tests/unit/task-platform-source-policy.test.js`
- `node --test tests/integration/task-platform-github-check.integration.test.js tests/integration/task-platform-pr-summary.integration.test.js tests/integration/task-platform-branch-protection.integration.test.js tests/integration/task-platform-source-policy.integration.test.js`
- `npm run maintainability:check`
- `npm run ownership:lint`
- `npm run lint`
- `npm run typecheck`
- `npm run test:contract`
- `npm run coverage`
- `npm run standards:check`
- `npm test`

## Evidence Paths

- `lib/task-platform/merge-readiness-pr-summary.js`
- `lib/task-platform/index.js`
- `tests/unit/task-platform-pr-summary.test.js`
- `tests/integration/task-platform-pr-summary.integration.test.js`
- `docs/api/task-platform-openapi.yml`
- `docs/runbooks/task-platform-rollout.md`
- `.artifacts/coverage-summary.json`

## Coverage

- Node/API line coverage: 88.49%
- UI line coverage: 89.56%
- Minimum suite line coverage: 88.49%
- Policy floor: 80%

## Gaps

No implementation gap remains for issue #116. Posting PR comments and storing `MergeReadinessReview` records are outside this issue scope; this change renders and evaluates summaries from existing structured review records.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring.
- Evidence in this report: acceptance-criteria audit, focused unit/integration tests, OpenAPI/runbook documentation, and source-of-truth precedence verification.
- Gap observed: none for issue #116. Documented rationale: the comment is a derived view and the structured `MergeReadinessReview` remains authoritative (source https://github.com/wiinc1/engineering-team/issues/116).

## Required Evidence

- Commands run: focused PR-summary unit/integration tests; adjacent task-platform merge-readiness unit/integration tests; `node --check lib/task-platform/merge-readiness-pr-summary.js`; `npm run maintainability:check`; `npm run ownership:lint`; `npm run lint`; `npm run typecheck`; `npm run test:contract`; `npm run coverage`; `npm run standards:check`; `npm test`.
- Tests added or updated: `tests/unit/task-platform-pr-summary.test.js`; `tests/integration/task-platform-pr-summary.integration.test.js`; `package.json`; `scripts/run-coverage.js`; `config/change-ownership-map.json`.
- Rollout or rollback notes: rollout is additive and derives comment text from existing structured reviews. Roll back by reverting the renderer, exports, tests, and docs; stop posting derived comments if a downstream comment-publishing integration is noisy.
- Docs updated: `docs/api/task-platform-openapi.yml`, `docs/runbooks/task-platform-rollout.md`, and issue #116 reports.
