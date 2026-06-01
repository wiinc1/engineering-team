# Execution Contract Refinement Runbook

## Scope

This runbook covers issue #152: turning an Intake Draft into a structured,
reviewed, approved, and dispatch-ready Execution Contract while preserving the
same Task ID and append-only audit history.

Authoritative references:
- API: `docs/api/execution-contract-refinement-openapi.yml`
- Workflow diagram: `docs/diagrams/workflow-execution-contract-refinement.mmd`
- Schema diagram: `docs/diagrams/schema-execution-contract-refinement.mmd`
- Architecture diagram: `docs/diagrams/architecture-execution-contract-refinement.mmd`
- Dashboard: `monitoring/dashboards/execution-contract-refinement.json`
- Alerts: `monitoring/alerts/execution-contract-refinement.yml`

## Happy Path

1. Confirm the task is an Intake Draft in `DRAFT`, assigned to PM, and still
   tied to the original Task ID.
2. Intake Draft creation auto-starts PM refinement. The workflow records
   `task.refinement_started` and either `task.refinement_completed` with
   `agent_id`, OpenClaw `session_id`, delegation artifact path, and truthful
   runtime attribution, or `task.refinement_failed` with the runtime fallback
   reason.
3. If an existing Intake Draft is still pending refinement, PM/admin can retry
   with `POST /api/v1/tasks/{taskId}/refinement/start`.
4. PM creates or updates the contract with `POST /api/v1/tasks/{taskId}/execution-contract`
   and selected `templateTier`.
5. The reviewer routing policy selects required reviewers from template tier and
   risk flags:
   - Architect, UX, and QA for Standard, Complex, and Epic contracts.
   - SRE for deployment, observability, reliability, auth, data, or production
     behavior risk.
   - Principal Engineer for high-risk engineering, security, auth, or Principal
     trigger conditions.
6. Reviewers record section-level contribution or approval through
   `POST /api/v1/tasks/{taskId}/execution-contract/{version}/sections/{sectionId}/review`.
7. PM validates the latest version, generates the Markdown review view, and
   resolves any blocking question cluster.
8. Operator Approval commits the current latest version through
   `POST /api/v1/tasks/{taskId}/execution-contract/approve`.
9. Generate the verification report skeleton when required, then generate and
   approve reviewable repo artifacts.
10. Confirm Task detail shows the latest approved contract, reviewer statuses,
   non-blocking comments, committed scope, and dispatch readiness.

## Blocking Conditions

- `stale_execution_contract_review`: reviewer targeted a version that is not the
  latest contract version. Reload the Task detail projection and submit against
  the latest version.
- `execution_contract_approval_blocked`: at least one required reviewer approval
  is missing or a blocking question is unresolved. Resolve the decision cluster
  before retrying approval.
- `execution_contract_auto_approval_blocked`: low-risk Simple policy approval
  was requested but eligibility failed. Record explicit Operator Approval.
- `artifact_bundle_approval_blocked`: PM, section-owner, or operator approval is
  missing for generated artifacts.
- `pm_refinement_already_started`: a start event exists without a later failed
  or completed event. Inspect runtime logs and task history before retrying.
- `task.refinement_failed`: runtime delegation did not produce verified PM
  ownership. Check `fallback_reason`, `delegation_artifact_path`, and
  `SPECIALIST_DELEGATION_RUNNER` configuration before retrying.

## Material Changes After Approval

Section reviews, section payload changes, reviewer routing changes, review
feedback, risk flags, provenance references, and scope boundary changes are
material. If any of these happen after Operator Approval, the workflow records a
new `task.execution_contract_version_recorded` event. The prior approval remains
historical evidence for its version only; implementation dispatch stays blocked
until the new latest version is approved or policy auto-approval is eligible.

## Verification

Run the focused local checks first:

```bash
node --test tests/unit/execution-contract-refinement.test.js
node --test tests/contract/execution-contract-refinement.contract.test.js
node --test tests/security/execution-contract-refinement.security.test.js
```

Before merge, run the issue-required matrix:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:contract
npm run test:e2e
npm run test:ui
npm run test:browser
npm run test:security
npm test
```

## Monitoring

Use the Execution Contract Refinement dashboard to watch:
- `feature_execution_contract_section_reviews_total`
- `feature_execution_contract_material_versions_total`
- `feature_execution_contract_auto_approvals_total`
- `feature_execution_contract_auto_approval_blocked_total`
- `feature_operator_trusted_autonomous_delivery_rate`
- `workflow_projection_lag_seconds`
- `workflow_audit_write_failures_total`

Investigate alerts by checking recent task history for
`task.execution_contract_version_recorded`, `task.execution_contract_approved`,
`task.execution_contract_verification_report_generated`, and
`task.execution_contract_artifact_bundle_approved`.

## Rollback

Disable reviewer section submissions by routing operators back to the PM-owned
`POST /tasks/{id}/execution-contract` versioning endpoint. Existing audit events
remain immutable and readable. Revert the issue #152 code and docs change if the
versioned section-review route itself must be removed.
