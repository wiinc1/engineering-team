# US-003 Design

> Issue #130 standards evidence: mechanical maintainability compaction only; no task-creation design behavior change.

## Research & Context

Issue 95 implements the first narrow slice of the intake-to-execution-ready workflow: capture raw operator requirements as a Task in `DRAFT`, then route the Task to PM refinement. Existing planning artifacts already establish that Intake Draft is a Task stage rather than a separate entity.

Existing repo behavior before this change required execution-contract fields in the browser creation form and API payload. That inverted the lifecycle because business context, acceptance criteria, Definition of Done, priority, and task type are refinement outputs.

## Coverage Gap Analysis

Existing task creation coverage validated refined-field payloads and UI inputs. It did not validate raw-requirements-only intake, optional title handling, PM routing metadata, pre-refinement transition blocking, failure compensation, or the `task.refinement_requested` audit event.

Gap-fill plan implemented in this change:
- update task-creation schema, adapter, and form tests for raw intake payloads
- add audit API coverage for raw Intake Draft creation, list/detail visibility, and history events
- add audit API coverage for title limits, pre-refinement stage-transition blocking, and `task.intake_creation_failed` compensation
- add security coverage for auth, permissions, blank intake input, and `ff_intake_draft_creation`
- add browser-shell coverage for `/tasks/create` submitting raw requirements and opening the created Intake Draft

## User Story

As a Software Factory operator, I want to create an Intake Draft from raw initial requirements, so that the control plane can start PM refinement without requiring me to pre-fill the execution-ready story contract.

Implemented acceptance criteria:
- raw requirements text alone creates a Task in `DRAFT`
- omitted title uses `Untitled intake draft`; priority and task type remain unset
- task list/detail identify Intake Drafts and show `PM refinement required`
- audit history records `task.created` and `task.refinement_requested` without implementation handoff or stage-start events
- Intake Drafts cannot use generic workflow transition controls until PM refinement creates a non-intake execution contract

## Technical Plan

- Keep `POST /tasks` as the authoritative creation endpoint.
- Accept the new intake shape `{ raw_requirements, title? }` while preserving the old refined-field shape for compatibility.
- Store raw intake text on `task.created` and `task.refinement_requested`.
- Add `task.refinement_requested` and compensating `task.intake_creation_failed` to the audit event taxonomy and current-state projection.
- Route Intake Drafts to PM by setting `assignee=pm`, `waiting_state=task_refinement`, and `next_required_action=PM refinement required`.
- Cap optional intake titles at 120 characters and reject overlong titles before task creation.
- Block `task.stage_changed` while an Intake Draft is still waiting on PM refinement.
- Update the browser creation route to collect raw requirements and optional title only.
- Surface Intake Draft badges and operator intake requirements in list/detail views.

## Rollout

The raw intake path is controlled by `FF_INTAKE_DRAFT_CREATION`. Disabling the flag rejects raw intake creation with `503` while leaving legacy refined-field task creation available.

Rollback is to disable `FF_INTAKE_DRAFT_CREATION` and redeploy the prior browser build if UI creation must be temporarily hidden.
