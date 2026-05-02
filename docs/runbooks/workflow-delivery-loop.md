# Workflow Delivery Loop

> Issue #130 standards evidence: mechanical maintainability compaction only; no workflow procedure change.

This runbook documents the delivery-loop primitives implemented for:

- `SF-005` task locking and concurrency control
- `SF-007` structured threaded workflow comments
- `SF-009` engineer implementation handoff
- `SF-011` QA testing stage and re-test loop
- `SF-012` QA-to-engineer escalation package and context transfer

## Task locking

### Lock model

The implementation uses a short-lived pessimistic lock recorded in append-only audit history.

- Acquire: `task.lock_acquired`
- Release: `task.lock_released`
- Conflict audit: `task.lock_conflict`

### Lock-protected operations

These task mutations are rejected while another active lock holder owns the task:

- stage transitions through `task.stage_changed`
- assignment writes
- architect handoff submission
- engineer implementation submission
- structured workflow thread create/reply/resolve/reopen
- review question create/answer/resolve/reopen
- structured QA result submission

### Exemption

Architect read-only check-ins use `task.comment_workflow_recorded` with `comment_type=architect_check_in` and do not require a lock.

### Expiry and renewal

- Default TTL: 15 minutes
- Renewal: the current lock holder may call the same lock acquisition path again to extend the expiration window
- Recovery: once `lock_expires_at` is in the past, the lock is treated as inactive and the next mutation may proceed

### User-facing behavior

- Task detail shows the lock holder, expiry time, reason, and next action
- Lock holder sees `Renew lock` and `Release lock`
- Other users see retry/refresh guidance without concurrency jargon
- Successful stage transitions by the active lock holder automatically release the lock so completed handoffs do not strand the task

## Structured workflow threads

### Typed thread schema

Workflow threads are typed objects with normalized semantics:

- `commentType`: `question | escalation | consultation | decision | note`
- `blocking`: boolean
- `state`: `open | resolved`
- `linkedEventId`: optional workflow event reference
- `notificationTargets`: role-oriented routing hints stored with the thread

### Notification rules

The codebase persists routing hints per type:

- `question`: architect, plus PM when blocking
- `escalation`: PM, engineer, SRE
- `consultation`: architect, engineer
- `decision`: PM, architect, engineer, QA
- `note`: followers, or PM/architect when blocking

These are stored in the thread payload and can drive later notifier integrations.

Task detail previews the current notification targets before a thread is submitted and keeps the stored targets visible on each thread card.

### Readability policy

- unresolved blocking threads are pinned near the top of task detail
- per-type badges provide distinct visual grammar
- long thread histories collapse after the most recent two updates until expanded

### Retention/edit policy

Threads are append-only workflow objects. Updates are represented as reply/resolve/reopen events rather than in-place mutation.

## Engineer implementation handoff

### Required reference model

At least one implementation reference is required before QA handoff:

- commit SHA
- GitHub PR URL

The primary implementation reference is:

- PR URL when provided
- otherwise commit SHA

### Current-assignee enforcement

- Engineer-only delivery-loop actions are accepted only when the caller still matches the task's current canonical assignee.
- If a task has already been reassigned to another owner role, later engineer check-ins, engineer submission, or above-skill escalation attempts fail with `403 forbidden`.
- Tier-based reassignment may set a more explicit projected assignee id such as `engineer-sr` or `engineer-principal` while still collapsing into the canonical engineer routing family for overview surfaces.

### Local git vs GitHub

QA progression does not depend on GitHub availability. A valid local commit SHA is sufficient.

### Fix history

Every engineer submission is versioned and preserved in audit history. Task detail exposes the prior implementation history so QA failures can route back with full fix lineage.

## QA result schema

Structured QA results are recorded as `task.qa_result_recorded` with:

- `outcome`: `pass | fail`
- `run_kind`: `initial | retest`
- `prior_run_id`: previous failing run for re-tests
- `implementation_version`
- `implementation_reference`
- `summary`
- `scenarios`
- `findings`
- `reproduction_steps`
- `stack_traces`
- `env_logs`
- `retest_scope`
- `routed_to_stage`
- `escalation_package` for failing runs

## QA routing rules

- `pass` routes `QA_TESTING -> SRE_MONITORING`
- `fail` routes `QA_TESTING -> IMPLEMENTATION`
- A re-test is inferred when a new implementation submission version exists after the last failed QA run

## Full regression vs scoped re-test

- Default first QA run is treated as full coverage for the task
- After a failed QA run and a newer engineer submission, QA may provide a scoped re-test plan through `retest_scope`
- The scoped re-test remains linked to the earlier failing run through `prior_run_id`

## Escalation package schema

Failing QA runs generate a packaged engineer-facing artifact containing:

- QA summary
- failing scenarios
- findings
- reproduction steps
- stack traces
- environment logs
- PM requirements: business context, acceptance criteria, DoD
- architect context: tier, rationale, technical spec, monitoring spec
- previous fix history
- routing metadata: recipient role/agent, required engineer tier, escalation chain
- notification preview: headline, top actionable highlights, collapsed log/trace counts
- attachment strategy for stack traces and environment logs

## Escalation package presentation rules

- reproduction steps first
- failing scenarios next
- findings next
- notification preview before the full package details
- logs and traces collapsed by default behind an expand affordance
- previous fix history always available from the same package view

## Governance review tasks

- Inactivity reassignment can create a dedicated governance review task typed as `governance_review`.
- Governance review tasks are operational follow-up artifacts, not standard delivery work, and should be shown on a dedicated governance review surface rather than in normal delivery queues.

## SRE monitoring workflow

### Monitoring start requirements

- A passing QA result routes work into `SRE_MONITORING`.
- SRE or admin starts the monitoring window through the dedicated SRE monitoring route, not via assignment controls.
- Start requires durable deployment confirmation fields:
  - deployment environment
  - deployment URL
  - deployment version
- The task-list projection exposes enough monitoring preview data for `/inbox/sre` to render countdown, deployment, PR, commit, and telemetry drilldowns without client fan-out.

### Routing precedence

- Active `SRE_MONITORING` work routes to the SRE inbox by stage, even when the assigned owner remains an engineer.
- Explicit human waiting-state or stakeholder escalation routing takes precedence so expired monitoring work leaves the SRE inbox and appears in the human inbox.

### Expiry handling

- Expired windows are materialized by worker processing rather than task reads.
- The worker appends an auditable `task.escalated` event with `reason=sre_monitoring_window_expired`.
- Resulting state should carry `waiting_state=awaiting_human_stakeholder_escalation` and a human-focused next action.
- Human inbox cards should show the expiry summary plus an explicit recommendation so stakeholders can approve, reject, or request more context without opening operational SRE views.

## Governed close-review dispute handling

- PM close review may raise `POST /tasks/{id}/close-review/exceptional-dispute` when PM or Architect cannot align on cancellation vs. reopening implementation.
- Exceptional disputes write an auditable `task.escalated` event with `reason=exceptional_dispute`, preserve the short recommendation summary shown in the human inbox, and set `waiting_state=awaiting_human_stakeholder_escalation`.
- Human stakeholder decisions continue to use the governed close-review decision endpoint and should remain explicit: approve, reject, or request more context.
- Human stakeholder decisions are valid only when the task is decision-ready. The backend now exposes that readiness explicitly and rejects premature decisions until dual cancellation recommendations or an escalation exists.
- Close-review backtrack is now a two-step agreement handshake. One PM/Architect request records a backtrack recommendation; the counterpart request using the same agreement artifact completes the stage change back to `IMPLEMENTATION`.
