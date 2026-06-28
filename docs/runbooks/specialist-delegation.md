# Specialist delegation rollout plan

> Issue #130 standards evidence: mechanical maintainability compaction only; no delegation rollout procedure change.

## Feature flag
- `FF_REAL_SPECIALIST_DELEGATION=true` enables specialist routing and delegation.
- `FF_REAL_SPECIALIST_DELEGATION=false` disables delegation and keeps the coordinator in direct-response mode.
- `FF_SPECIALIST_DELEGATION` remains a compatibility alias for older environments.
- `SPECIALIST_DELEGATION_RUNNER` must point at the real runtime bridge command. Without it, the software factory falls back truthfully and does not claim session ownership.
- `SPECIALIST_RUNTIME_RUNNER_TIMEOUT_MS` or `SPECIALIST_DELEGATION_RUNNER_TIMEOUT_MS` controls the runtime bridge timeout. Default: `20000`.
- `OPENCLAW_DELEGATION_LOCAL=true` opts the repo-local OpenClaw bridge into embedded local mode. The default is gateway mode because it returns session evidence without requiring model provider keys in the shell.
- `OPENCLAW_DELEGATION_THINKING` optionally sets the OpenClaw agent thinking level. The live OpenClaw smoke defaults this to `low`.

## Rollout steps
1. Enable in local/dev and verify `tests/unit/specialist-delegation.test.js` passes.
2. Configure `SPECIALIST_DELEGATION_RUNNER` to invoke the real OpenClaw/runtime handoff path, then start the command router.
3. Repo-local OpenClaw bridge command: `SPECIALIST_DELEGATION_RUNNER='node scripts/openclaw-specialist-runner.js'`.
4. Default repo-local alias map:
- `pm -> pm`
- `architect -> architect`
- `engineer -> sr-engineer`
- `qa -> qa-engineer`
- `sre -> sre`
5. Override aliases if your host uses different agent ids with `OPENCLAW_SPECIALIST_MAP='{"engineer":"jr-engineer","qa":"qa-engineer"}'`.
   Runtime ownership may report `ownership.specialistId=engineer` while `agentId=sr-engineer`; the bridge treats those aliases as equivalent when attribution is validated.
6. Move an assigned task into `IN_PROGRESS` and confirm the reply only claims runtime ownership when a real `session_id` is returned.
7. Confirm `observability/specialist-delegation.jsonl` contains `target_specialist`, `actual_agent`, `session_id`, `ownership`, and `delegation_id`.
8. Confirm `observability/specialist-delegation-metrics.json` is updated with both the raw snapshot and flattened Prometheus-safe metrics.
9. Run `npm run metrics:delegation:push` with `PUSHGATEWAY_URL` set when you want to publish the latest delegation metrics snapshot to your monitoring stack.
10. Confirm `observability/workflow-audit.log` shows structured attempt, success, fallback, and mismatch events.
11. Run `npm run test:delegation:live-smoke` or `npm run test:delegation:live-smoke:openclaw` in the target environment and confirm it exits successfully only when runtime delegation is truly confirmed and writes `observability/specialist-delegation-smoke.json`. The default smoke request is a bounded no-op so it proves handoff evidence without asking the specialist to perform unrelated repository work.
12. For the supervised pilot, run `npm run pilot:agents:seed` against the target task-platform backend to persist active assignable `pm`, `architect`, `engineer`, `qa`, and `sre` agents. This uses canonical AI-agent storage instead of relying only on bootstrap defaults.
13. Run `npm run pilot:delegation:readiness` in the target environment. This requires `FF_REAL_SPECIALIST_DELEGATION=true` and `SPECIALIST_DELEGATION_RUNNER='node scripts/openclaw-specialist-runner.js'`, dispatches a bounded no-op implementation task through the orchestration workflow, and writes `observability/pilot-delegation-readiness.json`.
14. Confirm the readiness artifact includes `appWorkflowDispatch.agentId`, `appWorkflowDispatch.sessionId`, `appWorkflowDispatch.delegationArtifactPath`, and `appWorkflowDispatch.runtimeAttribution.delegated=true`.
15. Enable in staging with log review for fallback volume and attribution mismatches.
16. Promote to production only after no unexpected fallback or mismatch spikes are observed.

For serverless deployments such as Vercel, delegation artifacts must be written
to a writable runtime directory. Set `SPECIALIST_DELEGATION_BASE_DIR` or
`SPECIALIST_DELEGATION_ARTIFACT_DIR` to a writable path when available; otherwise
the runtime uses `/tmp/engineering-team` under `VERCEL=1` while keeping the
specialist runner working directory unchanged.

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
- runtime bridge invocation count
- live delegation success count
- delegation attempts by target agent
- delegation success counts
- delegation failure counts
- delegation failure counts by fallback reason
- delegation failure counts by user-facing category
- fallback-to-coordinator count
- attribution mismatch count
- delegation latency histogram

## Dashboards + alert links
- Dashboard: `/monitoring/dashboards/real-specialist-delegation.json`
- Alerts: `/monitoring/alerts/real-specialist-delegation.yml`

Prometheus-safe metric names are persisted in `observability/specialist-delegation-metrics.json` and include:

- `real_specialist_delegation_runtime_bridge_invocation_total`
- `real_specialist_delegation_live_success_total`
- `real_specialist_delegation_fallback_total`
- `real_specialist_delegation_attribution_mismatch_total`
- `real_specialist_delegation_failure_reason_<reason>_total`
- `real_specialist_delegation_failure_category_<category>_total`
- `real_specialist_delegation_latency_p50_ms`
- `real_specialist_delegation_latency_p95_ms`
