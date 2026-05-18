# Supervised Autonomous Pilot Runbook

Use this runbook for the Issue 209 style pilot: one supervised, low-risk task that moves through Project intake, contract approval, implementation, validation, QA/SRE closeout, and a manual-action report.

## Preconditions

- Issue 208 production readiness is closed and its latest production smoke artifacts are still accepted.
- The operator has a production-capable account with PM/Admin privileges.
- OpenClaw delegation runtime access is available, or a visible blocker can be recorded.
- The task candidate is Simple, docs/test-only, reversible by git revert, and has no auth, schema, deployment, data, or production-risk flags.
- The pilot Project must contain exactly one pilot task until the report is archived.
- Clawpatch is optional for the first supervised pilot, not required. If the operator chooses to use it, follow `docs/runbooks/clawpatch-autonomous-workflow.md` and record the decision in closeout evidence.

## Workflow

1. Create a Project named `Autonomous Workflow Pilot - Issue <number>`.
2. Create exactly one low-risk task and link it to the Project.
3. Record a Simple Execution Contract with acceptance criteria, rollback notes, test expectations, observability notes, and handoff expectations.
4. For Postgres-backed audit environments, process bounded projection work after each write before checking the next read-model gate.
5. Request policy auto-approval only if the contract is low risk; otherwise record explicit operator approval and the reason.
6. Dispatch implementation ownership and record the assigned agent.
7. Run `npm run test:delegation:live-smoke:openclaw` and capture the runtime-owned agent and session ID. If the command falls back or times out, stop the pilot and link a remediation issue.
8. Decide whether Clawpatch is used for the implementation loop. If used, treat it as optional patch assistance and keep Codex/OpenClaw, PR checks, Vercel, QA, SRE, and operator closeout authoritative.
9. Implement through a normal branch and PR. Keep the change scoped to the pilot contract.
10. Validate the PR with the affected test matrix, standards gate, GitHub PR checks, browser validation if UI changed, and Vercel preview/production status.
11. Merge only after required checks pass.
12. Record QA pass, SRE monitoring approval, PR sync evidence, and closeout in task history.
13. Publish the pilot report and classify every manual action as `routine observation`, `required approval`, or `operator intervention`.
14. Record the operator decision: repeat pilot, remediate, or stop.

## Manual Action Classifications

- `routine observation`: read-only checks of state, logs, PR checks, deployment status, task history, or generated evidence.
- `required approval`: expected human approval points such as Project creation, task intake, contract approval, PR merge, QA pass, SRE approval, or closeout.
- `operator intervention`: a corrective manual action that changes course after approval, such as editing approved scope, repairing a failed route, changing runtime configuration, forcing deployment, bypassing an expected gate, manually replacing missing workflow evidence, or manually running projection catch-up when the next workflow gate cannot observe an accepted production write.

Routine observation and required approval are not counted as autonomy failures. Operator intervention must be explained with timestamp, location, reason, and follow-up issue.

## Evidence Checklist

- Project ID and task ID.
- Contract version, approval mode, policy or explicit approval details.
- Delegation selected specialist, runtime session ID, and command result.
- Clawpatch decision: `required`, `optional`, `not used`, or `out of scope`; include setup smoke and patch evidence only if used.
- Branch, commit SHA, PR URL, PR checks, and Vercel deployment status.
- Test commands and local/CI/browser results.
- QA pass, SRE approval, PR sync, and closeout events.
- Manual-action log with classification and timestamps.
- Follow-up issue links for every missing capability.

## Rollback

For a docs/test-only pilot, rollback is a normal revert of the pilot PR. Preserve the Project, task, report, and observability artifact until closeout evidence has been reviewed.

If runtime behavior, auth, schema, or production data changes become necessary, stop the pilot, reclassify the change, and create a remediation issue instead of continuing under Simple auto-approval.
