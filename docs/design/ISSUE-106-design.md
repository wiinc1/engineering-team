# Issue 106 Design

## Research & Context

Issue #106 extends the approved Execution Contract workflow after issues #102 through #105. The contract already captures template tier, risk flags, reviewer approvals, committed scope, artifact generation, and verification report dispatch gates. This slice adds the implementation dispatch policy that turns those approved contract signals into Jr, Sr, or Principal Engineer routing.

Source artifacts:

- `CONTEXT.md`
- `docs/refinement/CONTEXT-2026-04-28-software-factory-execution-contracts.md`
- PR #100

## Gap Analysis

Before this slice, dispatch readiness could say whether a verification report skeleton existed, but it did not select an engineer tier or explain why. Assignment could also target tier-specific engineer ids without checking whether the approved contract made that tier appropriate.

Implemented gap closure:

- Added `execution-contract-dispatch-policy.v1`.
- Selected engineer tier from template tier, risk flags, dispatch signals, reviewer state, and failure-loop context.
- Kept Sr Engineer as the default Standard-or-higher implementation tier.
- Allowed Jr Engineer only for constrained Simple tests, fixtures, docs, and clear refactors with a clear failing or pending test plan.
- Required Principal review/involvement for Principal-trigger risk flags before approval or dispatch.
- Exposed QA parallel-dispatch eligibility for Standard-or-higher Sr implementation.
- Returned failing QA work to the implementing Engineer first, with Principal escalation only for repeated failure, unclear root cause, high-risk regression, contract-defect suspicion, or explicit Principal escalation request.
- Measured tier policy through quality and intervention metrics, explicitly excluding lines of code and raw task count.

## Architecture

The implementation remains audit-backed and additive:

- `lib/audit/execution-contracts.js` owns dispatch signal normalization, tier selection, Principal/Jr blocking logic, QA parallel eligibility, and failure-loop policy.
- `deriveExecutionContractProjection` exposes the policy through `executionContract.dispatchReadiness.dispatchPolicy`.
- `lib/audit/store.js` uses dispatch readiness blockers for implementation-preparation stage changes.
- `lib/audit/http.js` evaluates the policy during tier-specific engineer assignment and architect handoff.
- `task.qa_result_recorded` escalation packages now include the failure-loop policy so failed work routes back to the implementing Engineer before Principal escalation.
- `lib/audit/agents.js` registers `engineer-jr`, `engineer-sr`, and `engineer-principal` as first-class assignable engineering agents.

## User-Facing Surface

API consumers can inspect:

- `dispatchPolicy.selectedEngineerTier`
- `dispatchPolicy.selectionReasons`
- `dispatchPolicy.blockingReasons`
- `dispatchPolicy.qaDispatch.parallelAllowed`
- `dispatchPolicy.failureLoop`
- `dispatchPolicy.metricsPolicy`

Assignment callers receive `409 dispatch_policy_blocked` when a proposed tier conflicts with the approved contract.

## Rollout

The behavior is controlled by the existing `FF_EXECUTION_CONTRACTS` and task-assignment feature gates. Rollback is the existing fail-closed path: disable Execution Contracts to stop contract dispatch evaluation, or disable assignment mutation to stop owner changes while preserving historical audit events.
