# Factory Gap Resolution Plan (2026-07-13)

Source: readiness assessment scorecard + epic #278 remaining children.

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
