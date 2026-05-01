# TSK-105 Generate Verification Report Skeletons From Approved Execution Contracts

Task Display ID: TSK-105
Execution Contract Version: v1
Template Tier: Standard
Authoritative Source: structured Task execution_contract data
Template Source: docs/templates/USER_STORY_TEMPLATE.md

This generated user story is the committed human-readable view of the approved Execution Contract. Material changes require a new approved contract version or amendment.

## 1. User Story

As a Product Manager, I want approved Execution Contracts to generate verification report skeletons before implementation preparation, so that engineers start from the required evidence checklist and required reports are not skipped.

## 2. Acceptance Criteria

- Given a Standard-or-higher Execution Contract is approved, when implementation preparation starts, then a verification report skeleton is generated under `docs/reports/`.
- Given a report skeleton is generated, when opened, then it contains required evidence from the approved contract.
- Given a Standard-or-higher task has no verification report skeleton, when dispatch is attempted, then dispatch is blocked.
- Given a Simple task has no risk flags, when dispatch is attempted, then the report skeleton is optional.

## 3. Workflow & User Journey

1. PM approves a structured Execution Contract after reviewer gates pass.
2. PM generates a verification report skeleton from the approved contract.
3. The skeleton appears under `docs/reports/` and in task-detail links.
4. Dispatch readiness blocks Standard-or-higher and risk-bearing Simple tasks until the skeleton exists.
5. Simple no-risk tasks may proceed without the skeleton.

## 4. Automated Test Deliverables

Coverage is provided by unit skeleton-generation tests, API dispatch-gate tests, e2e workflow coverage, security bypass tests, OpenAPI contract checks, React task-detail tests, and Playwright browser rendering tests.

## 6. Architecture & Integration

Skeleton generation is audit-backed. Dedicated routes append `task.execution_contract_verification_report_generated`; generic event writes are rejected. The Execution Contract projection exposes the latest skeleton and dispatch-readiness state to API and browser consumers.

## 7. API Design

New endpoints:

- `GET /tasks/{id}/execution-contract/verification-report`
- `POST /tasks/{id}/execution-contract/verification-report`

## 11. Deployment & Release Strategy

The behavior remains behind `FF_EXECUTION_CONTRACTS`.

## 12. Monitoring & Observability

Audit history records skeleton generation events. Current state records when a skeleton was generated for the active contract version.

## 15. Definition of Done

Code, tests, API docs, runbook updates, generated story/log artifacts, and verification reports are committed after automated gates pass.

## 16. Production Validation Strategy

Use a non-production tenant to approve a Standard contract, attempt dispatch before skeleton generation, generate the skeleton, verify task detail links, and confirm dispatch readiness changes.

## 17. Compliance & Handoff

Handoff requires the linked PR, verification report, security notes, generated story, Refinement Decision Log, and command evidence.
