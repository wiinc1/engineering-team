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
