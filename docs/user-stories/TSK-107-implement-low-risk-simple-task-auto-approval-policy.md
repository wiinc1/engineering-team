# TSK-107 Implement Low-Risk Simple Task Auto-Approval Policy

Task Display ID: TSK-107
Execution Contract Version: v1
Template Tier: Simple
Authoritative Source: structured Task execution_contract data
Template Source: docs/templates/USER_STORY_TEMPLATE.md

This generated user story is the committed human-readable view of the approved Execution Contract. Material changes require a new approved contract version or amendment.

## 1. User Story

As a Software Factory operator,
I want low-risk Simple Execution Contracts to be approved by a narrow policy when every safety criterion is satisfied,
so that routine autonomous delivery can progress while risk-bearing work still requires explicit Operator Approval.

## 2. Acceptance Criteria

- Given a Simple Execution Contract meets all low-risk criteria, when auto-approval policy runs, then Operator Approval can be recorded by policy with rationale.
- Given risk flags exist, when auto-approval policy runs, then explicit Operator Approval is still required.
- Given auto-approval occurs, when Task detail loads, then the policy, rationale, and timestamp are visible.
- Given auto-approved work closes successfully, when metrics update, then operator-trusted autonomous delivery rate includes it.

## 4. Automated Test Deliverables

- Unit coverage for policy eligibility, risk/dependency/sensitive-path/rollback blockers, and generated artifact visibility.
- API coverage for policy approval, blocked risk-flag fallback, task-detail projection, artifact output, and autonomous delivery metrics.
- Browser coverage for Task detail policy/rationale/timestamp visibility.
- Contract, e2e, and security coverage for documented API surface and fail-closed policy boundaries.

## 11. Deployment & Release Strategy

Use the existing `FF_EXECUTION_CONTRACTS` gate. Roll back by disabling Execution Contracts or reverting the policy change; historical approval events remain append-only.

## 12. Monitoring & Observability

The workflow exports `feature_execution_contract_auto_approvals_total`, `feature_execution_contract_auto_approval_blocked_total`, `feature_operator_trusted_autonomous_deliveries_total`, and `feature_operator_trusted_autonomous_delivery_rate`.

## 15. Definition Of Done

- Policy approval is recorded only for eligible low-risk Simple contracts.
- Ineligible contracts return explicit blocking reasons and require explicit Operator Approval.
- Task detail and generated artifacts show policy, rationale, and timestamp.
- Metrics include auto-approved work only after successful closure.
- Documentation and issue reports are updated.

## 16. Production Validation Strategy

After deployment, approve one eligible Simple contract with `autoApproval=true`, verify Task detail shows the policy record, close the task through the normal workflow, and confirm `feature_operator_trusted_autonomous_delivery_rate` increases.

## 17. Compliance & Handoff

Operators should treat `execution-contract-low-risk-simple-auto-approval.v1` as a narrow Simple-only policy. Risk flags, unresolved dependencies, production auth/security/data-model paths, missing rollback, or reviewer-gate blockers require explicit Operator Approval.

## Auto-Approval Policy

Policy: execution-contract-low-risk-simple-auto-approval.v1
Rationale: Low-risk Simple contracts can be approved by policy only when all safety criteria are satisfied.
Approved At: recorded on the `task.execution_contract_approved` event when the policy path is used.
