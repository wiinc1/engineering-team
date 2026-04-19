# Feature Flags

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
