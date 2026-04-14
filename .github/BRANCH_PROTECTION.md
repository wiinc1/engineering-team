# Branch Protection And Required Status Checks

## Purpose
This repo treats the governance and validation workflows as merge-blocking controls, not advisory checks.

Protect the default branch and require pull requests before merge.

## Required Status Checks
Require these exact GitHub Actions job names before merge:
- `Pull request metadata`
- `Repo validation`
- `Browser validation`

Require this job if governance drift is treated as blocking in your environment:
- `Governance drift report`

## Required Pull Request Settings
- Require a pull request before merging.
- Require status checks to pass before merging.
- Require branches to be up to date before merging.
- Dismiss stale approvals when new commits are pushed.
- Restrict direct pushes to the protected branch.

## Mapping To Workflow Files
- `.github/workflows/validation.yml`
- `.github/workflows/governance-drift.yml`

## Maintainer Notes
- If a workflow job name changes, update this file and any downstream org policy that references the old status name.
- Do not mark a status as required unless the corresponding workflow runs on pull requests for the protected branch.
- If governance drift should be advisory only, leave `Governance drift report` out of the required-check list but keep the scheduled workflow enabled.
