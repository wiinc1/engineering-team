# Issue 113 Verification

## Summary

Issue #113 is implemented as an additive merge-readiness source-inventory policy. The task-platform service factory now evaluates source relevance before review creation and persists explicit policy inventory, status, findings, exceptions, and merge-readiness check conclusions with the review record.

## Acceptance Criteria Audit

| # | Requirement | Verification |
| --- | --- | --- |
| 1 | Source selection is derived from changed files, required checks, Execution Contract evidence expectations, preview/deployment presence, and risk flags. | Passed: `lib/task-platform/merge-readiness-source-policy.js` selects required sources from all listed inputs. `tests/unit/task-platform-source-policy.test.js` covers each source category in one selection audit. |
| 2 | Review source inventory is explicit and linked to policy version. | Passed: created reviews include `sourceInventory.policy_version=merge-readiness-source-inventory.v1`, `status`, and `required_sources`. Unit and integration tests assert the persisted policy version. |
| 3 | Missing required source blocks review. | Passed: missing required sources append `missing_required_source` blocker findings and force `reviewStatus=blocked`. Covered by API unit test. |
| 4 | Inaccessible required evidence marks review `error` and GitHub `Merge readiness` must not pass. | Passed: inaccessible required sources force `reviewStatus=error`; metadata and classification include `merge_readiness_check.conclusion=failure`. Covered by API unit test. |
| 5 | Missing configuration or permissions raise `policy_blocked` assigned to relevant repo/admin/SRE owner. | Passed: policy exceptions are emitted with `type=policy_blocked`; permission/configuration failures map to `repo-admin`, and deployment/runtime evidence maps to `sre`. Unit tests cover both owner classes. |
| 6 | Optional logs outside required source inventory do not require human review. | Passed: optional available logs are retained as optional sources and do not affect satisfied status. Covered by source policy unit test. |
| 7 | Tests cover source policy, missing source handling, inaccessible evidence handling, and policy-blocked classification. | Passed: `tests/unit/task-platform-source-policy.test.js` covers policy selection, missing source blocking, inaccessible evidence error state, merge-readiness check failure, and `policy_blocked` classification; `tests/integration/task-platform-source-policy.integration.test.js` verifies persistence through the service factory. |

## Commands

- `node --test tests/unit/task-platform-source-policy.test.js`
- `node --test tests/integration/task-platform-source-policy.integration.test.js`
- `node --test tests/unit/task-platform-api.test.js tests/unit/task-platform-source-policy.test.js`
- `node --test tests/unit/task-platform-api.test.js tests/unit/task-platform-source-policy.test.js tests/integration/task-assignment-integration.test.js tests/integration/task-platform-source-policy.integration.test.js`
- `node --test tests/contract/audit-openapi.contract.test.js tests/security/audit-api.security.test.js tests/e2e/task-assignment.test.js`
- `npm run lint`
- `npm run coverage`
- `npm run standards:check`
- `npm run change:check`
- `npm run ownership:lint`
- `npm run typecheck`
- `npm run test:contract`
- `npm run test:unit`
- `npm run test:browser`
- `npm test`

## Evidence Paths

- `lib/task-platform/merge-readiness-source-policy.js`
- `lib/task-platform/index.js`
- `tests/unit/task-platform-source-policy.test.js`
- `tests/integration/task-platform-source-policy.integration.test.js`
- `docs/api/task-platform-openapi.yml`
- `docs/runbooks/task-platform-rollout.md`
- `.artifacts/coverage-summary.json`

## Coverage

- Node/API line coverage: 85.37%
- UI line coverage: 89.56%
- Minimum suite line coverage: 85.37%
- Policy floor: 80%

## Gaps

No issue acceptance gaps found.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, security and compliance, team and process.
- Evidence in this report: acceptance-criteria audit, focused tests, integration persistence check, OpenAPI/runbook documentation, coverage summary, and full repo verification commands.
- Gap observed: No standards gap remains for issue #113. Documented rationale: the implementation includes code, tests, docs, audit evidence, rollback notes, and passing repo gates for the source-inventory policy (source https://github.com/wiinc1/engineering-team/issues/113).

## Required Evidence

- Commands run: focused unit/integration/API/contract/security/e2e tests; `npm run lint`; `npm run coverage`; `npm run standards:check`; `npm run change:check`; `npm run ownership:lint`; `npm run typecheck`; `npm run test:contract`; `npm run test:unit`; `npm run test:browser`; `npm test`.
- Tests added or updated: `tests/unit/task-platform-source-policy.test.js`; `tests/integration/task-platform-source-policy.integration.test.js`; `package.json`; `config/change-ownership-map.json`.
- Rollout or rollback notes: rollout is additive through the task-platform service factory. Roll back by reverting the policy module and factory wrapper; existing review rows remain readable historical evidence.
- Docs updated: `docs/api/task-platform-openapi.yml`, `docs/runbooks/task-platform-rollout.md`, and issue #113 reports.
