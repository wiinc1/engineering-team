# Milestone E — Hosted Deploy Automation (P3.2–P3.3)

Replay **phase 6 deploy closeout** against a hosted engineering-team API and operator URL. Validates GP-022 auto-merge evidence, GP-026 SRE agent gate, and GP-023 validation on promotion paths.

## Prerequisites

- Milestone D passed (`npm run milestone-d:verify`).
- Factory delivery evidence JSON from a prior A–D run (`observability/milestone-d-staging/factory-delivery/*.json`).
- Hosted API base URL and JWT secret (staging or production).
- Optional: `GITHUB_TOKEN` + `FF_FACTORY_AUTO_MERGE=true` for live PR merge.

## Hosted phase 6 replay

```bash
export AUTH_JWT_SECRET=<hosted-jwt-secret>
export FORGEADAPTER_BASE_URL=<hosted-forgeadapter-url>  # when forge bridge required

npm run golden-path:replay:hosted-phase6 -- \
  --base-url https://<hosted-api> \
  --operator-url https://<hosted-app> \
  --evidence-path observability/milestone-d-staging/factory-delivery/factory-milestone-c-mqsjp2ax.json \
  --run-validation
```

### Flags

| Flag | Purpose |
| --- | --- |
| `--phase6-only` | Alias via replay script; skips Milestone A intake replay |
| `--operator-url` | Deployed app URL for SRE monitoring window |
| `--evidence-path` | Prior factory evidence to resume from |
| `--run-validation` | Run lint, test:unit, standards:check in phase 6 |
| `--auto-merge` | Enable `FF_FACTORY_AUTO_MERGE` for live GitHub merge |
| `--allow-local-hosted` | Permit local base URL for coordinated-stack smoke |

## Verify script

```bash
npm run milestone-e:hosted-phase6:verify -- \
  --base-url https://<hosted-api> \
  --operator-url https://<hosted-app> \
  --evidence-path observability/milestone-d-staging/factory-delivery/factory-milestone-c-mqsjp2ax.json
```

Artifacts:

- `observability/milestone-hosted-staging/milestone-hosted-phase6-verify.json`
- Updated factory evidence under `observability/milestone-hosted-staging/factory-delivery/`

## Modules

| GP step | Module |
| --- | --- |
| GP-022 | `lib/task-platform/github-auto-merge.js` |
| GP-026 | `lib/task-platform/factory-agent-phases.js` `runSreAgentPhase` |
| GP-010 | `lib/task-platform/golden-path-stack-probe.js` |

## Exit criteria

- [x] Hosted phase 6 replay reaches `phase6_complete` (local coordinated-stack proof via `--allow-local-hosted`)
- [x] `summary.gp026SreAgent` true (agent session recorded)
- [x] `summary.validationOk` true when `--run-validation` passed
- [x] GP-022 `autoMerge` evidence present (simulated or live merge)

Proof artifact: `observability/milestone-hosted-staging/milestone-hosted-phase6-verify.json`

### Hosted API prerequisites

- Factory scripts use **HMAC JWT** (`AUTH_JWT_SECRET`). Vercel deployments on **registration auth** reject those tokens (`invalid jwt signature`).
- Hosted task routes use `/api/v1/tasks/*` (auto-enabled when `baseUrl` is not the local `:13000` stack).
- Factory evidence must be created on the **same** hosted API before phase-6 replay (local `TSK-*` tasks are not visible on Vercel Postgres).

## Related

- [milestone-d-closeout-automation.md](milestone-d-closeout-automation.md)
- [golden-path-autonomous-delivery.md](golden-path-autonomous-delivery.md)