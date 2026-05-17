# Branch Protection And Required Status Checks

## Purpose
This repo treats the governance and validation workflows as merge-blocking controls, not advisory checks.

Protect the default branch and require pull requests before merge.

## Required Status Checks
Require these exact GitHub Actions job names before merge:
- `Pull request metadata`
- `Repo validation`
- `Browser validation`
- `verify`
- `Merge readiness`

Require this job if governance drift is treated as blocking in your environment:
- `Governance drift report`

## Required Pull Request Settings
- Require a pull request before merging.
- Require status checks to pass before merging.
- Require branches to be up to date before merging.
- Dismiss stale approvals when new commits are pushed.
- Restrict direct pushes to the protected branch.

## Mapping To Workflow Files
- `Pull request metadata` in `.github/workflows/validation.yml` runs `npm run pr:check`, `npm run change:check`, and `npm run ownership:lint`.
- `Repo validation` in `.github/workflows/validation.yml` runs `npm run coverage`, `npm run standards:check`, `npm run ownership:lint`, `npm run test:unit`, and the non-browser Node suites.
- `Browser validation` in `.github/workflows/validation.yml` runs `npm run test:browser`.
- `verify` in `.github/workflows/verify.yml` runs `make verify`, which aggregates DESIGN.md gates, standards policy validators, `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:browser`, `npm run build`, `npm run standards:check`, and artifact validators.
- `Merge readiness` is emitted by the task-platform merge-readiness GitHub check integration from the structured review source of truth.
- `Governance drift report` in `.github/workflows/governance-drift.yml` runs `npm run governance:drift:check`.

## Merge Readiness Enforcement Verification

Run this read-only verifier before enabling `MERGE_READINESS_ENFORCEMENT_TARGET=all`:

```bash
GITHUB_TOKEN=<repo-read-token> npm run task-platform:verify-branch-protection -- wiinc1/engineering-team main
```

The control plane may only report merge-readiness enforcement as active when the default
branch requires the exact `Merge readiness` check. If the check is absent from branch
protection, merge-readiness review creation records `policy_blocked` rather than treating
the gate as enforced.

## Maintainer Notes
- If a workflow job name changes, update this file and any downstream org policy that references the old status name.
- Do not mark a status as required unless the corresponding workflow runs on pull requests for the protected branch.
- If governance drift should be advisory only, leave `Governance drift report` out of the required-check list but keep the scheduled workflow enabled.
