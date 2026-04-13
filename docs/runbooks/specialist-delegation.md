# Specialist delegation rollout plan

## Feature flag
- `FF_SPECIALIST_DELEGATION=true` enables specialist routing and delegation.
- `FF_SPECIALIST_DELEGATION=false` disables delegation and keeps the coordinator in direct-response mode.
- `SPECIALIST_DELEGATION_RUNNER` must point at the real runtime bridge command. Without it, the software factory falls back truthfully and does not claim session ownership.

## Rollout steps
1. Enable in local/dev and verify `tests/unit/specialist-delegation.test.js` passes.
2. Configure `SPECIALIST_DELEGATION_RUNNER` to invoke the real OpenClaw/runtime handoff path, then start the command router.
3. Move an assigned task into `IN_PROGRESS` and confirm the reply only claims runtime ownership when a real `session_id` is returned.
4. Confirm `observability/specialist-delegation.jsonl` contains `target_specialist`, `actual_agent`, `session_id`, `ownership`, and `delegation_id`.
5. Confirm `observability/workflow-audit.log` shows structured attempt, success, fallback, and mismatch events.
6. Run `node scripts/validate-specialist-runtime.js "Please implement this fix"` in the target environment and confirm it writes `observability/specialist-delegation-smoke.json`.
7. Enable in staging with log review for fallback volume and attribution mismatches.
8. Promote to production only after no unexpected fallback or mismatch spikes are observed.

## Failure handling
- Missing runtime bridge configuration: fallback reason `not_configured`, user copy says runtime delegation is not configured or not available.
- Runtime process start/exit failure: fallback reason `runtime_exec_failed`, user copy says runtime delegation failed during execution.
- Runtime JSON/evidence/attribution validation failure: fallback reasons `invalid_json`, `missing_evidence`, or `attribution_mismatch`, user copy says runtime delegation could not be verified.
- Unsupported task type: fallback reason `unsupported_task_type`, user copy says the task type does not map to a supported runtime specialist.
- Attribution mismatch must always be treated as a failure and must not claim specialist handling.

## Metrics to watch
- delegation attempts by target agent
- delegation success counts
- delegation failure counts
- delegation failure counts by fallback reason
- fallback-to-coordinator count
- attribution mismatch count
- delegation latency histogram
