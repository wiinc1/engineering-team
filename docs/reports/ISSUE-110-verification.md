# Issue 110 Verification

## Results

- Implemented `deferred-considerations.v1` as structured Task child records.
- Added dedicated capture, queue, review, promote, and close endpoints.
- Added task-detail count/badge data and UI actions.
- Added Operator Approval and Operator Closeout projections that mark Deferred
  Considerations as outside current scope and non-blocking.
- Added explicit promotion to new Intake Drafts with source context carried
  forward.
- Added blocker conversion into refinement questions or
  `operator_decision_required` Exceptions.
- Updated API, runbook, product, design, verification, security, test, and
  customer review documentation.

## Requirement Audit

| Requirement | Audit result |
| --- | --- |
| Store out-of-scope refinement ideas as Deferred Consideration child records. | Passed: `task.deferred_consideration_captured` persists first-class child records on the Task and projections derive them from Task history. |
| Capture title, known context, rationale, source section, source comment or source agent, owner, revisit trigger/date, status, and promotion link. | Passed: capture normalization requires the required fields, projection carries optional promotion links, and tests assert persisted field values. |
| Support statuses `captured`, `reviewed`, `promoted`, and `closed_no_action`. | Passed: the deferred policy constants, projection reducer, action endpoints, and tests exercise all supported statuses. |
| Show visible count or badge on Task detail. | Passed: task list/detail projections expose `deferred_considerations.summary`; the browser task detail renders unresolved and total counts. |
| Add PM Deferred Considerations review queue. | Passed: `GET /deferred-considerations` returns unresolved items across Tasks with revisit-date, revisit-trigger, and source-Task groups; the app exposes grouped PM queue sections. |
| Show Deferred Considerations in Operator Approval as not current scope. | Passed: approval summaries include `deferredConsiderationsNotInScope` and `deferredConsiderationsExcludedFromCoverage=true`. |
| Show unresolved Deferred Considerations in Operator Closeout with leave, promote, and close actions. | Passed: close governance exposes unresolved items, `available_actions`, and per-item actions while keeping QA and closeout blockers false. |
| Promote only through explicit PM/operator action. | Passed: generic event writes reject Deferred Consideration event types, and promotion is available only through the dedicated PM/operator route. |
| Carry source Task ID, source Execution Contract version, Deferred Consideration ID, known context, rationale, and open questions into the promoted Intake Draft. | Passed: promoted raw requirements include each required source field; API tests assert the created Intake Draft content. |
| Exclude Deferred Considerations from Contract Coverage Audit unless promoted. | Passed: coverage row generation still reads only committed requirements, and focused coverage tests assert Deferred Consideration exclusion. |
| Do not block QA Verification or Operator Closeout. | Passed: closeout projection sets `blocks_qa_verification=false` and `blocks_operator_closeout=false`; no QA gate reads Deferred Considerations as blockers. |
| Convert current-progress blockers into refinement blocking questions or `operator_decision_required` Exceptions. | Passed: blocking review without conversion returns 409; conversion creates either a blocking workflow thread or an operator exception plus blocked state. |

## Commands

- `node --check lib/audit/deferred-considerations.js` - passed.
- `node --check lib/audit/http.js` - passed.
- `node --check lib/audit/core.js` - passed.
- `node --check src/features/task-detail/adapter.js` - passed.
- `node --test tests/unit/audit-api.test.js tests/unit/execution-contracts.test.js` - passed, 89 tests.
- `node --test tests/contract/audit-openapi.contract.test.js tests/security/audit-api.security.test.js tests/e2e/audit-foundation.e2e.test.js tests/unit/task-detail-adapter.test.js` - passed, 58 tests.
- `npx vitest run src/app/App.test.tsx tests/accessibility/task-assignment.a11y.spec.ts tests/integration/board-owner-filtering.integration.test.js` - passed, 80 tests.
- `node scripts/run-playwright.js tests/browser/task-detail.browser.spec.ts --project=chromium --grep "Deferred Considerations"` - passed, 1 focused browser test.
- `npm run lint` - passed.
- `npm run typecheck` - passed.
- `npm run standards:check` - passed.
- `npm run ownership:lint` - passed.
- `npm run change:check` - passed.
- `npm run test:unit` - passed, including 214 Node tests and 107 Vitest UI/accessibility/visual/performance tests.
- `npm run test:security` - passed, 23 tests.
- `npm run test:e2e` - passed, 28 tests.
- `npm run test:browser` - passed, 66 Playwright tests.
- `npm run test` - passed; includes unit, Vitest UI, contract, integration, e2e, property, performance, security, chaos, and browser suites.

## Required Evidence

- Commands run: focused, ship-gate, named suite, and aggregate commands listed
  above.
- Tests added or updated: `tests/unit/audit-api.test.js`,
  `tests/unit/execution-contracts.test.js`, `src/app/App.test.tsx`, and
  task-detail adapter coverage through existing UI/accessibility suites.
- Docs updated: API contract, runbook, PRD, design note, verification report,
  test report, security audit, customer review, and closeout review.
- Rollout or rollback notes: existing `FF_EXECUTION_CONTRACTS` gate.

## Standards Alignment

- Applicable standards areas: architecture and design, testing and quality
  assurance, security, product workflow, and team process.
- Evidence in this report: requirement-by-requirement audit plus focused API,
  UI, coverage, and blocker-conversion verification tied to Issue #110.
- Gap observed: production smoke evidence is not included in this repo-local workflow. Documented rationale: production validation requires deployed environment access after merge (source https://github.com/wiinc1/engineering-team/issues/110).
