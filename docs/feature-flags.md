# Feature Flags

## Canonical Task Runtime

- `FF_CANONICAL_TASK_RUNTIME`
  Rollout label for the canonical `/api/v1` task-platform runtime. The current
  checked-in route wiring treats canonical task records as the standard
  production/staging/local API path whenever Postgres is configured.
  Default: enabled when unset.

Fallback controls:

- `AUDIT_STORE_BACKEND=postgres`
  Explicitly selects the Postgres audit/task-platform backend.

- `AUDIT_STORE_BACKEND=file`
  Selects the file backend only when paired with an isolated local/test fallback
  opt-in. Production and staging reject this mode.

- `ALLOW_FILE_AUDIT_BACKEND=true`
  Allows the file backend for isolated local development or test harnesses.
  Do not set this in staging or production.

Behavior:

- Runtime startup uses Postgres by default and requires `DATABASE_URL` unless an
  explicit local/test file fallback is enabled.
- `npm run dev:postgres:up` starts the canonical local Postgres service.
- File fallback emits structured `ff_canonical_task_runtime` backend-selection
  warning metadata with remediation.
- Drift verification is enforced by `npm run task-platform:verify` and reports
  remediation steps for missing checkpoints, version mismatches, stale
  projection sequences, and failed sync status.

## Merge Readiness Enforcement

- `FF_MERGE_READINESS_ENFORCEMENT`
  Controls the structured merge-readiness enforcement layer for autonomous workflow PRs.
  Default: enabled when unset.

- `MERGE_READINESS_ENFORCEMENT_TARGET`
  Controls rollout targeting. Use `autonomous` for autonomous workflow PRs only, or `all`
  after branch protection is verified for the default branch.
  Default: `autonomous`.

Behavior:

- Reviews marked `autonomousWorkflowPr: true`, carrying an autonomous workflow label, or
  carrying autonomous workflow metadata require branch-protection verification before
  merge readiness can pass.
- Branch protection must require the exact GitHub check name `Merge readiness`; missing
  required-check configuration records `policy_blocked`.
- Proposed deferrals for blocking findings remain blocked unless policy permission,
  follow-up links, Product Manager risk acceptance, technical-owner risk acceptance, and
  Principal/SRE approval for high-risk findings are present.
- The PR summary remains derived output from the structured `MergeReadinessReview`; it
  is never used as the source of truth.

## Task Assignment

- `FF_ASSIGN_AI_AGENT_TO_TASK`
  Controls whether AI-agent assignment endpoints and roster reads are enabled.
  Default: enabled when unset.

- `FF_ASSIGN_AI_AGENT_TO_TASK_KILLSWITCH`
  Emergency global kill switch for task assignment.
  Default: disabled when unset.

Behavior:

- `GET /ai-agents` and `PATCH /tasks/{taskId}/assignment` require `FF_ASSIGN_AI_AGENT_TO_TASK` to be enabled.
- The same routes return `503 feature_disabled` when `FF_ASSIGN_AI_AGENT_TO_TASK_KILLSWITCH` is enabled.
- `GET /health/task-assignment` and `GET /api/internal/smoke-test/task-assignment` expose operational readiness for the assignment surface.

## Live Task Freshness Polling

- `FF_LIVE_TASK_FRESHNESS_POLLING`
  Server-side rollback flag for `GET /api/v1/tasks/updates`.
  Default: enabled when unset.

- `VITE_FF_LIVE_TASK_FRESHNESS_POLLING`
  Browser rollout flag for protected task routes.
  Default: disabled when unset.

- `VITE_FF_TASK_FRESHNESS_POLLING`
  Backward-compatible browser alias.
  Default: disabled when unset.

Local browser overrides:

- `localStorage["engineering-team.live-task-freshness-polling"] = "1"` enables polling for the current browser.
- `localStorage["engineering-team.live-task-freshness-polling"] = "0"` disables polling for the current browser.
- `localStorage["engineering-team.live-task-freshness-poll-ms"]` overrides the poll interval for local smoke tests.

Behavior:

- The server endpoint requires tenant and actor claims plus `state:read`.
- Task detail, Projects, workspace board/list, PM overview, governance/deferred queues, and role inbox routes reuse their existing refresh callbacks when relevant live updates arrive.
- Poll responses contain only permission-safe Task/Project snapshots and an opaque cursor. Comments, audit logs, telemetry, orchestration, context, and relationship detail remain omitted from the delta payload.
- Disabling the browser flag preserves manual refresh-only behavior. Disabling the server flag returns `503 feature_disabled`.

## Specialist Delegation

- `FF_REAL_SPECIALIST_DELEGATION`
  Preferred rollout flag for runtime-backed specialist delegation.
  Default: enabled when unset.

- `FF_SPECIALIST_DELEGATION`
  Legacy compatibility alias for specialist delegation rollout.
  Default: enabled when unset.

Behavior:

- The runtime-backed specialist delegation path treats `FF_REAL_SPECIALIST_DELEGATION` as the canonical flag and still honors `FF_SPECIALIST_DELEGATION` for compatibility.
- Disabling the flag fails closed to coordinator handling and does not claim specialist ownership.
- `SPECIALIST_DELEGATION_RUNNER` must resolve to the real runtime bridge command before delegated ownership can be emitted.

## Orchestration

- `FF_DEPENDENCY_PLANNER`
  Controls whether dependency-aware planner enrichment is included in task detail and orchestration read models.
  Default: enabled when unset.

- `FF_ORCHESTRATION_SCHEDULER`
  Controls whether orchestration runs can be started and persisted through `POST /tasks/{taskId}/orchestration`.
  Default: enabled when unset.

- `FF_ORCHESTRATION_VISIBILITY`
  Controls whether orchestration visibility payloads and UI surfaces are exposed to authorized readers.
  Default: enabled when unset.

Behavior:

- `GET /tasks/{taskId}/detail` includes additive `orchestration` planner/run fields only when `FF_DEPENDENCY_PLANNER` and `FF_ORCHESTRATION_VISIBILITY` are enabled and the caller has `relationships:read`.
- `GET /tasks/{taskId}/orchestration` requires `FF_DEPENDENCY_PLANNER` and `relationships:read`.
- `POST /tasks/{taskId}/orchestration` requires `FF_DEPENDENCY_PLANNER`, `FF_ORCHESTRATION_SCHEDULER`, read access to relationships, and mutation permission for the caller.
- Disabling `FF_ORCHESTRATION_VISIBILITY` preserves task detail readability while omitting orchestration sections server-side.
