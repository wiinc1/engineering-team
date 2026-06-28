# Milestone B — Factory Runs Without Scripted Contracts

Prove factory orchestration hardening and **agent-driven phase 1** on the coordinated golden-path stack before full implement/QA autonomy (Milestone C).

**Architecture:** Same as Milestone A — `npm run dev:golden-path:up` (Postgres `:15432`, API `:13000`, workers, forgeadapter `:14010`, UI `:15173`).

**Scope:** P1.2–P1.4 + P2.1–P2.3 (GP-009/012/013, agent-driven contract generation, worker projection preference).

## Prerequisites

- Milestone A exit criteria met (`npm run milestone-a:verify` passes).
- Stack running: `npm run dev:golden-path:up`

```bash
export AUTH_JWT_SECRET=golden-path-local-dev-secret
export DATABASE_URL=postgres://audit:audit@127.0.0.1:15432/engineering_team
export FORGE_SERVICE_TOKEN=local-golden-path-forge-token
```

## Verify Milestone B

Default uses **fixture delegation** (no live OpenClaw required):

```bash
npm run milestone-b:verify
```

Artifacts: `observability/milestone-b-staging/milestone-b-orchestration-verify.json`

### Checks

| Check | Meaning |
| --- | --- |
| `milestone_a_baseline` | Re-runs Milestone A smokes inside B verify |
| `factory_phase6_complete` | Full factory queue item through phase 6 |
| `gp012_intake_agents_seeded` | Pilot agent roster on factory intake |
| `gp009_forge_seed_on_phase1` | Forge task seeded after phase 1 |
| `gp013_delegation_smoke` | Delegation smoke recorded |
| `agent_driven_phase1_contract` | Requirements-based contract (not canned pilot template) |
| `projection_worker_preference` | Phase 1 projection uses `always_on_worker` ≥ manual fallback |

### Env flags

| Flag | Default in verify | Purpose |
| --- | --- | --- |
| `FF_FACTORY_AGENT_DRIVEN_PHASE1` | `true` | Requirements-based contract + architect handoff hooks |
| `FACTORY_USE_FIXTURE_DELEGATION` | `true` | Fixture specialist runner for local proof |

Live OpenClaw (optional):

```bash
npm run milestone-b:verify -- --live-openclaw --openclaw-url http://127.0.0.1:18789
```

## Projection catch-up (P1.1)

`lib/audit/projection-catch-up.js`:

1. Builds JWT auth headers for `/metrics` (required on the audit API).
2. Waits before first lag read so workers can process new writes.
3. Falls back to `process-audit-projection-queue.js` only when lag persists.
4. Contract-approval retries force manual catch-up on `execution_contract_not_found`.

## Exit criteria

- [x] `milestone-b:verify` → `summary.passed: true`
- [x] `projection_worker_preference`: `workerModes >= manualModes`
- [x] Per-run queue files (`factory-milestone-b-queue-{runId}.json`) avoid stale queue pollution

Completion evidence: `observability/milestone-b-complete.json`

## Related

- [milestone-a-hosted-factory.md](milestone-a-hosted-factory.md)
- [milestone-c-agent-autonomy.md](milestone-c-agent-autonomy.md)
- [golden-path-autonomous-delivery.md](golden-path-autonomous-delivery.md)