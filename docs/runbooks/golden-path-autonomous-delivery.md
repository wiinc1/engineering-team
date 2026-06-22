# Golden Path — Supervised Autonomous Delivery Epic

One GitHub issue with full requirements → implement → QA (fail) → fix → QA (pass) → PM + Architect approve → deploy → closeout.

**Mode:** supervised. Every step is executed manually today. Each step is logged so automation can replace it later.

**Tracking inventory:** `observability/golden-path-manual-steps.json` (27 steps, all manual as of 2026-06-22).

**Diagram:** `docs/diagrams/golden-path-autonomous-delivery.mmd`

**Epic issue:** https://github.com/wiinc1/engineering-team/issues/269

**Prior art:** Issue #209 supervised pilot (`docs/runbooks/supervised-autonomous-pilot.md`) covers ET-only contract → delegation → PR. This epic extends that spine with **forgeadapter lifecycle**, **intentional QA fail/retest**, and **explicit deploy/closeout**.

---

## Epic goal

Prove the full delivery vision on **one low-risk task** while producing:

1. A step-by-step operator runbook (this file)
2. A classified manual-action log (`docs/reports/GOLDEN_PATH_PILOT_EVIDENCE.md`)
3. Machine-readable step completion (`observability/golden-path-pilot.json`)
4. A list of automation targets ranked by leverage

**Not in scope for v1 golden path:** unattended operation, Redis for factory platform, generic multi-tenant deploy for arbitrary repos.

---

## Pilot constraints (same guardrails as #209)

| Constraint | Requirement |
| --- | --- |
| Risk tier | **Simple** only |
| Change type | Docs/test-only or reversible one-file marker |
| Production risk | No auth, schema, data, or infra changes |
| Tasks per project | Exactly **one** pilot task until closeout |
| Forgeadapter | Local stack OK (`RUN_LOCAL_STACK_SMOKE=1`); production forge host optional |
| Redis | **Out of scope** — factory runs on Vercel + Supabase today |

### Suggested deliverable

Add a single visible marker proving the loop completed, e.g.:

- `docs/reports/GOLDEN_PATH_PILOT_EVIDENCE.md` (filled during pilot)
- One-line entry in `README.md` golden-path section

---

## Preconditions

- [ ] Production readiness accepted (Issue #208 closed or equivalent evidence current)
- [ ] `engineering-team` production API reachable (`https://engineering-team-zeta.vercel.app` or current alias)
- [ ] Operator has PM/Admin API access + production env files
- [ ] `forgeadapter` checkout at `main` with Phase 2 local-stack e2e green
- [ ] `engineering-team` checkout at `main` with `lib/forge-local-smoke/seed-task.js`
- [ ] OpenClaw delegation reachable OR visible blocker recorded before Phase 2
- [ ] GitHub token for PR/checks (`GITHUB_TOKEN` / `gh` auth)

---

## Phase 0 — GitHub issue intake

| Step | Action | System | Manual? | Automate as |
| --- | --- | --- | --- | --- |
| GP-001 | Create GitHub issue from template below | GitHub | yes | issue webhook |
| GP-002 | Create ET task / intake draft linked to issue | ET | yes | intake normalizer |
| GP-003 | PM refines acceptance criteria | ET | yes | PM agent |
| GP-004 | Architect adds spec, tier, monitoring | ET | yes | Architect agent |

### GitHub issue template (copy into new issue)

```markdown
## Golden Path Pilot Task

**Parent epic:** #<EPIC_ISSUE_NUMBER>

### User story
As a Software Factory operator, I want one supervised end-to-end delivery loop documented, so we know exactly what to automate next.

### Acceptance criteria
- [ ] GP-001–GP-027 steps logged in `docs/reports/GOLDEN_PATH_PILOT_EVIDENCE.md`
- [ ] Intentional QA fail recorded, then retest pass
- [ ] forgeadapter local-stack lifecycle exercised (start + at least one gate)
- [ ] PM + Architect close review recorded in ET task history
- [ ] Vercel production deploy recorded on task
- [ ] `observability/golden-path-pilot.json` committed with step timestamps

### Deliverable
Docs-only marker: golden-path section in README + evidence report.

### Risk
Simple, reversible, no production data/auth/schema changes.
```

### ET task creation (manual)

Use task creation UI or API with `initial_stage: DRAFT`, link `github_issue_url`, copy issue body into intake fields.

**Commands (local API example):**

```bash
# Adjust base URL and auth for your environment
export ET_API_BASE=https://engineering-team-zeta.vercel.app/api/v1
# Create via UI or authenticated POST /tasks per your operator session
```

---

## Phase 1 — Execution contract

| Step | Action | System | Manual? |
| --- | --- | --- | --- |
| GP-005 | Create Project `Golden Path Pilot - Issue <N>` | ET | yes |
| GP-006 | Record execution contract with `forge_dispatch` | ET | yes |
| GP-007 | Bounded projection catch-up after each write | ET | yes |
| GP-008 | Approve contract (policy or explicit) | ET | yes |

**Contract must include:**

```json
{
  "forge_dispatch": {
    "targetRepo": "wiinc1/engineering-team",
    "projectId": "engineering-team",
    "domain": "workflow",
    "affectsUi": false
  }
}
```

**Projection catch-up (production Postgres):**

```bash
# After each workflow write when read model is stale
node scripts/run-projection-worker.js --max-events <bounded>
```

See Issue #209 manual-action log for when this is `operator intervention` vs routine.

---

## Phase 2 — Forge execution

| Step | Action | System | Manual? |
| --- | --- | --- | --- |
| GP-009 | Seed / verify forge-execution-readiness | ET | yes |
| GP-010 | Start forgeadapter local stack | forgeadapter | yes |
| GP-011 | `POST /tasks/:taskId/start` | forgeadapter | yes |
| GP-012 | `npm run pilot:agents:seed` | ET | yes |
| GP-013 | `npm run test:delegation:live-smoke:openclaw` | OpenClaw | yes |
| GP-014 | Engineer opens branch, implements, opens PR | GitHub | yes |

### Seed task for forgeadapter

```bash
cd engineering-team
export AUDIT_STORE_BACKEND=file
export ALLOW_FILE_AUDIT_BACKEND=true
export FORGE_SERVICE_TOKEN=local-forge-smoke-token
npm run forge:local-smoke:seed -- --task-id TSK-GOLDEN001
```

Verify:

```bash
curl -s -H "Authorization: Bearer local-forge-smoke-token" \
  http://127.0.0.1:3000/tasks/TSK-GOLDEN001/forge-execution-readiness | jq .
```

### Start forgeadapter + lifecycle smoke

```bash
cd forgeadapter
npm run smoke:local:phase2   # proves ET + mocks + start path

# Full lifecycle suite (optional but recommended for GP-011 evidence)
RUN_LOCAL_STACK_SMOKE=1 ENGINEERING_TEAM_DIR=../engineering-team \
  node --test tests/e2e/lifecycle-local-stack.test.js
```

### Manual forge start (GP-011)

```bash
curl -s -X POST \
  -H "Authorization: Bearer local-forgeadapter-token" \
  http://127.0.0.1:4010/tasks/TSK-GOLDEN001/start | jq .

# Poll job until succeeded, then check runtime projection
```

**Gap:** ET contract approval does **not** auto-call forgeadapter. Operator must bridge GP-009 → GP-011 until `et_dispatch_webhook` exists.

---

## Phase 3 — QA (intentional fail)

| Step | Action | System | Manual? |
| --- | --- | --- | --- |
| GP-015 | Record QA **fail** (`runType=initial`) | ET | yes |
| GP-016 | Forge `review` rejected OR `revision_required` | forgeadapter | yes |

**ET QA fail payload (example):**

```json
{
  "outcome": "fail",
  "runType": "initial",
  "summary": "Golden path intentional fail — marker file missing.",
  "findings": [{ "severity": "medium", "summary": "README golden-path section not present" }],
  "escalationPackage": { "returnTo": "engineer", "priorRunId": "<initial_run_id>" }
}
```

Record via task workflow API or task detail UI per `docs/runbooks/workflow-delivery-loop.md`.

---

## Phase 4 — Fix + retest

| Step | Action | System | Manual? |
| --- | --- | --- | --- |
| GP-017 | Engineer commits fix to PR | GitHub | yes |
| GP-018 | `POST /tasks/:taskId/resume` | forgeadapter | yes |
| GP-019 | QA **retest pass** with `prior_run_id` | ET | yes |

**Forge resume after reject (GP-018):**

```bash
curl -s -X POST \
  -H "Authorization: Bearer local-forgeadapter-token" \
  http://127.0.0.1:4010/tasks/TSK-GOLDEN001/resume | jq .
```

**Gap:** ET QA fail does **not** auto-trigger forge resume. Operator bridges GP-015 → GP-018.

---

## Phase 5 — PM + Architect sign-off

| Step | Action | System | Manual? |
| --- | --- | --- | --- |
| GP-020 | Approve forge `qa`, `architect`, `pm` gates | forgeadapter | yes |
| GP-021 | ET close review — PM + Architect | ET | yes |

### Forge gate approval (local stack pattern)

Use `POST /tasks/:id/review-requests/:gate` then `POST /tasks/:id/review` with approved packet. See `forgeadapter/tests/e2e/lifecycle-local-stack.test.js` `approveReviewGate` helper.

Then:

```bash
curl -s -X POST -H "Authorization: Bearer local-forgeadapter-token" \
  -H "Content-Type: application/json" \
  -d '{"requestedAction":"complete","actor":{"owner":"main","role":"operator"},"summary":"Golden path complete.","outcome":"accepted"}' \
  http://127.0.0.1:4010/tasks/TSK-GOLDEN001/complete | jq .
```

**Gap:** ET close review and forge gates are **parallel systems** — both must be satisfied manually.

---

## Phase 6 — Deploy + closeout

| Step | Action | System | Manual? |
| --- | --- | --- | --- |
| GP-022 | Merge PR (checks green) | GitHub | yes |
| GP-023 | Vercel production deploy | Vercel | yes |
| GP-024 | Supabase (platform already on Supabase) | Supabase | n/a for docs-only |
| GP-025 | Redis | — | **out of scope** |
| GP-026 | SRE monitoring approval | ET | yes |
| GP-027 | Closeout report + manual-action log | ET | yes |

```bash
# Deploy (engineering-team itself)
npx vercel deploy --prod --yes

# Validation
npm run lint && npm run test:unit && npm run standards:check
```

---

## Evidence artifacts (required at closeout)

| Artifact | Path |
| --- | --- |
| Manual step log | `docs/reports/GOLDEN_PATH_PILOT_EVIDENCE.md` |
| Step timestamps JSON | `observability/golden-path-pilot.json` |
| Manual step inventory | `observability/golden-path-manual-steps.json` |
| Forge lifecycle proof | `forgeadapter` local-stack test output or CI link |
| Delegation proof | `observability/pilot-delegation-readiness.json` (if OpenClaw used) |
| PR + deploy | PR URL, merge SHA, Vercel deployment ID |

### Manual-action classifications

Same as #209:

- `routine observation` — read-only checks
- `required approval` — expected human gates
- `operator intervention` — corrective action after a blocker

---

## Automation priority (from manual-step inventory)

| Priority | Step IDs | Why |
| --- | --- | --- |
| P0 | GP-002, GP-011 | Issue → task and contract → forge start |
| P0 | GP-007 | Projection worker always-on (blocks production gates) |
| P1 | GP-015, GP-016, GP-018 | QA fail ↔ forge reject/resume loop |
| P1 | GP-020, GP-021 | Unify ET close + forge gate approval |
| P2 | GP-003, GP-004, GP-014 | Agent-driven refine + implement |
| P2 | GP-023, GP-024 | Target-app deploy (Vercel + Supabase) |
| P3 | GP-025 | Redis — only if target apps require it |

---

## Rollback

Docs-only pilot: revert the PR. Preserve task history, evidence JSON, and this runbook until metrics epic (#156) absorbs the learnings.

---

## Related docs

- `docs/runbooks/supervised-autonomous-pilot.md` — Issue #209 ET-only pilot
- `docs/runbooks/workflow-delivery-loop.md` — QA fail/retest schema
- `../forgeadapter/docs/runbooks/phase2-local-smoke.md` — forge local stack
- `docs/architecture/openclaw-forge-delivery-architecture.md` — target architecture
- `prd/software-factory.md` — full factory vision