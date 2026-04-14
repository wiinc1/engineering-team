# Issue #30 — Task Platform Redesign Implementation

## Delivered

Issue #30 is now implemented in the repo as an additive canonical task platform layered beside the audit foundation.

Delivered components:

- additive schema for `ai_agents`, `tasks`, `task_mutations`, and `task_sync_checkpoints` in [db/migrations/006_canonical_task_persistence.sql](/Users/wiinc2/.openclaw/workspace/engineering-team/db/migrations/006_canonical_task_persistence.sql)
- canonical task platform services in [lib/task-platform/service.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/task-platform/service.js), [lib/task-platform/postgres.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/task-platform/postgres.js), and [lib/task-platform/backfill.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/task-platform/backfill.js)
- additive runtime API under `/api/v1` in [lib/audit/http.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/audit/http.js)
- optimistic concurrency on canonical task mutations through required `version`
- compatibility sync from legacy audit-backed task flows into canonical task rows
- imported-agent handling so legacy owners outside the bounded roster can still be represented canonically
- backfill entrypoint in [scripts/backfill-task-platform.js](/Users/wiinc2/.openclaw/workspace/engineering-team/scripts/backfill-task-platform.js)
- versioned API contract in [docs/api/task-platform-openapi.yml](/Users/wiinc2/.openclaw/workspace/engineering-team/docs/api/task-platform-openapi.yml)

## Runtime Shape

Current live architecture in-repo:

1. canonical task business state writes can go through `/api/v1/tasks` and `/api/v1/tasks/{taskId}/owner`
2. canonical task state persists through the task-platform service on the configured backend
3. legacy audit-backed task routes continue to function
4. legacy task mutations best-effort sync into canonical task rows
5. canonical ownership changes still emit audit events so current history/projection surfaces remain valid

This means Issue #29 remains compatible while Issue #30’s canonical model now exists as executable code, not only documentation.

## Backfill And Sync

Backfill path:

- source: audit projections and task history via `createAuditStore()`
- target: canonical task platform via `syncTaskFromProjection()`
- checkpointing: `task_sync_checkpoints`
- imported legacy owners: auto-created as `execution_kind='legacy-import'`, `assignable=false`

Operational command:

```bash
npm run task-platform:backfill
```

Operator rollout reference:

- [docs/runbooks/task-platform-rollout.md](/Users/wiinc2/.openclaw/workspace/engineering-team/docs/runbooks/task-platform-rollout.md)

## Verification

Verified locally on 2026-04-12:

- `node --test tests/unit/task-platform-api.test.js tests/unit/task-platform-backfill.test.js`
- `node --test tests/e2e/task-assignment.test.js tests/integration/task-assignment-integration.test.js`
- `npm test`
- `npm run lint`
- `npm run typecheck`
- `git diff --check`

## Remaining Operational Work

The architecture and runtime implementation are present. The remaining steps are environment execution tasks rather than missing repo code:

- apply migration `006_canonical_task_persistence.sql` in the target Postgres environment
- run `npm run task-platform:backfill` against the target environment
- switch read surfaces from projection-first to canonical-first when rollout policy allows
- observe drift and retire compatibility-only sync paths after the cutover window

## Standards Alignment

- Applicable standards areas: architecture and design, deployment and release, testing and quality assurance, observability and monitoring
- Evidence in this report: additive schema, versioned API contracts, automated verification commands, and phased rollout notes
- Gap observed: target-environment migration execution and drift observation are still pending outside this repo report. Documented rationale: small, reversible rollout steps reduce operational risk and observability should support confidence during cutover (source https://sre.google/books/).

## Required Evidence

- Commands run: `node --test tests/unit/task-platform-api.test.js tests/unit/task-platform-backfill.test.js`, `node --test tests/e2e/task-assignment.test.js tests/integration/task-assignment-integration.test.js`, `npm test`, `npm run lint`, `npm run typecheck`, `git diff --check`
- Tests added or updated: task-platform unit, integration, end-to-end, and full-suite regression coverage
- Rollout or rollback notes: additive canonical platform with compatibility sync and backfill path before cutover
- Docs updated: task-platform report, linked runbook, API contract, schema diagram, and ADR
