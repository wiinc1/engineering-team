# Factory Phase 1 assignment readiness

## Incident

The first diagnostic Simple delivery reached execution-contract approval but Forge readiness returned HTTP 422 with `task_not_execution_ready`. The approved task was missing the immutable `architect_engineer_assignment` artifact, so the durable queue correctly retried instead of dispatching implementation.

## Root cause

The factory orchestrator exposed `--agent-driven-phases` for implementation through closeout, but did not propagate that selection to the separate Phase 1 option. In addition, the persistent live API environment did not enable post-approval artifact generation or architect-to-engineer assignment delegation.

## Resolution

- `--agent-driven-phases` now enables agent-driven Phase 1 as well as downstream phases.
- Resolved programmatic configuration applies the same implication when `FF_FACTORY_AGENT_DRIVEN_PHASES` is enabled.
- The live coordinated-stack profile enables post-approval artifact generation and architect assignment delegation through OpenClaw.
- Fixture and non-live profiles keep their prior behavior.

## Standards Alignment

The change preserves durable PostgreSQL queueing, exact-head protected checks, immutable assignment evidence, live specialist attribution, and fail-closed Forge readiness. It does not relax hosted staging, soak, release-manifest, or production cutover gates.

- Applicable standards areas: architecture and design; coding quality; testing and quality assurance; release governance; observability; team process.
- Evidence expected for this change: agent-driven Phase 1 configuration, live-stack post-approval flags, immutable assignment evidence, exact-head protected checks, and a successful Forge readiness response.
- Gap observed: the all-phase CLI mode omitted Phase 1 and the live API lacked post-approval assignment automation. Documented rationale: the failed diagnostic task remains excluded so the cohort measures only clean post-fix deliveries (source https://github.com/wiinc1/engineering-team/issues/341).

## Required Evidence

- Node/API coverage: 1,069 tests passed, zero failed.
- Focused factory delivery, CLI, and stack tests: 30 passed, zero failed.
- Standards, source integrity, secret scanning, maintainability, and the 70.57% suite coverage policy passed.
- Commands run: `npm run coverage`; `npm run standards:check`; focused Node test commands; `git diff --check`.
- Tests added or updated: factory configuration implication, orchestrator CLI propagation, and coordinated-stack live environment defaults.
- Rollout or rollback notes: merge this fix, rebind the canonical launchd stack to the exact merge SHA, then begin six fresh tasks. Roll back by reverting the two fix commits.
- Docs updated: this issue evidence report.

The failed diagnostic delivery is excluded from the clean cohort. The six-task cohort begins only after this fix is merged and the canonical launchd stack is rebound to the exact merge revision.
