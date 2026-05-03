# Issue 115 Security Audit

## Scope

Issue #115 adds read-only GitHub branch-protection verification for the `Merge readiness` required check. It does not add unauthenticated routes, mutate repository settings, emit GitHub check runs, or copy source logs into review records.

## Findings

No security blockers found.

## Security-Relevant Changes

- GitHub branch-protection verification requires an injected client or `GITHUB_TOKEN`.
- The CLI and library use read-only branch-protection GET requests and never write repository settings.
- Missing, unreadable, or non-enforcing branch protection fails closed as `error` or `policy_blocked`.
- Control-plane metadata represents `enforced=true` only when required status checks include the exact `Merge readiness` name.
- Policy-blocked ownership routes to `repo-admin` for branch-protection settings follow-up.

## Verification

- `node --test tests/unit/task-platform-branch-protection.test.js`
- `node --test tests/integration/task-platform-branch-protection.integration.test.js`
- `node --check scripts/verify-merge-readiness-branch-protection.js`
- `npm run lint`
- `npm run test:contract`
- `npm run coverage`
- `npm test`
- `gh api repos/wiinc1/engineering-team/branches/main/protection`

## Residual Risk

The current live repository setting is not protected for `main`, based on the GitHub API 404 response. That operational state remains non-enforced until a repo admin explicitly updates branch-protection settings outside this code change.

## Standards Alignment

- Applicable standards areas: security and compliance, architecture and design, testing and quality assurance, observability and monitoring.
- Evidence in this report: read-only GitHub API behavior, fail-closed mapping, explicit repo-admin ownership, no settings mutation, and security-relevant tests.
- Gap observed: Live branch protection is currently absent on `main`; no security implementation gap remains. Documented rationale: the verifier fails closed and does not request write permissions or mutate repository settings, matching the issue out-of-scope boundary (source https://github.com/wiinc1/engineering-team/issues/115).

## Required Evidence

- Commands run: `node --test tests/unit/task-platform-branch-protection.test.js`; `node --check scripts/verify-merge-readiness-branch-protection.js`; `npm run lint`; `npm run test:contract`; `npm run coverage`; `npm test`; live `gh api` branch-protection check.
- Tests added or updated: `tests/unit/task-platform-branch-protection.test.js`; `tests/integration/task-platform-branch-protection.integration.test.js`.
- Rollout or rollback notes: rollout is read-only. Repo admins must separately approve any branch-protection setting change; rollback by reverting the verifier and docs.
- Docs updated: `docs/reports/security_audit_ISSUE-115.md`, `.github/BRANCH_PROTECTION.md`, `docs/runbooks/task-platform-rollout.md`.
