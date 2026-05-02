# Issue 112 Verification

## Summary

Issue #112 is implemented as an additive Merge Readiness Review data model and canonical task-platform API collection. This audit was completed before ship preparation.

## Acceptance Criteria Audit

| # | Requirement | Verification |
| --- | --- | --- |
| 1 | Migration creates tenant-scoped `merge_readiness_reviews` linked to `tasks`. | Passed: `db/migrations/010_merge_readiness_reviews.sql` creates `(tenant_id, review_id)` primary key records with `fk_merge_readiness_reviews_task` to `tasks (tenant_id, task_id)`. |
| 2 | Identity/status/`is_current`/version/check-run/timestamps/actor fields are typed columns. | Passed: migration defines typed columns for Task/PR/SHA identity, `review_status`, `is_current`, `policy_version`, `record_version`, `github_check_run_id`, timestamps, and reviewer actor fields. |
| 3 | Evolving review payload fields are JSONB. | Passed: source inventory, required checks, reviewed sources, findings, classification, owner, rationale, follow-up links, approvals, and metadata are JSONB columns. |
| 4 | Findings remain JSONB inside `merge_readiness_reviews`; no findings child table. | Passed: migration and tests assert `findings JSONB` and no `merge_readiness_findings` table. |
| 5 | Partial unique index enforces one current review per Task+repository+PR+SHA. | Passed: `idx_merge_readiness_reviews_current_identity` is partial on `is_current = true`. |
| 6 | Created record includes all required typed and payload fields. | Passed: service normalization and API tests create records with Task ID, repository, PR number, SHA, status, policy version, checks, sources, findings, classification, owner, rationale, follow-ups, approvals, check-run ID, timestamps, and actor. |
| 7 | Full source logs are linked, not copied. | Passed: service rejects copied full-log fields in `sourceInventory` and `reviewedLogSources`; tests assert `full_log_content_not_allowed`. |
| 8 | Invalid status writes are rejected. | Passed: service status enum rejects invalid writes with `invalid_merge_readiness_status`; API test covers this path. |
| 9 | Multiple reviews for same identity return exactly one current review. | Passed: API and integration tests create replacements then query current review and assert one current item. |
| 10 | New current review marks prior current false while preserving history. | Passed: API test queries `current=false` history and asserts two rows with one current and the prior row historical. |
| 11 | Failed replacement rolls back prior current marker. | Passed: PostgreSQL service test simulates insert failure after supersession update and asserts rollback restores the prior current review. |
| 12 | Query by Task or PR deterministically retrieves current review. | Passed: GET route filters by Task, repository, PR number, SHA, and defaults to current-only deterministic ordering. |
| 13 | Update uses optimistic concurrency/equivalent. | Passed: PATCH requires `recordVersion`; stale update returns `merge_readiness_review_version_conflict`. |
| 14 | `docs/api/task-platform-openapi.yml` documents create/read/update. | Passed: OpenAPI contract includes GET/POST/PATCH for `/tasks/{taskId}/merge-readiness-reviews` and request/response schemas. |
| 15 | No standalone merge-readiness OpenAPI file introduced. | Passed: test scans `docs/api` and asserts no merge-readiness standalone contract file exists. |
| 16 | Tests cover model, API behavior, validation, linkage, JSONB findings, uniqueness, transactional supersession, history, typed/JSONB boundary, no-full-log storage, and query behavior. | Passed: coverage is in `tests/unit/task-platform-api.test.js`, `tests/unit/audit-api.test.js`, `tests/integration/task-assignment-integration.test.js`, `tests/security/audit-api.security.test.js`, and `tests/contract/audit-openapi.contract.test.js`. |

## Commands

- `node --test tests/unit/task-platform-api.test.js`
- `node --test tests/unit/audit-api.test.js`
- `node --test tests/security/audit-api.security.test.js`
- `node --test tests/integration/task-assignment-integration.test.js`
- `node --test tests/e2e/task-assignment.test.js`
- `node --test tests/contract/audit-openapi.contract.test.js`
- `npm run lint`
- `npm run standards:check`
- `npm run change:check`
- `npm run ownership:lint`
- `npm run test:governance`
- `npm run typecheck`
- `npm run test:unit`
- `npm run test:contract`
- `npm run test:browser`
- `npm test`
- `env VITE_OIDC_DISCOVERY_URL=https://idp.example/.well-known/openid-configuration VITE_OIDC_CLIENT_ID=engineering-team-browser AUTH_JWT_ISSUER=https://idp.example AUTH_JWT_AUDIENCE=engineering-team AUTH_JWT_JWKS_URL=https://idp.example/.well-known/jwks.json npm run build`

## Evidence Paths

- `db/migrations/010_merge_readiness_reviews.sql`
- `lib/task-platform/service.js`
- `lib/task-platform/postgres.js`
- `lib/audit/http.js`
- `docs/api/task-platform-openapi.yml`
- `docs/runbooks/task-platform-rollout.md`
- `tests/unit/task-platform-api.test.js`
- `tests/unit/audit-api.test.js`
- `tests/integration/task-assignment-integration.test.js`
- `tests/e2e/task-assignment.test.js`
- `tests/security/audit-api.security.test.js`
- `tests/contract/audit-openapi.contract.test.js`

## Gaps

No issue acceptance gaps found in the repository implementation.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, team and process.
- Evidence in this report: acceptance-criteria audit, migration/API mapping, focused tests, and workflow evidence paths for issue #112.
- Gap observed: No standards gap remains for issue #112. Documented rationale: the implemented storage/API foundation has migration, code, test, docs, and acceptance-audit evidence in this change (source https://github.com/wiinc1/engineering-team/issues/112).

## Required Evidence

- Commands run: `node --test tests/unit/task-platform-api.test.js`; `node --test tests/unit/audit-api.test.js`; `node --test tests/security/audit-api.security.test.js`; `node --test tests/integration/task-assignment-integration.test.js`; `node --test tests/e2e/task-assignment.test.js`; `node --test tests/contract/audit-openapi.contract.test.js`; `npm run lint`; `npm run standards:check`; `npm run change:check`; `npm run ownership:lint`; `npm run test:governance`; `npm run typecheck`; `npm run test:unit`; `npm run test:contract`; `npm run test:browser`; `npm test`; production `npm run build` with documented example OIDC/JWKS variables.
- Tests added or updated: `tests/unit/task-platform-api.test.js`; `tests/unit/audit-api.test.js`; `tests/integration/task-assignment-integration.test.js`; `tests/e2e/task-assignment.test.js`; `tests/security/audit-api.security.test.js`; `tests/contract/audit-openapi.contract.test.js`.
- Rollout or rollback notes: Apply migration `010_merge_readiness_reviews.sql` before enabling writes; roll back by stopping/reverting the additive route and service methods while preserving historical review rows.
- Docs updated: `docs/design/ISSUE-112-design.md`, `docs/api/task-platform-openapi.yml`, `docs/runbooks/task-platform-rollout.md`, and issue #112 reports.
