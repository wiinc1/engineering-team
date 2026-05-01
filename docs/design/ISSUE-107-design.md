# Issue 107 Design

## Research & Context

Issue #107 adds the first progressive-autonomy approval policy on top of the structured Execution Contract workflow from issues #102 through #106. The workflow already has versioned contract data, reviewer routing, approval gates, artifact generation, dispatch readiness, and task-detail projection. This slice allows a narrowly scoped policy to record Operator Approval for low-risk Simple contracts only.

Source artifacts:

- `CONTEXT.md`
- `docs/refinement/CONTEXT-2026-04-28-software-factory-execution-contracts.md`
- Issues #102 through #106

## Gap Analysis

Before this slice, all Execution Contract approvals required explicit human approval through `POST /tasks/{id}/execution-contract/approve`. There was no way to distinguish a policy-approved low-risk Simple contract from a human-approved one, and no metric for autonomous work that later closed successfully.

Implemented gap closure:

- Added `execution-contract-low-risk-simple-auto-approval.v1`.
- Allowed policy approval only for Simple contracts with complete acceptance criteria, no risk flags, no unresolved dependencies, no inferred or declared production auth/security/data-model paths, a clear rollback path, and ready reviewer gates.
- Returned `execution_contract_auto_approval_blocked` when a caller requests policy approval for ineligible work.
- Preserved explicit Operator Approval for risk-bearing or otherwise ineligible contracts.
- Persisted policy version, rationale, criteria, and timestamp on the approval event and task-detail projection.
- Added auto-approval visibility to Task detail and generated repo artifacts.
- Added metrics for auto approvals, blocked policy attempts, trusted autonomous deliveries, and operator-trusted autonomous delivery rate.

## Architecture

The implementation remains audit-backed and additive:

- `lib/audit/execution-contracts.js` owns policy evaluation, auto-approval signal normalization, persisted auto-approval records, projection exposure, and generated artifact text.
- `lib/audit/http.js` wires `autoApproval` approval requests, fail-closed policy blocking, approval event payloads, and close-time trusted-delivery metrics.
- `lib/audit/core.js` initializes the new metrics.
- `src/app/App.jsx` renders policy, rationale, and timestamp from `executionContract.approval.autoApproval`.
- API/runbook docs describe the request, response, task-detail projection, metrics, and fallback behavior.

## Rollout

The behavior is controlled by the existing `FF_EXECUTION_CONTRACTS` gate. Rollback disables Execution Contract approval mutations while preserving append-only audit history. Risk-bearing Simple, Standard, Complex, and Epic auto-approval remain out of scope.
