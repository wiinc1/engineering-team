# Issue 112 Design

## Research & Context

Issue #112 adds the storage and API foundation for Merge Readiness Review records under the canonical task platform. The implementation is intentionally limited to structured persistence and create/read/update behavior; GitHub check-run emission, source-inventory policy decisions, branch-protection enforcement, rendered PR summaries, standalone OpenAPI files, and normalized findings child tables remain out of scope.

Source artifacts:

- GitHub issue #112
- `docs/api/task-platform-openapi.yml`
- `docs/runbooks/task-platform-rollout.md`
- Existing task-platform file and PostgreSQL service patterns

## Architecture

The change adds `merge_readiness_reviews` as an additive tenant-scoped table linked to `tasks` by `(tenant_id, task_id)`. Identity, review status, current marker, policy version, record version, check-run ID, timestamps, and actor fields are typed columns. Evolving payloads are JSONB columns: `source_inventory`, `required_check_inventory`, `reviewed_log_sources`, `findings`, `classification`, `owner`, `rationale`, `follow_up_links`, `approvals`, and `metadata`.

The table has a partial unique index on `(tenant_id, task_id, repository, pull_request_number, commit_sha)` where `is_current = true`. This preserves historical reviews while enforcing one current review for the same Task, repository, PR number, and commit SHA.

## Runtime Behavior

The task-platform service now exposes:

- `createMergeReadinessReview`
- `listMergeReadinessReviews`
- `updateMergeReadinessReview`

Create validates status and identity fields, rejects copied full source-log content, and defaults records to current. Creating a replacement current review uses transactional supersession in PostgreSQL: prior current rows are marked historical and the new review is inserted in one transaction. The file-backed test harness mirrors the same semantics for local API tests.

Update uses `recordVersion` optimistic concurrency. Stale writes return `merge_readiness_review_version_conflict`.

## HTTP Surface

The existing audit HTTP server now routes the canonical task-platform collection:

- `GET /api/v1/tasks/{taskId}/merge-readiness-reviews`
- `POST /api/v1/tasks/{taskId}/merge-readiness-reviews`
- `PATCH /api/v1/tasks/{taskId}/merge-readiness-reviews`

Read requires `state:read`. Create and update require `events:write`. Full source logs must remain linked through `reviewedLogSources` or `sourceInventory` references and are rejected if copied inline.

## Rollout

Rollout is additive: apply migration `010_merge_readiness_reviews.sql`, deploy the service/API changes, and smoke the new collection against an existing canonical Task. Rollback can stop new writes by reverting the API/service slice while preserving historical rows.
