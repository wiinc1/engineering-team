# Issue 104 Verification

## Results

- Approved Execution Contracts can now generate reviewable repo artifact bundles.
- Production artifact paths use `TSK-123` display IDs plus readable slugs.
- Staging/local artifact paths use non-production aliases such as `STG-123` or `LOCAL-123`.
- Generated bundles include Markdown user-story content, Refinement Decision Log content, task-detail links, and PR guidance.
- Commit readiness is blocked until PM and required section-owner approvals are recorded.
- Incremental artifact approvals preserve approvals already recorded on the generated bundle while adding newly supplied role approvals.
- Operator approval is required for exception-triggered artifact content.
- Material changes after a prior approved generated story use versioned artifact paths instead of silently editing the approved story.
- Task detail exposes generated artifact links and PR guidance.
- GitHub issue creation remains default-off unless explicitly requested.

## Requirement Audit

| Acceptance criterion | Audit result |
| --- | --- |
| 1. Production approved contract generates user story and decision log with `TSK-123` filenames | Passed: `createExecutionContractArtifactBundle` emits `docs/user-stories/TSK-104-...md` and `docs/refinement/TSK-104-...md`; API test verifies paths. |
| 2. Staging/local artifacts avoid production ID collision | Passed: non-production identity generation rewrites `TSK-123` to `STG-123` or `LOCAL-123`; unit test verifies staging alias. |
| 3. PM approval required before commit readiness | Passed: artifact approval summary always includes `pm`; API test blocks commit readiness with missing approvals. |
| 4. Section-owned content routes section-owner approvals | Passed: section `ownerRole` values derive required artifact approvals for Architect, UX, QA, and SRE. |
| 5. Exception-triggered cases require operator approval | Passed: non-blocking comments and explicit exception flags add `operator` to required roles; unit test verifies operator gating. |
| 6. Material change after approval creates version/amendment instead of silent story edit | Passed: prior approved versions produce `-vN` artifact paths plus amendment notice. |
| 7. Task detail shows generated artifact links | Passed: API detail projection exposes `executionContract.artifacts.links`; React and browser tests verify rendered links. |
| 8. GitHub issue creation default-off | Passed: artifact bundle `commit_policy.github_issue_creation.default_off=true`; API history verifies no GitHub issue event is emitted by default. |
| 9. PR guidance uses display ID and slug, not opaque internal ID | Passed: generated `pr_guidance` uses display ID, story path, decision-log path, and evidence path; unit/API tests verify opaque IDs are absent from guidance targets. |

## Commands

- `node --test tests/unit/execution-contracts.test.js` - passed, 10 tests.
- `node --test tests/unit/audit-api.test.js` - passed, 60 tests.
- `node --test tests/security/audit-api.security.test.js` - passed, 18 tests.
- `node --test tests/e2e/audit-foundation.e2e.test.js` - passed, 12 tests.
- `node --test tests/contract/audit-openapi.contract.test.js` - passed, 3 tests.
- `npx vitest run src/app/App.test.tsx` - passed, 75 tests.
- `npm run standards:check` - passed.
- `npm run ownership:lint` - passed.
- `npm run change:check` - passed.
- `npm run lint` - passed.
- `npm run typecheck` - passed.
- `npm run test` - passed; Node unit, Vitest UI, contract/integration/e2e/property/performance/security/chaos, and Playwright browser suites completed.
- `npm run test:unit` - passed after the CI-mode review-question assertion timeout stabilization.
- `env CI=true npx vitest run src/app/*.test.tsx tests/unit/board-owner-card-rendering.test.js tests/unit/role-inbox-routing.test.js tests/unit/pm-overview-routing.test.js tests/integration/board-owner-filtering.integration.test.js tests/accessibility/task-assignment.a11y.spec.ts tests/accessibility/orchestration-visibility.a11y.spec.ts tests/visual/task-assignment.visual.spec.ts tests/visual/orchestration-visibility.visual.spec.ts tests/visual/auth-sign-in.visual.spec.tsx tests/performance/lighthouse-task-detail.spec.ts` - passed, 105 tests.
- `npm run test:issue-104:mutation` - passed, Stryker mutation score 93.21% for the Issue #104 artifact-bundle generation and approval range.
- `npm run build` - expected local failure without production auth env; missing `VITE_OIDC_DISCOVERY_URL`, `VITE_OIDC_CLIENT_ID`, `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`, and `AUTH_JWT_JWKS_URL`.
- `env VITE_OIDC_DISCOVERY_URL=https://idp.example/.well-known/openid-configuration VITE_OIDC_CLIENT_ID=engineering-team-browser AUTH_JWT_ISSUER=https://idp.example AUTH_JWT_AUDIENCE=engineering-team AUTH_JWT_JWKS_URL=https://idp.example/.well-known/jwks.json npm run build` - passed.

## Required Evidence

- Commands run: focused Node/Vitest suites, `npm run standards:check`, `npm run ownership:lint`, `npm run change:check`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:unit`, CI-mode Vitest UI rerun, `npm run test:issue-104:mutation`, `npm run build` without local auth env, and `env ... npm run build` with placeholder production auth env.
- Tests added or updated: `tests/unit/execution-contracts.test.js`, `tests/unit/audit-api.test.js`, `tests/e2e/audit-foundation.e2e.test.js`, `tests/security/audit-api.security.test.js`, `tests/contract/audit-openapi.contract.test.js`, `src/app/App.test.tsx`, `tests/browser/task-detail.browser.spec.ts`.
- Docs updated: API contract, task detail API notes, audit runbook, design note, generated story, Refinement Decision Log, product PRD, verification report, test report, security audit, and customer review notes.
- Rollout or rollback notes: controlled by `FF_EXECUTION_CONTRACTS`; disable it to stop artifact reads and mutations while preserving audit history.

## Standards Alignment

- Applicable standards areas: architecture and design, testing and quality assurance, security, team and process.
- Evidence in this report: requirement-by-requirement audit plus unit, API, e2e, browser, contract, and security test coverage.
- Gap observed: no remaining Issue #104 residual audit gaps after this follow-up. Documented rationale: `docs/product/software-factory-control-plane-prd.md` now exists as a restored source artifact derived from accepted context, refinement, ADR, Issue #104, and PR #100 decisions; issue-specific mutation testing is captured by `npm run test:issue-104:mutation` with Stryker coverage for artifact-bundle generation and approval behavior (source https://github.com/wiinc1/engineering-team/issues/104).
