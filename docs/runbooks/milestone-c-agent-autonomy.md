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

Fixture delegation (default — fast local proof):

```bash
npm run milestone-c:verify
```

Live OpenClaw delegation:

```bash
npm run milestone-c:verify -- --live-openclaw --openclaw-url http://127.0.0.1:18789
```

Ensure the **audit API process** has `FF_REAL_SPECIALIST_DELEGATION=true` and `SPECIALIST_DELEGATION_RUNNER` when proving live GP-003 via `/refinement/start` on the server (phase-runner client env alone is insufficient).

### Checks

| Check | Meaning |
| --- | --- |
| `factory_phase6_complete` | End-to-end delivery with validation |
| `gp014_implementer_agent` | Implementer delegation `sessionId` or `delegated` |
| `gp019_qa_agent` | QA agent evidence on phase 3 |
| `gp017_fix_loop` | Engineer resubmission after QA fail |
| `gp023_ci_validation_evidence` | Phase 6 CI/workflow metadata |
| `agent_session_evidence` | At least one agent `sessionId` in evidence |

### Env flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `FF_FACTORY_AGENT_DRIVEN_PHASE1` | `true` | Agent-driven phase 1 |
| `FF_FACTORY_AGENT_DRIVEN_PHASES` | `true` | Phases 2–4 agent hooks |
| `FACTORY_USE_FIXTURE_DELEGATION` | `true` (unless `--live-openclaw`) | Fixture runner from repo root |

Artifacts: `observability/milestone-c-staging/milestone-c-agent-verify.json`

## Exit criteria

- [x] `milestone-c:verify` → `summary.passed: true`
- [x] `implementerAgent.sessionId` present (fixture or live)
- [x] GP-023 validation runs without `--skip-validation`

Completion evidence: `observability/milestone-c-complete.json`

## Related

- [milestone-b-orchestration.md](milestone-b-orchestration.md)
- [milestone-d-closeout-automation.md](milestone-d-closeout-automation.md)