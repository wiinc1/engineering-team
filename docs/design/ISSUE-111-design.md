# Issue 111 Design

## Research & Context

Issue #111 adds the Software Factory control-plane operating model on top of the task audit, Execution Contract, dispatch, auto-approval, Contract Coverage Audit, and Deferred Consideration work from issues #102 through #110.

Source artifacts:

- `CONTEXT.md`
- `docs/product/software-factory-control-plane-prd.md`
- GitHub issue #111

## Gap Analysis

Before this slice, policy behavior existed in several feature modules, but there was no shared control-plane model for policy decisions, capability evidence, context provenance, WIP and budget policy, exception metadata, prioritization, autonomy confidence, or closeout retrospective signals.

Implemented gap closure:

- Added `lib/audit/control-plane.js` as the shared policy surface.
- Added inspectable policy decision records with policy name, version, input facts, decision, rationale, override, actor, timestamp, and provenance.
- Added a capability model that combines OpenClaw profile data with control-plane permissions, risk limits, eligible task classes, evidence history, recent outcomes, and routing eligibility.
- Added contract and decision context provenance categories for source intake, repo docs, ADRs, code inspection, issue/PR history, logs, external sources, previous failures, and specialist contributions.
- Added Delivery Retrospective Signal generation at `task.closed`.
- Added class-specific autonomy-confidence thresholds.
- Added linked Exception normalization for control-plane exceptions, escalations, blockers, coverage exceptions, and budget exhaustion.
- Added explainable prioritization, WIP observe/enforce decisions, delivery budget policy, and prompt-boundary enforcement.
- Exposed the projection through Task detail as `context.controlPlane`.

## Architecture

The implementation is additive and audit-backed:

- `lib/audit/control-plane.js` owns policy decision normalization, provenance normalization, capability evaluation, retrospective signals, autonomy confidence, exception records, prioritization, WIP, budget, and prompt-boundary policy.
- `lib/audit/event-types.js` declares `task.control_plane_decision_recorded` and `task.control_plane_exception_recorded`.
- `lib/audit/core.js` projects control-plane state and metrics.
- `lib/audit/store.js` enriches close events with retrospective signals, evaluates WIP limits attached to stage transitions, evaluates delivery budgets attached to payload control-plane metadata, and normalizes control-plane decision/exception events.
- `lib/audit/execution-contracts.js` records contract-level context provenance.
- `lib/audit/http.js` exposes the derived control-plane projection on Task detail.

## User-Facing Surface

Task detail consumers can inspect:

- `context.controlPlane.policy_surfaces`
- `context.controlPlane.decisions`
- `context.controlPlane.context_provenance`
- `context.controlPlane.exceptions`
- `context.controlPlane.delivery_retrospective_signal`
- `context.controlPlane.autonomy_confidence`

Operators can trace which facts and provenance drove a policy decision before accepting automation or expanding autonomy.

## Rollout

The model is compatible with existing audit and Execution Contract feature flags. Rollback can stop new control-plane writes by reverting this slice while preserving append-only audit events already recorded.
