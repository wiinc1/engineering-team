# USER STORY — Create Intake Drafts From Raw Operator Requirements

**Story ID:** US-003
**GitHub Issue:** [#95](https://github.com/wiinc1/engineering-team/issues/95)
**Template Tier:** Standard
**Standards Verified:** Story authored from `docs/templates/USER_STORY_TEMPLATE.md`, [CONTEXT.md](/Users/wiinc1/repos/engineering-team/CONTEXT.md), and ADR [ADD-2026-04-28-intake-draft-as-task-stage.md](/Users/wiinc1/repos/engineering-team/docs/adr/ADD-2026-04-28-intake-draft-as-task-stage.md).

## 1. User Story

As a Software Factory operator,
I want to create an Intake Draft from raw initial requirements,
so that the control plane can start PM refinement without requiring me to pre-fill the execution-ready story contract.

**Business Context & Success Metrics**

The Software Factory control plane should optimize first for capturing operator intent. The current task creation flow asks for business context, acceptance criteria, Definition of Done, priority, and task type before a task can exist. That inverts the intended lifecycle because those fields are refinement outputs, not intake prerequisites.

This story changes intake so the operator can submit raw requirements quickly and let the control plane route the new Task into Product Manager refinement.

**Success Metrics**
- 100% of automated happy-path coverage can create an Intake Draft with only raw requirements text.
- 0 required fields remain in the intake form beyond raw requirements text.
- 100% of created Intake Drafts are persisted as `DRAFT` and show `PM refinement required` as the next required action.
- 0 Intake Draft creation flows claim implementation, QA, or SRE work has started.

## 2. Acceptance Criteria

### Must Have

**Scenario 1 — Operator creates an Intake Draft from raw requirements only**
Given the operator opens task creation
When they enter only raw requirements text and submit
Then a Task is created in `DRAFT` as an Intake Draft.

**Scenario 2 — Optional metadata does not block intake**
Given optional title, priority, or type are omitted
When the draft is created
Then the system stores safe defaults or leaves those fields unset without blocking intake.

**Scenario 3 — Intake Draft is visible as refinement work**
Given an Intake Draft is created
When task list or task detail loads
Then it is visibly labeled as Intake Draft
And its next required action is PM refinement.

**Scenario 4 — Audit/history records intake and routing only**
Given an Intake Draft is created
When the audit or task history is inspected
Then creation and PM refinement routing are recorded
And implementation has not been claimed as started.

### Out of Scope

- Full Product Manager, Architect, and UX Designer refinement generation
- Auto-approval
- Implementation dispatch
- QA or SRE verification changes
- Production release automation
- Multi-task decomposition
- Editing or revising raw intake requirements after creation

## 2a. Standards Alignment

- Applicable standards areas: architecture and design, testing and quality assurance, auditability, deployment and release, observability and monitoring
- Evidence expected for this change: UI/API tests for raw-requirements intake, task state/history assertions, task list/detail visibility checks, and documentation updates
- Known gaps stated using: Gap observed: the full multi-specialist refinement workflow remains out of scope. Documented rationale: Intake Draft creation is the narrow first slice needed before PM/Architect/UX refinement automation can be safely designed and implemented (source [CONTEXT.md](/Users/wiinc1/repos/engineering-team/CONTEXT.md)).

## 3. Workflow & User Journey

**User Journey (step-by-step)**
1. Operator opens the task creation route.
2. Operator sees a lightweight intake form with raw requirements text and optional title.
3. Operator submits the intake.
4. System creates a Task in `DRAFT`.
5. System routes the Task to PM refinement.
6. Operator lands on task detail or sees the new draft in the task list.
7. Task detail shows `Operator intake requirements` above refined execution-contract sections.
8. The next required action is `PM refinement required`.

**System Flow (technical)**
1. Task creation UI collects `raw_requirements` and optional `title`.
2. UI submits to the existing task creation API.
3. API validates that raw requirements text is present.
4. API creates a Task with `initial_stage: 'DRAFT'`.
5. API records PM refinement routing as task state metadata: `current_owner=pm` and `next_required_action='PM refinement required'`.
6. API appends audit/history for `task.created` and `task.refinement_requested`.
7. Task list and task detail adapters surface Intake Draft label, raw intake text, current owner, and next required action.

**Error & Edge Cases**
- Raw requirements text is empty or whitespace only.
- Optional title is omitted.
- Optional title is excessively long.
- Existing clients still submit the older refined-field payload.
- Task creation succeeds but PM refinement routing event fails.
- Task list or detail receives a DRAFT task without PM routing metadata from older data.

**Required Diagram**
- Mermaid workflow diagram to be committed at: `/docs/diagrams/workflow-US-003.mmd`

## 4. Automated Test Deliverables

**Required automated deliverables for Standard tier**

```text
tests/
├── unit/
│   ├── task-creation-intake-schema.test.js
│   └── intake-draft-history.test.js
├── integration/
│   └── intake-draft-task-creation.integration.test.js
├── e2e/
│   └── intake-draft-creation.spec.ts
├── contract/
│   └── intake-draft-task-creation.contract.test.js
├── visual/
│   └── intake-draft-creation.visual.spec.ts
├── accessibility/
│   └── intake-draft-creation.a11y.spec.ts
├── performance/
│   └── lighthouse-intake-draft.spec.ts
└── security/
    └── intake-draft-creation-security.test.js
```

**Additional Standard Tier Test Requirements**
- Unit coverage for intake payload validation and optional-title handling.
- API/integration coverage that raw requirements only creates `DRAFT` and PM refinement routing metadata.
- E2E coverage for each Given-When-Then scenario in Section 2.
- Visual coverage for the intake form and Intake Draft task detail state.
- Accessibility coverage with axe-core on the creation form and task detail display.
- Security coverage that unauthenticated users cannot create Intake Drafts and unauthorized roles cannot bypass task creation permissions.

**Test Data Management**
- Fixture for raw intake text only.
- Fixture for raw intake text with optional title.
- Fixture for legacy task creation payload compatibility if retained.

## 5. Data Model & Schema

Not required for Standard tier as a standalone migration unless implementation discovers that the current audit/task payloads cannot persist raw intake text, PM routing metadata, or `task.refinement_requested`.

## 6. Architecture & Integration

**Pattern**
- Feature-sliced browser application architecture, using the existing task creation feature and existing audit/task APIs.

**New/Changed Components**
- `src/features/task-creation/TaskCreationForm.tsx`
- `src/features/task-creation/schema.js`
- `src/features/task-creation/adapter.js`
- `src/features/task-creation/TaskCreationPage.tsx`
- `lib/audit/event-types.js`
- `lib/audit/http.js`
- task list and task detail mapping surfaces in `src/app/App.jsx` and task-detail adapters as needed

**Required Diagram**
- C4 context/container diagram to be committed at: `/docs/diagrams/architecture-US-003.mmd`

**External Integrations**
- Existing authenticated task API only.
- No new third-party provider integration.

**Retry/Timeout Configuration**
- Reuse existing browser API client timeout/retry behavior.
- Do not retry validation failures.

**Circuit Breaker Settings**
- Not required for this slice.

**Feature Flag**
- Flag name: `ff_intake_draft_creation`
- Platform: existing repo feature-flag mechanism
- Targeting rules: internal operator users first, then all authenticated task creators after validation

## 7. API Design

**API Contract**

Existing task creation endpoint remains authoritative:

- `POST /tasks`

**Request body**

```json
{
  "raw_requirements": "The operator's raw initial requirements text.",
  "title": "Optional short title"
}
```

**Success response**

```json
{
  "taskId": "TSK-123",
  "status": "DRAFT",
  "nextRequiredAction": "PM refinement required"
}
```

**Validation/error response examples**
- `400` when `raw_requirements` is missing or blank
- `401` when no authenticated session is present
- `403` when the actor lacks `tasks:create`
- `503` when task creation is feature-disabled

**Committed spec location**
- If an API spec is changed, update `/docs/api/task-platform-openapi.yml` or the relevant audit/task API spec rather than creating a disconnected contract.

**Versioning Strategy**
- Additive request-shape change to existing task creation behavior.
- Preserve compatibility for existing callers where practical.

**Backwards Compatibility**
- Older refined-field creation payloads may continue to work during transition.
- New UI should use raw intake fields only.

**Automated API Testing**
- Contract coverage for raw requirements only.
- Regression coverage for missing auth, missing permission, and blank requirements.

## 10. UI/UX Requirements

**Owner:** UX Designer during the PM + Architect review stage.

### 10.1 Design Assets

- Wireframe or inline design notes are acceptable for this narrow slice.

### 10.2 Core Screens & Purpose

| Screen | Purpose | Primary User/Agent |
|---|---|---|
| Task Creation | Capture raw operator intake requirements quickly | Software Factory operator |
| Task List / Board | Make Intake Drafts visible as PM refinement work | Operator, PM |
| Task Detail | Preserve original operator intent and show next action | Operator, PM, Architect, UX Designer |

### 10.3 Role-Based Inbox / Queue Requirements

- PM Inbox: Intake Drafts routed to PM refinement should be visible as PM-owned work.
- Architect Inbox: no required change in this story.
- Engineer Inbox: Intake Drafts must not appear as implementation-ready work.
- QA Inbox: no required change in this story.
- SRE Inbox: no required change in this story.

### 10.4 Task Detail Page Information Architecture

**Above the fold**
- Task title or `Untitled intake draft`
- `Intake Draft` label
- Current owner: PM
- Current stage: `DRAFT`
- Next required action: `PM refinement required`

**Below the fold or in tabs**
- `Operator intake requirements`
- Audit/history entries for creation and PM refinement routing
- Existing refined execution-contract sections may remain empty or pending

### 10.5 Threaded Comment Model

No new threaded comment type is required for the first slice.

### 10.6 Escalation UX

Not required for this slice.

### 10.7 Stage Visualization

Task list/detail must visually distinguish Intake Drafts from implementation-ready tasks.

### 10.8 Component Library

Use existing app styles and components. Do not introduce a new design system.

### 10.9 Responsive Design

Creation form and Intake Draft detail state must remain usable at mobile, tablet, and desktop breakpoints already covered by the app.

### 10.10 Visual Regression

Capture baseline states for:
- raw intake form
- created Intake Draft in task detail
- Intake Draft in task list or board

### 10.11 Accessibility Automation

Run axe-core coverage against the intake form and Intake Draft detail state.

### 10.13 Automated UX Validation

Validate form labels, error messages, focus handling, and submit behavior without manual review.

## 11. Deployment & Release Strategy

**Deployment Type**
- Feature flag toggle through `ff_intake_draft_creation`.

**Progressive Rollout**
- Enable for internal operator usage first.
- Expand to all authenticated task creators after automated coverage and local validation pass.

**Automated Rollback Triggers**
- Disable `ff_intake_draft_creation` if task creation error rate increases, Intake Drafts fail to route to PM refinement, or list/detail display regresses.

**Rollback Procedure**
- Disable the feature flag and keep existing task creation behavior available until the regression is fixed.

**Synthetic Monitoring**
- Add or update a smoke path that verifies authenticated task creation can create a DRAFT task from raw requirements in a non-production or safe test tenant.

## 12. Monitoring & Observability

**Service Level Objectives**
- Intake Draft creation success rate should remain within existing task creation baseline.
- PM refinement routing should be recorded for 100% of created Intake Drafts.

**Events and Error Codes**
- Add `task.refinement_requested` to the workflow audit event taxonomy.
- Use unique validation and routing error codes for blank requirements and PM routing failure.

**Metrics**
- Intake Draft creation count.
- Intake Draft creation failures by reason.
- PM refinement routing failures.
- Intake Drafts without PM routing metadata.

**Dashboards and Alerts**
- Reuse existing task/audit dashboards unless implementation requires a new panel.
- Alert on routing failures or unexplained DRAFT tasks without next action.

## 15. Definition of Done

- Intake form requires raw requirements text only.
- Optional title is supported.
- Omitted title displays as `Untitled intake draft` plus Task ID in list/detail contexts.
- API accepts raw requirements only and persists a `DRAFT` Task.
- PM refinement routing is recorded as `current_owner=pm`, `next_required_action='PM refinement required'`, and `task.refinement_requested`.
- Task list/detail visibly labels Intake Drafts and shows `Operator intake requirements`.
- Engineer/QA/SRE execution states are not claimed during intake creation.
- Unit, integration, E2E, contract, visual, accessibility, performance, and security coverage required by Section 4 are added or updated.
- Lint, typecheck, and relevant test scripts pass.
- Documentation and API/diagram artifacts are updated where changed.

## 16. Production Validation Strategy

**Automated Pre-Flight Checks**
- Unit, integration, E2E, visual, accessibility, security, and contract checks pass before rollout.

**Automatic Verification in Production**
- If production validation is required, use a safe internal test tenant and verify that an authenticated operator can create a DRAFT from raw requirements without exposing sensitive content in logs.

**Escape Hatch**
- Disable `ff_intake_draft_creation`.

**Post-Deployment Verification Checklist**
- Deployment reports healthy.
- Task creation smoke passes.
- Task list/detail show Intake Drafts correctly.
- No spike in task creation errors.
- No Intake Drafts are missing PM refinement routing metadata.

## 17. Compliance & Handoff

**Code Repository**
- All implementation code should land on a feature branch named `feature/US-003-intake-draft-creation`.
- PR title: `[US-003] Create Intake Drafts From Raw Operator Requirements`
- PR description links to this story, [CONTEXT.md](/Users/wiinc1/repos/engineering-team/CONTEXT.md), and ADR [ADD-2026-04-28-intake-draft-as-task-stage.md](/Users/wiinc1/repos/engineering-team/docs/adr/ADD-2026-04-28-intake-draft-as-task-stage.md).

**Artifact Locations**
- Tests: `/tests/[unit|integration|e2e|contract|visual|accessibility|performance|security]/...`
- Diagrams: `/docs/diagrams/workflow-US-003.mmd`, `/docs/diagrams/architecture-US-003.mmd`
- API contract: existing task API spec if changed
- Runbook: update existing task workflow runbook if operator behavior changes

**Final Actions**
- Feature flag state documented in `/docs/feature-flags.md` if a flag is added.
- Story evidence captured in the PR or a report under `/docs/reports/`.
