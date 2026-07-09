# Milestone D — Closeout Automation (P3)

Generate a **classified closeout report** (GP-027) from factory delivery evidence and the golden-path manual-step inventory.

**Scope:** P3.1 + P3.4 (GP-023 validation evidence in closeout, auto closeout report with manual-action classification).

## Prerequisites

- Milestones A–C passed on the coordinated stack.
- `observability/golden-path-manual-steps.json` up to date.

```bash
export AUTH_JWT_SECRET=golden-path-local-dev-secret
export DATABASE_URL=postgres://audit:audit@127.0.0.1:15432/engineering_team
export FORGE_SERVICE_TOKEN=local-golden-path-forge-token
```

## Verify Milestone D

Runs Milestone C factory delivery, then asserts closeout artifacts. Primary path is **live OpenClaw** (probe + fail closed); use fixture smoke only for local non-claim runs:

```bash
npm run milestone-d:verify
npm run milestone-d:verify:fixture
```

### Checks (Milestone C + closeout)

| Check | Meaning |
| --- | --- |
| `gp027_closeout_report` | `observability/factory-closeout/TSK-*.json` generated |
| `gp027_task_closed` | Phase 6 `task.closed` event recorded |
| `gp027_step_classification` | All 27 GP steps classified (automated / manual / completed) |
| `gp023_validation_in_closeout` | Validation outcome embedded in closeout report |

Artifacts:

- `observability/milestone-d-staging/milestone-d-closeout-verify.json`
- `observability/factory-closeout/{taskId}.json`

## Closeout module

`lib/task-platform/factory-closeout.js`:

- Reads `observability/golden-path-manual-steps.json`
- Classifies each GP step against `stepsCompleted` in factory evidence
- Records `manualInterventions` from phase 6
- Writes structured JSON for operator review (replaces ad-hoc closeout markdown for factory runs)

Phase 6 (`runGoldenPathPhase6`) invokes this automatically after `task.closed`.

## Exit criteria

- [x] `milestone-d:verify` → `summary.passed: true`
- [x] Closeout report lists `stepClassification.automated` ≥ 12 (post A/B/C inventory)
- [x] `observability/milestone-d-complete.json` written when verify passes
- [ ] `manualInterventions` array present when GP-026 waived or operator steps required

## P3.2–P3.3 (shipped)

- **GP-022** auto-merge — `lib/task-platform/github-auto-merge.js` (`FF_FACTORY_AUTO_MERGE` + `GITHUB_TOKEN`)
- **GP-026** SRE agent gate — `runSreAgentPhase` in phase 5/6 when `FF_FACTORY_AGENT_DRIVEN_PHASES=true`
- **Hosted promotion** — `npm run golden-path:replay:hosted-phase6` (see [milestone-e-deploy-automation.md](milestone-e-deploy-automation.md))

## Related

- [milestone-c-agent-autonomy.md](milestone-c-agent-autonomy.md)
- [golden-path-autonomous-delivery.md](golden-path-autonomous-delivery.md)