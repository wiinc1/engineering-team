# Autonomous Software Factory — Readiness Assessment

**Date:** 2026-07-10  
**Assessor context:** strategy-review / live milestone C+D proof session on coordinated stack  
**Status:** Evidence-based assessment (not a claim of “factory done”)  
**Primary goal reference:** operator-trusted progressive autonomy on a long-running coordinated stack  
(`docs/reports/FACTORY_AUTONOMY_DECISIONS.md`, `docs/product/software-factory-control-plane-prd.md`)

## Standards Alignment

- Applicable standards areas: architecture and design; testing and quality assurance; deployment and release; team and process.
- Evidence expected for this change: live milestone C/D completion artifacts; dual-remote policy and tip status; host runtime snapshot (OpenClaw live vs mocks); factory autonomy decisions and control-plane PRD.
- Gap observed: success metric cohort (≥10 Simple trusted closes) not run; Hermes remains mock; forge often skipped on local live path. Durable API+workers launchd stack shipped (#269); golden-path defaults live OpenClaw; Q6 human PM/Architect factory wiring landed. Documented rationale: progressive autonomy requires a reboot-safe factory of record and truthful live evidence before delivery-rate claims (source https://github.com/wiinc1/engineering-team/blob/main/docs/reports/FACTORY_AUTONOMY_DECISIONS.md).

## Required Evidence

- Commands run: live `verify-milestone-c-agent` / `verify-milestone-d-closeout` with `FACTORY_PROOF_PROFILE=live`; `node scripts/dual-remote-sync-status.js`; host health probes on `:13000`/`:18789`/`:14001`/`:14002`; `npm run coverage` for full GP-023 path.
- Tests added or updated: none required for this report-only assessment (prior live-proof unit coverage already shipped).
- Docs updated: this report; dual-remote mirror note in `docs/runbooks/dual-remote-gitlab-primary.md` when GitHub backup is synced.
- Rollout or rollback notes: assessment is documentation/evidence only; rollback by reverting the merge that introduced this file.

---

## 1. Executive summary

The project has a **real, scriptable delivery loop** on a **local coordinated stack**, with **live OpenClaw specialist sessions** proven through **milestone C and D** without fixture delegation and without skipping GP-023 validation (once coverage artifacts exist).

It does **not** yet meet the locked success bar for an autonomous software factory:

| Horizon (from decisions) | Bar | Status |
| --- | --- | --- |
| Near-term (~15 days) | ≥80% operator-trusted autonomous delivery on **≥10 closed Simple/low-risk tasks**, zero post-approval interventions | **Not met** — loop proven once; not 10 trusted closes |
| Factory of record | Always-on coordinated stack (Postgres + API + workers + UI + forgeadapter + **real** OpenClaw) | **Met for host stack (#269)** — `factory:stack:*` launchd KeepAlive for postgres-ensure, API, workers, UI, forgeadapter; compose Postgres `restart: unless-stopped` + volume; OpenClaw live launchd |
| Human gates | Human PM/Architect review before contract authority | **Partial → improved** — Q6 gate blocks agent-authored proposals without human acceptance; factory agent-driven phase1 records supervised human PM/Architect reviews on the contract |
| Real services | Live OpenClaw/Hermes/forge in the loop (not mocks) | **Partial → improved** — `dev:golden-path:up` defaults to live OpenClaw `:18789` (mock only with `--use-openclaw-mock`); Hermes mock remains; forge often skipped in local live proof |

**Overall readiness (goal attainment, not code maturity): ~45–55%.** (was ~35–45% pre #269 + gap closeout)

Local milestones A–D are **necessary proofs of the loop**. They remain **insufficient alone** for “we have an autonomous factory” (explicit in factory autonomy decisions).

---

## 2. Goal definition (what “done enough” means)

From accepted decisions (`FACTORY_AUTONOMY_DECISIONS.md`):

1. **Primary metric:** operator-trusted autonomous delivery rate (PRD).  
2. **Posture:** supervised progressive autonomy — automate middle; keep humans where policy demands.  
3. **Runtime of record:** long-running operator-hosted coordinated stack (not Vercel as factory host).  
4. **Near-term bar:** ≥10 Simple trusted closes with live evidence; live OpenClaw default; real GP-022 path; metrics on.  
5. **Non-goals for this assessment window:** multi-tenant SaaS SLA; multi-repo GP-024/025 automation; full unattended E2E for all classes.

Control-plane PRD still defines the product spine: intake → refinement → approval → implement → QA → SRE → closeout, with structured Execution Contracts and role projections.

---

## 3. Evidence base (what this assessment used)

### 3.1 Live proof artifacts (strong)

| Artifact | Finding |
| --- | --- |
| `observability/milestone-d-complete.json` (2026-07-10T17:01:46Z) | `summary.passed: true`; `exitCriteria.validationWithoutSkip: true`; 21 automated / 2 still-manual classification |
| Factory evidence `factory-milestone-c-mrf6h8wv` / task **TSK-020** | `status: phase6_complete`; **26** GP steps completed (GP-002…GP-027) |
| Real sessions | At least **3** live `specialist-delegation-*` sessionIds (implementer / smoke / QA path) |
| Profile | `coordinated-stack`, `baseUrl: http://127.0.0.1:13000` |
| Closeout | `observability/factory-closeout/TSK-020.json` |

### 3.2 Ship / dual-remote

| Item | Evidence |
| --- | --- |
| Live factory proof code path | Merged GitLab primary MRs !280–!285; GitHub backup PR **#299** merged |
| Policy | GitLab `origin` primary, GitHub `github` backup (`docs/runbooks/dual-remote-gitlab-primary.md`) |
| Sync status | **#270:** dual-remote tips equalized under AC1 bar (`remotes:sync-status` → `divergence.synced`; trees may match with forge-local merge SHAs). See `docs/runbooks/dual-remote-gitlab-primary.md` |

### 3.3 Runtime snapshot (this host, assessment time)

| Component | Observed |
| --- | --- |
| OpenClaw `:18789` | **Live** gateway; `launchd` `ai.openclaw.gateway` |
| OpenClaw mock `:14001` | Up (`openclaw-mock`, `realDelegation: false`) |
| Hermes mock `:14002` | Up |
| Audit API `:13000` | Up; process env includes live proof (`OPENCLAW_BASE_URL=…18789`, `FACTORY_PROOF_PROFILE=live`) |
| Audit workers | Long-lived `npm run audit:workers` process (not launchd) |
| forgeadapter `:14010` | Up |
| Postgres `:15432` | Open |
| Docker | **Not installed / not on PATH** — compose-based persistence unavailable on this host |

### 3.4 Inventory / classification

| Source | Finding |
| --- | --- |
| `observability/golden-path-manual-steps.json` | 27 supervised steps; inventory `summary` claims 25 automated / 2 manual (as of 2026-06-24 inventory metadata) |
| Closeout classification (TSK-020) | **21** automated, **2** still manual, **4** automated-pending |

---

## 4. Capability scorecard

Legend: **Works** = evidenced end-to-end on stack · **Partial** = code + some proof, gaps for operator-trusted bar · **Missing** = not productized / not evidenced

| Capability | Status | Evidence / gap |
| --- | --- | --- |
| Coordinated local stack boots | **Works** | `dev:golden-path:up` + `factory:stack:up`; live OpenClaw default |
| Postgres-backed audit / projections | **Works** (when workers up) | launchd workers reduce forgotten-worker lag |
| Factory delivery queue (Postgres) | **Works** | Live C/D ticks: intake → phase1 → phases_2_6 → phase6_complete |
| Live OpenClaw specialist delegation | **Works** (ET agent phases) | Real sessionIds; fail-closed live proof profile shipped |
| Fixture fail-closed under live profile | **Works** | Factory proof profile + unit tests; C/D used non-fixture runner |
| Agent implement / QA / fix loop (GP-014…019) | **Partial** | Session-proof vs **trusted delivery** prompts/enforcement split; trusted path forbids synthetic branch/PR JSON |
| GP-023 validation in loop | **Works** (with prep) | Full lint/unit/standards when `.artifacts/coverage-summary.json` present |
| GP-027 closeout report | **Works** | Closeout JSON + classification |
| Human PM/Architect review as authority | **Partial** | Gate enforces Q6 on agent proposals; factory path records human acceptance; cohort metric still missing |
| Real GitHub PR merge as default GP-022 | **Partial** | Code paths exist; local live proof often has no real PR target |
| forgeadapter full lifecycle in live proof | **Partial** | Service up; local live path commonly `STAGING_SKIP_FORGE_*` |
| Hermes real runtime | **Missing** | Mock only on `:14002` |
| Always-on host services (API/workers/DB/UI/forge) | **Works** (#269) | Full `factory:stack` launchd set + postgres ensure watcher; OpenClaw separate launchd |
| ≥10 Simple operator-trusted closes | **Missing** | Single-task proof (e.g. TSK-020), not cohort metric |
| Metrics MVP (delivery rate / interventions) | **Partial** | Metrics surfaces exist historically; not shown as live cohort dashboard for 10-task bar |
| Dual-remote primary/backup discipline | **Partial** | Policy + tooling; tips currently diverge |
| Vercel removed from factory claims | **Partial** | Decision locked; full purge not verified in this assessment pass |
| Multi-repo / external product delivery | **Missing** (deferred by Q4) | Explicitly out of near-term scope |

---

## 5. What works (keep and build on)

### 5.1 End-to-end factory orchestrator on coordinated stack

- Factory intake → execution contract path → agent-driven phases → closeout is **scriptable**.  
- Evidence: TSK-020 `phase6_complete`, 26 GP steps marked complete, D complete artifact green with `validationWithoutSkip: true`.

### 5.2 Live OpenClaw as truthful agent runtime for ET specialists

- Gateway live; implementer/QA (and smoke) produced real `specialist-delegation-*` sessionIds.  
- Live proof profile fails closed on missing sessions / fixture attribution.  
- Code path shipped (GitLab primary + GitHub #299).

### 5.3 Progressive autonomy spine in product/code

- Roles, contracts, QA fail/retest structure, SRE recording hooks, merge-readiness concepts, factory queue durability.  
- Control-plane PRD and factory decisions give a **coherent target**, not an ambiguous prototype.

### 5.4 Operator dual-remote policy

- GitLab primary / GitHub backup is documented and partially automated (`remotes:sync-status`).  
- Live-proof work was shipped GitLab-first then mirrored.

### 5.5 Local proof without hosted real-evidence coupling

- Local coordinated-stack live proof no longer requires hosted PR/real-evidence solely because `agentDrivenPhases` is on.  
- Important: local live proof ≠ hosted release proof; both modes must stay distinct.

---

## 6. What is partial (works, but not factory-grade)

### 6.1 Persistent stack (item 3) — **#269 complete**

| Have | Notes |
| --- | --- |
| `factory:stack:up/down/status/restart/accept` | One-script recovery after reboot or process kill |
| launchd KeepAlive: postgres-ensure, API, workers, UI, forgeadapter | Claim topology included when forgeadapter checkout present |
| Compose Postgres `restart: unless-stopped` + `factory_pgdata` volume | Survives container restarts; ensure watcher re-ups after reboot |
| OpenClaw via launchd `ai.openclaw.gateway` | Separate host unit on `:18789` |
| Acceptance audit | `npm run factory:stack:accept` / `factory:stack:verify` |

**Risk residual:** Docker/OrbStack engine itself must be installed for compose path; without Docker, an external `:15432` listener is still required.

### 6.2 Real services vs mocks (item 4) — improved

| Real today | Still mock / skipped |
| --- | --- |
| OpenClaw `:18789` **default** for `dev:golden-path:up` and factory stack | OpenClaw mock `:14001` only with `--use-openclaw-mock` |
| forgeadapter process | Hermes `:14002` mock |
| Live C/D agent sessions | Full forge seed/start/review often **skipped** for local live proof |

**Risk residual:** Hermes + forge still incomplete for full claim topology; mock path remains for isolated smoke only.

### 6.3 “Autonomous delivery” vs “agent session proof” — improved labeling

Live C/D proves:

- agents can be invoked,  
- sessions are attributed,  
- the factory queue advances phases.

It does **not** yet prove:

- real code change in a target repo,  
- real PR merge under branch protection as the normal path,  
- zero human intervention after approval on a **cohort** of tasks.

Implementer prompts now distinguish **SESSION PROOF ONLY** vs **TRUSTED DELIVERY** (synthetic forbidden + real artifact assertion when `requireRealEvidence` / trusted flags are set).

### 6.4 Dual-remote content drift

`remotes:sync-status` reported primary/backup **not synced** (unique merge commits on each side). Policy is right; execution hygiene slipped after multi-MR ship. Factory claims should cite **GitLab primary** as canonical until tips are equalized.

### 6.5 Automation inventory honesty

Closeout reports **21 automated / 2 still manual / 4 automated-pending**. That is progress against 27 steps, but “automated” in inventory is not the same as “unattended in production with human policy satisfied.”

---

## 7. What is missing (must build or explicitly defer)

### 7.1 Must build for near-term success bar (~15-day decision pack)

1. **Persistent stack on this host** (item 3)  
   - launchd (or Docker once installed) for: Postgres, audit API, workers, forgeadapter, UI  
   - one `factory:stack:up|down|status|restart` contract with health probes  

2. **Default real OpenClaw in stack topology** (item 4)  
   - stop treating `:14001` mock as default for factory claims  
   - document/fail closed if live gateway down under `FACTORY_PROOF_PROFILE=live`  

3. **Real Hermes decision**  
   - wire real Hermes **or** declare Hermes non-critical and remove mock dependency from claim paths  

4. **Forge real-or-redesign**  
   - either live OpenClaw child-session protocol for forgeadapter, **or** factory delivery that does not require forge for Simple class  

5. **Operator-trusted Simple cohort**  
   - ≥10 closed Simple tasks with: live sessions, real PR/checks when class requires, recorded human PM/Architect reviews when required, intervention log = empty post-approval  

6. **Metrics MVP for the success bar**  
   - trusted close count, intervention count, first-pass QA, fixture vs live proof rate  

### 7.2 Explicitly deferred (do not pretend missing = urgent)

- Multi-repo / GP-024–025 product automation  
- Continuous multi-tenant SaaS SLA  
- Unattended closeout for all classes  
- Full analytics platform beyond MVP  

### 7.3 Assessment document debt (this item — closed by this report)

This file is the exhaustive readiness assessment requested as item 5. It should be updated when:

- persistent stack ships,  
- mock ports are removed from claim path,  
- 10-task trusted cohort exists.

---

## 8. Prioritized roadmap (evidence-driven)

### P0 — Make the factory of record real on this host

| Priority | Work | Unblocks |
| --- | --- | --- |
| P0.1 | Persistent stack (launchd and/or Docker+compose) for API, workers, Postgres | Reliable C/D and multi-task cohort |
| P0.2 | Equalize dual-remote tips (GitLab primary catch-up / mirror) | Honest “main” claims |
| P0.3 | Stack defaults: live OpenClaw URL in stack env, not only verify client | Stop mock false greens |

### P1 — Replace remaining proof mocks / incomplete real paths

| Priority | Work | Unblocks |
| --- | --- | --- |
| P1.1 | Hermes real or explicit de-scope | Clean topology |
| P1.2 | Forge live integration or Simple-class forge-optional policy | Full GP-010… lifecycle honesty |
| P1.3 | Real PR/merge path for Simple trusted closes (not synthetic JSON) | Success metric validity |

### P2 — Hit the success bar

| Priority | Work | Unblocks |
| --- | --- | --- |
| P2.1 | Human PM/Architect review gate product flow + evidence | Decision Q6 compliance |
| P2.2 | Metrics MVP + run **≥10** Simple trusted closes | Near-term bar |
| P2.3 | Vercel purge verification pass | Topology decision Q3 |

### P3 — Expand class / multi-repo (after P2 green)

- Standard class specialist refinement with human review  
- One external pilot repo  

---

## 9. Honest answers to the three follow-on items

### Item 3 — Make the stack persistent

**Status: done (#269).**  
`factory:stack:*` installs launchd KeepAlive for postgres-ensure, audit API, workers, UI, and forgeadapter (when checkout exists). Postgres compose uses `restart: unless-stopped` + persistent volume. OpenClaw remains separate launchd. Acceptance: `npm run factory:stack:accept`.

**Why it matters for the goal:** always-on workers and API are part of the factory of record definition; without them, projection lag and manual resurrection remain interventions.

### Item 4 — Replace proof mocks with real services

**Status: partial (OpenClaw default fixed).**  
**Real OpenClaw is stack default** (`:18789`). Mock is opt-in only. **Hermes mock remains.** **Forge is real as a process but optional/skipped in local live proof.** Trusted-delivery implementer path forbids synthetic PR evidence.

**Why it matters for the goal:** fixture/mock-free claims are a prerequisite for operator-trusted delivery rate; dual mock+live topology was an operator footgun.

### Item 5 — Exhaustive assessment

**Status: delivered by this document.**  
Evidence is current as of 2026-07-10 live C/D and host runtime snapshot. Re-score after P0 stack persistence and a 10-task cohort.

---

## 10. Recommended next action (single sequence)

1. **Done (partial):** P0.1 API+workers launchd; P0.3 live OpenClaw stack default; Q6 factory human gate wiring; trusted vs session implementer prompts.  
2. **P0.2** — Keep dual-remote tips equalized (GitLab primary).  
3. **P1** — Hermes real-or-descope; forge live integration or Simple forge-optional policy.  
4. **P2** — Run and instrument **≥10 Simple** trusted closes (real PR path + measured human gates).  
5. **Re-issue this assessment** after the 10-task cohort.

---

## 11. Appendix — key paths

| Kind | Path |
| --- | --- |
| Decisions | `docs/reports/FACTORY_AUTONOMY_DECISIONS.md` |
| Control-plane PRD | `docs/product/software-factory-control-plane-prd.md` |
| Live proof REQ | `docs/refinement/REQ-live-factory-proof-default-openclaw.md` |
| Golden-path runbook | `docs/runbooks/golden-path-autonomous-delivery.md` |
| Dual-remote | `docs/runbooks/dual-remote-gitlab-primary.md` |
| Factory stack (#269) | `scripts/factory-stack.js`, `scripts/factory-stack-postgres-watch.js`, `scripts/verify-factory-stack-acceptance.js`, `lib/task-platform/factory-stack/*`, runbook § Durable factory stack |
| Human PM/Architect gate | `lib/audit/pm-architect-human-review-gate.js`, `lib/task-platform/factory-human-pm-architect.js` |
| D complete | `observability/milestone-d-complete.json` |
| Closeout | `observability/factory-closeout/TSK-020.json` |
| Step inventory | `observability/golden-path-manual-steps.json` |

---

## 12. Standards alignment (see top of document)

The required `## Standards Alignment` and `## Required Evidence` sections appear at the top of this report for `scripts/verify-standards.js` compliance.
