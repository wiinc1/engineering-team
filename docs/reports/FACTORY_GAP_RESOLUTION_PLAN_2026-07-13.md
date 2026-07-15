# Factory Gap Resolution Plan (2026-07-13)

Source: readiness assessment scorecard + epic #278 remaining children.

## Standards Alignment

- Applicable standards areas: architecture and design governance; testing and quality assurance; deployment and release evidence; team and process traceability.
- Evidence expected for this change: the readiness assessment scorecard, the remaining child issues under epic #278, dual-remote synchronization evidence, trusted-close cohort evidence, and an updated assessment after the listed gaps are resolved.
- Gap observed: factory readiness still has unresolved hosting, remote synchronization, trusted-close cohort, and reassessment work. Documented rationale: the factory cannot claim the locked autonomy bar until its system of record and live evidence meet the accepted exit criteria (source http://192.168.1.116/wiinc1/engineering-team/-/work_items/278).

## Required Evidence

- Commands run: `npm run standards:check`; issue-specific verification commands are recorded by each linked child issue.
- Tests added or updated: none for this planning-only report; automated evidence belongs to issues #276, #277, and #279 and the assessment re-score.
- Rollout or rollback notes: no runtime rollout occurs from this report; rollback is reverting this documentation change without changing factory state.
- Docs updated: this gap-resolution plan and, at exit, the readiness assessment and epic #278 status.

## Gaps in scope (resolve)

| Gap | Issue | Resolution approach |
| --- | --- | --- |
| Vercel as factory claim host | #277 | Verify purge; active docs/CI must not treat Vercel as factory of record; historical reports labeled residual |
| Dual-remote MVP + tip sync | #279 + operational | Mirror agent already shipped; equalize tips; close #279 |
| Metrics MVP + ≥10 Simple trusted closes | #276 | Cohort evaluator + report; metrics from closeouts/live evidence; expand live cohort when stack allows |
| Assessment re-score | #278 exit | Update scorecard after above |

## Explicitly out of scope (unchanged deferred)

- Multi-repo / GP-024–025 product automation (Q4)
- Multi-tenant SaaS SLA
- Building real Hermes runtime (de-scoped #272)

## Exit criteria

1. #277 closed with verification checklist
2. #279 closed or residual ops-only note; remotes content-synced under #270 bar after mirror
3. #276: metrics/cohort tooling shipped; report under `docs/reports/` or `observability/` against ≥10 / ≥80% bar; honest residual if live cohort count still &lt;10
4. Assessment updated; epic #278 status reflects remaining residual only
