# Issue #7 Completion Audit

## Scope
Issue #7 (`[SF-002] Software Factory: Task detail page and task read model`) requires a task detail page and dedicated task detail read model that let a workflow participant understand task state, ownership, blockers, supporting context, and next action within seconds.

This note closes the remaining audit gaps by documenting the canonical API contract, explicit server-side derivation rules, freshness semantics, and non-functional budgets used by the implementation.

## Status
Issue #7 is implemented in this repository.

The remaining work identified during audit was documentation and contract hardening, not missing core product functionality.

## Canonical contract
The canonical UI contract is `GET /tasks/{id}/detail`.

Supporting endpoints remain available for narrower reads and operator workflows:
- `GET /tasks/{id}`
- `GET /tasks/{id}/history`
- `GET /tasks/{id}/observability-summary`

The browser task detail page uses the server-prepared detail payload and does not stitch primary page state from multiple endpoints on the client.

## Deterministic derived-field rules
The implementation defines the following server-side rules in `lib/audit/http.js`.

### Task status precedence
From `inferTaskStatus(summary)`:
1. `done` when `summary.closed === true` or `summary.current_stage === 'DONE'`
2. `blocked` when `summary.blocked === true`
3. `waiting` when `summary.waiting_state` is present
4. otherwise `active`

This precedence is authoritative for the task detail read model.

### Linked PR rollup
From `collectLinkedPrs()` and `summarizePrStatus()`:
- linked PRs are collected first from explicit relationship data, then augmented from audit event payloads
- PRs are deduplicated by normalized PR id
- rollup precedence:
  1. `done` when all linked PRs are merged
  2. `draft` when any non-merged linked PR is draft
  3. `active` when any non-merged linked PR remains open
  4. `mixed` otherwise
  5. `empty` when no linked PRs exist

### Child task rollup
From `buildTaskDetailViewModel()`:
- child task summaries are resolved from projected task summaries rather than per-child history fanout
- rollup precedence:
  1. `blocked` when any child task is blocked
  2. `done` when every child task is done
  3. `waiting` when any child task is waiting
  4. `active` otherwise
  5. `empty` when no child tasks exist

### Next action derivation
From `buildTaskDetailViewModel()`:
- `summary.nextAction.label` uses `summary.next_required_action`
- when absent, the UI receives `No next step defined`
- current implementation marks populated next actions as `source: 'system'` and empty state as `source: 'none'`
- `summary.nextAction.waitingOn` is derived from `summary.waiting_state`
- `summary.nextAction.overdue` is true when telemetry freshness is stale

### Workflow stage source of truth
- workflow stage comes from projected current state (`summary.current_stage`)
- the detail read model does not infer workflow stage on the client

### Owner source of truth
- current owner comes from projected current state (`summary.current_owner`)
- unassigned is explicit, not inferred from missing UI data

### Technical and monitoring spec precedence
From `lastDefinedPayloadValue()`:
- technical spec is the newest non-empty value found in task history under `technical_spec` or `technicalSpec`
- monitoring spec is the newest non-empty value found in task history under `monitoring_spec` or `monitoringSpec`

### Blocker source derivation precedence
For each blocker entry:
1. `child_task` when the blocker references a currently blocked child task
2. `external_dependency` when the blocker payload declares one
3. `review` when `review_required` is present
4. `approval` when `approval_required` is present
5. fallback to `summary.waiting_state`
6. fallback to `workflow`

## Permissions and omission rules
The `/detail` contract is server-authoritative.

When access is insufficient, the server omits or empties restricted sections rather than relying on client-side hiding.

Permission mapping:
- comments and audit log require `history:read`
- child tasks and linked PR metadata require `relationships:read`
- telemetry requires `observability:read`

The payload includes explicit `meta.permissions` booleans so the UI can explain hidden sections without showing misleading blanks.

## Freshness and consistency semantics
Current implementation:
- `summary.freshness` is the canonical workflow/read-model freshness source
- `telemetry.lastUpdatedAt` is telemetry-specific recency
- live updates are **not** required in v1
- refresh behavior is **manual refresh**
- stale or degraded telemetry must be rendered explicitly

Staleness rules currently implemented:
- workflow freshness becomes `stale` when the latest task activity is older than 5 minutes in the local read model helper
- telemetry stale/degraded state is surfaced independently in the detail payload and activity shell

## Performance and payload budgets
The implementation and tests now use the following v1 expectations:
- detail page primary read path: one canonical `/tasks/{id}/detail` request for page state
- local browser render smoke budget: under 1 second for mock-backed task detail route verification
- history endpoint pagination default: `limit=25`, maximum `500`
- detail payload truncation:
  - comments limited to 10 entries in the detail payload
  - audit log limited to 20 entries in the detail payload
- child summaries are read from projections to avoid child-history N+1 fanout

These are v1 budgets for local and internal-use validation, not production internet-facing SLOs.

## Validation evidence
Relevant coverage already present in repo:
- unit: `tests/unit/task-detail-adapter.test.js`
- route/model: `tests/unit/task-detail-route.test.js`
- app rendering and accessibility semantics: `src/app/App.test.tsx`
- browser responsive verification: `tests/browser/task-detail.browser.spec.ts`
- API authorization and feature flag behavior: `tests/unit/audit-api.test.js`

## Remaining non-blocking follow-up ideas
Not required to satisfy issue #7, but worth later tightening:
- document payload-size budget numerically
- document backing query-count budget numerically for each storage backend
- add a first-class OpenAPI example payload for `/tasks/{id}/detail`
- add explicit stale-window config if the project wants a runtime-tunable threshold later

## Later task-detail additions now covered by the same contract discipline
- Subsequent workflow slices may extend the detail `context` object with additive sections when the server remains the authoritative derivation layer.
- Current additive example: `context.sreMonitoring`, which carries deployment evidence, countdown state, telemetry drilldowns, approval evidence, and expiry escalation status for tasks in the SRE monitoring flow.
- These additions do not change the underlying task-detail rule that the client should consume the server-prepared `/tasks/{id}/detail` payload rather than reconstructing workflow state from multiple endpoints.

## Standards Alignment

- Applicable standards areas: testing and quality assurance, observability and monitoring, team and process
- Evidence in this report: explicit contract rules, permissions behavior, freshness semantics, and validation evidence
- Gap observed: deployed-environment latency evidence and production alert wiring remain future work. Documented rationale: user-facing reliability requires direct measurement, and actionable alerting should correspond to user pain (source https://sre.google/books/).

## Required Evidence

- Commands run: validation commands are captured in the report's validation evidence section
- Tests added or updated: route contract and browser validation coverage referenced in the audit
- Rollout or rollback notes: audit-only review with no direct runtime change
- Docs updated: issue completion audit report
