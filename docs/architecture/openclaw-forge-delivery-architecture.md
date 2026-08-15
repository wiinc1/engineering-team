# OpenClaw Forge Delivery Architecture

## Purpose

Define the target architecture for using OpenClaw as the execution layer for a broader autonomous delivery system, with `engineering-team` as the source of truth for work coordination and Hermes as the primary runtime memory system.

This document captures the currently agreed direction for:

- task intake and execution
- specialist delegation
- review and sign-off
- Discord and remote access
- runtime memory
- project/repo binding

## Goals

- Turn strong requirements into implementation work without line-by-line micromanagement
- Use a specialized multi-agent team instead of one generic executor
- Keep task coordination and progress tracking in `engineering-team`
- Make work resumable across long-running sessions and remote surfaces
- Support Discord as a control surface without making it the source of truth
- Avoid redundant infrastructure and software

## Primary Systems

### `engineering-team`

Canonical system of record for:

- task metadata
- task classification
- acceptance criteria
- review gates
- task history
- handoff history
- operator-visible runtime projections

### Forge Adapter

Separate local service that sits between `engineering-team` and OpenClaw.

Owns:

- execution control
- runtime/session mapping
- packet compilation and validation
- routing rules
- project binding
- worktree allocation
- memory writes to Hermes
- service-side authorization
- execution audit events

### OpenClaw

Execution runtime and agent surface.

Owns:

- parent `main` task sessions
- child specialist sessions
- Discord interaction surface
- task execution inside the correct bound project/worktree

### Hermes

Primary runtime memory system.

Used for minimal, durable task memory:

- task summary at start
- handoff summaries
- final outcome summary

Not the source of truth for workflow history.

## Authority Model

### Source Of Truth

- `engineering-team` is the authoritative record of work
- forge adapter is the authoritative execution control boundary
- OpenClaw is the execution runtime
- Hermes is the runtime memory layer
- Discord is a UI surface, not an authority

### Multiple Entry Surfaces

The system supports both:

- `engineering-team`-initiated work
- Discord-initiated work

But all task-affecting actions must flow through the forge adapter and resolve against `engineering-team` first.

If `engineering-team` is unavailable:

- new work must not start
- the caller should receive an explicit failure and remediation message

## Execution Model

### Session Ownership

- each task gets one durable parent OpenClaw session
- the parent session belongs to `main`
- `main` is an orchestration layer, not the default implementer
- specialist-owned work must be delegated to real specialist sessions

### Specialist Delegation

- `main` delegates work into child execution sessions
- child sessions are linked to the same canonical task
- delegation and return are first-class task-history events

Each handoff record should capture at least:

- delegating agent
- receiving agent
- reason for handoff
- child session id
- timestamp
- outcome or status
- blockers or escalation note
- next owner or next stage

### Initiation

- `engineering-team` pushes work into the forge adapter
- the forge adapter starts or resumes OpenClaw work asynchronously
- execution actions return a job/run id immediately

## Routing Model

### Primary Routing

- deterministic routing rules live in the forge adapter
- model judgment is fallback only for ambiguous tasks

### Override Rules

- `main` has narrow override authority
- human operators also have override authority
- every override requires an explicit reason
- every override is audited and linked to the task

## Task Classification And Intake

### Canonical Classification

`engineering-team` owns the canonical task shape, even when work originates from GitHub.

GitHub issues must be normalized into `engineering-team` tasks before execution starts.

Draft tasks with missing metadata are allowed, but execution is blocked until preflight requirements are satisfied.

### Required Preflight Fields

The initial required execution fields are:

- `task_type`
- `domain`
- `project_id`
- `target_repo` or equivalent project binding
- `affects_ui`
- `acceptance_criteria`
- `priority`
- `requested_owner` or initial routing hint when present

If required fields are missing:

- the forge adapter must reject the execution request
- the response must include remediation details

## Review And Completion Model

### Review Gates

Required review gates are materialized onto the task at execution start.

Default implementation-task gates:

- `qa-engineer` pass
- `architect` sign-off
- `product-manager` sign-off

Additional gate when user-facing UI or experience is affected:

- `ux-designer` sign-off

### Gate Determination

- `engineering-team` supplies canonical classification metadata
- the forge adapter applies deterministic gate rules
- gates become the task's review contract

After execution starts:

- review gates may change only through an explicit review-contract amendment event

### Sign-Off Representation

Each gate records a structured decision:

- `approved`
- `rejected`
- `changes_requested`

Each decision includes:

- role
- actor
- reason
- timestamp
- session linkage

### Failed Gates

If a gate fails:

- the task returns to active execution, not review limbo
- return routing is determined by deterministic rules in the forge adapter
- `main` remains notified as parent orchestrator

Review approvals must come from actual specialist sessions, not simulated approval by `main`.

## Project And Repo Binding

### Binding Responsibility

The forge adapter resolves project and repo targeting before execution starts.

It owns:

- task -> project resolution
- project -> worktree root resolution
- task -> worktree allocation
- session binding to the correct repo or worktree

### Code Isolation

For implementation-heavy code tasks:

- allocate one git worktree per active task

For non-code tasks:

- use shared OpenClaw workspace context
- do not allocate a dedicated worktree unless the task actually needs repo isolation

## Discord And Remote Access

### Discord

OpenClaw's existing Discord integration stays in place.

However:

- `start task`
- `resume task`
- `assign`
- `record progress`

must all flow through the forge adapter and resolve against `engineering-team`.

### Remote Access

Primary remote-access model:

- Tailscale-only access

The task system and forge adapter should remain private, not broadly internet-exposed.

## Memory Model

### Primary Memory Choice

Use Hermes as the one primary runtime memory system.

Do not run redundant steady-state memory infrastructure unless a later evaluation proves Hermes insufficient.

### Memory Policy

All tasks receive the same minimal memory lifecycle.

Hermes writes occur:

- at task start
- at each delegation or handoff
- at task completion

Hermes memory is keyed primarily by `task_id`.

### What Gets Written

Minimal memory policy only:

- task summaries
- handoff summaries
- final outcomes

The forge adapter composes these summaries from canonical task and runtime data.

Agents do not freely author memory payloads as the primary mechanism.

### Resume Behavior

When resuming a task:

- adapter fetches the latest task record from `engineering-team`
- adapter fetches the task's Hermes memory summary
- the resumed session receives both

Success criterion for Hermes:

- a resumed task session can continue correctly without the human re-explaining the task

### Hermes Failure Policy

If a Hermes write fails:

- execution continues
- adapter records a visible memory-write warning
- the degradation is surfaced in task/runtime status for remediation

## Packet Architecture

### Packet Ownership

The forge adapter fetches canonical task data from `engineering-team` and compiles execution and review packets itself.

`engineering-team` does not own packet compilation logic.

### Packet Validation

- canonical schemas live in the forge adapter repo
- packets are schema-validated before every start, resume, or delegation action
- invalid packets cause the action to be rejected with remediation detail

### Shared Core Fields

Execution and review packets share at least:

- `task_id`
- `project_id`
- `task_type`
- `domain`
- `current_workflow_state`
- `current_execution_state`
- `parent_session_id`
- `active_agent_id`
- `acceptance_criteria`
- `blockers`
- `next_expected_action`

### Execution Packet Fields

Execution packets additionally require:

- `objective`
- `repo_context`
- `worktree_path` when code task
- `handoff_reason`
- `latest_handoff_summary`
- `requested_deliverables`
- `constraints`
- `validation_steps`

### Review Packet Fields

Review packets additionally require:

- `review_role`
- `review_scope`
- `artifacts_under_review`
- `implementation_summary`
- `test_summary` when applicable
- `open_questions`
- `decision_deadline` optional
- `recommended_decision` optional

### Packet Reuse

The standardized execution packet contract is reused for:

- task resume
- `main` -> specialist delegation
- specialist return to `main`

## Security And Authorization

### Service Authentication

Use service-to-service authentication between `engineering-team` and the forge adapter.

### Adapter Authorization

The forge adapter must enforce per-action authorization, not merely trust any authenticated caller.

Minimum authorization inputs:

- `actor`
- `task_id`
- `requested_action`
- `target_agent`
- current task/runtime state

### Auditing

Every accepted and rejected control action must be recorded as an audit event linked to the task.

This includes operator overrides and failed requests.

## Operator Visibility

`engineering-team` should store and display:

- projections of execution packets
- handoff summaries
- runtime status projections
- review gate state
- memory-write degradation warnings

But these are projections for visibility, not the canonical execution contract.

## Recommended Implementation Order

1. Build the forge adapter as a separate local service
2. Define canonical execution and review packet schemas in the adapter
3. Define service auth and adapter-side authorization
4. Implement canonical task fetch from `engineering-team`
5. Implement task -> project -> worktree binding
6. Implement durable parent `main` sessions and child specialist sessions
7. Implement deterministic routing rules plus explicit override handling
8. Implement review-gate materialization and structured gate decisions
9. Integrate Hermes with minimal task memory writes
10. Add Discord control-surface routing through the forge adapter

## Issue Backlog Alignment

The `wiinc1/forgeadapter` repository issue backlog should reflect this document at two levels:

- architecture epics
- implementation child issues

### Architecture Epics

These issues map directly to the architecture areas in this document:

- `#1` Scaffold forge adapter service and baseline repo structure
- `#2` Define canonical forge adapter schemas and API contract
- `#3` Integrate canonical task fetch from `engineering-team` and enforce preflight validation
- `#4` Implement service-to-service auth, adapter authorization, and audit events
- `#5` Persist runtime state and asynchronous job orchestration for task execution
- `#6` Add deterministic specialist routing, overrides, and delegated child sessions
- `#7` Implement parent OpenClaw task sessions and standardized resume packet generation
- `#8` Implement project binding resolution and task-scoped git worktree allocation
- `#9` Implement review gate materialization, structured review packets, and sign-off workflow
- `#10` Integrate Hermes as the primary runtime memory system with minimal task memory writes
- `#11` Expose runtime projections and execution context back to `engineering-team`
- `#12` Route Discord-initiated task actions through the forge adapter without bypassing `engineering-team`

### Implementation Breakdown

The concrete implementation backlog currently includes:

#### Foundation and contracts

- `#13` Choose forge adapter runtime, package manager, and repository layout
- `#14` Document the initial forge adapter HTTP API and remediation error model
- `#15` Define runtime projection, handoff event, audit event, and review gate schemas
- `#16` Define and validate the canonical review packet schema
- `#17` Define and validate the canonical execution packet schema
- `#18` Define shared core schema for execution and review packets
- `#19` Set up test, lint, and typecheck pipelines for the forge adapter
- `#20` Add service bootstrap, config loading, and health/readiness endpoints

#### Auth, task fetch, validation, and runtime state

- `#21` Implement service authentication between `engineering-team` and the forge adapter
- `#22` Implement asynchronous job/run orchestration for start, resume, delegate, and review actions
- `#23` Persist canonical task-to-runtime mapping and execution state records
- `#24` Compute and materialize required review gates at execution start
- `#25` Validate required preflight metadata before task execution starts
- `#26` Implement `engineering-team` task client and canonical task fetch by task id
- `#27` Persist accepted and rejected control actions as task-linked audit events
- `#28` Enforce adapter-side authorization for task-affecting actions

#### Execution, routing, and project binding

- `#29` Compile validated initial execution packets from canonical task data
- `#30` Allocate and track one git worktree per active code task
- `#31` Resolve project bindings from canonical task metadata before execution
- `#32` Create delegated child specialist sessions and record canonical handoff history
- `#33` Support narrow routing overrides with required reasons for `main` and human operators
- `#34` Implement deterministic specialist routing rules in the forge adapter
- `#35` Generate deterministic resume packets from task state and Hermes memory
- `#36` Create one durable parent OpenClaw session per task owned by `main`
- `#37` Bind OpenClaw execution to resolved repo/worktree or shared workspace context

#### Review workflow and Hermes memory

- `#38` Enforce review-contract amendment events for post-start gate changes
- `#39` Route failed review gates back into active execution through deterministic return rules
- `#40` Record structured gate decisions from QA, architect, PM, and UX review sessions
- `#41` Implement structured review packet compilation from canonical task and runtime data
- `#42` Write Hermes final outcome summaries and load Hermes context on resume
- `#43` Write Hermes handoff summaries for delegated specialist work
- `#44` Integrate Hermes client and task-keyed memory writes at task start

#### Operator projection, Discord, testing, and operations

- `#45` Implement `GET /tasks/:id/runtime` with parent-child session lineage and execution state projection
- `#46` Write an operator and integration runbook for `engineering-team`, OpenClaw, Hermes, and Discord wiring
- `#47` Bind Discord thread references into canonical runtime state
- `#48` Reject Discord-initiated new work when `engineering-team` is unavailable
- `#49` Accept Discord-initiated task actions through the forge adapter control path
- `#50` Render projections of execution and review packet context for operator visibility
- `#51` Project handoff history, review status, and memory degradation into operator-facing runtime views
- `#52` Add integration test coverage for task lifecycle, delegation, review gates, and Hermes-backed resume

### Documentation Rule

If new issues are added to the `forgeadapter` backlog that materially change:

- system authority
- packet contracts
- review gates
- memory policy
- routing policy
- task/runtime state ownership
- Discord behavior
- project binding behavior

then this document should be updated in the same change set or planning pass.

## Non-Goals For The First Version

- dual task authorities
- broad internet exposure of the execution plane
- broad freeform memory ingestion
- packet compilation in multiple systems
- specialist review simulated by `main`
- shared code worktrees for concurrent implementation tasks
