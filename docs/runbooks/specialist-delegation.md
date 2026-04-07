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
5. Enable in staging with log review for fallback volume and attribution mismatches.
6. Promote to production only after no unexpected fallback or mismatch spikes are observed.

## Failure handling
- Missing runtime bridge configuration must fall back explicitly and must not claim runtime-backed ownership.
- Delegation failure must fall back with an explicit coordinator message naming the unavailable specialist.
- Attribution mismatch must be treated as a failure and must not claim specialist handling.

## Metrics to watch
- delegation attempts by target agent
- delegation success counts
- delegation failure counts
- fallback-to-coordinator count
- attribution mismatch count
- delegation latency histogram
