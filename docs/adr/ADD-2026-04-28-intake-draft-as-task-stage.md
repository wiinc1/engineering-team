# Architecture Decision Record: Intake Draft Is a Task Stage

**Date:** 2026-04-28
**Status:** Accepted
**Deciders:** Software Factory operator, Codex

## Context

The Software Factory control plane starts work from operator-authored initial task requirements. Those requirements are an intake draft, not an execution-ready contract.

The product needs to represent that early intake state without losing continuity as Product Manager, Architect, and UX Designer refinement turns the draft into an execution-ready task.

## Decision

Represent Intake Draft as the first stage of the same Task, not as a separate Intake entity.

The same Task ID, task detail surface, and audit trail carry work from Intake Draft through refinement, approval, implementation, QA verification, SRE verification, and operator closeout.

## Rationale

Keeping intake and delivery on the same Task preserves continuity for the operator and avoids forcing users to reconcile a pre-task intake record with a later delivery task.

It also matches the existing repo direction: `/tasks` creation already records `initial_stage: 'DRAFT'`, and the task platform already centers task history, ownership, and detail views around a Task.

## Consequences

### Positive

- One stable Task ID from intake through closeout.
- One audit trail for every requirement, refinement, approval, and delivery event.
- One task detail page can become the control surface for the whole lifecycle.
- Lower product complexity than introducing an Intake-to-Task conversion flow now.

### Negative

- Task schemas and views must distinguish raw intake fields from refined execution-contract fields.
- Task lists and board views need clear filtering or labeling so Intake Drafts are not confused with implementation-ready work.
- Future analytics must avoid treating every created Task as approved delivery demand.

### Neutral

- A separate Intake entity can still be introduced later if the product needs anonymous intake, external submitters, or multi-task decomposition before a Task exists.

## Alternatives Considered

- Separate Intake entity that later becomes one or more Tasks.
- Keep intake as a UI-only draft before creating any server-side record.

## Related Artifacts

- [CONTEXT.md](/Users/wiinc1/repos/engineering-team/CONTEXT.md)
- [src/features/task-creation/TaskCreationForm.tsx](/Users/wiinc1/repos/engineering-team/src/features/task-creation/TaskCreationForm.tsx)
- [lib/audit/http.js](/Users/wiinc1/repos/engineering-team/lib/audit/http.js)

## Standards Alignment

- Applicable standards areas: architecture and design, team and process
- Evidence in this decision: existing `/tasks` creation already writes a `DRAFT` initial stage, while the product glossary defines initial requirements as intake rather than execution-ready work.
- Gap observed: the current task-creation UI still requires execution-contract fields up front. Documented rationale: this ADR establishes the target domain model before implementation changes align the UI and API behavior (source https://github.com/wiinc1/engineering-team/issues/95).

## Required Evidence

- Commands run: `git diff --cached --check`
- Tests added or updated: Documentation-only decision; implementation test coverage is specified in `docs/user-stories/US-003-create-intake-drafts-from-raw-operator-requirements.md`
- Rollout or rollback notes: implementation should remain additive by allowing Intake Draft tasks before changing delivery dispatch behavior
- Docs updated: `CONTEXT.md`, this ADR
