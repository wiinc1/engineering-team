# Standards Compliance Checklist

## Linked Standards

- Standards document: `docs/standards/software-development-standards.md`
- Required gap statement format: `Gap observed: X. Documented rationale: Y (source Z).`

## Change Metadata

- Change or task ID: GitHub issue #212
- Owner: Codex implementation agent
- Date: 2026-05-17
- Scope summary: Enforce structured merge readiness for autonomous workflow PRs using feature-flag targeting, branch-protection verification, blocking-finding deferral policy, GitHub check projection, PR summary safety, and runbook evidence.

## Standards Alignment

- Applicable standards areas: architecture and design; coding and code quality; testing and quality assurance; deployment and release; observability and monitoring; authentication and secret handling; team and process.
- Evidence expected for this change: GitHub check-run behavior, branch-protection verification, evidence inventory policy tests, invalidation tests, PR summary tests, deferral policy tests, workflow diagram, runbook, and API documentation.
- Gap observed: autonomous workflow readiness could still be treated as advisory unless enforcement targeting and deferral policy were applied to persisted reviews. Documented rationale: issue #212 requires a structured gate that blocks stale, inaccessible, incomplete, or policy-unverified evidence before merge (source https://github.com/wiinc1/engineering-team/issues/212).

## Architecture and Design

- Applicable: Yes
- Evidence in this change: `lib/task-platform/merge-readiness-enforcement.js`, `lib/task-platform/merge-readiness-gate.js`, `lib/task-platform/index.js`, and `docs/diagrams/workflow-autonomous-merge-readiness-enforcement.mmd`.
- Gap observed: enforcement targeting was not explicit for autonomous workflow PR rollout.
- Documented rationale and source: feature-flagged rollout lets autonomous PRs enforce first, then all PRs after branch protection is confirmed (source issue #212).

## Coding and Code Quality

- Applicable: Yes
- Evidence in this change: scoped helper modules and task-platform wrapper integration, with existing source-policy, branch-protection, GitHub-check, and PR-summary components reused.
- Gap observed: deferral policy was reusable but not applied to persisted review status before check-run emission.
- Documented rationale and source: merge readiness must remain blocked when blocking finding deferrals lack policy permission or approvals (source issue #212 acceptance criteria).

## Testing and Quality Assurance

- Applicable: Yes
- Evidence in this change: unit coverage for enforcement targeting and deferral blocking, contract coverage for API shape, security coverage for token/config failure and no log-copy leakage, and e2e workflow coverage for PR synchronize invalidation.
- Gap observed: None for the newly enforced behavior.
- Documented rationale and source: automated tests now cover the behavior required by issue #212.

## Deployment and Release

- Applicable: Yes
- Evidence in this change: `FF_MERGE_READINESS_ENFORCEMENT`, `MERGE_READINESS_ENFORCEMENT_TARGET`, branch-protection verifier guidance, and rollback notes.
- Gap observed: live branch protection could not be verified from this local environment because no GitHub OAuth token or `GITHUB_TOKEN` is configured.
- Documented rationale and source: the verifier fails closed with `GITHUB_TOKEN is required`, while automated tests cover enforced and `policy_blocked` branch-protection states; issue #212 requires the control plane to report `policy_blocked` instead of claiming enforcement when branch protection does not require `Merge readiness` (source https://github.com/wiinc1/engineering-team/issues/212).

## Observability and Monitoring

- Applicable: Yes
- Evidence in this change: persisted metadata includes `merge_readiness_enforcement`, `merge_readiness_finding_policy`, `github_merge_readiness_gate`, and branch-protection policy state for inspection.
- Gap observed: dashboard metrics remain existing task-platform evidence artifacts in this slice.
- Documented rationale and source: issue #212 names target counters; this implementation records the structured states those counters aggregate from.

## Authentication and Secret Handling

- Applicable: Yes
- AuthN/AuthZ surfaces changed: No new public route is added; existing merge-readiness review mutation authorization remains in place.
- Secret, token, cookie, password, or PII redaction evidence: GitHub clients fail closed when tokens are missing; PR summaries use allowlisted fields and do not paste raw logs or token-like metadata.
- Abuse-control or rate-limit evidence: Existing authenticated task-platform API controls apply.
- Rollback or removal impact: Disable `FF_MERGE_READINESS_ENFORCEMENT` or GitHub check-run client configuration without deleting historical reviews.
- Gap observed: None for this scope.
- Documented rationale and source: issue #212 requires inaccessible evidence and token/config failures to stay non-passing.

## Team and Process

- Applicable: Yes
- Evidence in this change: branch protection documentation, runbook, API docs, workflow diagram, and this checklist.
- Gap observed: None for handoff artifacts.
- Documented rationale and source: documentation-as-code is required by the repo standards baseline.

## Required Evidence

- Commands run: `node --check lib/task-platform/merge-readiness-enforcement.js` (pass); `node --check lib/task-platform/merge-readiness-gate.js` (pass); `node --check lib/task-platform/index.js` (pass); `node --test tests/unit/task-platform-merge-readiness-gate.test.js tests/unit/task-platform-source-policy.test.js tests/unit/task-platform-github-check.test.js tests/unit/task-platform-branch-protection.test.js tests/unit/task-platform-pr-summary.test.js` (pass, 32 tests); `node --test tests/security/merge-readiness-enforcement.security.test.js tests/e2e/merge-readiness-enforcement.e2e.test.js tests/contract/projects-openapi.contract.test.js` (pass, 5 tests); `node --test tests/unit/task-platform-api.test.js tests/unit/task-platform-merge-readiness-gate.test.js tests/integration/task-platform-pr-summary.integration.test.js` (pass, 18 tests after final wrapper hardening); `npm run test:unit` (pass); `npm run test:integration:api` (pass, 30 tests); `npm run test:contract` (pass, 22 tests); `npm run test:security` (pass, 40 tests); `npm test` (pass, including Playwright 169 passed and 23 skipped); `npm run standards:check` (pass).
- Live branch-protection verifier: `npm run task-platform:verify-branch-protection -- wiinc1/engineering-team main` was attempted and failed closed because this environment has no GitHub OAuth token or `GITHUB_TOKEN`; no repository settings were mutated.
- Tests added or updated: `tests/unit/task-platform-merge-readiness-gate.test.js`, `tests/security/merge-readiness-enforcement.security.test.js`, `tests/e2e/merge-readiness-enforcement.e2e.test.js`, `tests/contract/projects-openapi.contract.test.js`.
- Rollout or rollback notes: See `docs/runbooks/merge-readiness-enforcement.md`, `.github/BRANCH_PROTECTION.md`, and `docs/feature-flags.md`.
- Docs updated: `docs/api/task-platform-openapi.yml`, `docs/diagrams/workflow-autonomous-merge-readiness-enforcement.mmd`, `docs/runbooks/merge-readiness-enforcement.md`, `.github/BRANCH_PROTECTION.md`, and `docs/feature-flags.md`.
