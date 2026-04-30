# Issue 103 Design

## Research & Context

Issue #103 builds on Issue #102 Execution Contract generation. The accepted domain context in `CONTEXT.md` and `docs/refinement/CONTEXT-2026-04-28-software-factory-execution-contracts.md` requires deterministic reviewer routing before Operator Approval.

## Gap Analysis

Before this slice, Execution Contracts stored reviewer status as a shallow map and approval only checked required section completeness. That left three gaps:

- reviewer selection was not explainable from template tier and risk flags
- model judgment could silently disagree with deterministic rules
- Operator Approval could be recorded while required approvals or blocking questions were still unresolved

Implemented gap closure:

- Added normalized `risk_flags`, `reviewer_routing`, and `review_feedback` to structured Execution Contracts.
- Added deterministic reviewer reasons for tier and risk rules.
- Added stricter-wins model disagreement handling with operator-visible downgrade rationales for non-hard model-selected reviewers.
- Added approval readiness summaries that block missing required role approvals and unresolved blocking questions.
- Added non-blocking comment summaries to successful and blocked approval responses without treating those comments as blockers.
- Blocked direct generic `task.execution_contract_approved` event writes so the dedicated approval endpoint always runs the gates.

## User Story

As a Product Manager,
I want Execution Contracts to route reviewers and gate Operator Approval deterministically,
so that implementation cannot be approved before required specialists and blocking questions are handled.

## Acceptance Criteria Mapping

1. Reviewer routing from tier and risk flags: `createExecutionContractDraft` records `reviewer_routing.required_role_approvals` plus per-role `reasons`.
2. Stricter route wins: deterministic requirements override less-strict supplied judgment, and stricter model-required reviewers remain required unless PM records an operator-visible downgrade rationale.
3. Missing role approvals block approval: `POST /tasks/{id}/execution-contract/approve` returns `execution_contract_approval_blocked` with `missing_required_approvals`.
4. Blocking questions block approval: approval readiness combines contract feedback, workflow threads, and review questions into `unresolved_blocking_questions`.
5. Non-blocking comments do not block: `approvalSummary.nonBlockingComments` is returned while approval continues when no hard blockers remain.

## Architecture

The implementation stays in the existing audit-backed contract model:

- `lib/audit/execution-contracts.js` owns deterministic routing, review feedback normalization, and approval readiness evaluation.
- `lib/audit/http.js` uses approval readiness in the dedicated approval endpoint and rejects direct generic approval-event writes.
- Existing projection and detail surfaces remain additive; latest approval projections include `approvalSummary`.

## Rollout

The behavior remains behind `FF_EXECUTION_CONTRACTS`. Rollback is the existing fail-closed path: disable the flag to stop Execution Contract reads and mutations while preserving historical audit events.
