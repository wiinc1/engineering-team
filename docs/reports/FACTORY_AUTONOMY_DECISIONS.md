# Factory Autonomy Decisions (Accepted)

**Date:** 2026-07-08  
**Status:** Accepted by operator (strategy-review session)  
**Source analysis:** factory gap analysis / roadmap against progressive autonomy PRD  

## Standards Alignment

- Applicable standards areas: architecture and design; testing and quality assurance; deployment and release; team and process; authentication and secret handling.
- Evidence in this document: progressive autonomy product decisions, coordinated-stack runtime topology, operator-trusted delivery metric bar, and human PM/Architect review requirements on agent disagreement.
- Gaps or exceptions: live OpenClaw-as-default factory proof remains follow-up work tracked in `docs/refinement/REQ-live-factory-proof-default-openclaw.md`.

## Required Evidence

- Commands run: targeted unit tests for human review gate, auth config residual cleanup, forge bridge restoration, ownership map lint, and `node scripts/verify-standards.js`.
- Tests added or updated: `tests/unit/pm-architect-human-review-gate.test.js`, auth/deploy residual tests, release-artifact CLI CI env isolation.
- Docs updated: this report, `docs/product/software-factory-control-plane-prd.md`, `docs/architecture.md`, `docs/refinement/REQ-live-factory-proof-default-openclaw.md`.
- Rollout or rollback notes: factory claims use coordinated stack only; rollback by reverting the PR merge on `main`.

These answers lock sequencing for the autonomous software factory work. They supersede open clarifying questions in the gap analysis for planning purposes.

---

## Decision pack (locked)

### Q1 — Success metric bar — **Accepted as recommended**

Primary success metric remains **operator-trusted autonomous delivery rate** (PRD).

| Horizon | Bar |
| --- | --- |
| Near-term (**~15 days**, see Q5) | ≥80% operator-trusted autonomous delivery on **≥10 closed Simple/low-risk tasks** in the factory runtime of record, with **zero post-approval operator interventions** (PRD definition) |
| Medium-term (**~45 days**) | Same metric for **Simple + selected Standard** classes; track first-pass QA rate and intervention rate via metrics MVP |
| Explicit non-goal for “factory done” | Continuous multi-tenant SaaS SLA until long-running factory hosting is productized |

Local milestones A–E remain necessary proofs of the loop; they are **not** sufficient alone for “we have an autonomous factory.”

---

### Q2 — Autonomy posture — **Accepted as recommended**

**Supervised progressive autonomy** (PRD default):

- Keep required human approvals where policy demands (see Q6).
- Automate the middle: dispatch, implement/QA/fix, evidence, merge when checks pass, SRE recording when signals green.
- **Out of near-term scope:** full unattended E2E for all task classes; coding-factory-without-control-plane pivot.

---

### Q3 — Runtime / hosting of record — **Accepted as recommended + Vercel removed**

| Layer | Decision |
| --- | --- |
| Factory of record | **Long-running operator-hosted coordinated stack**: Postgres + audit API + workers + UI + forgeadapter + real OpenClaw |
| Factory green claims | Only against that topology (same family as `dev:golden-path:up` / milestones A–E), preferably always-on |
| **Vercel** | **Not part of the factory tech stack. Remove Vercel from the stack** (deployment config, docs claims, pilot topology, and any path that treats Vercel as factory or primary production host for this product). Do not use Vercel for factory proof or as the system of record runtime. |
| Supabase as factory platform | Not the factory platform (aligned with milestone notes); managed Postgres may remain as *data* backend only if explicitly chosen later—not as “host the factory on Vercel+Supabase.” |

---

### Q4 — Out-of-repo boundaries — **Accepted as recommended**

1. **Now:** close real tasks in **`engineering-team`** (control plane + this monorepo).  
2. **Defer:** GP-024/025 automation and arbitrary product repos until Simple operator-trusted rate is green on-platform.  
3. **Later:** one designated external pilot repo after Simple class thresholds are met.

---

### Q5 — Time horizon — **Accepted with timeline cut in half**

| Window | Duration | Focus |
| --- | --- | --- |
| Hard slice | **~15 days** | Live OpenClaw as default proof; real GP-022 path; metrics on; **≥10** trusted Simple closes on stack; **start Vercel removal** |
| Plan horizon | **~45 days** | Specialist refinement for Standard; class expansion policy; always-on workers; PM/Architect human review gates enforced in product flow |
| Constraints | — | Allow auto-merge **only** for low-risk Simple with green checks + branch-protection evidence; no blanket auto-merge for higher classes |

Original recommendation was 30 / 90 days; operator directed **half** → **15 / 45**.

---

### Q6 — Non-negotiable humans — **Accepted with amendment (PM + Architect)**

**Amendment:** **PM and Architect outputs must be reviewed by a human** before they count as accepted for approval/dispatch. Agent-authored PM refinement or Architect sections are **proposals**, not authority.

| Always human (required approval — not an autonomy failure) | Automate when policy allows | Always escalate (never auto) |
| --- | --- | --- |
| Initial product intent / intake ownership | Simple low-risk **operator** contract auto-approval only after human PM/Architect review gates are satisfied when those roles were required | Auth, security, data-model, irreversible migrations |
| **Human review of PM work** (refinement contract quality, scope, acceptance criteria) | Dispatch, implement, QA fail/retest, evidence package **after** contract is human-cleared | Principal-triggered architecture disagreements |
| **Human review of Architect work** (technical approach, tiering, API/data/security sections when Architect contributed) | Merge when checks + merge-readiness pass (**Simple** class only) | Policy overrides, budget exhaustion, escaped defects |
| High-risk / Standard+ full contract approval until class unlocked | SRE monitoring **recording** when signals green | Secrets / prod access outside agent boundary |
| Optional: final closeout acknowledgment | — | — |

**Routine observation** (status, logs, dashboards) never counts as intervention.

**Implication for progressive autonomy:** Simple auto-approval policy may still skip *operator* rubber-stamp where eligibility holds, but it must **not** skip required **human PM/Architect review** when those roles are on the route. Autonomy expands *after* those humans have signed the contract quality, not by treating specialist agents as final PM/Architect.

---

## Sequencing implications (compressed)

### Days 0–15 (hard slice)

1. Freeze topology: coordinated stack only; open **Vercel removal** workstream (code, `vercel.json`, docs, CI, smokes, runbooks).  
2. Live OpenClaw default for factory verify (fail closed on fixture under production-like flags).  
3. Real GP-022 + real-delivery fail-closed green on stack.  
4. Enforce/document human PM + Architect review gates in approval path.  
5. Drive toward **≥10 Simple** operator-trusted closes; metrics MVP on.

### Days 15–45

1. Finish Vercel purge and dual-topology doc cleanup.  
2. Specialist refinement productization for Standard, still with human PM/Architect review.  
3. Class expansion policy wired to metrics (Simple → selected Standard only after thresholds).  
4. Always-on workers; no manual projection catch-up as normal path.

### Deferred (unchanged by Q4)

- Multi-repo / GP-024–025 automation  
- Full analytics platform beyond MVP  
- Unattended closeout for all classes  

---

## Open follow-ups (implementation, not re-opened policy)

- [ ] Inventory and remove Vercel-specific runtime/deploy surface (`vercel.json`, API adapter assumptions, runbooks, smoke targets, package scripts).  
- [ ] Productize human PM review + human Architect review as explicit workflow gates (events, UI next-action, metrics classification).  
- [ ] Re-baseline milestone verify against live OpenClaw + half-timeline exit criteria.  

---

## Supersedes

Prior open questions in the strategy gap analysis are closed by this document for roadmap planning. Re-open only if the operator changes posture on progressive autonomy, stack topology, or human PM/Architect review.

## Implementation progress (2026-07-08)

- PRD updated: `docs/product/software-factory-control-plane-prd.md` (topology, progressive autonomy, PM/Architect human authority, 15/45 horizon).
- Vercel deploy config removed (`vercel.json`, `.vercelignore`); canonical docs/package/repo-contract/architecture re-pointed to coordinated stack.
- Cloud Supabase removed as platform requirement in architecture, README, audit backend errors, worker compose notes.
- PM/Architect human review gate on agent disagreement: `lib/audit/pm-architect-human-review-gate.js` wired through `evaluateExecutionContractApprovalReadiness` / auto-approval.
