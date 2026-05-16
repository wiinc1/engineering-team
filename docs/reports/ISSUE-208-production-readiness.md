# Production Readiness Report: Issue #208

Date: 2026-05-16 CDT

## Decision

Pilot readiness is approved for the supervised autonomous workflow pilot.

Final production deployment:
- Deployment: `dpl_5FCcMDQypg6jbnULekDUhFYCeR3d`
- URL: `https://engineering-team-nxle1id5w-wiinc1-hotmailcoms-projects.vercel.app`
- Alias: `https://engineering-team-zeta.vercel.app`
- Status: Ready
- Rollback target: `https://engineering-team-8yls3uecc-wiinc1-hotmailcoms-projects.vercel.app`

Follow-up remediation issue created during the blocked phase: https://github.com/wiinc1/engineering-team/issues/215. The blockers it tracked are resolved by this evidence set.

## Standards Alignment

- Applicable standards areas: deployment and release; authentication and secret handling; observability and monitoring; testing and quality assurance; security and compliance; team and process.
- Evidence expected for this change: deployment record, redacted auth smoke artifact, auth status gate, Projects migration/schema/API smoke evidence, protected route smoke evidence, delegation smoke artifact, rollback target, workflow diagram, and cleanup notes.
- Gap observed: None remaining for Issue #208. Documented rationale: release readiness must be verified against the exact production deployment and current runtime state before an autonomous workflow pilot. source https://github.com/wiinc1/engineering-team/blob/main/docs/standards/software-development-standards.md.

## Evidence Summary

Passed:
- `npx vercel deploy --prod --yes --force --logs`: deployment `dpl_5FCcMDQypg6jbnULekDUhFYCeR3d` Ready.
- `npm run auth:config:check:vercel`: production env-name validation passed.
- `npm run auth:registration:production-smoke -- --deployment-id dpl_5FCcMDQypg6jbnULekDUhFYCeR3d --protected-route /tasks,/projects,/tasks/TSK-PG-001`: all summary checks passed.
- `npm run auth:status:check -- --require-complete`: `ok=true`, evidence and docs complete.
- `npm run projects:production-smoke -- --deployment-id dpl_5FCcMDQypg6jbnULekDUhFYCeR3d`: migration/schema checks, Project CRUD, task attach/detach, archive, tenant isolation, rollback target, and redaction checks passed.
- `TENANT_ID=tenant-int npm run task-platform:verify`: migration applied, canonical task count `2`, drift `ok=true`.
- `npm run test:delegation:live-smoke:openclaw`: delegated mode with runtime-owned `agentId=engineer` and `sessionId=20a1c12b-d183-419d-b08f-5f0730375514`.
- Local verification after remediation: `npm run test:unit`, focused Projects/task-platform tests, `npm run lint`, and `npm run standards:check`.

Resolved Blockers:
- Vercel Hobby function limit: removed redundant one-segment v1 handlers and kept the deployment at the allowed function count.
- Nested task Project route 404: replaced the ambiguous task catch-all with explicit Vercel dynamic handlers for `/api/v1/tasks/{taskId}` and `/api/v1/tasks/{taskId}/{action}`.
- Auth 500s from serverless pool pressure: capped default Postgres pool size in serverless and skipped deploy bootstrap during Vercel builds unless explicitly enabled.
- Projects attach response mismatch: preserved tenant context when hydrating Postgres task Project labels.
- Task-platform drift: Projects task attach/detach now updates `task_sync_checkpoints`.
- OpenClaw delegation fallback: configured the `engineer` runtime agent and increased smoke timeouts.

Cleanup:
- Archived remaining Issue #208 smoke Projects through the production Projects API: `PRJ-B62A7346`, `PRJ-9262EDCF`, and `PRJ-2F29C122`.
- Final passing smoke Project `PRJ-E5F009AB` was archived by the smoke itself.

## Artifacts

- `observability/registration-auth-production-smoke.json`: passing redacted registration auth evidence for deployment `dpl_5FCcMDQypg6jbnULekDUhFYCeR3d`.
- `observability/projects-production-smoke.json`: passing redacted Projects smoke evidence for deployment `dpl_5FCcMDQypg6jbnULekDUhFYCeR3d`.
- `observability/specialist-delegation-smoke.json`: passing runtime delegation evidence.
- `docs/diagrams/workflow-autonomous-pilot-production-readiness.mmd`: required readiness workflow diagram.
- `docs/reports/ISSUE-208_STANDARDS_COMPLIANCE_CHECKLIST.md`: standards evidence checklist.

## Required Evidence

- Commands run: `gh issue view 208 --repo wiinc1/engineering-team --json number,title,state,body,labels,url`; `npx vercel deploy --prod --yes --force --logs`; `npm run auth:config:check:vercel`; `npm run auth:registration:production-smoke ...`; `npm run auth:status:check -- --require-complete`; `npm run projects:production-smoke ...`; `TENANT_ID=tenant-int npm run task-platform:verify`; `npm run test:delegation:live-smoke:openclaw`; `npm run test:unit`; `npm run lint`; `npm run standards:check`.
- Tests added or updated: `tests/unit/projects-production-smoke.test.js`, `tests/unit/audit-postgres-pool.test.js`, `tests/unit/task-platform-projects.test.js`, `tests/unit/audit-api-deploy-wrapper.test.js`, `tests/unit/deploy-auth-bootstrap.test.js`, and `tests/unit/openclaw-specialist-runner.test.js`.
- Rollout or rollback notes: Final deployment `dpl_5FCcMDQypg6jbnULekDUhFYCeR3d` is Ready and smoke-verified; rollback target is `https://engineering-team-8yls3uecc-wiinc1-hotmailcoms-projects.vercel.app`.
- Docs updated: this report, `docs/reports/ISSUE-208_STANDARDS_COMPLIANCE_CHECKLIST.md`, `docs/diagrams/workflow-autonomous-pilot-production-readiness.mmd`, production auth runbooks, and Vercel deployment notes.
