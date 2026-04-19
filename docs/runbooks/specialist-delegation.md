# Specialist delegation rollout plan

## Feature flag
- `FF_SPECIALIST_DELEGATION=true` enables specialist routing and delegation.
- `FF_SPECIALIST_DELEGATION=false` disables delegation and keeps the coordinator in direct-response mode.
- `SPECIALIST_DELEGATION_RUNNER` must point at the real runtime bridge command. Without it, the software factory falls back truthfully and does not claim session ownership.

## Rollout steps
1. Enable in local/dev and verify `tests/unit/specialist-delegation.test.js` passes.
2. Configure `SPECIALIST_DELEGATION_RUNNER` to invoke the real OpenClaw/runtime handoff path, then start the command router.
3. Repo-local OpenClaw bridge command: `SPECIALIST_DELEGATION_RUNNER='node scripts/openclaw-specialist-runner.js'`.
4. Default repo-local alias map:
- `architect -> architect`
- `engineer -> sr-engineer`
- `qa -> qa-engineer`
- `sre -> sre`
5. Override aliases if your host uses different agent ids with `OPENCLAW_SPECIALIST_MAP='{"engineer":"jr-engineer","qa":"qa-engineer"}'`.
6. Move an assigned task into `IN_PROGRESS` and confirm the reply only claims runtime ownership when a real `session_id` is returned.
7. Confirm `observability/specialist-delegation.jsonl` contains `target_specialist`, `actual_agent`, `session_id`, `ownership`, and `delegation_id`.
8. Confirm `observability/workflow-audit.log` shows structured attempt, success, fallback, and mismatch events.
9. Run `npm run test:delegation:live-smoke` or `npm run test:delegation:live-smoke:openclaw` in the target environment and confirm it exits successfully only when runtime delegation is truly confirmed and writes `observability/specialist-delegation-smoke.json`.
10. Enable in staging with log review for fallback volume and attribution mismatches.
11. Promote to production only after no unexpected fallback or mismatch spikes are observed.

## Docker smoke runner
- `docker compose run --rm delegation-smoke` runs the same live-smoke validator in a container built from this repo.
- `npm run docker:delegation-smoke:build` builds the image and `npm run docker:delegation-smoke` runs it.
- `docker compose run --rm delegation-smoke-fixture` uses the bundled fixture runtime bridge to verify container wiring end to end.
- `npm run docker:delegation-smoke:fixture:build` builds that image and `npm run docker:delegation-smoke:fixture` runs it.
- The service bind-mounts `./observability` to `/app/observability` so the smoke artifact remains on the host after the container exits.
- This image does not bundle the real runtime bridge. `SPECIALIST_DELEGATION_RUNNER` still has to resolve to a real command inside the container, either because the image was extended with that runtime or because the command is mounted/provided at runtime.
- If `SPECIALIST_DELEGATION_RUNNER` is unset in the compose environment, the container will fail closed with `SPECIALIST_RUNTIME_NOT_CONFIGURED`.
- The fixture-backed service is only a container self-check. It proves the image can execute the validator and persist artifacts, but it is not evidence that the real runtime bridge is installed.

## Staged validation checklist
1. Confirm the environment exposes `SPECIALIST_DELEGATION_RUNNER`.
2. Run `npm run test:delegation:live-smoke`.
3. Treat any non-zero exit as a blocker. The smoke artifact is still diagnostic output, not success evidence.
4. Open `observability/specialist-delegation-smoke.json` and confirm all of the following:
- `mode` is `delegated`
- `agentId` is present and not `main`
- `sessionId` is present
- `attribution.delegated` is `true`
- `metadata.artifactPath` points at the persisted delegation artifact log
5. Check `observability/specialist-delegation.jsonl` and `observability/workflow-audit.log` for the matching `delegationId`.

## Staged failure triage
- Exit with `SPECIALIST_RUNTIME_NOT_CONFIGURED`: the environment is still missing `SPECIALIST_DELEGATION_RUNNER`.
- Exit with `SPECIALIST_RUNTIME_EXEC_FAILED`: the configured runtime command failed to start or exited non-zero.
- Exit with `SPECIALIST_RUNTIME_INVALID_JSON` or `SPECIALIST_RUNTIME_MISSING_EVIDENCE`: the runtime bridge responded, but not with valid ownership evidence.
- Exit with `SPECIALIST_RUNTIME_SMOKE_NOT_DELEGATED` or `SPECIALIST_RUNTIME_SMOKE_MISSING_EVIDENCE`: the smoke validator rejected the result as insufficient for live-runtime proof.

## Failure handling
- Missing runtime bridge configuration: fallback reason `not_configured`, user copy says runtime delegation is not configured or not available.
- Runtime process start/exit failure: fallback reason `runtime_exec_failed`, user copy says runtime delegation failed during execution.
- Runtime JSON/evidence/attribution validation failure: fallback reasons `invalid_json`, `missing_evidence`, or `attribution_mismatch`, user copy says runtime delegation could not be verified.
- Unsupported task type: fallback reason `unsupported_task_type`, user copy says the task type is unsupported for runtime delegation.
- Attribution mismatch must always be treated as a failure and must not claim specialist handling.

## User-facing fallback categories
- `runtime_not_available`: runtime delegation is not configured or not available.
- `runtime_execution_failed`: runtime delegation failed during execution.
- `delegation_unverified`: runtime output or attribution could not be verified safely.
- `unsupported_runtime_specialist`: the task type is unsupported for runtime delegation.
- `delegation_disabled`: rollout flag disabled delegation entirely.
- `no_clear_specialist_owner`: the request did not resolve to a single specialist owner.

## Metrics to watch
- delegation attempts by target agent
- delegation success counts
- delegation failure counts
- delegation failure counts by fallback reason
- fallback-to-coordinator count
- attribution mismatch count
- delegation latency histogram
