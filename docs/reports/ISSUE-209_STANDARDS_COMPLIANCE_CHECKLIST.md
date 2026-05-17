# Standards Compliance Checklist

## Linked Standards

- Standards document: `docs/standards/software-development-standards.md`
- Required gap statement format: `Gap observed: X. Documented rationale: Y (source Z).`

## Change Metadata

- Change or task ID: Issue #209, supervised low-risk autonomous workflow pilot.
- Owner: Codex implementation agent.
- Date: 2026-05-16.
- Scope summary: Run and document a supervised pilot through the existing control plane. Remediate the versioned nested task workflow route and projection catch-up gaps exposed by the pilot.

## Standards Alignment

- Standards baseline reviewed: `docs/standards/software-development-standards.md`.
- Applicable standards areas: architecture and design; coding and code quality; testing and quality assurance; deployment and release; observability and monitoring; authentication and secret handling; team and process.
- Evidence expected for this change: pilot Project ID, task ID, approved contract, delegation attribution, PR URL, check summary, closeout notes, intervention log, follow-up issue links, route/proxy regression test, projection catch-up evidence, runbook, report, and diagram.
- Gap observed: The existing production route adapter did not support nested versioned task workflow routes, and production read models required explicit projection-worker catch-up during the pilot. Documented rationale: Issue 209 requires the pilot to move through the existing deployed workflow path and link each missing capability before closeout (source https://github.com/wiinc1/engineering-team/issues/209).

## Architecture and Design

- Applicable: Yes.
- Evidence in this change: `api/v1/task-workflow-proxy.js`, `api/v1/tasks/[taskId]/[action].js`, `vercel.json`, `lib/audit/http.js`, and `docs/diagrams/workflow-supervised-autonomous-pilot.mmd`.
- Gap observed: Vercel exposed a one-segment versioned task wrapper, while the workflow requires nested task action routes. Documented rationale: the production pilot must use the same `/api/v1` workflow paths as the documented task API before the workflow can be trusted for repeated autonomous runs (source `docs/product/software-factory-control-plane-prd.md`).

## Coding and Code Quality

- Applicable: Yes.
- Evidence in this change: The Vercel wrappers and proxy delegate to the existing shared request handler, avoiding duplicate route logic; route matching accepts both legacy and versioned task workflow paths; the Projects production smoke CLI is mapped in `config/change-ownership-map.json`.
- Gap observed: None remaining for this scoped route remediation. Documented rationale: the change is a narrow adapter/routing correction with adjacent regression coverage (source `docs/standards/software-development-standards.md`).

## Testing and Quality Assurance

- Applicable: Yes.
- Evidence in this change: `tests/unit/audit-api-v1-workflow-routes.test.js` and updated `tests/unit/audit-api-deploy-wrapper.test.js`.
- Gap observed: PR merge and final QA/SRE closeout validation are pending. Documented rationale: Issue 209 defines the supervised pilot itself as the production validation strategy, so final evidence must include the live task history and PR checks (source https://github.com/wiinc1/engineering-team/issues/209).

## Deployment and Release

- Applicable: Yes.
- Evidence in this change: README Vercel deployment notes, `vercel.json` rewrites, deployment `dpl_FdiWbwoaJ5uRAWMVRntVjGb9WUDm`, and the required production-pilot report.
- Gap observed: Vercel rejects conflicting generic dynamic routes and the Hobby plan caps deployments at 12 functions. Documented rationale: nested workflow routing is implemented with one proxy function and rewrites to stay within the production plan limit (source `docs/reports/ISSUE-209-supervised-autonomous-pilot.md`).

## Observability and Monitoring

- Applicable: Yes.
- Evidence in this change: `docs/reports/ISSUE-209-supervised-autonomous-pilot.md` and `observability/supervised-autonomous-pilot.json`.
- Gap observed: Manual intervention classification remains report-based, and projection-worker catch-up was required during the live pilot. Documented rationale: structured operator-trusted autonomous delivery metrics are tracked separately in Issue #156, while projection operations remain an explicit runbook action for Postgres audit read-model catch-up (sources https://github.com/wiinc1/engineering-team/issues/156 and `docs/runbooks/audit-foundation.md`).

## Authentication and Secret Handling

- Applicable: Yes.
- AuthN/AuthZ surfaces changed: No auth semantics changed; the route wrapper preserves the existing shared audit handler and RBAC path.
- Secret, token, cookie, password, or PII redaction evidence: Pilot artifacts must include IDs, status, and command summaries only; no JWTs, cookies, emails, passwords, raw secrets, or env values are stored.
- Abuse-control or rate-limit evidence: No new public unauthenticated surface is added; existing authenticated API handling applies.
- Rollback or removal impact: Revert the route wrapper and report/docs if needed; preserve pilot evidence before cleanup.
- Gap observed: None for secret handling. Documented rationale and source: the pilot uses existing authenticated production APIs and redacted observability artifacts (source `docs/standards/software-development-standards.md`).

## Team and Process

- Applicable: Yes.
- Evidence in this change: `docs/runbooks/supervised-autonomous-pilot.md`, manual-action classifications in the pilot report, `observability/supervised-autonomous-pilot.json`, and follow-up link to Issue #156.
- Gap observed: The pilot required operator intervention to remediate routing and projection catch-up gaps. Documented rationale: Issue 209 requires each missing workflow capability to be linked or remediated before closeout (source https://github.com/wiinc1/engineering-team/issues/209).

## Required Evidence

- Commands run: `gh issue view 209 --repo wiinc1/engineering-team --json number,title,state,body,labels,url`; `gh issue view 208 --repo wiinc1/engineering-team --json number,title,state,url`; `gh issue view 156 --repo wiinc1/engineering-team --json number,title,state,url`; `node --test tests/unit/audit-api-deploy-wrapper.test.js tests/unit/audit-api-v1-workflow-routes.test.js`; `npm run lint`; `npm run test:unit`; `npm run coverage`; `npm run ownership:lint`; `npm run standards:check`; `npm run test:delegation:live-smoke:openclaw`; `npx vercel deploy --prod --yes --force --logs`; production pilot resume helper using `.env.production.local`.
- Tests added or updated: `tests/unit/audit-api-v1-workflow-routes.test.js`; `tests/unit/audit-api-deploy-wrapper.test.js`; `package.json` unit test list.
- Rollout or rollback notes: Production deployment `dpl_FdiWbwoaJ5uRAWMVRntVjGb9WUDm` is Ready and aliased to `https://engineering-team-zeta.vercel.app`; rollback is a normal git revert plus redeploy after preserving pilot evidence.
- Docs updated: `README.md`; `docs/diagrams/workflow-supervised-autonomous-pilot.mmd`; `docs/runbooks/supervised-autonomous-pilot.md`; `docs/reports/ISSUE-209-supervised-autonomous-pilot.md`; this checklist.
