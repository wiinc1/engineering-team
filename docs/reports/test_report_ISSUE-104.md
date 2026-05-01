# Test Report Issue 104

## Automated Coverage

- `tests/unit/execution-contracts.test.js`
  - Artifact identity normalization for production and non-production display IDs.
  - Generated user-story and Refinement Decision Log paths.
  - PM, section-owner, and operator approval routing.
  - Artifact slug, GitHub issue, and approval input aliases.
  - Incremental artifact approval merge behavior.
  - Versioned artifact paths after prior approved generated stories.
- `tests/unit/audit-api.test.js`
  - End-to-end HTTP generation and approval of artifact bundles.
  - Commit-readiness blocking on missing artifact approvals.
  - Task detail artifact projection and default-off GitHub issue behavior.
- `tests/e2e/audit-foundation.e2e.test.js`
  - Intake Draft to approved Execution Contract to generated/approved artifact bundle.
  - Existing PM artifact approval persists when a later section-owner approval completes the bundle.
- `tests/security/audit-api.security.test.js`
  - Direct generic artifact approval bypass rejection.
  - Rejected generic bypasses do not write artifact-bundle approval history.
- `tests/contract/audit-openapi.contract.test.js`
  - OpenAPI route and event documentation for artifact generation and approval.
- `src/app/App.test.tsx` and `tests/browser/task-detail.browser.spec.ts`
  - Task-detail rendering of generated artifact links and PR guidance.

## Commands Run

- `node --test tests/unit/execution-contracts.test.js`
- `node --test tests/unit/audit-api.test.js`
- `node --test tests/security/audit-api.security.test.js`
- `node --test tests/e2e/audit-foundation.e2e.test.js`
- `node --test tests/contract/audit-openapi.contract.test.js`
- `npx vitest run src/app/App.test.tsx`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:unit`
- `env CI=true npx vitest run src/app/*.test.tsx tests/unit/board-owner-card-rendering.test.js tests/unit/role-inbox-routing.test.js tests/unit/pm-overview-routing.test.js tests/integration/board-owner-filtering.integration.test.js tests/accessibility/task-assignment.a11y.spec.ts tests/accessibility/orchestration-visibility.a11y.spec.ts tests/visual/task-assignment.visual.spec.ts tests/visual/orchestration-visibility.visual.spec.ts tests/visual/auth-sign-in.visual.spec.tsx tests/performance/lighthouse-task-detail.spec.ts`
- `npm run test:issue-104:mutation`
- `npm run build` without local production auth env, then `env ... npm run build` with placeholder auth env

## Mutation Testing

- Config: `stryker.issue-104.conf.json`
- Command: `npm run test:issue-104:mutation`
- Target: `lib/audit/execution-contracts.js:1267-1423`
- Test command: `node --test tests/unit/execution-contracts.test.js`
- Result: passed with 93.21% mutation score, above the 80% high threshold.

## Standards Alignment

- Applicable standards areas: testing and quality assurance, security, accessibility and usability planning.
- Evidence in this report: unit, API, e2e, security, contract, React, and Playwright browser coverage mapped to Issue #104 behavior.
- Gap observed: no remaining mutation-testing gap for the Issue #104 artifact-bundle slice after this follow-up. Documented rationale: mutation testing was added and run for the Issue #104 artifact-bundle generation and approval range (source https://github.com/wiinc1/engineering-team/issues/104).

## Required Evidence

- Commands run: focused Node/Vitest suites, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:unit`, CI-mode Vitest UI rerun, `npm run test:issue-104:mutation`, and production build verification with placeholder auth env after the expected missing-env local failure.
- Tests added or updated: `tests/unit/execution-contracts.test.js`, `tests/unit/audit-api.test.js`, `tests/e2e/audit-foundation.e2e.test.js`, `tests/security/audit-api.security.test.js`, `tests/contract/audit-openapi.contract.test.js`, `src/app/App.test.tsx`, `tests/browser/task-detail.browser.spec.ts`.
- Rollout or rollback notes: `FF_EXECUTION_CONTRACTS`.
- Docs updated: test report for Issue #104.
