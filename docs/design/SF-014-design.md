# SF-014 Design

## Research & Context
## Evidence
- Issue `#19` defines `SF-014` as an SRE monitoring dashboard with deployment-aware monitoring windows, telemetry drilldowns, early approval controls, and expiry escalation.
- The requested workflow runner scripts are not present in this checkout: `npm run task:pull`, `npm run ag:workflow ...`, `npm run workflow:discover ...`, and `.agent/skills/test-coverage-gap-analysis/...` do not exist, so the workflow must be executed manually against the actual repo.
- Existing workflow primitives already live in [lib/audit/http.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/http.js), [lib/audit/core.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/core.js), [lib/audit/store.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/store.js), and [lib/audit/workflow.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/workflow.js).
- The current product already routes passing QA results into `SRE_MONITORING`, exposes task detail telemetry, links PR metadata, and has an SRE inbox surface in [src/app/App.jsx](/Users/wiinc2/.openclaw/workspace/engineering-team/src/app/App.jsx) and routing helpers in [src/app/task-owner.mjs](/Users/wiinc2/.openclaw/workspace/engineering-team/src/app/task-owner.mjs).
- Existing acceptance-adjacent behavior already exists for PR sync and close gating in [tests/unit/audit-api.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/unit/audit-api.test.js), but there is no deployment-gated monitoring window, no SRE approval mutation, and no expiry-based human escalation.

## Coverage Gap Analysis
## Evidence
- The requested coverage-gap script is absent, so the gap analysis was performed from the repo’s real test surface.
- Existing coverage already validates QA routing into `SRE_MONITORING`, task detail telemetry shaping, PR sync, and role inbox routing.
- Missing coverage for this story:
- backend tests for starting a monitoring window only after durable deployment confirmation inputs and merged PR evidence
- backend tests for auditable early approval moving the task from `SRE_MONITORING` to `PM_CLOSE_REVIEW`
- backend tests for automatic expiry escalation producing a human-routed escalation signal
- adapter tests for new SRE monitoring start and approval endpoints
- UI tests for the SRE inbox dashboard row/card treatment and the task-detail SRE monitoring controls
- Planned gap closure:
- extend [tests/unit/audit-api.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/unit/audit-api.test.js) with SRE monitoring lifecycle tests
- extend [tests/unit/task-detail-adapter.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/unit/task-detail-adapter.test.js) for the new monitoring client methods
- extend [src/app/App.test.tsx](/Users/wiinc2/.openclaw/workspace/engineering-team/src/app/App.test.tsx) for SRE inbox and detail interaction
- extend [tests/unit/role-inbox-routing.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/unit/role-inbox-routing.test.js) so expired monitoring work routes to human stakeholders

## User Story
## Evidence
- As an SRE, I want to monitor all deployed tasks with telemetry, timers, and decision controls, so that I can catch production issues before closing work.
- Acceptance criteria to satisfy:
- given a PR merge and successful deploy, when monitoring starts, then a 48-hour countdown is visible
- given SRE opens the monitoring view, when tasks are listed, then PR, commit, metrics, logs, and time remaining are visible
- given metrics are clearly stable, when SRE approves early, then the task advances to Close review
- given 48 hours expires with no SRE action, when the threshold passes, then human stakeholder escalation is created
- Architectural notes to preserve:
- monitoring begins only after a durable deploy confirmation event or command, not merely after QA passes
- the dashboard should read from a task-centric monitoring projection/view model rather than forcing the UI to compose raw observability queries itself
- early approval must record an explicit reason plus an evidence snapshot
- expiry escalation must be auditable and system-driven

## Feasibility Check
## Evidence
- Backend feasibility is moderate but localized: the audit API already appends immutable events, computes detail view models, and exposes task/observability projections.
- Frontend feasibility is moderate and low-risk: the SRE inbox route already exists, task detail already supports role-gated mutations, and telemetry/PR data already render in task detail.
- Risk validation:
- rather than inventing a separate monitoring subsystem, derive an SRE monitoring view model from existing task history, PR relationships, engineer submission metadata, and observability summary data
- add two explicit SRE mutations, one to start the monitoring window after deploy confirmation and one to approve early with evidence
- use the existing projection worker path to materialize expiry escalation when the monitoring deadline has passed and no approval exists; this keeps the path system-driven and idempotent without making reads mutate state
- retain `PM_CLOSE_REVIEW` as the post-SRE close-review stage instead of introducing a new close-stage enum

## Technical Plan
## Evidence
- Backend/API work in [lib/audit/http.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/http.js), [lib/audit/core.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/core.js), and [lib/audit/event-types.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/event-types.js):
- add feature-flag support for `ff_sre_monitoring`
- add explicit monitoring lifecycle events for monitoring start and SRE approval, while reusing `task.escalated` for expiry escalation
- derive a task-centric `sreMonitoring` view model from task history, PR relationships, engineer submission metadata, architect monitoring spec, and observability summary data
- expose new mutation routes for `POST /tasks/:id/sre-monitoring/start` and `POST /tasks/:id/sre-monitoring/approve`
- process expired monitoring windows through the projection worker so an auditable expiry escalation event exists even when no read request touches the task
- HTTP task-list enrichment:
- augment `GET /tasks` responses with monitoring preview data needed by the SRE inbox so the UI can render countdown, risk, deployment, PR, commit, and drilldown links without fan-out fetches
- Frontend work in [src/features/task-detail/adapter.js](/Users/wiinc2/.openclaw/workspace/engineering-team/src/features/task-detail/adapter.js), [src/features/task-detail/adapter.browser.js](/Users/wiinc2/.openclaw/workspace/engineering-team/src/features/task-detail/adapter.browser.js), [src/app/task-owner.mjs](/Users/wiinc2/.openclaw/workspace/engineering-team/src/app/task-owner.mjs), and [src/app/App.jsx](/Users/wiinc2/.openclaw/workspace/engineering-team/src/app/App.jsx):
- add task-detail client methods for SRE monitoring start and approval
- render a monitoring panel on task detail with deploy confirmation inputs, countdown, evidence snapshot, telemetry drilldowns, and early approval flow
- specialize the existing SRE inbox into a monitoring dashboard treatment using the enriched task-list projection and stage-based routing
- route expired monitoring items to human stakeholders via waiting-state / next-action semantics
- Verification plan:
- unit tests first for API lifecycle, adapter calls, routing, and UI
- then run `npm run test:unit`
- if time and environment permit, run broader verification commands available in this repo rather than the absent workflow wrappers
