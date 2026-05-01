# Software Factory Control Plane PRD

## Status

Accepted source artifact restored by the Issue #104 residual-gap follow-up.

This PRD is derived from accepted repository artifacts because no earlier `docs/product/software-factory-control-plane-prd.md` revision exists in git history. Source artifacts:

- `CONTEXT.md`
- `docs/refinement/CONTEXT-2026-04-28-software-factory-execution-contracts.md`
- `docs/adr/ADD-2026-04-28-intake-draft-as-task-stage.md`
- Issue #104
- PR #100

## Product Summary

The Software Factory control plane is an internal product for creating, assigning, executing, reviewing, and closing software work across humans and AI agents. It is not only a Kanban board. Board, inbox, task-detail, and PR views are projections over the same audited task lifecycle.

The control plane must make work understandable, routable, verifiable, and recoverable before agent implementation starts. Structured Task data is the authoritative state. Markdown repo artifacts are durable generated views for human review, PRs, docs, and long-term auditability.

## Primary Users

- Software Factory operator: creates initial requirements, approves or corrects refined scope, and closes verified work.
- Product Manager: owns refinement and the complete Execution Contract.
- Architect: owns technical feasibility, API, data, architecture, security, and tiering decisions when triggered.
- UX Designer: owns human workflow, accessibility, task-detail hierarchy, role queues, and user-facing trust signals.
- QA: owns testability, acceptance evidence mapping, and automated verification expectations.
- SRE: owns rollout, rollback, observability, production evidence, and reliability review when triggered.
- Engineer: implements the approved Execution Contract through the specialist delivery workflow.

## Lifecycle Requirements

The canonical lifecycle is:

1. Intake Draft
2. Task Refinement
3. Operator Approval
4. Implementation
5. QA Verification
6. SRE Verification
7. Operator Closeout

An Intake Draft is the first stage of the same Task, not a separate intake object. The Task ID, task detail surface, audit trail, refinement threads, generated artifacts, PRs, commits, and evidence must stay anchored to the same Task.

## Execution Contract Requirements

Task Refinement produces a structured, versioned Execution Contract owned by the Product Manager. The contract is the dispatch source only after required role approvals and Operator Approval or policy-based auto-approval are recorded.

The Execution Contract uses `docs/templates/USER_STORY_TEMPLATE.md` sections by tier:

- Simple: sections 1, 2, 4, 11, 12, 15, 16, and 17.
- Standard: sections 1 through 4, 6 through 7, 10 through 12, and 15 through 17.
- Complex: sections 1 through 12 and 14 through 17.
- Epic: sections 1 through 17.

Material changes create a new Execution Contract version. Typo fixes and non-substantive formatting corrections may be metadata-only edits.

## Task ID And Repo Artifact Requirements

Production Task display IDs are generated at Intake Draft creation, are sequential and never reused, use `TSK-123` format, and are used in filenames, PR titles, operator conversation, dashboards, and repo artifacts.

Staging and local artifacts must use environment-prefixed aliases such as `STG-123` or `LOCAL-123`, or avoid committed repo artifacts. Non-production artifacts must not collide with production Task display IDs.

Approved Execution Contracts may generate a reviewable artifact bundle containing:

- generated Markdown user story under `docs/user-stories/`
- Refinement Decision Log under `docs/refinement/`
- verification report skeleton when in scope
- Contract Coverage Audit Markdown view when applicable
- ADR draft when ADR criteria are met

Generated artifacts use display ID plus slug filenames. Approved generated stories are immutable for material changes; later material changes require a new contract version or amendment.

## Artifact Approval Requirements

Artifact bundles must be reviewable before commit. Commit readiness requires Product Manager approval plus any section-owner approvals implied by generated content:

- Architect approves architecture, API, data, and security sections.
- UX approves UX, workflow, and accessibility sections.
- QA approves verification expectations and Contract Coverage Audit views.
- SRE approves rollout, rollback, observability, and production evidence sections.

Operator approval is exception-triggered, not routine. It is required when generated artifact content reveals a scope mismatch, promotes a Deferred Consideration, changes a committed requirement, accepts unresolved non-blocking comments, or is bundled with Operator Approval or Operator Closeout.

GitHub issues are optional and default-off. The Task is the authoritative workflow record; the remote repo is the durable audit surface through committed artifacts and PRs.

## Success Measures

The primary product metric is operator-trusted autonomous delivery rate: the percentage of approved or auto-approved tasks that reach verified closeout without operator intervention after approval while still passing QA, SRE, and required evidence gates.

Supporting measures:

- task refinement completion rate
- approval rework rate
- implementation return-to-engineer rate
- escaped requirement defects
- artifact approval cycle time
- generated artifact collision or immutability violations

## Non-Goals

- Replacing structured Task data with Markdown as the source of truth.
- Requiring GitHub issue creation for every task.
- Dispatching implementation before Execution Contract approval.
- Using Principal Engineer as the default implementation lane.
- Treating manual testing as sufficient completion evidence.
