# Standards Compliance Checklist

## Linked Standards

- Standards document: `docs/standards/software-development-standards.md`
- Required gap statement format: `Gap observed: X. Documented rationale: Y (source Z).`

## Change Metadata

- Change or task ID: GitHub issue #214
- Owner: Codex implementation agent
- Date: 2026-05-18
- Scope summary: Document Clawpatch usage boundaries, setup validation, optional/fallback workflow, failure recovery, evidence requirements, and supervised pilot references for autonomous workflow operators.

## Standards Alignment

- Standards baseline reviewed: `docs/standards/software-development-standards.md`
- Applicable standards areas: documentation; team and process; security and compliance; testing and quality assurance; deployment and release.
- Evidence expected for this change: Clawpatch operator runbook, decision table, setup/smoke instructions, workflow diagram, failure-mode documentation, pilot runbook reference, external URL validation, and required validation commands.
- Gap observed: issue #207 contains only the Clawpatch installation link and no repo-specific workflow guidance. Documented rationale: operators need repo-specific boundaries before using a patch tool in an autonomous implementation workflow (source https://github.com/wiinc1/engineering-team/issues/207).

## Architecture and Design

- Applicable: Yes
- Evidence in this change: `docs/runbooks/clawpatch-autonomous-workflow.md`, `docs/runbooks/supervised-autonomous-pilot.md`, and `docs/diagrams/workflow-clawpatch-autonomous-operator-runbook.mmd`
- Gap observed: Clawpatch is not a governed control-plane component in this repository. Documented rationale: Issue #214 scopes Clawpatch as optional operator tooling guidance, not runtime architecture or connector implementation (source https://github.com/wiinc1/engineering-team/issues/214).

## Coding and Code Quality

- Applicable: No
- Evidence in this change: No runtime code changed.
- Gap observed: No Clawpatch automation is added. Documented rationale: Issue #214 instructs not to install or run Clawpatch as part of implementation unless required for documentation validation (source https://github.com/wiinc1/engineering-team/issues/214).

## Testing and Quality Assurance

- Applicable: Yes
- Evidence in this change: Documentation validation commands and external installation URL validation.
- Gap observed: No executable smoke automation is added. Documented rationale: The issue marks tests as not applicable unless setup smoke automation is added; this PR documents a smoke path without adding runtime tooling (source https://github.com/wiinc1/engineering-team/issues/214).

## Deployment and Release

- Applicable: Yes
- Evidence in this change: Runbook states Clawpatch does not bypass branch protection, PR checks, Vercel, QA, SRE, or closeout.
- Gap observed: No runtime rollout or feature flag exists. Documented rationale: The change is documentation-only and can be rolled back by reverting the documentation PR (source https://github.com/wiinc1/engineering-team/issues/214).

## Observability and Monitoring

- Applicable: Yes
- Evidence in this change: Runbook requires closeout notes and future task evidence to state whether Clawpatch was used.
- Gap observed: No automated retrospective signal is added. Documented rationale: Issue #214 lists future optional signal recording but does not require runtime observability changes (source https://github.com/wiinc1/engineering-team/issues/214).

## Authentication and Secret Handling

- Applicable: Yes
- AuthN/AuthZ surfaces changed: None.
- Secret, token, cookie, password, or PII redaction evidence: Runbook forbids putting secrets, credentials, customer records, production env values, or restricted data into Clawpatch prompts, reports, configs, issues, PR bodies, or logs.
- Abuse-control or rate-limit evidence: Not applicable to this documentation-only slice.
- Rollback or removal impact: Revert the runbook, diagram, pilot-runbook reference, and checklist.
- Gap observed: Clawpatch setup can create local tool state outside this repo's current tracked workflow. Documented rationale: The runbook treats Clawpatch-generated local state as generated tooling state unless a task explicitly requires committing it (source https://clawpatch.ai/#installation).

## Team and Process

- Applicable: Yes
- Evidence in this change: Operator decision table, fallback path, failure recovery table, evidence checklist, and supervised pilot reference.
- Gap observed: Operators previously had no repo-specific answer for whether Clawpatch is required, optional, or out of scope. Documented rationale: Issue #214 requires clear guidance before repeated autonomous workflow pilots (source https://github.com/wiinc1/engineering-team/issues/214).

## Required Evidence

- Commands run: `curl -I -L https://clawpatch.ai/#installation`; `npm run standards:check`; `npm run lint`; `npm run change:check`; `git diff --check`; `npm test`; `npm run build`.
- Tests added or updated: None; documentation-only runbook and diagram.
- Rollout or rollback notes: No runtime rollout; rollback is a normal git revert of the documentation changes.
- Docs updated: `docs/runbooks/clawpatch-autonomous-workflow.md`; `docs/runbooks/supervised-autonomous-pilot.md`; `docs/diagrams/workflow-clawpatch-autonomous-operator-runbook.mmd`; this checklist.
