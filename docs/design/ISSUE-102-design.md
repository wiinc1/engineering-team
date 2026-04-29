# Issue 102 Design

## Research & Context

Issue #102 implements the next narrow capability after US-003: generate a structured, versioned Execution Contract from an existing Intake Draft without dispatching implementation.

The accepted domain context in `CONTEXT.md` and `docs/refinement/CONTEXT-2026-04-28-software-factory-execution-contracts.md` defines the Execution Contract as authoritative structured Task data. A Markdown user story is a generated view for review and repo artifacts, not the source of truth.

## Gap Analysis

Existing US-003 behavior created Intake Draft tasks with raw operator requirements and PM refinement routing. It did not model the refined contract as structured data, enforce template-tier sections, track material contract versions, or generate Markdown from structured contract state.

Implemented gap closure:
- Added `lib/audit/execution-contracts.js` for tier rules, structured contract generation, validation, material-change detection, and Markdown rendering.
- Added audit events for `task.execution_contract_version_recorded`, `task.execution_contract_validated`, and `task.execution_contract_markdown_generated`.
- Projected latest contract version, validation status, and Markdown metadata into task state and detail/list summaries.
- Added `POST /tasks/{id}/execution-contract`, `POST /tasks/{id}/execution-contract/validate`, and `POST|GET /tasks/{id}/execution-contract/markdown`.
- Preserved PM ownership through `owner=pm`, current-state assignment, and PM/admin-only mutation checks.
- Kept implementation dispatch blocked by the existing Intake Draft workflow guard.

## User Story

As a Product Manager,
I want to generate a structured, versioned Execution Contract from an Intake Draft,
so that operator requirements can become approval-ready delivery instructions without treating Markdown or implementation dispatch as the source of truth.

## Acceptance Criteria Mapping

1. Intake Draft to draft contract: `POST /tasks/{id}/execution-contract` creates version 1 for the same Task and records `task.execution_contract_version_recorded`.
2. Tier validation: `validateExecutionContract` enforces Simple, Standard, Complex, and Epic required sections.
3. Material changes: material section/tier/reviewer changes produce a new version with a new material hash.
4. Markdown view: `POST /tasks/{id}/execution-contract/markdown` generates non-authoritative Markdown from the structured latest version.

## Architecture

The implementation remains audit-backed and additive:
- The authoritative contract is stored in audit event payloads and derived projections.
- Current-state projection carries the latest version and validation status for list/detail use.
- Detail context exposes the latest structured contract and generated Markdown metadata.
- No database migration is required for the file-backed and existing projection model.

## Rollout

The feature is guarded by `FF_EXECUTION_CONTRACTS` / `ff_execution_contracts` and defaults on, following existing repo feature-flag behavior.

Rollback path: disable `FF_EXECUTION_CONTRACTS` to stop contract reads and mutations while retaining historical audit events. Existing Intake Draft creation remains controlled separately by `FF_INTAKE_DRAFT_CREATION`.
