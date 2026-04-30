# TSK-104 Implement Refinement Decision Logs and Task-ID Artifact Generation

Task Display ID: TSK-104
Execution Contract Version: v1
Template Tier: Standard
Authoritative Source: structured Task execution_contract data
Template Source: docs/templates/USER_STORY_TEMPLATE.md

This generated user story is the committed human-readable view of the approved Execution Contract. Material changes require a new approved contract version or amendment.

## 1. User Story

As a Product Manager, I want approved Execution Contracts to generate reviewable repo artifact bundles with display-ID filenames, so that generated user stories, Refinement Decision Logs, task detail links, and PR guidance preserve durable human-readable scope without making GitHub issues mandatory.

## 2. Acceptance Criteria

- Given an approved production Execution Contract, when repo artifacts are generated, then the generated user story and Refinement Decision Log use `TSK-123` display-ID filenames under `docs/user-stories/` and `docs/refinement/`.
- Given staging or local artifacts are generated, when filenames are produced, then they use `STG-` or `LOCAL-` aliases instead of production `TSK-` IDs.
- Given generated artifacts are ready for commit, when approval is requested, then PM artifact-bundle approval is required first.
- Given generated artifacts include section-owned content, when approval is requested, then section-owner approvals are required.
- Given exception-triggered artifact content exists, when approval is requested, then operator approval is required.
- Given a material contract change occurs after approval, when artifacts are regenerated, then a versioned story path or amendment is produced instead of silently editing the approved story.
- Given a task has generated artifacts, when task detail loads, then generated story and decision-log links are visible.
- Given GitHub issue creation is default-off, when artifact generation completes, then no issue is created unless explicitly requested.
- Given PR guidance is generated, when links are inspected, then they use the display ID and slug paths rather than opaque internal IDs.

## 3. Workflow & User Journey

1. PM approves a structured Execution Contract after reviewer gates pass.
2. PM generates a reviewable artifact bundle.
3. The bundle exposes generated user-story and Refinement Decision Log paths, content, task-detail links, and PR guidance.
4. PM and required section owners approve the bundle before commit readiness.
5. Operator approval is added only for exception-triggered cases.

## 4. Automated Test Deliverables

Coverage is provided by unit artifact-bundle tests, API workflow tests, e2e approval flow, security bypass tests, OpenAPI contract checks, and browser task-detail rendering tests.

## 6. Architecture & Integration

Artifact generation is audit-backed. Dedicated routes append `task.execution_contract_artifact_bundle_generated` and `task.execution_contract_artifact_bundle_approved` events. The Execution Contract projection exposes the latest artifact bundle to task detail and PR guidance consumers.

## 7. API Design

New endpoints:

- `GET /tasks/{id}/execution-contract/artifacts`
- `POST /tasks/{id}/execution-contract/artifacts`
- `POST /tasks/{id}/execution-contract/artifacts/approve`

## 11. Deployment & Release Strategy

The behavior remains behind `FF_EXECUTION_CONTRACTS`.

## 12. Monitoring & Observability

Audit history records artifact-bundle generation and approval events. GitHub issue creation remains default-off.

## 15. Definition of Done

Code, tests, API docs, runbook updates, generated story/log artifacts, and verification reports are committed after automated gates pass.

## 16. Production Validation Strategy

Use a non-production tenant to approve a contract, generate an artifact bundle with `STG-` or `LOCAL-` display aliasing, approve the bundle, and verify task detail links plus PR guidance before enabling production use.

## 17. Compliance & Handoff

Handoff requires the linked PR, verification report, security notes, generated story, Refinement Decision Log, and command evidence.
