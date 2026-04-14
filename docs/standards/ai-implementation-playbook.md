# AI Implementation Playbook For Software Development Standards

## Purpose
This document captures the standards-governance system implemented in this repo and rewrites it as a reusable implementation recipe for another project.

Use it when an AI agent or engineering team needs to:
- introduce a standards baseline into an existing repo
- turn that baseline into enforced repo policy
- connect runtime code changes to matching tests and documentation
- make governance rules maintainable through config rather than checker edits
- validate that the governance layer itself is tested
- make the resulting checks operationally mandatory through protected-branch policy

This document is written as an implementation playbook, not as a retrospective narrative.

## Starting Point
The source standards model was a first-principles standards document covering:
- architecture and design
- coding and code quality
- testing and quality assurance
- deployment and release
- observability and monitoring
- team and process

The key requirement was not to store the standards as passive documentation only. The repo needed to make them difficult to ignore by:
- requiring standards metadata in delivery artifacts
- requiring PR evidence
- failing CI when those artifacts were missing or incomplete
- failing CI when runtime code changed without adjacent tests and docs
- failing CI when the changed tests or docs were unrelated to the changed runtime domain
- surfacing governance drift before it becomes systemic

## Final Governance Model
The completed model in this repo has seven layers:

### 1. Canonical standards baseline
One standards document defines the factual baseline and repo enforcement policy.

In this repo:
- `docs/standards/software-development-standards.md`

It defines:
- the standards themselves
- source-backed rationale
- the required gap statement format
- the repo enforcement policy

### 2. Standards-bearing delivery artifacts
Governed artifacts must carry explicit standards metadata.

In this repo:
- tasks under `tasks/`
- ADRs under `docs/adr/`
- reports under `docs/reports/`
- pull requests via `.github/PULL_REQUEST_TEMPLATE.md`

Each governed document must include:
- `## Standards Alignment`
- `## Required Evidence`

### 3. Repo-level validation scripts
Small CLI scripts enforce the rules locally and in CI.

In this repo:
- `scripts/verify-standards.js`
- `scripts/verify-pr-body.js`
- `scripts/verify-change-completeness.js`
- `scripts/lint-change-ownership-map.js`
- `scripts/governance-drift.js`

### 4. Domain-aware ownership map
Runtime areas are mapped to the exact tests and docs that must move with them.

In this repo:
- `config/change-ownership-map.json`
- `docs/standards/change-governance-maintenance.md`

### 5. Direct governance tests
The governance scripts are tested as black-box CLIs.

In this repo:
- `tests/unit/governance/`

### 6. CI enforcement
Validation runs in GitHub Actions and blocks merges when required checks fail.

In this repo:
- `.github/workflows/validation.yml`
- `.github/workflows/governance-drift.yml`

### 7. Protected-branch operational policy
The required CI checks are documented as mandatory branch-protection settings.

In this repo:
- `.github/BRANCH_PROTECTION.md`

## Required Artifacts
Another project implementing this pattern should create, at minimum:
- one canonical standards document
- one standards compliance checklist template
- one ADR template
- one report template
- one PR template
- one standards checker
- one PR body checker
- one diff-based change checker
- one ownership-map config file
- one ownership-map maintainer guide
- one ownership-map lint check
- one governance drift report check
- one governance test suite
- one branch-protection policy document
- CI wiring for all of the above

## Implementation Strategy
Apply the rollout in this order.

### 1. Establish a canonical standards baseline
Create a standards document that becomes the repo source of truth.

Required contents:
- the standards themselves
- allowed evidence sources
- required gap statement format
- explicit repo enforcement policy

In this repo:
- `docs/standards/software-development-standards.md`

Required policy statements:
- task files must include `## Standards Alignment` and `## Required Evidence`
- ADRs must include `## Standards Alignment` and `## Required Evidence`
- reports must include `## Standards Alignment` and `## Required Evidence`
- pull requests must include standards evidence
- CI must run a standards checker
- diff-based adjacency rules must be maintained in config
- branch protection must require the validation jobs

### 2. Require standards metadata in human-facing artifacts
Add reusable templates so future work starts from the required structure instead of retrofitting it later.

Create:
- standards compliance checklist template
- ADR template
- report template
- PR template

In this repo:
- `docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md`
- `docs/templates/ADR_TEMPLATE.md`
- `docs/templates/REPORT_TEMPLATE.md`
- `.github/PULL_REQUEST_TEMPLATE.md`

Then normalize existing artifacts so the checker can be enabled immediately.

At minimum, each governed document must contain:
- `## Standards Alignment`
- `## Required Evidence`

`Standards Alignment` must include:
- applicable standards areas
- evidence expected for the change, decision, or report
- a gap statement in this form:
  - `Gap observed: X. Documented rationale: Y (source Z).`

`Required Evidence` must include:
- commands run
- tests added or updated
- rollout or rollback notes
- docs updated

The PR template should also include:
- `Test evidence paths:`
- `Doc evidence paths:`

### 3. Add repository-level governance checks
Implement small CLI checks that fail fast and are safe to run in CI.

In this repo:
- `scripts/verify-standards.js`
- `scripts/verify-pr-body.js`
- `scripts/verify-change-completeness.js`
- `scripts/lint-change-ownership-map.js`
- `scripts/governance-drift.js`

#### Standards checker
Validate that:
- canonical standards docs and templates exist
- branch-protection guidance exists
- required sections exist in tasks, ADRs, and reports
- required fields are populated
- placeholder values are rejected
- standards areas map to known categories
- gap statements include both `Documented rationale:` and a source URL

Command surface:
- `npm run standards:check`

#### PR body checker
Validate that the PR body contains non-empty values for:
- linked task
- standards baseline reviewed
- checklist completed or updated
- compliance checklist path
- relevant standards areas
- standards gaps or exceptions
- standards check result
- lint result
- tests
- test evidence paths
- docs updated
- doc evidence paths
- risk level
- rollback path

Also validate that:
- every path listed under `Test evidence paths:` was changed in the PR diff
- every path listed under `Doc evidence paths:` was changed in the PR diff

Command surface:
- `npm run pr:check`

#### Change completeness checker
Validate the actual diff, not file existence alone.

It must fail when:
- runtime changes have no matching tests
- runtime changes have no matching docs
- runtime files are not mapped to any ownership domain
- required test evidence groups for a domain are missing
- required doc evidence groups for a domain are missing

Command surface:
- `npm run change:check`

#### Ownership-map lint
Validate the ownership-map config itself.

It should fail when:
- domains have duplicate names
- domains match no runtime files
- requirement groups match no files
- important runtime files are unmapped
- config structure is malformed

Command surface:
- `npm run ownership:lint`

#### Governance drift reporting
Produce a report of current governance coverage and optionally fail on drift.

It should surface:
- domains and their runtime-file counts
- unmapped runtime files
- stale or missing domain coverage problems

Command surface:
- `npm run governance:drift`
- `npm run governance:drift:check`

### 4. Add domain-aware adjacency rules
Do not accept repo-wide “any doc” and “any test” as sufficient. Use domain ownership rules so code changes are tied to the nearest evidence.

Externalize the rules into config.

In this repo:
- `config/change-ownership-map.json`
- `docs/standards/change-governance-maintenance.md`

The ownership map should define:
- `classification`
- `domains`

`classification` should define:
- runtime roots or runtime patterns
- test patterns
- doc patterns
- non-runtime exclusions

Each domain should define:
- `name`
- `runtime_patterns`
- `test_requirements`
- `doc_requirements`

Prefer named requirement groups instead of a single flat list. That allows exact enforcement by evidence category.

Example intent:
- backend API changes may require both contract and security coverage
- UI shell changes may require UI/browser coverage and matching API or runbook docs
- migration changes may require integration evidence plus rollout/runbook updates

Required behavior:
- if runtime files change in a mapped domain, at least one changed file must satisfy every required test group for that domain
- if runtime files change in a mapped domain, at least one changed file must satisfy every required doc group for that domain
- if a runtime file matches no domain, the check must fail with an unmapped-domain error
- governance-only script changes can be explicitly excluded from adjacency rules when appropriate

### 5. Add branch-protection policy
Document the exact required CI status checks and the protected-branch settings.

In this repo:
- `.github/BRANCH_PROTECTION.md`

At minimum, document:
- exact required job names
- whether governance drift is blocking or advisory
- that direct pushes to the protected branch are restricted
- that stale approvals should be dismissed on new commits

Protected-branch policy should require these validation jobs:
- pull-request metadata
- repo validation
- browser validation

If governance drift is treated as blocking, require that as well.

## Execution Plan That Was Defined
The implementation plan used for this repo was:

1. Add a canonical standards document and repo enforcement policy.
2. Add templates for standards compliance, ADRs, reports, and PRs.
3. Add a standards checker and wire it into CI.
4. Normalize existing task files so the checker can be turned on immediately.
5. Tighten the standards checker from section presence to content validation.
6. Add PR-body validation so evidence fields cannot be skipped.
7. Add diff-based change completeness validation.
8. Tighten that validation with domain-aware adjacency rules.
9. Externalize domain rules into config.
10. Add direct automated tests for the governance scripts.
11. Add PR-body-to-diff validation for evidence paths.
12. Add exact required evidence groups per domain instead of loose “any test/any doc” matching.
13. Add ownership-map linting.
14. Add governance drift reporting.
15. Add explicit branch-protection and required-status documentation.
16. Run full repo validation to confirm the governance layer does not break the project.

This order matters. It keeps the rollout additive and avoids enabling a gate before the repo can satisfy it.

## Concrete Steps Taken In This Repo
The following sequence was executed.

### Step 1. Added the standards baseline
Created:
- `docs/standards/software-development-standards.md`

Added:
- first-principles standards
- source-backed references
- repo enforcement policy
- required gap statement format

### Step 2. Added standards-bearing templates
Created:
- `docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md`
- `docs/templates/ADR_TEMPLATE.md`
- `docs/templates/REPORT_TEMPLATE.md`
- `.github/PULL_REQUEST_TEMPLATE.md`

Updated:
- `docs/templates/USER_STORY_TEMPLATE.md`

### Step 3. Added standards metadata to existing governed documents
Updated:
- existing task files in `tasks/`
- existing ADRs in `docs/adr/`
- existing reports in `docs/reports/`
- agent guidance in `agents/README.md`
- repo guidance in `README.md`

### Step 4. Added the first standards checker
Created:
- `scripts/verify-standards.js`

Wired into:
- `package.json` as `npm run standards:check`
- `.github/workflows/validation.yml`

### Step 5. Tightened standards validation
Extended the checker to validate:
- non-placeholder content
- known standards areas
- structured gap statements with source URLs
- tasks, ADRs, and reports rather than tasks only

### Step 6. Added PR metadata validation
Created:
- `scripts/verify-pr-body.js`

Wired into:
- `package.json` as `npm run pr:check`
- the pull-request CI job in `.github/workflows/validation.yml`

### Step 7. Added diff-based change completeness checks
Created:
- `scripts/verify-change-completeness.js`

Initial behavior:
- fail if runtime code changed without tests
- fail if runtime code changed without docs

### Step 8. Added domain-aware adjacency
Introduced domain-specific mapping between:
- runtime files
- tests
- docs

This prevented unrelated docs from satisfying the check.

### Step 9. Externalized the ownership map
Created:
- `config/change-ownership-map.json`
- `docs/standards/change-governance-maintenance.md`

Updated:
- `scripts/verify-change-completeness.js` to load config

### Step 10. Added direct tests for the governance layer
Created:
- `tests/unit/governance/helpers.js`
- `tests/unit/governance/verify-standards.test.js`
- `tests/unit/governance/verify-pr-body.test.js`
- `tests/unit/governance/verify-change-completeness.test.js`
- `tests/unit/governance/ownership-map.test.js`

Wired into:
- `package.json` as `npm run test:governance`
- `npm run test:unit`

Testing model:
- use temp directories
- use temp git repos for diff-based checks
- run the scripts as black-box CLIs
- assert both pass and fail cases

### Step 11. Tightened PR evidence validation
Extended the PR checker so it now:
- requires `Test evidence paths:`
- requires `Doc evidence paths:`
- verifies those listed paths are actually present in the PR diff

### Step 12. Tightened domain evidence enforcement
Extended the ownership map and change checker so they now enforce exact named requirement groups rather than loose “one matching test” and “one matching doc” behavior.

Examples:
- a domain can require both contract and security tests
- a domain can require both API and runbook/design evidence

### Step 13. Added ownership-map linting
Created:
- `scripts/lint-change-ownership-map.js`

Wired into:
- `package.json` as `npm run ownership:lint`
- `.github/workflows/validation.yml`

### Step 14. Added governance drift reporting
Created:
- `scripts/governance-drift.js`
- `.github/workflows/governance-drift.yml`

Wired into:
- `package.json` as `npm run governance:drift`
- `package.json` as `npm run governance:drift:check`

### Step 15. Added branch-protection policy
Created:
- `.github/BRANCH_PROTECTION.md`

Updated:
- `docs/standards/software-development-standards.md`
- `docs/standards/change-governance-maintenance.md`
- `scripts/verify-standards.js`

### Step 16. Validated the full repo
Commands run successfully:
- `npm run standards:check`
- `npm run pr:check`
- `npm run change:check`
- `npm run ownership:lint`
- `npm run governance:drift`
- `npm run test:governance`
- `npm run lint`
- `npm run test:unit`
- `npm run test:browser`
- `npm test`

Observed result:
- governance checks passed
- ownership-map lint passed
- governance drift reporting passed
- governance tests passed
- unit, UI, browser, and full repo validation passed

## How To Implement This In Another Project
Use the following exact sequence.

### Phase A. Explore before editing
Before adding any standards machinery:
- inspect repo structure
- identify existing docs, PR templates, CI workflows, and test commands
- identify the real runtime directories
- identify the real test directories
- identify nearest operator, ADR, design, API, and runbook docs
- identify which runtime changes should count as governed product code

Do not define domain rules before this exploration. The map must reflect the actual repo, not a generic template.

### Phase B. Add governance scaffolding
Create:
- `docs/standards/software-development-standards.md`
- standards compliance checklist template
- ADR template
- report template
- PR template

Then normalize enough existing tasks/docs so enabling the checker will not immediately fail every branch.

### Phase C. Add the checkers
Implement:
- standards artifact checker
- PR body checker
- diff-based change completeness checker
- ownership-map lint checker
- governance drift reporter

Expose them as stable package commands.

### Phase D. Wire into CI
Minimum CI jobs:
- pull-request metadata validation
- standards artifact validation
- existing repo test suite
- browser suite if the repo uses browser tests

For PR diff checks, make sure CI fetches enough history to diff base and head.

### Phase E. Add the ownership map
Externalize domain rules into config.

Start with the highest-value runtime areas first:
- API and auth
- primary UI shell
- core backend service modules
- migrations
- operational workflows

Then expand coverage until all important runtime paths belong to at least one domain.

Prefer exact requirement groups over flat pattern lists.

### Phase F. Tighten evidence quality
Do not stop at “some test changed” and “some doc changed.”

Add:
- exact named test requirement groups per domain
- exact named doc requirement groups per domain
- PR evidence-path validation against the actual diff

This is the step that turns the governance system from broad completeness checking into domain-aware evidence enforcement.

### Phase G. Test the governance layer itself
Add direct automated tests that verify:
- known good fixtures pass
- malformed docs fail
- incomplete PR bodies fail
- PR evidence paths fail if they were not changed
- runtime-only diffs fail
- runtime plus matching tests and docs pass
- missing required evidence groups fail
- unmapped runtime files fail
- malformed ownership-map config fails

### Phase H. Add operational policy
Document the protected-branch requirements and exact required CI job names.

Do not assume admins will infer them from the workflow file.

### Phase I. Run full project validation
Only consider the rollout complete when the project’s existing main validation path also passes.

## Defaults And Non-Negotiable Rules
Use these defaults unless the target repo has a stronger established convention.

- Keep standards enforcement additive. Do not block merges until the repo has been normalized enough to satisfy the rules.
- Externalize ownership rules into config rather than hardcoding them in the checker.
- Test governance scripts as black-box CLIs.
- Reject placeholder evidence values.
- Require source-backed gap statements.
- Treat unmapped runtime files as a failure, not a warning.
- Prefer narrow domain rules over catch-all rules.
- Require adjacent docs that reflect the changed surface, not arbitrary repo docs.
- Prefer exact named evidence groups over loose repo-wide matching.
- Treat protected-branch required statuses as part of the implementation, not optional follow-up work.

## Acceptance Criteria
The migration is complete when:
- standards-bearing tasks, ADRs, and reports are required
- PRs cannot omit standards evidence
- PR evidence paths must refer to files actually changed in the PR
- runtime changes cannot merge without adjacent tests and docs
- runtime changes cannot merge unless every required evidence group for the affected domain is satisfied
- every important runtime path belongs to a domain
- the ownership map is linted automatically
- governance drift is reported automatically
- governance scripts have automated tests
- protected branches require the validation status checks
- the project’s normal validation flow still passes
