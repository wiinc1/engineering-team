# Simple Operator-Trusted Cohort Report

**Generated:** 2026-07-13T15:33:44.198Z
**Policy:** simple-trusted-cohort.v1
**Issue:** GitLab #276 / factory autonomy Q1 bar

## Standards Alignment

- Applicable standards areas: testing and quality assurance; observability and evidence provenance; deployment and release claims; team and process governance.
- Evidence expected for this change: deterministic `simple-trusted-cohort.v1` evaluation, versioned closeout and live-session inputs, aggregate metric output, and explicit reporting when the locked cohort size or delivery-rate target is not met.
- Gap observed: only 6 trusted Simple closes were evidenced and the evaluated cohort delivery rate was 0.6667, below the targets of 10 closes and 0.8. Documented rationale: autonomy claims require live specialist-session evidence and zero post-approval interventions for every trusted close (source http://192.168.1.116/wiinc1/engineering-team/-/work_items/276).

## Required Evidence

- Commands run: `npm run cohort:simple-trusted`; `npm run standards:check`.
- Tests added or updated: existing evaluator coverage is in `tests/unit/simple-trusted-cohort.test.js`; this generated report adds no runtime test.
- Rollout or rollback notes: this is an evidence report and performs no rollout; regenerate it from canonical closeout evidence or revert the report and generated JSON together.
- Docs updated: this cohort report; machine-readable evidence is `observability/trusted-simple-close/cohort-report.json`.

## Bar

| Metric | Target | Actual |
| --- | --- | --- |
| Trusted Simple closes | ≥ 10 | **6** |
| Autonomous delivery rate (trusted / closed) | ≥ 0.8 | **0.6667** |
| Bar met | true | **false** |

## Definition of trusted close

- Factory delivery / closeout at `phase6_complete`
- Zero recorded manual interventions on closeout
- At least one live OpenClaw `specialist-delegation-*` session id in factory evidence (not fixture)
- Task class treated as Simple / low-risk cohort

## Trusted tasks

- `TSK-013`
- `TSK-014`
- `TSK-015`
- `TSK-016`
- `TSK-019`
- `TSK-020`

## All evaluated rows

| Task | Closed | Live sessions | Interventions | Trusted | Reasons if not |
| --- | --- | --- | --- | --- | --- |
| TSK-007 | true | 0 | 0 | false | missing_live_session_evidence |
| TSK-008 | true | 0 | 0 | false | missing_live_session_evidence |
| TSK-010 | true | 0 | 0 | false | missing_live_session_evidence |
| TSK-013 | true | 4 | 0 | true | — |
| TSK-014 | true | 4 | 0 | true | — |
| TSK-015 | true | 4 | 0 | true | — |
| TSK-016 | true | 4 | 0 | true | — |
| TSK-019 | true | 4 | 0 | true | — |
| TSK-020 | true | 4 | 0 | true | — |
| TSK-022 | false | 0 | 0 | false | not_phase6_complete, missing_live_session_evidence |

## Metrics MVP (aggregate of trusted signals)

```json
{
  "total_signals": 6,
  "included_signals": 6,
  "known_signals": 6,
  "unknown_signals": 0,
  "closed_signals": 6,
  "autonomous_deliveries": 6,
  "autonomous_delivery_rate": 1,
  "operator_interventions_total": 0,
  "operator_intervention_rate": 0,
  "qa_sre_rework_total": 0,
  "qa_sre_rework_rate": 0,
  "rollback_total": 0,
  "rollback_rate": 0,
  "escaped_defects_total": 0,
  "escaped_defect_rate": 0,
  "policy_auto_approved_total": 0,
  "policy_auto_approval_rate": 0
}
```

## Artifacts

- JSON: `observability/trusted-simple-close/cohort-report.json`

## Residual

- Bar not met: need 4 more trusted Simple closes with live session evidence.
