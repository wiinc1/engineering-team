# Architecture Decision Record: Canonical Task Persistence And AI Agent Ownership

**Date:** 2026-04-12  
**Status:** Accepted  
**Deciders:** Architect (Arch), Engineering

## Context

Task ownership is currently implemented on top of the workflow audit/event stream and read projections:

- immutable source-of-truth events live in `audit_events`
- current task state is derived into `audit_task_current_state`
- assignment validity depends on a config-backed AI registry in `lib/audit/agents.js`
- mutation APIs are exposed from `lib/audit/http.js`

That architecture is good for auditability, but it is not the same as having a canonical task persistence model. The gaps surfaced by Issue #30 are real:

- there is no canonical `tasks` table
- there is no first-class nullable `owner_agent_id` column on a canonical task record
- there is no canonical AI agent registry persisted in the database
- the API surface is centered on audit/event endpoints rather than a cohesive task application API
- request validation and error semantics are mostly route-local rather than standardized application conventions
- optimistic concurrency is not a consistent contract for task mutations

## Decision

Introduce an additive canonical task platform alongside the current audit stack, with the first implementation slice now present in the repo.

### 1. Canonical task record

Create a database-backed `tasks` table as the source of truth for mutable task state. The row owns the task's current business state, including:

- `task_id`
- `tenant_id`
- `title`
- `description`
- `status`
- `priority`
- `owner_agent_id`
- `version`
- `created_at`
- `updated_at`
- `closed_at`

The current audit projection remains valuable, but it becomes a derived or compatibility read model rather than the long-term write authority for product workflows.

### 2. Canonical AI agent registry

Create an `ai_agents` table as the database source of truth for assignable agents. A canonical agent must express:

- identity: `agent_id`
- tenant/environment scope
- display metadata: display name, role, execution type
- lifecycle state: `active`
- assignment eligibility: `assignable`

Config-backed registries remain supported only as bootstrap or fallback data sources during rollout.

### 3. Ownership semantics

Task ownership is modeled as a nullable foreign key from `tasks.owner_agent_id` to `ai_agents.agent_id` within the same tenant scope.

- `NULL` means unassigned
- non-null means assigned to the canonical active agent row at write time
- inactive or non-assignable agents cannot receive new assignments
- historical ownership changes are preserved in audit/event history and canonical mutation history

### 4. Mutation API model

Introduce versioned task application endpoints under `/api/v1/tasks/...` and `/api/v1/ai-agents`.

- `/tasks/{id}/assignment` remains as a compatibility route during rollout
- new canonical mutations target the task row directly
- audit events are emitted from canonical mutations, not treated as the primary write path

### 5. Validation and errors

Standardize on:

- route-level request parsing
- shared schema validation
- typed domain/application errors
- one error response shape
- request-id based logging correlation

### 6. Concurrency

Use optimistic concurrency on every mutating task endpoint via a required task version.

- successful mutation increments `tasks.version`
- stale writes return `409 conflict`
- compatibility routes may temporarily translate projection state into canonical version semantics

### 7. Rollout shape

Adopt a parallel-run migration:

1. add canonical tables
2. backfill from audit projections/history
3. dual-write from canonical task service to audit events
4. migrate read surfaces to canonical tables or canonical-backed views
5. retire projection-only ownership writes after confidence thresholds are met

## Implementation Status

Implemented in-repo on 2026-04-12:

- additive schema in `db/migrations/006_canonical_task_persistence.sql`
- canonical task platform services in `lib/task-platform/`
- additive `/api/v1/tasks` and `/api/v1/ai-agents` routes in `lib/audit/http.js`
- optimistic concurrency on canonical task mutations
- compatibility sync from the legacy audit-owned routes into canonical task records
- audit-to-canonical backfill utility in `lib/task-platform/backfill.js`

Remaining rollout work is operational rather than architectural:

- run the migration in the target Postgres environment
- execute backfill in the target environment
- cut read surfaces from projection-first to canonical-first
- monitor drift and remove compatibility-only write paths when safe

## Rationale

- The product needs a stable, queryable task record for future workflow features, not only an audit projection.
- Ownership is business state and should be first-class on the task row.
- Agents are operational resources and should be modeled as data, not only config.
- Standard mutation semantics and versioning reduce route-by-route behavior drift.
- The existing audit foundation remains useful for history, compliance, replay, and external publishing.

## Consequences

### Positive

- Clear source of truth for task state and ownership
- Extensible platform for future workflow features
- Cleaner validation, error handling, and API contracts
- Explicit concurrency semantics
- Simpler joins for task lists, inboxes, and queue views

### Negative

- Additional write path complexity during dual-write rollout
- Backfill/reconciliation work is required
- Legacy markdown command-router flows need compatibility shims
- More schema and service surface area to operate

### Neutral

- Audit events remain important, but shift from primary mutable store to derived event stream for canonical writes
- Existing `/tasks/{id}/assignment` clients can continue temporarily behind compatibility adapters

## Alternatives Considered

### Alternative 1: Keep audit projections as the only task state model

**Decision:** Rejected  
**Rationale:** Keeps current limitations around ownership, validation consistency, and concurrency as the system grows.

### Alternative 2: Add only an `owner_agent_id` projection field and defer canonical tables

**Decision:** Rejected  
**Rationale:** Solves only one symptom while leaving task persistence and agent registry gaps unresolved.

### Alternative 3: Replace audit storage entirely with mutable task tables

**Decision:** Rejected  
**Rationale:** Loses the current audit/event strengths and makes migration riskier than an additive canonical model.

## Related Artifacts

- [db/migrations/006_canonical_task_persistence.sql](/Users/wiinc2/.openclaw/workspace/engineering-team/db/migrations/006_canonical_task_persistence.sql)
- [docs/api/task-platform-openapi.yml](/Users/wiinc2/.openclaw/workspace/engineering-team/docs/api/task-platform-openapi.yml)
- [docs/diagrams/schema-ISSUE-30.mmd](/Users/wiinc2/.openclaw/workspace/engineering-team/docs/diagrams/schema-ISSUE-30.mmd)
- [docs/reports/ISSUE_30_TASK_PLATFORM_REDESIGN.md](/Users/wiinc2/.openclaw/workspace/engineering-team/docs/reports/ISSUE_30_TASK_PLATFORM_REDESIGN.md)
