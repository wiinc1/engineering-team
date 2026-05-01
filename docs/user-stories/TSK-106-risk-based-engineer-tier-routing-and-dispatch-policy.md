# TSK-106 Risk-Based Engineer Tier Routing And Dispatch Policy

Task Display ID: TSK-106
Execution Contract Version: v1
Template Tier: Standard
Authoritative Source: structured Task execution_contract data
Template Source: docs/templates/USER_STORY_TEMPLATE.md

This generated user story is the committed human-readable view of the approved Execution Contract. Material changes require a new approved contract version or amendment.

## 1. User Story

As a Software Factory operator,
I want approved Execution Contracts to select Jr, Sr, or Principal Engineer routing from tier, risk, and contract signals,
so that implementation work starts with the right engineering tier, QA involvement, and escalation path.

## 2. Acceptance Criteria

- Given an approved Execution Contract, when dispatch policy runs, then the selected Engineer tier is explainable from tier, risk, and contract signals.
- Given a Jr Engineer assignment is proposed without a clear test plan, when dispatch is evaluated, then dispatch is blocked or re-routed.
- Given Principal triggers are present, when approval or dispatch is attempted, then Principal review is required first.
- Given Standard-or-higher work is dispatched, when QA coverage work is applicable, then QA can run in parallel with Sr implementation.
- Given implementation fails tests, when the failure loop starts, then the task returns to the implementing Engineer before Principal escalation unless escalation triggers are met.

## 4. Automated Test Deliverables

- Unit coverage for tier selection, Jr blocking, Principal triggers, QA parallel eligibility, and failure-loop escalation.
- API coverage for approved-contract assignment dispatch and Principal approval blocking.
- QA route coverage for failure-loop packages returning work to the implementing Engineer first.
- Contract coverage for the public dispatch policy schema and assignment conflict response.

## 11. Deployment & Release Strategy

Use existing Execution Contract and task-assignment feature gates. Roll back by disabling the relevant feature flag while preserving append-only audit history.

## 12. Monitoring & Observability

Dispatch policy results are persisted in assignment and handoff payloads and exposed in task detail projection. Policy measurement uses quality and intervention metrics rather than lines of code or raw task count.

## 15. Definition Of Done

- Dispatch policy is implemented and exposed through dispatch readiness.
- Tier-specific assignment enforces approved-contract policy.
- QA failure packages include failure-loop routing policy.
- Documentation, API contracts, and issue verification reports are updated.
- Focused and full repository verification pass.

## 16. Production Validation Strategy

After deployment, verify a Standard approved contract exposes `selectedEngineerTier=Sr`, `qaDispatch.parallelAllowed=true`, and assignment of an unsafe `engineer-jr` proposal returns `dispatch_policy_blocked`.

## 17. Compliance & Handoff

Operators should use the dispatch policy explanation and blocking reasons as the handoff surface for PM, Architect, QA, and Principal review conversations.
