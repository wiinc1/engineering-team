# SF-043 Design

## Research & Context
## Evidence
- Issue `#48` defines the story as clarifying specialist delegation fallback reasons so users can distinguish runtime not configured, runtime execution failure, unverifiable runtime evidence, and unsupported task-type cases without any false ownership claims.
- The workflow wrappers referenced in the requested process are not present in this checkout: `npm run task:pull`, `npm run ag:workflow ...`, `npm run workflow:discover ...`, `.agent/skills/test-coverage-gap-analysis/...`, and `./scripts/move-task-column.sh` do not exist here, so the workflow is being executed manually against the actual repo commands and files.
- Existing delegation classification, copy, metrics, and artifact logging live in [lib/software-factory/delegation.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/software-factory/delegation.js).
- Runtime bridge validation and stable runtime error codes live in [lib/software-factory/runtime-delegation.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/software-factory/runtime-delegation.js).
- Task-type routing into delegation lives in [lib/software-factory/task-dispatch.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/software-factory/task-dispatch.js), where unsupported task types currently return a direct message instead of using the shared fallback message builder.
- Existing higher-level delegation coverage already exists in [tests/unit/specialist-delegation.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/unit/specialist-delegation.test.js), [tests/unit/command-router-delegation.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/unit/command-router-delegation.test.js), [tests/e2e/specialist-delegation.e2e.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/e2e/specialist-delegation.e2e.test.js), [tests/security/specialist-delegation.security.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/security/specialist-delegation.security.test.js), and [tests/contract/specialist-delegation.contract.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/contract/specialist-delegation.contract.test.js).
- The current user-facing fallback copy already distinguishes `not_configured`, `runtime_exec_failed`, and the shared unverifiable class for `invalid_json`, `missing_evidence`, and `attribution_mismatch`, but it does not expose a shared user-facing reason category in metadata and does not enforce that the unsupported-task-type path reuses the same mapping.

## Coverage Gap Analysis
## Evidence
- The requested gap-analysis script is absent from this repo, so the gap review was performed from the current test surface.
- Existing coverage already verifies:
- runtime success attribution and artifact persistence
- truthful fallback for not-configured and missing-evidence cases
- sanitized execution-failure copy
- runtime evidence contract enforcement
- Missing coverage for this story:
- an explicit shared user-facing reason-category mapping for every fallback state
- assertions that fallback metadata carries a stable user-facing category in addition to the low-level fallback reason
- assertions that unsupported task types reuse the shared fallback messaging taxonomy instead of bypassing it with bespoke copy
- direct assertions for invalid JSON and attribution mismatch staying inside the same user-facing unverifiable class
- Planned gap closure:
- extend [tests/unit/specialist-delegation.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/unit/specialist-delegation.test.js) with category-mapping and message assertions for every required must-have class
- extend [tests/unit/command-router-delegation.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/unit/command-router-delegation.test.js) so the unsupported task-type path asserts the new shared wording
- keep existing contract, e2e, and security coverage intact while verifying the refined copy and metadata via targeted runs

## User Story
## Evidence
- As a software factory user, I want delegation fallback messages to explain why delegation was not confirmed, so that I can trust the system’s status without guessing whether the problem was configuration, runtime failure, invalid ownership evidence, or unsupported routing.
- Acceptance criteria to satisfy:
- given runtime delegation is not configured, when fallback occurs, then the message states runtime delegation is not configured or not available
- given runtime execution fails, when fallback occurs, then the message states delegation failed during execution
- given runtime output is invalid or attribution does not match, when fallback occurs, then the message states delegation could not be verified
- given a task type does not map to a supported specialist, when delegation is attempted, then the message states the task type is unsupported for runtime delegation
- given any fallback reason is rendered, when the user reads it, then it does not claim specialist ownership or imply a confirmed delegated session

## Feasibility Check
## Evidence
- The implementation is low-risk and localized because the repo already has stable fallback reasons, runtime error codes, a shared coordinator response builder, and existing tests around delegation outcomes.
- The main feasibility constraint is consistency, not new infrastructure: the unsupported-task-type path in [lib/software-factory/task-dispatch.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/software-factory/task-dispatch.js) currently formats its own message and metadata, which risks drift from the coordinator’s shared mapping.
- Risk validation:
- preserve the existing low-level `fallbackReason` values for metrics, artifacts, and runbook alignment
- add a higher-level user-facing reason category so operators and UI surfaces can distinguish the broad failure class without exposing internal runtime details
- route all fallback copy through a single builder so future wording changes stay consistent across coordinator and task-dispatch entry points

## Technical Plan
## Evidence
- Update [lib/software-factory/delegation.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/software-factory/delegation.js):
- add a stable user-facing fallback-category mapper that groups low-level reasons into safe user-visible classes
- return message plus category from one shared helper instead of scattering copy decisions
- include the user-facing category in fallback metadata so operators and UI surfaces can inspect the broad failure class safely
- Update [lib/software-factory/task-dispatch.js](/Users/wiinc2/.openclaw/workspace/engineering-team/lib/software-factory/task-dispatch.js):
- reuse the shared fallback builder for unsupported task types
- add the same user-facing category metadata on unsupported-task-type fallback responses
- Update tests first in [tests/unit/specialist-delegation.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/unit/specialist-delegation.test.js) and [tests/unit/command-router-delegation.test.js](/Users/wiinc2/.openclaw/workspace/engineering-team/tests/unit/command-router-delegation.test.js):
- verify each required fallback class maps to distinct safe wording
- verify invalid JSON and attribution mismatch stay in the unverifiable class
- verify unsupported task types use the shared runtime-delegation taxonomy and metadata
- Verification plan:
- run targeted delegation unit tests first
- run `npm run test:unit` after the code passes the focused delegation suite
- if broader verification remains stable, reuse the existing higher-level delegation tests rather than inventing new wrappers that do not exist in this checkout
