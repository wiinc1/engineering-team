# Merge Readiness Enforcement Runbook

## Purpose

Use this runbook when enabling or debugging the structured `Merge readiness` gate for autonomous workflow pull requests.

## Preconditions

- `FF_MERGE_READINESS_ENFORCEMENT` is enabled.
- `MERGE_READINESS_ENFORCEMENT_TARGET=autonomous` until the default branch is verified.
- GitHub credentials can create or update check runs and read branch protection.
- Branch protection requires the exact check name `Merge readiness` before expanding to all PRs.

## Evaluation Flow

1. A PR, check, workflow, status, preview, or deployment event triggers merge-readiness refresh.
2. Required checks and policy-selected evidence are evaluated for the exact PR HEAD SHA.
3. Missing required evidence records `blocked`; inaccessible required evidence records `error`.
4. Configuration or permission failures create a `policy_blocked` exception.
5. Blocking findings remain blocked unless an explicit deferral policy, follow-up link, Product Manager risk acceptance, technical-owner risk acceptance, and Principal/SRE high-risk approval are present.
6. Branch protection must require `Merge readiness`; otherwise the control plane records `policy_blocked`.
7. The GitHub check uses the structured review only. PR comments are summaries and cannot make readiness pass.

## Verification

```bash
npm run task-platform:verify-branch-protection -- wiinc1/engineering-team main
```

Expected enforced output includes:

```json
{
  "status": "enforced",
  "enforced": true,
  "requiredCheckName": "Merge readiness"
}
```

Expected missing-policy output includes `status: "policy_blocked"` and `owner: "repo-admin"` in exceptions.

## Rollback

1. Set `FF_MERGE_READINESS_ENFORCEMENT=0`.
2. Keep historical `MergeReadinessReview` records readable.
3. Stop GitHub check-run emission by removing the check-run client configuration if needed.
4. Keep branch-protection changes in place unless a repo admin explicitly approves changing required checks.

## Standards Alignment

- Applicable standards areas: deployment and release, testing and quality assurance, observability and monitoring, security and compliance, team and process.
- Gap observed: autonomous workflow PRs could previously rely on humans interpreting logs and comments before merge. Documented rationale: issue #212 requires an authoritative structured gate for the reviewed commit and evidence fingerprint.

## Required Evidence

- Commands run: `npm run test:unit`, `npm run test:integration:api`, `npm run test:contract`, `npm run test:security`, `npm test`, `npm run standards:check`.
- Tests added or updated: merge-readiness gate, branch-protection enforcement, security, contract, and workflow tests.
- Docs updated: this runbook, branch protection guide, feature flag docs, API docs, and Mermaid workflow diagram.
