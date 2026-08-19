# Factory Phase 1 assignment readiness

## Incident

The first diagnostic Simple delivery reached execution-contract approval but Forge readiness returned HTTP 422 with `task_not_execution_ready`. The approved task was missing the immutable `architect_engineer_assignment` artifact, so the durable queue correctly retried instead of dispatching implementation.

## Root cause

The persistent live API environment did not enable post-approval artifact generation or architect-to-engineer assignment delegation. A first remediation also made downstream `--agent-driven-phases` imply delegated Phase 1, but live PM refinement then correctly re-tiered documentation subjects as Standard and blocked Simple policy approval.

A subsequent clean retry exposed a second lifecycle boundary: the factory creates a distinct Forge-facing task after Phase 1. That seed writes an approved execution record directly to the durable audit store, so it does not traverse the API approval endpoint that starts architect assignment. The new readiness gate therefore rejected the Forge task exactly as designed.

## Resolution

- The live coordinated-stack profile enables post-approval artifact generation and architect assignment delegation through OpenClaw.
- Downstream agent phases and delegated Phase 1 remain separate controls. The Simple cohort uses deterministic intake/contract Phase 1, then live OpenClaw assignment, implementation, QA, SRE, and closeout.
- Factory Forge seeding now requests architect assignment through the canonical API, tolerates only projection-catch-up conflicts while retrying, and verifies live delegated attribution before readiness is accepted.
- Fixture and non-live profiles keep their prior behavior.

## Standards Alignment

The change preserves durable PostgreSQL queueing, exact-head protected checks, immutable assignment evidence, live specialist attribution, and fail-closed Forge readiness. It does not relax hosted staging, soak, release-manifest, or production cutover gates.

- Applicable standards areas: architecture and design; coding quality; testing and quality assurance; release governance; observability; team process.
- Evidence expected for this change: intentionally separate Phase 1 configuration, live-stack post-approval flags, immutable assignment evidence, exact-head protected checks, and a successful Forge readiness response.
- Gap observed: the live API lacked post-approval assignment automation and the initial remediation coupled two intentionally distinct phase controls. Documented rationale: pre-approval diagnostic tasks remain excluded so the cohort measures only clean post-fix deliveries (source https://github.com/wiinc1/engineering-team/issues/341).

## Required Evidence

- Node/API coverage: 1,073 tests passed, zero failed; aggregate line coverage is 70.73%.
- Focused factory delivery and assignment tests: 27 passed, zero failed.
- Standards, source integrity, secret scanning, maintainability, and the 70.57% suite coverage policy passed.
- Commands run: `npm run coverage`; `npm run standards:check`; focused Node test commands; `git diff --check`.
- Tests added or updated: factory phase-control separation, orchestrator CLI propagation, coordinated-stack live environment defaults, projection-lag retry, and rejection of fallback architect attribution in real-evidence mode.
- Rollout or rollback notes: merge this fix, rebind the canonical launchd stack to the exact merge SHA, then begin six fresh tasks. Roll back by reverting the associated assignment-readiness repair commits.
- Docs updated: this issue evidence report.

The failed diagnostic delivery is excluded from the clean cohort. The six-task cohort begins only after this fix is merged and the canonical launchd stack is rebound to the exact merge revision.
