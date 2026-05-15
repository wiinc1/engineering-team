# Issue #153 Design Note: Task Detail Next Actions

## Goal
Task detail keeps the full lifecycle surface, but the first screen now gives each user a role-specific next action derived from the existing read model and session roles.

## Information Architecture
- The task title, status chips, next-action panel, owner, workflow stage, blocked/waiting state, freshness, PR status, and child-task status remain in the task-detail hero.
- The next-action panel appears before the dense summary grid so mobile users see the required action above the fold.
- Existing lifecycle sections remain available through stable anchors rather than hidden or removed.
- Reader-only sessions receive a status-only panel with blocked/waiting reasons and no edit-control affordance.

## Role Mapping
- PM/admin: refinement, assignment, close-review, and Deferred Consideration paths.
- Architect: technical handoff and escalation-review paths.
- Engineer: implementation handoff, check-in, PR, and responsible escalation paths.
- QA: verification result and retest evidence paths.
- SRE: monitoring state, expiry, approval, and anomaly paths.
- Human stakeholder: close-review decision paths.
- Reader: passive status, history, telemetry, and discussion paths.

## Responsive Behavior
The panel uses the existing task-detail token system, avoids nested cards, and switches from side-by-side support content to a single column on narrow screens. Its primary link remains a normal anchor so keyboard, deep-link, and browser history behavior stay predictable.

## Rollout
The UI is guarded by `ff_task_detail_next_action_redesign`. Disabling the flag removes the panel and leaves the pre-existing task-detail hierarchy intact.
