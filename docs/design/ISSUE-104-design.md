# Issue 104 Design

## Research & Context

Issue #104 builds on the Execution Contract generation and reviewer-gating work from issues #102 and #103. The accepted context in `CONTEXT.md` requires generated Markdown user stories, Refinement Decision Logs, task detail links, and PR guidance to use human-readable Task display IDs while preserving structured Task data as authoritative.

One listed source artifact, `docs/product/software-factory-control-plane-prd.md`, is not present in this checkout. The implemented behavior is based on `CONTEXT.md`, the refinement decision log, the intake ADR, and the linked #102/#103 implementation.

## Gap Analysis

Before this slice, Execution Contracts could generate a non-authoritative Markdown review view, but there was no repo artifact bundle, no display-ID path policy, no artifact-bundle approval gate, no task-detail artifact links, and no default-off GitHub issue policy in the generated guidance.

Implemented gap closure:

- Added artifact-bundle generation for approved Execution Contracts.
- Added production `TSK-123` display-ID validation and staging/local alias generation.
- Added generated user-story and Refinement Decision Log content with durable repo paths.
- Added PM, section-owner, and exception-triggered operator approval routing before commit readiness.
- Added versioned artifact paths after a prior approved story exists.
- Added task detail rendering for generated artifact links and PR guidance.
- Added OpenAPI/runbook documentation for the artifact routes and gates.
- Kept GitHub issue creation default-off unless explicitly requested in the bundle request.

## Architecture

The implementation remains audit-backed and additive:

- `lib/audit/execution-contracts.js` owns artifact identity, path generation, artifact content, approval routing, and commit-readiness evaluation.
- `lib/audit/http.js` exposes dedicated artifact generation and approval routes.
- `task.execution_contract_artifact_bundle_generated` records the reviewable bundle.
- `task.execution_contract_artifact_bundle_approved` records the commit-ready approval.
- `deriveExecutionContractProjection` exposes `executionContract.artifacts` to task detail and API consumers.

## User-Facing Surface

Task detail now shows generated artifact links under linked delivery artifacts when a bundle exists. PR guidance is visible with the display-ID title so PMs and engineers can use the generated story, decision log, and evidence paths in PR bodies.

## Rollout

The behavior is controlled by `FF_EXECUTION_CONTRACTS`. Rollback is the existing fail-closed path: disable the flag to stop Execution Contract and artifact mutations while preserving historical audit events.
