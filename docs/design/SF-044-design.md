# SF-044 Design

## Research & Context
## Evidence
- Issue `#47` defines the story as expanding specialist delegation verification coverage so the feature is proven by higher-level automated validation and committed evidence, not only by unit checks.
- The workflow wrappers referenced in the requested process are not present in this checkout: `npm run task:pull`, `npm run ag:workflow ...`, `npm run workflow:discover ...`, `.agent/skills/test-coverage-gap-analysis/...`, and `./scripts/move-task-column.sh` do not exist here, so the workflow is being executed manually against the repo’s actual scripts, tests, and report conventions.
- Existing delegation runtime behavior already lives in [lib/software-factory/delegation.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/software-factory/delegation.js), [lib/software-factory/runtime-delegation.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/software-factory/runtime-delegation.js), and [lib/software-factory/task-dispatch.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/software-factory/task-dispatch.js).
- Existing automated coverage already includes unit tests in [tests/unit/specialist-delegation.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/unit/specialist-delegation.test.js) and [tests/unit/command-router-delegation.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/unit/command-router-delegation.test.js), contract coverage in [tests/contract/specialist-delegation.contract.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/contract/specialist-delegation.contract.test.js), e2e coverage in [tests/e2e/specialist-delegation.e2e.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/e2e/specialist-delegation.e2e.test.js), security coverage in [tests/security/specialist-delegation.security.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/security/specialist-delegation.security.test.js), and performance coverage in [tests/performance/specialist-delegation.performance.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/performance/specialist-delegation.performance.test.js).
- CI already runs broad validation through [.github/workflows/validation.yml](/Users/wiinc2/.openclaw/workspace/engineering-team/.github/workflows/validation.yml), but the delegation story’s proof is currently implicit inside larger jobs rather than exposed as one explicit delegation verification matrix and linked reviewer artifacts.

## Coverage Gap Analysis
## Evidence
- The requested coverage-gap script is absent from this repo, so the gap review was performed from the current test surface, CI workflow, and report artifacts.
- Existing coverage already proves:
- successful runtime-backed delegation with artifact logging
- truthful fallback when the runtime is not configured
- sanitized fallback messaging for execution failure
- runtime evidence contract enforcement
- local latency budget coverage for fixture-backed delegation
- Remaining gaps for this story:
- no dedicated integration suite that validates artifact persistence and failure artifacts across delegation scenarios
- no end-to-end assertion for malformed runtime output being rejected and recorded with the expected fallback metadata
- no single explicit CI command or named workflow job for the delegation verification matrix
- no committed reviewer-facing reports summarizing delegation verification evidence in one place
- Planned gap closure:
- extend [tests/e2e/specialist-delegation.e2e.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/e2e/specialist-delegation.e2e.test.js) with malformed-runtime-output rejection and artifact assertions
- add [tests/integration/specialist-delegation.integration.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/integration/specialist-delegation.integration.test.js) for artifact persistence, invalid evidence rejection, and unsupported task-type fallback
- add an explicit `test:delegation:verification` script and CI job in [.github/workflows/validation.yml](/Users/wiinc2/.openclaw/workspace/engineering-team/.github/workflows/validation.yml)
- generate report artifacts in `docs/reports/` and `docs/test-reports/`

## User Story
## Evidence
- As a software factory stakeholder, I want specialist delegation covered by the full required higher-level automated validation, so that merge readiness does not rely on interpretation of scattered tests.
- Acceptance criteria to satisfy:
- given a clear specialist-owned request, when higher-level automated tests run, then they verify delegated attribution only occurs with valid runtime evidence
- given runtime delegation cannot be confirmed, when automated tests run, then they verify truthful fallback without false specialist ownership
- given runtime ownership artifacts are written, when verification inspects them, then the artifacts match the validated delegation result
- given invalid runtime evidence is returned, when automated tests run, then the system rejects it and records the correct failure outcome
- given CI runs, when delegation policy regresses, then a dedicated verification matrix fails visibly

## Feasibility Check
## Evidence
- The implementation is low risk because the story is primarily verification and artifact work rather than new production behavior.
- The repo already has the core fixture runtime, artifact log path, and targeted delegation tests needed to compose a dedicated verification matrix.
- Risk validation:
- keep the production delegation code unchanged unless a higher-level test exposes a real defect
- keep the verification matrix narrow and explicit so failures isolate delegation regressions instead of being buried in the full repo suite
- use repo-native markdown reports instead of inventing new reporting formats

## Technical Plan
## Evidence
- Test changes:
- add integration coverage in [tests/integration/specialist-delegation.integration.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/integration/specialist-delegation.integration.test.js)
- extend [tests/e2e/specialist-delegation.e2e.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/e2e/specialist-delegation.e2e.test.js) with invalid-runtime-output rejection and artifact assertions
- CI changes:
- add `test:delegation:verification` to [package.json](/Users/wiinc2/.openclaw/workspace/engineering-team/package.json)
- add a dedicated `specialist-delegation-verification` job to [.github/workflows/validation.yml](/Users/wiinc2/.openclaw/workspace/engineering-team/.github/workflows/validation.yml)
- Reporting changes:
- add delegation verification artifacts in `docs/reports/` and `docs/test-reports/`
- Verification plan:
- run the focused delegation verification command
- run the new integration file directly during development
- keep note of the repo-wide unrelated `src/app/App.test.tsx` failure in `npm run test:unit` so story-local verification remains attributable
