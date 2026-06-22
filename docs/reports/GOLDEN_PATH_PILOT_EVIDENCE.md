# Golden Path Pilot Evidence

**Status:** Phase 0 started (local bootstrap); production ET seed pending operator credentials  
**Epic issue:** https://github.com/wiinc1/engineering-team/issues/269  
**Pilot issue:** https://github.com/wiinc1/engineering-team/issues/271  
**Pilot task ID:** `TSK-458D32A2` (local script proof; recreate on production)  
**Project ID:** `PRJ-7B7977DD` (local script proof; recreate on production)  
**Forge task ID:** `TSK-GOLDEN001` (suggested)

## Decision

Phase 0 intake artifacts created. Production API bootstrap failed with Postgres tenant resolution (`ENOTFOUND`); local file-backend bootstrap succeeded via `node scripts/seed-golden-path-phase0.js --local`. Operator must rerun without `--local` using production-capable JWT/session before Phase 1 contract work on Vercel.

## Blockers

| Blocker | Classification | Remediation |
| --- | --- | --- |
| Production `seed-golden-path-phase0` 500 (`tenant/user postgres... not found`) | operator intervention | Use production operator JWT (browser session or prod env file), not local `.env.local` secret |
| PR #270 not merged | required approval | Merge runbook PR before pilot implementation PR |

## Manual action log

| Timestamp (UTC) | Step ID | Action | Classification | Location | Reason |
| --- | --- | --- | --- | --- | --- |
| 2026-06-22T23:10Z | GP-001 | Created pilot issue #271 | required approval | GitHub | Child task for golden-path deliverable |
| 2026-06-22T23:10Z | GP-002 | Local ET task `TSK-458D32A2` + intake description from #271 | operator intervention | `seed-golden-path-phase0.js --local` | Production API rejected local JWT tenant mapping |
| 2026-06-22T23:11Z | GP-005 | Local project `PRJ-7B7977DD` linked to task | operator intervention | local file API | Proof of bootstrap script; not production persistence |
| | GP-003 | | | | |
| | GP-004 | | | | |
| | GP-005 | | | | |
| | GP-006 | | | | |
| | GP-007 | | | | |
| | GP-008 | | | | |
| | GP-009 | | | | |
| | GP-010 | | | | |
| | GP-011 | | | | |
| | GP-012 | | | | |
| | GP-013 | | | | |
| | GP-014 | | | | |
| | GP-015 | | | | |
| | GP-016 | | | | |
| | GP-017 | | | | |
| | GP-018 | | | | |
| | GP-019 | | | | |
| | GP-020 | | | | |
| | GP-021 | | | | |
| | GP-022 | | | | |
| | GP-023 | | | | |
| | GP-026 | | | | |
| | GP-027 | | | | |

## Validation summary

Pending.

## Automation gaps observed

Pending — compare completed steps against `observability/golden-path-manual-steps.json`.

## Required evidence checklist

- [ ] GitHub issue URL
- [ ] ET task + Project IDs
- [ ] Execution contract version + approval mode
- [ ] forge-execution-readiness HTTP 200 capture
- [ ] forgeadapter start job + runtime projection
- [ ] QA fail + retest pass events
- [ ] Forge gate approvals + complete job
- [ ] PR URL, merge SHA, Vercel deployment
- [ ] SRE approval + closeout events
- [ ] `observability/golden-path-pilot.json` committed