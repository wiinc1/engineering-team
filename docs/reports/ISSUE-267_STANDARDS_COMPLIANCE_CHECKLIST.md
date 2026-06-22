# Standards Compliance Checklist

## Change Metadata
- Change or task ID: PR #267, forge execution-readiness endpoint for forgeadapter Phase 2.
- Owner: OpenClaw implementation agent.
- Date: 2026-06-22.
- Scope summary: Expose `GET /tasks/:taskId/forge-execution-readiness` on audit-api with service-token and `forge:read` JWT auth, canonical task mapping, and `forge_dispatch` persistence on execution contract upsert.

## Standards Alignment
- Standards baseline reviewed: `docs/standards/software-development-standards.md`.
- Applicable standards areas: architecture and design; coding and code quality; authentication and secret handling; testing and quality assurance; deployment and release; observability and monitoring.
- Evidence expected for this change: route wrapper isolation, mapper unit tests, audit API auth tests, OpenAPI/runbook updates, maintainability compliance, and standards gate output.
- Gap observed: No functional standards gaps for this additive route wrapper. Documented rationale: Forge execution-readiness logic is isolated in new modules and tests without expanding legacy baselined long functions (source https://github.com/wiinc1/engineering-team/blob/main/docs/standards/software-development-standards.md).

## Architecture and Design
- Evidence: `lib/audit/forge-execution-http.js`, `lib/task-platform/forge-canonical-task.js`, `lib/audit/http-projects.js`.
- Route wrapper pattern preserves the minified `http.js` bundle while wiring production-only forge reads.
- Execution-ready gate requires approved execution contract, dispatch readiness, and `forge_dispatch` metadata.

## Authentication and Secret Handling
- Service-to-service auth uses `FORGE_SERVICE_TOKEN` bearer with timing-safe comparison.
- JWT fallback requires `forge:read` on the caller role (`admin` granted in `lib/audit/authz.js`).
- No secret values are logged in responses or audit telemetry.

## Testing and QA
- Tests added or updated:
  - `tests/unit/forge-canonical-task.test.js`
  - `tests/unit/audit-api.test.js`
  - `tests/contract/forge-execution-readiness.contract.test.js`
  - `tests/security/audit-api.security.test.js`
- Coverage areas: field mapping, draft/unapproved 422 paths, service-token success, JWT permission enforcement, OpenAPI contract, and invalid service-token rejection.

## Deployment and Release
- Set `FORGE_SERVICE_TOKEN` in engineering-team environments that serve forgeadapter reads.
- Pair with forgeadapter `ENGINEERING_TEAM_SERVICE_TOKEN` using the same value.
- Rollback: revert PR #267 to remove the route wrapper and mapper; forgeadapter Phase 1 bridge remains available on `:3003` until client migration completes.

## Required Evidence
- Commands run: `npm run maintainability:check`; `node --test tests/unit/forge-canonical-task.test.js`; `node --test tests/unit/audit-api.test.js --test-name-pattern=forge-execution-readiness`; `node --test tests/contract/forge-execution-readiness.contract.test.js`; `node --test tests/security/audit-api.security.test.js --test-name-pattern=forge execution-readiness`; `npm run change:check`; `npm run standards:check`.
- Tests added or updated: `tests/unit/forge-canonical-task.test.js`; `tests/unit/audit-api.test.js`; `tests/contract/forge-execution-readiness.contract.test.js`; `tests/security/audit-api.security.test.js`.
- Rollout or rollback notes: Set `FORGE_SERVICE_TOKEN` before enabling forgeadapter Phase 2 reads; rollback by reverting PR #267 and keeping forgeadapter on the Phase 1 `:3003` bridge until client migration completes.
- Docs updated: `docs/api/audit-foundation-openapi.yml`; `docs/api/task-platform-openapi.yml`; `docs/runbooks/audit-foundation.md`; `docs/runbooks/task-platform-rollout.md`; `docs/reports/ISSUE-267_STANDARDS_COMPLIANCE_CHECKLIST.md`.