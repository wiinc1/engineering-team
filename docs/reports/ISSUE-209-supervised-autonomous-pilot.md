# Supervised Autonomous Pilot Report: Issue #209

Date: 2026-05-16 CDT

## Decision

Status: implementation and dispatch evidence recorded; PR merge and final task closeout pending.

The pilot exposed two workflow blockers before closeout:

- Vercel did not route versioned task workflow paths to the shared audit API handler consistently.
- Production Postgres audit writes require bounded projection-worker processing before the next read-model gate can observe a write.

Both blockers were remediated or worked around visibly for this pilot. The same pilot Project and task resumed successfully after deployment `dpl_FdiWbwoaJ5uRAWMVRntVjGb9WUDm`; the task now has a valid Simple contract v2, policy auto-approval, engineer assignment, and delegated runtime attribution.

Operator decision so far: complete PR validation and merge, then record QA/SRE/closeout in task history.

## Pilot Scope

- Parent issue: https://github.com/wiinc1/engineering-team/issues/209
- Production readiness prerequisite: https://github.com/wiinc1/engineering-team/issues/208, closed.
- Structured metrics follow-up: https://github.com/wiinc1/engineering-team/issues/156, open.
- Project name: `Autonomous Workflow Pilot - Issue 209`
- Project ID: `PRJ-3F6E1F1D`
- Task title: `Issue 209 supervised pilot evidence task`
- Task ID: `TSK-4C15648B`
- Task type: docs/test-only pilot evidence package.
- Risk classification: Simple, reversible by git revert, no intended auth/schema/runtime/data change.

## Standards Alignment

- Applicable standards areas: architecture and design, testing and quality assurance, deployment and release, observability and monitoring, authentication and secret handling, and team and process.
- Evidence expected for this change: pilot Project ID, task ID, approved contract, delegation attribution, PR link, validation results, closeout notes, intervention log, follow-up issue links, route/projection regression evidence, runbook, and diagram.
- Gap observed: The production pilot exposed a missing nested versioned task workflow route. Documented rationale: the supervised pilot cannot claim an end-to-end autonomous workflow path until `/api/v1` task workflow routes can record contract, QA, SRE, and closeout evidence through the deployed app (source https://github.com/wiinc1/engineering-team/issues/209).

## Evidence To Complete

The final closeout update must fill in:

- Branch, commit SHA, PR URL, PR check summary, and Vercel status.
- QA pass, SRE monitoring approval, PR sync, and closeout task events.
- Final operator decision.

## Blocker And Remediation

Route blocker:
- `POST /api/tasks/TSK-4C15648B/execution-contract` reached a production 404 before the app handler processed the request.
- `POST /api/v1/tasks/TSK-4C15648B/execution-contract/markdown` also reached a production 404 until two-segment workflow routing was added.

Root cause:
- Vercel had a one-segment dynamic wrapper at `api/v1/tasks/[taskId]/[action].js`.
- Workflow routes need deeper paths, including `execution-contract/approve`, `execution-contract/markdown`, `contract-coverage-audit/validate`, and other closeout endpoints.
- The app handler also only matched many workflow routes without the `/v1` prefix, despite the public API documentation and pilot workflow using `/api/v1`.

Remediation:
- Added `api/v1/task-workflow-proxy.js` plus Vercel rewrites for nested `execution-contract`, `contract-coverage-audit`, and `sre-monitoring` workflow actions. This stays within the Hobby 12-function limit and avoids Vercel dynamic-route conflicts.
- Updated route matching in `lib/audit/http.js` to accept both `/tasks/...` and `/v1/tasks/...`.
- Added `tests/unit/audit-api-v1-workflow-routes.test.js` to prove versioned execution contract creation and approval reach the audit handler.
- Updated deployment wrapper coverage and README Vercel notes.

Projection blocker:
- Production audit event writes returned accepted event IDs, but task history/detail remained stale until projection queue processing ran.
- The pilot used bounded projection processing after each production workflow write. All recorded projection runs passed with `failed=0`; see `observability/supervised-autonomous-pilot.json`.

## Manual Action Log

| Timestamp | Action | Classification | Location | Reason |
|---|---|---|---|---|
| 2026-05-16 CDT | Verified Issue 208 is closed | routine observation | GitHub issue | Production readiness is the pilot prerequisite. |
| 2026-05-16 CDT | Created pilot branch | required approval | Git branch | Pilot implementation must use normal PR flow. |
| 2026-05-16 CDT | Created or reused pilot Project and task | required approval | Production API | Issue 209 requires one Project and one low-risk task. |
| 2026-05-16 CDT | Stopped pilot on nested workflow route 404 | operator intervention | Production API | The approved pilot path could not record the execution contract through the expected versioned workflow route. |
| 2026-05-16 CDT | Added route remediation and regression test | operator intervention | Repository branch | Missing capability must be fixed before closeout can claim a complete workflow path. |
| 2026-05-17 UTC | Deployed route remediation `dpl_FdiWbwoaJ5uRAWMVRntVjGb9WUDm` | operator intervention | Vercel production | Production needed the route fix before the pilot could continue. |
| 2026-05-17 UTC | Ran bounded projection processing after production writes | operator intervention | Audit projection worker | Postgres read models needed to catch up before each subsequent workflow gate. |
| 2026-05-17 UTC | Approved Simple contract v2 by policy | required approval | Execution Contract API | Low-risk Simple auto-approval policy recorded `execution-contract-low-risk-simple-auto-approval.v1`. |
| 2026-05-17 UTC | Recorded delegated runtime attribution | routine observation | Task control-plane decision | OpenClaw smoke recorded `agentId=engineer`, session `20a1c12b-d183-419d-b08f-5f0730375514`. |

## Validation

Passed:
- `node --test tests/unit/audit-api-deploy-wrapper.test.js tests/unit/audit-api-v1-workflow-routes.test.js`
- `npm run lint`
- `npm run test:unit`
- `npm run standards:check`
- `npm run test:delegation:live-smoke:openclaw`
- `npx vercel deploy --prod --yes --force --logs`: deployment `dpl_FdiWbwoaJ5uRAWMVRntVjGb9WUDm` Ready and aliased to `https://engineering-team-zeta.vercel.app`.
- Production pilot resume: Project `PRJ-3F6E1F1D`, task `TSK-4C15648B`, contract v2 valid, policy auto-approval recorded, engineer assigned, delegation attribution recorded.

Pending:
- GitHub PR checks
- PR merge
- QA pass, SRE monitoring approval, PR sync, and closeout events

## Follow-Up Issues

- https://github.com/wiinc1/engineering-team/issues/156: replace this manual intervention report with structured operator-trusted autonomous delivery metrics.

Additional follow-up issues must be linked here if deployment, delegation, QA/SRE, or closeout exposes another missing capability.

## Artifacts

- `docs/diagrams/workflow-supervised-autonomous-pilot.mmd`
- `docs/runbooks/supervised-autonomous-pilot.md`
- `docs/reports/ISSUE-209_STANDARDS_COMPLIANCE_CHECKLIST.md`
- `observability/supervised-autonomous-pilot.json`

## Required Evidence

- Commands run: `gh issue view 209 --repo wiinc1/engineering-team --json number,title,state,body,labels,url`; `gh issue view 208 --repo wiinc1/engineering-team --json number,title,state,url`; `gh issue view 156 --repo wiinc1/engineering-team --json number,title,state,url`; `node --test tests/unit/audit-api-deploy-wrapper.test.js tests/unit/audit-api-v1-workflow-routes.test.js`; `npm run lint`; `npm run test:unit`; `npm run standards:check`; `npm run test:delegation:live-smoke:openclaw`; `npx vercel deploy --prod --yes --force --logs`; production pilot resume helper using `.env.production.local`.
- Tests added or updated: `tests/unit/audit-api-v1-workflow-routes.test.js`; `tests/unit/audit-api-deploy-wrapper.test.js`; `package.json` unit test list.
- Rollout or rollback notes: production deployment `dpl_FdiWbwoaJ5uRAWMVRntVjGb9WUDm` is Ready; rollback is a normal git revert plus redeploy after preserving pilot evidence.
- Docs updated: `README.md`; `docs/diagrams/workflow-supervised-autonomous-pilot.mmd`; `docs/runbooks/supervised-autonomous-pilot.md`; `docs/reports/ISSUE-209_STANDARDS_COMPLIANCE_CHECKLIST.md`; this report.
