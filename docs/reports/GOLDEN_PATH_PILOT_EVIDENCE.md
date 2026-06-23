# Golden Path Pilot Evidence

**Status:** Phases 0–6 complete on **local Postgres golden-path stack** (GP-026 SRE monitoring executed in phase 5)
**Epic issue:** https://github.com/wiinc1/engineering-team/issues/269  
**Pilot issue:** https://github.com/wiinc1/engineering-team/issues/271  
**Pilot task ID:** `TSK-D54F1849` (Postgres golden-path stack)  
**Project ID:** `PRJ-95FA1A5E` (Postgres golden-path stack)  
**Forge task ID:** `TSK-GOLDEN001`  
**Canonical evidence:** `observability/golden-path-postgres-pilot.json` (`phase6_complete`, GP-001–GP-027)

## Decision

The supervised golden-path epic is **proven locally end-to-end** on the coordinated dev stack (`npm run dev:golden-path:up`):

- Docker Postgres on port **15432**
- ET audit API on **13000** with registration auth + seeded admin
- ET UI (Vite) on **15173** with email/password sign-in
- forgeadapter on **14010** with OpenClaw/Hermes mocks

Phase 0–1 intake and execution-contract artifacts were created against the **Postgres-backed audit API**. Phase 1 recorded Simple execution contract **v1** with `forge_dispatch` targeting `wiinc1/engineering-team`, policy auto-approval (`execution-contract-low-risk-simple-auto-approval.v1`), and architect tier/monitoring embedded in contract dispatch signals.

Phases 2–6 exercised forgeadapter lifecycle (start → QA reject → resume → gate approvals → complete), intentional QA fail/retest pass, SRE monitoring window (GP-026 in phase 5), PM + Architect close review, local validation, human close approval, and `task.closed`. The operator can sign in at `http://127.0.0.1:15173/sign-in` and view the closed pilot task in the UI.

An earlier **file-backend** replay (`TSK-526A02DE`, `observability/golden-path-pilot.json`) remains as prior art for fast isolated proofs; Postgres replay is the canonical operator experience.

## Standards Alignment

- Applicable standards areas: testing and quality assurance, deployment and release, observability and monitoring, team and process.
- Evidence in this report: golden-path phase runners, Postgres pilot evidence JSON, manual-step classifications, validation command output, forge lifecycle jobs, UI sign-in verification, and closeout events for issue #271.
- Gap observed: GP-013 OpenClaw delegation smoke remains optional on local replay. Documented rationale: local replay uses OpenClaw/Hermes mocks for speed; use `--require-delegation-smoke` with real runtime URLs for live delegation proof. Source https://github.com/wiinc1/engineering-team/issues/269.

## Required Evidence

- Commands run: `npm run dev:golden-path:up`; `npm run golden-path:replay:postgres -- --from 2 --to 6`; `npm run lint`; `npm run test:unit`; `npm run standards:check`
- Tests added or updated: `tests/unit/golden-path-phase1.test.js`; phase-runner QA projection catch-up retry for Postgres workflow gates.
- Rollout or rollback notes: rollout via pilot branch/PR #271; rollback by reverting README marker and golden-path evidence commits. Preserve Postgres data across stack restarts with `npm run dev:golden-path:down -- --keep-postgres`.
- Docs updated: `docs/reports/GOLDEN_PATH_PILOT_EVIDENCE.md`, `docs/runbooks/golden-path-autonomous-delivery.md`, `observability/golden-path-postgres-pilot.json`, `README.md` golden-path marker.

## Blockers

| Blocker | Classification | Remediation |
| --- | --- | --- |
| Production `seed-golden-path-phase0` 500 (`tenant/user postgres... not found`) | operator intervention | Use production operator JWT (browser session or prod env file), not local `.env.local` secret |
| `forge-execution-readiness` 422 while task stage is `DRAFT` | routine observation | Expected until GP-009 workflow advancement; contract is approved with `forge_dispatch` |
| GP-013 delegation smoke skipped | routine observation | Re-run with `--require-delegation-smoke` and real OpenClaw/Hermes URLs |

## Manual action log (Postgres replay)

| Timestamp (UTC) | Step ID | Action | Classification | Location | Reason |
| --- | --- | --- | --- | --- | --- |
| 2026-06-23T16:30Z | GP-002 | Postgres ET task `TSK-D54F1849` + intake from #271 | operator intervention | `run-golden-path-phase1.js --bootstrap` | Phase 0/1 bootstrap against local Postgres API |
| 2026-06-23T16:30Z | GP-005 | Project `PRJ-95FA1A5E` linked to task | operator intervention | Postgres audit API | Pilot project bootstrap |
| 2026-06-23T16:30Z | GP-008 | Policy auto-approval recorded (`approvalMode=policy`) | required approval | execution-contract approve | Low-risk Simple docs pilot |
| 2026-06-23T16:34Z | GP-009 | Seeded `TSK-GOLDEN001` + `forge-execution-readiness` HTTP 200 | operator intervention | Postgres ET API | Forge seed for lifecycle |
| 2026-06-23T16:34Z | GP-011 | `POST /tasks/TSK-GOLDEN001/start` job `job_0001` | operator intervention | forgeadapter harness | Runtime `running` |
| 2026-06-23T16:34Z | GP-014 | Engineer submission v1 + stage advance to QA path | operator intervention | ET API | Commit `2207097…` PR #271 |
| 2026-06-23T16:35Z | GP-015 | QA intentional fail `qa-27ab7158` (retry after projection catch-up) | required approval | ET API | README marker absent by design |
| 2026-06-23T16:35Z | GP-016 | Forge QA review rejected → `revision_required` | operator intervention | forgeadapter | Review-request bridge |
| 2026-06-23T16:36Z | GP-017 | README golden-path marker present | operator intervention | README.md | Docs-only deliverable |
| 2026-06-23T16:36Z | GP-018 | `POST /tasks/TSK-GOLDEN001/resume` | operator intervention | forgeadapter | Resume after reject |
| 2026-06-23T16:36Z | GP-019 | QA retest pass | required approval | ET API | Fix commit `7e3e3b5…` |
| 2026-06-23T16:36Z | GP-020 | Forge gates approved + complete `job_0011` | operator intervention | forgeadapter | `executionState=completed` |
| 2026-06-23T16:36Z | GP-021 | ET PM + Architect close-review recorded | required approval | ET API | Close review while in PM_CLOSE_REVIEW |
| 2026-06-23T16:36Z | GP-022 | `task.github_pr_synced` for PR #271 | operator intervention | Postgres ET API | Merge SHA `7e3e3b5c596210b5310244592ca9e7ad503404e5` |
| 2026-06-23T16:36Z | GP-023 | `lint`, `test:unit`, `standards:check` green | routine observation | engineering-team | Local deploy validation (GP-023 complete) |
| 2026-06-23T16:36Z | GP-026 | SRE monitoring start + approve in phase 5 (`SRE_MONITORING` window) | routine observation | Postgres ET API | Executed before PM close review advance |
| 2026-06-23T16:36Z | GP-027 | Human close approve + `task.closed` | required approval | Postgres ET API | Task `TSK-D54F1849` closed; UI verified |

## Validation summary

- `npm run dev:golden-path:up` → audit API, UI, forgeadapter healthy
- Browser sign-in at `http://127.0.0.1:15173/sign-in` (`admin@golden-path.local`) → task list shows `TSK-D54F1849` **DONE**
- `observability/golden-path-postgres-pilot.json` → `phase6_complete`, GP-001–GP-027
- `forge-execution-readiness` for `TSK-GOLDEN001` → HTTP 200 on Postgres stack
- Forge lifecycle → `revision_required` after QA reject, resume, gate approvals, `completed`
- `npm run lint` / `npm run test:unit` / `npm run standards:check` → green during GP-023

## Automation gaps observed

| Step | Gap |
| --- | --- |
| GP-003 | PM refinement still requires runtime delegate or operator-triggered `/refinement/start` |
| GP-007 | Postgres projection catch-up between gates (mitigated in phase runner with retry) |
| GP-009 → GP-011 | **Bridged** via `et-forge-dispatch-bridge.js` when `ET_FORGE_DISPATCH_ENABLED=true` |
| GP-013 | OpenClaw delegation smoke remains optional (`--skip-delegation-smoke`) |
| GP-016 | **Bridged** via `et-forge-dispatch-bridge.js` on initial QA fail (forge QA reject) |
| GP-018 | **Bridged** via `et-forge-dispatch-bridge.js` on engineer submission v2 (forge resume) |
| GP-020 → GP-021 | **Bridged** via `et-forge-dispatch-bridge.js` on QA retest pass (forge gates + ET close recommendations) |
| GP-020/GP-021 | ET close review and forge gates are parallel manual systems |
| GP-023 | Wire CI validation on merge (local proof scripted in phase 6) |
| GP-026 | SRE monitoring now runs in phase 5 before `PM_CLOSE_REVIEW` advance |

## Required evidence checklist

- [x] GitHub issue URL
- [x] ET task + Project IDs (`TSK-D54F1849`, `PRJ-95FA1A5E`)
- [x] Execution contract version + approval mode
- [x] forge-execution-readiness HTTP 200 capture
- [x] forgeadapter start job + runtime projection
- [x] QA fail + retest pass events
- [x] Forge gate approvals + complete job
- [x] PR URL + merge SHA (`7e3e3b5c596210b5310244592ca9e7ad503404e5`)
- [x] Operator UI sign-in + closed task visible in browser
- [x] GP-023 local deploy validation (`lint`, `test:unit`, `standards:check`)
- [x] GP-026 SRE monitoring + human closeout events
- [x] `observability/golden-path-postgres-pilot.json` committed
- [x] `task.closed` event recorded

## Prior art: file-backend replay

| Field | Value |
| --- | --- |
| Pilot task | `TSK-526A02DE` |
| Project | `PRJ-6424A918` |
| Evidence | `observability/golden-path-pilot.json` |
| Merge SHA | `eb7b7e924bd2eec24d15320dbb4bd95b595e2578` |

Use the file-backend path only for fast isolated proofs without UI/forgeadapter fidelity.