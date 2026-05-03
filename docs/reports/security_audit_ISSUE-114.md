# Issue 114 Security Audit

## Scope

Issue #114 adds outbound GitHub check-run emission from existing structured `MergeReadinessReview` data. It does not add unauthenticated routes, branch-protection configuration, copied log storage, or source-inventory policy internals.

## Findings

No security blockers found.

## Security-Relevant Changes

- GitHub check-run writes require an injected client or `GITHUB_TOKEN`; without configuration, the service factory preserves existing local review behavior and does not emit external writes.
- The check-run output is derived from structured review status and linked evidence metadata rather than raw copied logs.
- Missing, stale, pending, blocked, errored, commit-mismatched, and evidence-mismatched states fail closed by returning failure or in-progress check-run payloads instead of success.
- Recursive refresh loops are avoided by ignoring events from the `Merge readiness` check run itself.
- Invalidated reviews preserve audit metadata, including policy version, invalidation reason, latest commit SHA, and evidence fingerprint.

## Verification

- `node --test tests/unit/task-platform-github-check.test.js`
- `node --test tests/integration/task-platform-github-check.integration.test.js`
- `node --test tests/security/audit-api.security.test.js`
- `npm run standards:check`
- `npm test`

## Residual Risk

Operational configuration still controls whether the GitHub checks API can be written. Missing or invalid GitHub credentials cause the check-run client to fail instead of fabricating a passing result, which preserves the merge-readiness fail-closed posture.

## Standards Alignment

- Applicable standards areas: security and compliance, architecture and design, testing and quality assurance, observability and monitoring.
- Evidence in this report: fail-closed mapping, token-scoped outbound write model, recursive-event guard, stale metadata audit trail, and security regression tests.
- Gap observed: No security gap remains for issue #114. Documented rationale: the emitter uses structured review data, requires configured GitHub credentials for external writes, and never maps missing or stale readiness evidence to a passing check (source https://github.com/wiinc1/engineering-team/issues/114).

## Required Evidence

- Commands run: `node --test tests/unit/task-platform-github-check.test.js`; `node --test tests/integration/task-platform-github-check.integration.test.js`; `node --test tests/security/audit-api.security.test.js`; `npm run standards:check`; `npm test`.
- Tests added or updated: `tests/unit/task-platform-github-check.test.js`; `tests/integration/task-platform-github-check.integration.test.js`.
- Rollout or rollback notes: rollout requires check-run client or token configuration; rollback by disabling that configuration or reverting the additive emitter.
- Docs updated: `docs/reports/security_audit_ISSUE-114.md`, `docs/runbooks/task-platform-rollout.md`.
