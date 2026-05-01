# Issue 110 Design

## Research & Context

Issue #110 adds Deferred Considerations for ideas, alternatives, and future
enhancements that are explicitly outside the current approved Execution
Contract. The slice builds on the structured contract workflow from issues
#102 through #108, where the Task audit stream is authoritative and approved
contracts commit only `committed_scope.committed_requirements`.

Source artifacts:

- `CONTEXT.md`
- `docs/product/software-factory-control-plane-prd.md`
- `docs/templates/USER_STORY_TEMPLATE.md`
- GitHub issue #110

## Gap Analysis

Before this slice, non-committed refinement ideas could only live as
unstructured text in contract notes, comments, or follow-up lists. That made
them easy to lose, but also risky to confuse with committed implementation
scope.

Implemented gap closure:

- Added Deferred Considerations as first-class Task child records backed by
  dedicated audit events.
- Captured the required context, rationale, source, owner, revisit, status,
  promotion, and open-question fields.
- Added PM review queue and task-detail counts.
- Projected unresolved items into Operator Approval as not in current scope.
- Projected unresolved items into Operator Closeout with non-blocking actions.
- Promoted items only through explicit PM/operator action to new Intake Drafts.
- Kept Deferred Considerations out of Contract Coverage Audit unless promoted.
- Converted current-progress blockers into a refinement blocking question or
  `operator_decision_required` Exception.

## Architecture

The implementation stays additive and audit-backed:

- `lib/audit/deferred-considerations.js` owns field normalization, projection,
  closeout/approval summaries, blocker-conversion policy, and promoted-intake
  raw requirement generation.
- `lib/audit/event-types.js` declares dedicated Deferred Consideration events.
- `lib/audit/core.js` exposes state counters and child-record relationships.
- `lib/audit/http.js` exposes dedicated list, capture, review, promote, and
  close endpoints while blocking generic event bypass.
- `src/app/App.jsx` adds task-detail count/action UI and a PM review queue.
- Task-detail adapters expose the Deferred Consideration route family.

## Rollout

The behavior is tied to the existing audit foundation and Execution Contract
surfaces. Rollback uses the existing `FF_EXECUTION_CONTRACTS=false` control to
stop contract-adjacent reads and mutations while preserving append-only audit
history.
