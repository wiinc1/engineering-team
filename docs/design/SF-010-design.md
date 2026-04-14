# SF-010 Design

## Research & Context
## Evidence
- Issue `#15` defines `SF-010` as support for Jr responsible escalation, architect re-tiering, inactivity-based reassignment, governance review task creation, and transferred context for the new assignee.
- The workflow engine named in the requested process does not exist in this checkout: `.workflow/state.json`, `npm run task:pull`, `npm run ag:workflow ...`, `npm run workflow:discover ...`, and `.agent/skills/test-coverage-gap-analysis/...` are absent, so the story was executed against the actual repo structure and available scripts.
- Existing workflow state and detail modeling already lived in [lib/audit/http.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/http.js), [lib/audit/core.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/core.js), and [lib/audit/store.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/store.js).
- Existing shipped UI surfaces already lived in [src/app/App.jsx](/Users/wiinc2/.openclaw/workspace/engineering-team/src/app/App.jsx) and [src/app/task-owner.mjs](/Users/wiinc2/.openclaw/workspace/engineering-team/src/app/task-owner.mjs), with task-detail API access through [src/features/task-detail/adapter.js](/Users/wiinc2/.openclaw/workspace/engineering-team/src/features/task-detail/adapter.js) and [src/features/task-detail/adapter.browser.js](/Users/wiinc2/.openclaw/workspace/engineering-team/src/features/task-detail/adapter.browser.js).
- Code discovery over `lib`, `src`, and `tests` showed the story was already partially implemented in backend routes, but acceptance gaps remained around UI reachability, architect notification, engineer-only inactivity semantics, governance-task separation, and neutral UX copy.

## Coverage Gap Analysis
## Evidence
- The requested gap-analysis script is absent from this repo, so coverage analysis was done directly from the test surface and changed modules.
- Before the gap-closure work, coverage existed for backend audit APIs and some reassignment projections, but not for the shipped UI controls or adapter endpoints needed to make the workflow usable from the product.
- Gaps closed in this story:
- add adapter coverage for `skill-escalation`, `check-ins`, `retier`, and `reassignment` in [tests/unit/task-detail-adapter.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/unit/task-detail-adapter.test.js)
- add API coverage for Jr escalation, architect re-tiering, inactivity reassignment, transferred-context generation, and governance review task creation in [tests/unit/audit-api.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/unit/audit-api.test.js)
- add projection/routing coverage so architect-waiting work routes correctly and governance reviews stay out of delivery inboxes in [tests/unit/role-inbox-routing.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/unit/role-inbox-routing.test.js)
- preserve app-level interaction coverage through [src/app/App.test.tsx](/Users/wiinc2/.openclaw/workspace/engineering-team/src/app/App.test.tsx) and browser verification in [tests/browser/task-detail.browser.spec.ts](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/browser/task-detail.browser.spec.ts)

## User Story
## Evidence
- As a Junior Engineer or Architect, I want to flag tasks above skill level and handle inactivity-based reassignment, so that work does not stall with the wrong owner.
- Acceptance criteria implemented:
- given a Jr believes work is above skill level, when they flag before starting, then the task records a responsible escalation, creates a blocking architect-facing workflow thread, and allows architect re-tiering
- given an assigned engineer misses 2 consecutive 15-minute check-ins, when the threshold is reached, then architect can reassign to the next senior tier and create an inactivity review task
- given reassignment occurs, when the new engineer receives task ownership, then task detail includes a transferred-context summary with prior assignee, reason, tier change, latest qualifying engineer activity, latest implementation reference, unresolved threads, and blockers
- Architectural notes implemented:
- objective activity signals are restricted to engineer check-ins and engineer submissions
- re-tiering and reassignment remain separate events in the data model
- governance review tasks are typed as `governance_review` and filtered out of delivery surfaces
- UX notes implemented:
- user-facing copy uses `Responsible escalation` instead of inflammatory phrasing
- user-facing review copy uses `Inactivity review`
- transferred context is shown as a concise task-detail card

## Feasibility Check
## Evidence
- Backend feasibility was low risk because the audit API already had immutable event append, task detail projections, and workflow-thread modeling.
- Frontend feasibility was low risk because task detail already supported role-gated forms and server-backed reload after mutations.
- Risk validation performed:
- architect notification was implemented with an existing first-class workflow thread instead of inventing a new notification subsystem
- inactivity thresholds now depend on engineer-authored activity only, avoiding false resets from PM, architect, or QA actions
- governance separation is enforced in owner list, inbox routing, PM overview, and board column derivation
- Verification showed no regressions across the existing test battery, including browser flows and routing projections.

## Technical Plan
## Evidence
- Backend/API changes:
- extend the audit detail view model in [lib/audit/http.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/http.js) with `skillEscalation`, `retiering`, `reassignment`, `ghostingReview`, `activityMonitoring`, and `transferredContext`
- create first-class routes for `POST /tasks/:id/skill-escalation`, `POST /tasks/:id/check-ins`, `POST /tasks/:id/retier`, and `POST /tasks/:id/reassignment`
- emit `task.workflow_thread_created` on responsible escalation to make architect review visible in product surfaces
- persist `task_type` into list projections in [lib/audit/store.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/store.js) and [lib/audit/postgres.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/postgres.js)
- Projection/UI changes:
- add adapter methods in [src/features/task-detail/adapter.js](/Users/wiinc2/.openclaw/workspace/engineering-team/src/features/task-detail/adapter.js) and [src/features/task-detail/adapter.browser.js](/Users/wiinc2/.openclaw/workspace/engineering-team/src/features/task-detail/adapter.browser.js)
- add task-detail forms and status handling in [src/app/App.jsx](/Users/wiinc2/.openclaw/workspace/engineering-team/src/app/App.jsx) for responsible escalation, engineer check-ins, architect re-tiering, and architect reassignment
- filter governance review tasks from delivery surfaces and route architect-waiting work correctly in [src/app/task-owner.mjs](/Users/wiinc2/.openclaw/workspace/engineering-team/src/app/task-owner.mjs)
- Changed files for the implementation:
- [lib/audit/http.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/http.js)
- [lib/audit/core.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/core.js)
- [lib/audit/event-types.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/event-types.js)
- [lib/audit/feature-flags.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/feature-flags.js)
- [lib/audit/store.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/store.js)
- [lib/audit/postgres.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/postgres.js)
- [src/app/task-owner.mjs](/Users/wiinc2/.openclaw/workspace/engineering-team/src/app/task-owner.mjs)
- [src/features/task-detail/adapter.js](/Users/wiinc2/.openclaw/workspace/engineering-team/src/features/task-detail/adapter.js)
- [src/features/task-detail/adapter.browser.js](/Users/wiinc2/.openclaw/workspace/engineering-team/src/features/task-detail/adapter.browser.js)
- [src/app/App.jsx](/Users/wiinc2/.openclaw/workspace/engineering-team/src/app/App.jsx)
- [tests/unit/audit-api.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/unit/audit-api.test.js)
- [tests/unit/task-detail-adapter.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/unit/task-detail-adapter.test.js)
- [tests/unit/role-inbox-routing.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/unit/role-inbox-routing.test.js)
