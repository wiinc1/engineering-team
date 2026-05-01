# Security Audit Issue 110

## Review Scope

Issue #110 changes the audit workflow by adding Deferred Consideration child
records and dedicated routes for capture, review, promotion, and no-action
closure.

## Findings

- Generic event bypass is blocked for all Deferred Consideration event types.
- Capture is limited to PM/admin callers.
- Review, promotion, and no-action close are limited to PM, operator,
  stakeholder, or admin callers.
- Promotion creates a normal Intake Draft instead of mutating committed scope.
- Deferred Considerations are excluded from Contract Coverage Audit until they
  are promoted through the normal intake and contract approval workflow.
- Current-progress blockers fail closed unless converted into a blocking
  refinement question or `operator_decision_required` Exception.

## Security-Relevant Tests

- `tests/unit/audit-api.test.js` verifies direct generic event injection is
  rejected for Deferred Consideration events.
- `tests/unit/audit-api.test.js` verifies blocker review without conversion
  fails with 409.
- `tests/unit/audit-api.test.js` verifies operator exception conversion records
  a blocked waiting state.
- `tests/unit/execution-contracts.test.js` verifies Deferred Considerations are
  not treated as committed coverage rows.

## Residual Risk

- Production smoke evidence is still required after deployment to confirm route
  authorization, feature flags, and UI visibility in the deployed environment.
- No external penetration test or DAST scan was run. Documented rationale: this
  is an internal workflow-gating change covered by repo-local authorization,
  fail-closed, and bypass tests.

## Standards Alignment

- Applicable standards areas: security, testing and quality assurance, and team
  process.
- Evidence in this report: authorization boundary review plus fail-closed
  route and projection tests for Issue #110.
- Gap observed: no external penetration test or DAST scan was run. Documented rationale: repo-local tests target the changed internal workflow boundaries (source https://github.com/wiinc1/engineering-team/issues/110).

## Required Evidence

- Commands run: focused security/API/e2e/contract suites, `npm run test:security`,
  and aggregate `npm run test`; see `docs/reports/ISSUE-110-verification.md`.
- Tests added or updated: Deferred Consideration API, coverage-exclusion, UI,
  and accessibility regression tests.
- Rollout or rollback notes: existing `FF_EXECUTION_CONTRACTS` gate.
- Docs updated: security audit for Issue #110.
