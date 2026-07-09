# Milestone C — Agent Implements and Verifies

Prove **agent-driven factory phases** (implementer, QA, fix loop) and GP-023 validation on the coordinated stack.

**Scope:** P2.4–P2.7 + P3.1 (GP-014/017/019, specialist review path, CI validation evidence).

## Prerequisites

- Milestones A and B passed.
- Stack running with forgeadapter.

```bash
export AUTH_JWT_SECRET=golden-path-local-dev-secret
export DATABASE_URL=postgres://audit:audit@127.0.0.1:15432/engineering_team
export FORGE_SERVICE_TOKEN=local-golden-path-forge-token
```

## Verify Milestone C

### Primary path (live OpenClaw — factory claims)

Primary `milestone-c:verify` **probes** the OpenClaw gateway and **fails closed** if it is unavailable. Fixtures are not a silent fallback.

```bash
# 1. Coordinated stack
npm run dev:golden-path:up

# 2. Live OpenClaw gateway (default probe URL)
#    export OPENCLAW_BASE_URL=http://127.0.0.1:18789
#    Ensure the **audit API process** also has:
#      FF_REAL_SPECIALIST_DELEGATION=true
#      SPECIALIST_DELEGATION_RUNNER="node scripts/openclaw-specialist-runner.js"
#      OPENCLAW_BASE_URL=http://127.0.0.1:18789

# 3. Primary claim path (live or fail closed)
npm run milestone-c:verify
# force URL:
npm run milestone-c:verify -- --openclaw-url http://127.0.0.1:18789
# force live (same as primary when gateway is up):
npm run milestone-c:verify:live
```

### Fixture smoke only (not operator-trusted)

```bash
npm run milestone-c:verify:fixture
# or: npm run milestone-c:verify -- --allow-fixture-delegation
```

Fixture runs print a warning and must not be treated as factory-green / operator-trusted evidence.

### Checks

| Check | Meaning |
| --- | --- |
| `factory_phase6_complete` | End-to-end delivery with validation |
| `gp014_implementer_agent` | Live implementer `sessionId` under live profile |
| `gp019_qa_agent` | Live QA agent session under live profile |
| `gp017_fix_loop` | Engineer resubmission after QA fail |
| `gp023_ci_validation_evidence` | Phase 6 CI/workflow metadata |
| `agent_session_evidence` | Real (non-fixture) agent `sessionId` under live profile |
| `live_session_evidence` | Aggregated live session validation (primary path) |

### Env flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `FACTORY_PROOF_PROFILE` | resolved (`live` / `fixture`) | Explicit proof profile |
| `OPENCLAW_BASE_URL` | probe default `http://127.0.0.1:18789` on claim path | Gateway base URL |
| `FF_FACTORY_AGENT_DRIVEN_PHASE1` | `true` | Agent-driven phase 1 |
| `FF_FACTORY_AGENT_DRIVEN_PHASES` | `true` | Phases 2–4 agent hooks |
| `FACTORY_USE_FIXTURE_DELEGATION` | `false` on live claim path | Fixture runner only with explicit fixture profile |

Artifacts: `observability/milestone-c-staging/milestone-c-agent-verify.json`

## Exit criteria

- [x] `milestone-c:verify` → live profile + `summary.passed: true` (gateway required)
- [x] Real implementer/QA `sessionId` present (not fixture attribution)
- [x] GP-023 validation runs without `--skip-validation`

Completion evidence: `observability/milestone-c-complete.json`

## Related

- [milestone-b-orchestration.md](milestone-b-orchestration.md)
- [milestone-d-closeout-automation.md](milestone-d-closeout-automation.md)