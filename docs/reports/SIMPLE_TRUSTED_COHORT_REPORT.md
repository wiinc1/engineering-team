# Simple Operator-Trusted Cohort Report

**Generated:** 2026-08-20T14:01:15.400Z
**Policy:** simple-trusted-cohort.v2
**Cohort:** simple-trusted-bullet-safe-20260820
**Revision:** `316e6c7c6cf030a0afa461e95603dcaafc5d0147`
**Source set:** `2429694b4d5de90d81720f1205a6e096a1448035e8152b00fee7a9cf14cb6a57`
**Issue:** GitLab #276 / factory autonomy Q1 bar

## Bar

| Metric | Target | Actual |
| --- | --- | --- |
| Trusted Simple closes | ≥ 6 | **6** |
| Autonomous delivery rate (trusted / closed) | ≥ 0.8 | **1** |
| Bar met | true | **true** |

## Definition of trusted close

- Factory delivery / closeout at `phase6_complete`
- Zero recorded manual interventions on closeout
- At least one live OpenClaw `specialist-delegation-*` session id in factory evidence (not fixture)
- Task class treated as Simple / low-risk cohort

## Trusted tasks

- `TSK-080`
- `TSK-081`
- `TSK-082`
- `TSK-083`
- `TSK-084`
- `TSK-085`

## All evaluated rows

| Task | Closed | Live sessions | Interventions | Trusted | Reasons if not |
| --- | --- | --- | --- | --- | --- |
| TSK-080 | true | 3 | 0 | true | — |
| TSK-081 | true | 3 | 0 | true | — |
| TSK-082 | true | 3 | 0 | true | — |
| TSK-083 | true | 3 | 0 | true | — |
| TSK-084 | true | 3 | 0 | true | — |
| TSK-085 | true | 3 | 0 | true | — |

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

- Q1 near-term bar is met for this evidence snapshot.

## Standards Alignment

- Applicable standards areas: architecture and design; coding and code quality; testing and quality assurance; deployment and release; observability and monitoring; team and process.
- Evidence expected for this change: immutable closeout, factory-delivery, hosted PR, human-review, and live OpenClaw evidence.
- Gap observed: legacy evidence discovery and projection ordering could omit valid provenance. Documented rationale: select an explicit clean cohort and reconcile only from authoritative task history (source https://github.com/wiinc1/engineering-team).

## Required Evidence

- Commands run: `npm run cohort:reconcile-closeouts`; `npm run cohort:simple-trusted`; `make verify`.
- Tests added or updated: cohort selection, factory-cohort discovery, report environment parsing, and governed report sections.
- Rollout or rollback notes: deploy the exact merged revision to staging; roll back by reverting the reporting commit without modifying source evidence.
- Docs updated: this generated cohort report and its SHA-256-addressed JSON snapshot.

## Provenance

- Generator: `scripts/build-simple-trusted-cohort-report.js`
- Inputs: 18
- Source-set SHA-256: `2429694b4d5de90d81720f1205a6e096a1448035e8152b00fee7a9cf14cb6a57`

| Input | SHA-256 | Bytes |
| --- | --- | --- |
| `observability/factory-closeout/TSK-080.json` | `3e0582671a137c877e1627df438ef527f4c4fd98f08a1783c957344e1921d63f` | 263807 |
| `observability/factory-closeout/TSK-081.json` | `d514abd29234573311d890ca80f16f42991cd15a01e88cbbd0f56a8fd4c3aa80` | 263680 |
| `observability/factory-closeout/TSK-082.json` | `4102af876fa7981baea85ab3028a1f949d0d289099d30d00e723fa06ac5e8bb3` | 263819 |
| `observability/factory-closeout/TSK-083.json` | `93d06baf69926d54b30c48011fa9dbf8226fb2ac7a411aacf43ee6cbc207f7b1` | 263829 |
| `observability/factory-closeout/TSK-084.json` | `f41108b4b85966a08e4045ea0c8668b44cdaf16ce337d63cba6fad05470f4ef4` | 263702 |
| `observability/factory-closeout/TSK-085.json` | `d1bf61d3f1e812a633991913414ec9b2656a263e8c0f17101302903ea7525395` | 263715 |
| `observability/factory-delivery/factory-cohort-bullet-safe-20260820-435.json` | `af9de1a9e1ab1254b1e4d4227fd0688983bce1ba6ec1cea11d87ead576750e92` | 1288911 |
| `observability/factory-delivery/factory-cohort-bullet-safe-20260820-436.json` | `80422d224b0bdff99502e9e7966b2f0e7b02f4d2efd79385877cbe7781545bf2` | 1288237 |
| `observability/factory-delivery/factory-cohort-bullet-safe-20260820-437.json` | `8598531094b4634a969908a283e222d921a622d39e2780a15c8ebc6fc3aabca8` | 1288944 |
| `observability/factory-delivery/factory-cohort-bullet-safe-20260820-438.json` | `c661d914dfb8a848bfed98bed752b9277088363bc4df7e4d7eb13517eb851f5d` | 1289066 |
| `observability/factory-delivery/factory-cohort-bullet-safe-20260820-439.json` | `090fb70f44185c74d120c1e387fd41a61113027dac2a2741d50516dfe6584b2e` | 1288412 |
| `observability/factory-delivery/factory-cohort-bullet-safe-20260820-440.json` | `85bfe4e70b7d16cf746ba83b0a198282878605d46ec46fb84ab417a798d2b52d` | 1288529 |
| `observability/trusted-simple-close/TSK-080.json` | `9ab291e1a03b14dd53f065723ff0ed5b694cbb31512b418b0fe8f4f76948a9f1` | 6282 |
| `observability/trusted-simple-close/TSK-081.json` | `02b73fe117b021b30a6d5b47cc1e3b29e986313e4560f24dd2d60e74108917b4` | 6250 |
| `observability/trusted-simple-close/TSK-082.json` | `43728456a42590849a0b32afc6590363e7c7d6b7407074f20579dcf1d570a2db` | 6274 |
| `observability/trusted-simple-close/TSK-083.json` | `5c6992df37749ef80df17af2f944bb9779223ee5895db06220a152429311ca6f` | 6292 |
| `observability/trusted-simple-close/TSK-084.json` | `9c3d91ffa4f61f8441636e61ea4b8213a8f6bf14d0e199688e6eec2cf8dd9b9b` | 6296 |
| `observability/trusted-simple-close/TSK-085.json` | `1e2c19b0320973ef6284e774a33113c56709b5886ddd1f8fb58de03f6e90418a` | 6312 |

