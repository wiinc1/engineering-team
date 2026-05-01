# Issue 105 Design

## Research & Context

Issue #105 extends the approved Execution Contract workflow from issues #102 through #104. The approved contract remains the authoritative source for implementation scope, while generated Markdown and repo artifacts stay reviewable derivative views. This slice adds a verification report skeleton before implementation preparation so teams start delivery with the required evidence checklist already copied from the approved contract.

## Gap Analysis

Before this slice, approved Standard-or-higher Execution Contracts could be moved toward implementation preparation without a report skeleton under `docs/reports/`. Generated artifact PR guidance referenced an evidence path, but the system did not generate the skeleton, did not copy required evidence from the approved contract, and did not block dispatch when the skeleton was required.

Implemented gap closure:

- Added verification report skeleton generation for approved Execution Contracts.
- Added `docs/reports/{display-id}-{slug}-verification.md` path generation.
- Copied approved-contract evidence for acceptance criteria, tests, security, SRE, rollout, operator/customer review, and Definition of Done.
- Added a dispatch readiness policy that requires a skeleton for Standard, Complex, Epic, and risk-bearing Simple contracts.
- Kept Simple no-risk skeletons optional.
- Added a dedicated API route and rejected generic event writes for skeleton generation.
- Exposed skeleton links in task detail.

## Architecture

The implementation remains audit-backed and additive:

- `lib/audit/execution-contracts.js` owns skeleton path/content generation and dispatch-readiness evaluation.
- `lib/audit/http.js` exposes `GET/POST /tasks/{id}/execution-contract/verification-report`.
- `task.execution_contract_verification_report_generated` records the generated skeleton.
- `deriveExecutionContractProjection` exposes `executionContract.verificationReport` and `executionContract.dispatchReadiness`.
- `lib/audit/store.js` blocks implementation preparation transitions when the active approved contract requires a skeleton and no skeleton event exists.

## User-Facing Surface

Task detail now shows verification report skeleton links beside generated delivery artifacts. API consumers can inspect dispatch readiness from the Execution Contract projection.

## Rollout

The behavior is controlled by `FF_EXECUTION_CONTRACTS`. Rollback is the existing fail-closed path: disable the flag to stop Execution Contract and skeleton mutations while preserving historical audit events.
