# SF-045 Design

## Research & Context
## Evidence
- Issue `#46` defines the story as configuring and validating live runtime-backed specialist delegation against the real runtime, with staging-like proof of `agentId` and `sessionId`.
- The requested workflow wrappers are not present in this checkout: `npm run task:pull`, `npm run ag:workflow ...`, `npm run workflow:discover ...`, `.agent/skills/test-coverage-gap-analysis/...`, and `./scripts/move-task-column.sh` do not exist here, so the workflow is being executed manually against the repo’s actual scripts and artifacts.
- The runtime bridge currently resolves its command from `options.delegationRunnerCommand` or `process.env.SPECIALIST_DELEGATION_RUNNER` in [lib/software-factory/runtime-delegation.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/software-factory/runtime-delegation.js:31).
- The local shell does not have `SPECIALIST_DELEGATION_RUNNER` configured. Evidence: `printenv SPECIALIST_DELEGATION_RUNNER` exited non-zero in this environment on April 17, 2026.
- The live-smoke validator in [scripts/validate-specialist-runtime.js](/Users/wiinc2/.openclaw/workspace/engineering-team/scripts/validate-specialist-runtime.js:1) was executed locally and produced [observability/specialist-delegation-smoke.json](/Users/wiinc2/.openclaw/workspace/engineering-team/observability/specialist-delegation-smoke.json:1) showing `mode: "fallback"`, `errorCode: "SPECIALIST_RUNTIME_NOT_CONFIGURED"`, and `fallbackReason: "not_configured"`.
- The smoke validator now behaves as a real gate: it writes the smoke artifact for diagnosis, but exits non-zero unless runtime delegation is actually confirmed with runtime-owned `agentId` and `sessionId`.
- Existing repository evidence already shows repeated not-configured fallback events in [observability/workflow-audit.log](/Users/wiinc2/.openclaw/workspace/engineering-team/observability/workflow-audit.log:28).
- Existing runtime-backed delegation logic, artifact logging, and truthful fallback semantics already live in [lib/software-factory/delegation.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/software-factory/delegation.js:181), [lib/software-factory/runtime-delegation.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/software-factory/runtime-delegation.js:1), and [docs/runbooks/specialist-delegation.md](/Users/wiinc2/.openclaw/workspace/engineering-team/docs/runbooks/specialist-delegation.md:1).

## Coverage Gap Analysis
## Evidence
- The requested gap-analysis script is absent from this repo, so the gap review was performed from the current runtime wiring, smoke script, and existing delegation verification surface.
- Existing coverage already proves:
- fixture-backed runtime evidence parsing and fail-closed handling
- truthful fallback when the runtime is not configured
- malformed output rejection and artifact logging in repo-local tests
- CI gating for delegation regressions through the `SF-044` verification matrix
- Remaining gaps for this story:
- no real `SPECIALIST_DELEGATION_RUNNER` command is configured in the target environment
- no staging-like environment is available from this workspace to produce a successful live delegation artifact
- no live smoke artifact exists with a real runtime-owned `agentId` and `sessionId`
- Planned gap closure once wiring exists:
- configure `SPECIALIST_DELEGATION_RUNNER` in the target environment
- execute `node scripts/validate-specialist-runtime.js "Please implement this fix"` against the real runtime
- capture the resulting successful smoke artifact and complete the live-runtime verification reports

## User Story
## Evidence
- As a software factory operator, I want the specialist delegation runtime bridge configured and validated against the real runtime, so that specialist ownership is proven in live execution rather than only through fixtures.
- Acceptance criteria currently blocked:
- given `SPECIALIST_DELEGATION_RUNNER` is configured in a staging-like environment, when a clear specialist-owned request is processed, then the system delegates to the real runtime and records runtime-owned `agentId` and `sessionId`
- given a live delegated run succeeds, when observability artifacts are inspected, then the ownership/session evidence matches the actual runtime response and is persisted
- given a live delegated run completes, when logs are inspected, then structured logs include target specialist, actual agent, outcome, and duration
- Acceptance criteria currently satisfied at the fail-closed level:
- given the runtime bridge is missing or invalid, when a specialist-owned request is processed, then the system falls back truthfully without claiming specialist ownership
- given runtime evidence is malformed or missing required fields, when the response is processed, then the system rejects the result and falls back to coordinator handling

## Feasibility Check
## Evidence
- Repository feasibility is good: the code path already supports fail-closed behavior, artifact persistence, and live-smoke validation.
- Environment feasibility is currently blocked: this workspace has no configured real runtime bridge command and no staging access path to validate against a real runtime.
- Risk validation:
- proceeding without the environment would only reproduce truthful fallback, not live delegation proof
- shipping code changes without successful staged runtime evidence would not satisfy the issue’s main acceptance criteria
- the correct next step is environment enablement, not speculative code changes

## Technical Plan
## Evidence
- Immediate implementation for this blocked state:
- record the blocker with design and verification artifacts
- preserve the smoke validator output proving the current environment fails closed because the runner is not configured
- harden the smoke validator so fallback is a failing validation outcome rather than a false pass
- defer code-path changes until a real runtime command is available
- Once wiring is available:
- set `SPECIALIST_DELEGATION_RUNNER` to the real runtime bridge command in the staging-like environment
- rerun [scripts/validate-specialist-runtime.js](/Users/wiinc2/.openclaw/workspace/engineering-team/scripts/validate-specialist-runtime.js:1)
- verify [observability/specialist-delegation-smoke.json](/Users/wiinc2/.openclaw/workspace/engineering-team/observability/specialist-delegation-smoke.json:1) contains a delegated result with runtime-owned `agentId` and `sessionId`
- update the report set from blocked to complete with live-runtime evidence
