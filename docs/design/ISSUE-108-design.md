# Issue 108 Design

## Research & Context

Issue #108 adds a required Contract Coverage Audit gate after implementation and before QA Verification for approved Execution Contract work. It builds on the structured contract workflow from issues #102 through #107: approved contracts already freeze `committed_scope.committed_requirements`, implementation attempts are recorded through engineer submissions, and verification report skeletons live under `docs/reports/`.

Source artifacts:

- `CONTEXT.md`
- `docs/product/software-factory-control-plane-prd.md`
- `docs/templates/USER_STORY_TEMPLATE.md`
- GitHub issue #108

## Gap Analysis

Before this slice, a task could move from implementation toward QA with only implementation metadata. There was no authoritative row-by-row proof that every committed requirement was implemented and verified, and no blocking exception type for committed-requirement gaps discovered by QA.

Implemented gap closure:

- Added `execution-contract-coverage-audit.v1` structured Task data for submitted and validated coverage audits.
- Generated rows only from approved `committed_scope.committed_requirements`; Deferred Considerations remain excluded unless promoted into a new approved contract version.
- Versioned every row to the Execution Contract version and implementation attempt.
- Required an Engineer-submitted coverage matrix before entering Contract Coverage Audit.
- Required QA validation before QA Verification can begin.
- Added blocking `implementation_incomplete` exceptions that block QA Verification and Operator Closeout.
- Generated a Markdown coverage view for the verification report under `docs/reports/`.
- Fed positive, neutral, and negative coverage outcomes into autonomy-confidence metrics.

## Architecture

The implementation stays audit-backed and additive:

- `lib/audit/execution-contracts.js` owns row generation, evidence normalization, coverage evaluation, Markdown rendering, projection, and autonomy-confidence signal calculation.
- `lib/audit/store.js` enforces stage and closeout gates against the latest approved contract and current implementation attempt.
- `lib/audit/http.js` exposes dedicated submit, validate, and Markdown endpoints and blocks generic event bypass writes.
- `lib/audit/core.js` projects coverage state and initializes coverage/autonomy metrics.
- `lib/audit/workflow.js` adds `CONTRACT_COVERAGE_AUDIT` as the post-implementation pre-QA stage.
- `src/app/App.jsx` surfaces the latest Contract Coverage Audit status and report link in Task detail.

## Rollout

The behavior is controlled by the existing `FF_EXECUTION_CONTRACTS` gate. Rollback disables contract and coverage-audit reads and mutations while preserving append-only audit history.
