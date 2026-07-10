# Golden Path — Supervised Autonomous Delivery Epic

One GitHub issue with full requirements → implement → QA (fail) → fix → QA (pass) → PM + Architect approve → deploy → closeout.

**Mode:** supervised. Every step is executed manually today. Each step is logged so automation can replace it later.

**Tracking inventory:** `observability/golden-path-manual-steps.json` (27 steps, all manual as of 2026-06-22).

**Diagram:** `docs/diagrams/golden-path-autonomous-delivery.mmd`

**Epic issue:** https://github.com/wiinc1/engineering-team/issues/269

**Prior art:** Issue #209 supervised pilot (`docs/runbooks/supervised-autonomous-pilot.md`) covers ET-only contract → delegation → PR. This epic extends that spine with **forgeadapter lifecycle**, **intentional QA fail/retest**, and **explicit deploy/closeout**.

**Development default:** run the **entire app locally** on one machine (Postgres + audit API + UI + forgeadapter). Do not split UI and API across hosted platforms for golden-path work — use the coordinated stack below.

---

## Local development stack (default)

Start one coordinated stack on the operator machine:

```bash
cd engineering-team
npm run dev:golden-path:up
```

This brings up (pinned ports by default):

| Service | URL | Notes |
| --- | --- | --- |
| Docker Postgres | `postgres://audit:audit@127.0.0.1:15432/engineering_team` | Port **15432** avoids conflicts with other local Postgres on 5432 (`docker-compose.golden-path.yml`) |
| ET audit API | `http://127.0.0.1:13000` | Postgres-backed, `FF_WORKFLOW_ENGINE=true` |
| ET audit workers | background | Projection + outbox on 3s interval; **ET→forge dispatch bridge** when `ET_FORGE_DISPATCH_ENABLED=true` |
| ET UI (Vite) | `http://127.0.0.1:15173` | React SPA on `/tasks/*`; API via `/backend/*` and `/auth/*` proxies → audit API |
| forgeadapter | `http://127.0.0.1:14010` | Requires sibling `../forgeadapter` checkout |
| OpenClaw | `http://127.0.0.1:14001` | **Mock** unless `--openclaw-url` points at a real runtime |

### Live factory proof (default for milestone claim verifies)

Primary `npm run milestone-{b,c,d}:verify` probes **live OpenClaw** (`OPENCLAW_BASE_URL`, default `http://127.0.0.1:18789`) and **fails closed** if the gateway is unavailable. Fixtures are opt-in only (`milestone-*:verify:fixture` or `--allow-fixture-delegation`) and are **not** valid for operator-trusted factory claims.

Configure the **audit API process** (not only the verify client):

```bash
export OPENCLAW_BASE_URL=http://127.0.0.1:18789
export FF_REAL_SPECIALIST_DELEGATION=true
export SPECIALIST_DELEGATION_RUNNER="node scripts/openclaw-specialist-runner.js"
export FACTORY_USE_FIXTURE_DELEGATION=false
```

See `docs/refinement/REQ-live-factory-proof-default-openclaw.md` and milestone B/C/D runbooks.

**Local coordinated-stack live C/D** (agent sessions without hosted forge/real-evidence):

```bash
export FACTORY_PROOF_PROFILE=live
export OPENCLAW_BASE_URL=http://127.0.0.1:18789
export STAGING_SKIP_FORGE_SEED=true
export STAGING_SKIP_FORGE_PHASES=true
export FF_REAL_SPECIALIST_DELEGATION=true
export SPECIALIST_DELEGATION_RUNNER="node scripts/openclaw-specialist-runner.js"
# Prefer always-on workers: npm run audit:workers (or docker compose audit-workers when available)
node scripts/verify-milestone-c-agent.js --base-url http://127.0.0.1:13000 --openclaw-url http://127.0.0.1:18789
node scripts/verify-milestone-d-closeout.js --base-url http://127.0.0.1:13000 --openclaw-url http://127.0.0.1:18789
```

Hosted real-evidence collection remains opt-in via explicit `FF_GOLDEN_PATH_*` / `STAGING_REQUIRE_REAL_EVIDENCE` flags and is not implied by agent-driven phases alone on a local base URL.

### Durable factory stack on this host (reboot-safe API + workers)

Use **launchd KeepAlive** units for the factory of record (audit API + projection/outbox workers). OpenClaw remains the separate host unit `ai.openclaw.gateway` on `:18789`.

```bash
# Install/load launchd services + ensure Postgres (existing :15432 or docker compose when Docker is installed)
npm run factory:stack:up
npm run factory:stack:status   # health: postgres, API :13000, live OpenClaw :18789
npm run factory:stack:restart
npm run factory:stack:down     # stop services; plists retained so reboot restarts them
npm run factory:stack:uninstall  # remove plists permanently
```

| Service | LaunchAgent label | Port / role |
| --- | --- | --- |
| Audit API | `com.engineering-team.factory-audit-api` | `:13000` |
| Audit workers | `com.engineering-team.factory-audit-workers` | projection + outbox |
| Postgres | Docker golden-path compose **or** existing listener | `:15432` |
| OpenClaw (live) | `ai.openclaw.gateway` (pre-existing) | `:18789` |

Logs: `~/Library/Logs/engineering-team-factory/`. Env example: `deploy/launchd/factory-stack.env.example`. Runtime env copy: `observability/factory-stack/service.env`.

**Postgres note:** If Docker is unavailable and nothing listens on `:15432`, `factory:stack:up` fails with a clear error. Start Postgres first (or install Docker and let the script run `docker-compose.golden-path.yml`).

| Hermes | `http://127.0.0.1:14002` | **Mock** unless `--hermes-url` points at a real runtime |

**Browser sign-in** (seeded on stack startup):

- URL: `http://127.0.0.1:15173/sign-in`
- Email: `admin@golden-path.local`
- Password: `GoldenPathAdmin1`
- Tenant: `engineering-team` (matches golden-path scripts)

The stack uses **registration auth** (`AUTH_PRODUCTION_AUTH_STRATEGY=registration`) with a seeded active admin. New accounts can register but require admin approval (`AUTH_REGISTRATION_MODE=admin-approved`). Trusted auth-code bootstrap is disabled for the default UI path.

**If sign-in fails with "Request failed":** the golden-path UI must use same-origin API paths (`/auth/*`, `/tasks/*`). `dev:golden-path:up` forces `VITE_TASK_API_BASE_URL=` empty; restart the stack after pulling changes. Also clear `sessionStorage` key `engineering-team.task-browser-session` if a stale `apiBaseUrl` remains. Use `http://127.0.0.1:15173` exactly — not `localhost`.

**Shared dev tokens** (also in `observability/golden-path-local-dev/stack.json` while running):

- `FORGE_SERVICE_TOKEN=local-golden-path-forge-token`
- `FORGEADAPTER_SERVICE_TOKEN=local-forgeadapter-token`
- `AUTH_JWT_SECRET=golden-path-local-dev-secret`
- `AUTH_SESSION_SECRET=golden-path-local-session-secret`

**Use real OpenClaw for GP-013** (ET specialist delegation) while keeping the stack default mock for forgeadapter review gates:

```bash
# Stack default: OpenClaw mock on :14001 (forgeadapter review child sessions)
npm run dev:golden-path:up

# Postgres replay with live GP-013 delegation (ET path only)
npm run golden-path:replay:postgres -- \
  --require-delegation-smoke \
  --openclaw-url http://127.0.0.1:<openclaw-gateway-port> \
  ...
```

Point `--openclaw-url` at the live gateway (e.g. `http://127.0.0.1:18789`) for GP-013 smoke. Leave forgeadapter on the dev mock unless the live gateway implements `POST /sessions/:id/children`.

**Use real Hermes** when already running locally:

```bash
npm run dev:golden-path:up -- \
  --hermes-url http://127.0.0.1:<hermes-port>
```

**Stop / status:**

```bash
npm run dev:golden-path:down                    # kill child processes; stop Postgres container (wipes DB)
npm run dev:golden-path:down -- --keep-postgres # stop app processes only; preserve pilot task data
npm run dev:golden-path:status                  # print stack.json
```

Use `--keep-postgres` when you want the UI to keep showing a completed golden-path replay after restarting the stack. Without it, `dev:golden-path:down` removes the Docker Postgres volume and you must re-run phase scripts from Phase 0/1.

Logs: `observability/golden-path-local-dev/logs/`. State: `observability/golden-path-local-dev/stack.json`.

### ET → forgeadapter dispatch bridge

`dev:golden-path:up` enables `ET_FORGE_DISPATCH_ENABLED=true` on audit workers. The outbox publisher in `lib/task-platform/et-forge-dispatch-bridge.js` routes:

| Audit event | Forge action | Golden-path step |
| --- | --- | --- |
| `task.execution_contract_approved` | `POST /tasks/:id/start` (when execution-ready) | GP-011 |
| `task.qa_result_recorded` (initial fail) | `POST /tasks/:id/review-requests/qa` + rejected review packet | GP-016 |
| `task.engineer_submission_recorded` (version ≥ 2) | `POST /tasks/:id/resume` | GP-018 |
| `task.qa_result_recorded` (retest pass) | approve qa/architect/pm gates + `POST /tasks/:id/complete` + ET close recommendations | GP-020, GP-021 |

Environment (set automatically by the dev stack):

- `FORGEADAPTER_BASE_URL=http://127.0.0.1:14010`
- `ENGINEERING_TEAM_BASE_URL=http://127.0.0.1:13000`
- `ET_FORGE_LIFECYCLE_TASK_ID=TSK-GOLDEN001` (maps ET pilot task events to forge lifecycle task)

Phase scripts still perform explicit forge actions for supervised replay evidence; the bridge covers unattended operator gaps between ET and forgeadapter.

**Run golden-path phase scripts against the local Postgres API** (with stack up):

```bash
export AUTH_JWT_SECRET=golden-path-local-dev-secret
export FORGE_SERVICE_TOKEN=local-golden-path-forge-token

node scripts/run-golden-path-phase1.js --bootstrap \
  --base-url http://127.0.0.1:13000 \
  --child-issue <issue-number> \
  --child-issue-url https://github.com/wiinc1/engineering-team/issues/<issue-number>

node scripts/run-golden-path-phases.js \
  --base-url http://127.0.0.1:13000 \
  --from 2 --to 6 --skip-delegation-smoke \
  --operator-url http://127.0.0.1:15173 \
  --out observability/golden-path-postgres-pilot.json \
  --persist-dir observability/golden-path-postgres-stack/audit-data
```

**One-command Postgres replay** (stack must already be up):

```bash
npm run golden-path:replay:postgres
# fresh intake + phases 1–6 when evidence file is missing:
npm run golden-path:replay:postgres -- --bootstrap
```

**Standalone step smoke verifiers** (stack must already be up; read task id from `observability/golden-path-postgres-pilot.json` when omitted):

```bash
npm run gp-002:verify               # GP-002 intake normalizer (webhook + projection + evidence)
npm run gp-005:verify               # GP-005 project bootstrap on GitHub intake
npm run golden-path:smoke:gp-002    # lightweight GP-002 webhook smoke only
npm run golden-path:smoke:gp-015    # initial QA fail recorded before QA_TESTING stage advance
npm run golden-path:smoke:gp-013 -- --openclaw-url http://127.0.0.1:<gateway>   # live delegation
```

Phase 3 advances to `QA_TESTING` (through contract-coverage audit when required), waits for projection catch-up, then records the intentional QA fail (`GP-015`).

Phase 4 waits for contract-coverage audit rows matching the current implementation attempt before leaving `IMPLEMENTATION`. Phase 5 waits for `task.sre_monitoring_started` to project before SRE approve.

The `--local` file-backend path remains for fast isolated proofs (`observability/golden-path-local-stack/audit-data`); prefer the Postgres stack above for UI + forgeadapter + workflow fidelity.

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
| Forgeadapter | **Local** via `dev:golden-path:up`; production forge host optional |
| Data plane | **Local Docker Postgres** for dev; cloud Supabase only for staging/prod replay |
| Redis | **Out of scope** for golden-path v1 |

### Suggested deliverable

Add a single visible marker proving the loop completed, e.g.:

- `docs/reports/GOLDEN_PATH_PILOT_EVIDENCE.md` (filled during pilot)
- One-line entry in `README.md` golden-path section

---

## Preconditions (local-first)

- [ ] Docker available (`docker compose` works)
- [ ] `npm run dev:golden-path:up` reaches green (audit API `/metrics`, UI, forgeadapter `/health`)
- [ ] `forgeadapter` checkout at `../forgeadapter` (or `FORGEADAPTER_DIR`) on `main` with lifecycle e2e green
- [ ] `engineering-team` on branch with golden-path scripts + `lib/forge-local-smoke/seed-task.js`
- [ ] OpenClaw + Hermes running locally **or** accept dev mocks for GP-013 (record which in evidence)
- [ ] GitHub token for PR/checks (`GITHUB_TOKEN` / `gh` auth)

### Hosted deployment replay (optional)

Do **not** block local golden-path progress on hosted deployment. When you promote beyond the local stack, replay Phase 6 with a real **SRE monitoring window** (GP-026) against your hosted operator URL.

### Strict real-evidence replay

Use this only after a real low-risk code change has an actual branch, commit,
pull request, GitHub branch-protection required checks, and a passing
`Merge readiness` check. The strict mode rejects the default pilot PR, generated
commit SHAs, skipped deploy validation, SRE waivers, docs-only scope, and
dev-only release evidence.

```bash
export RELEASE_ENV=staging
export CHANGE_KIND=bugfix
export CHANGE_REVERSIBILITY=reversible
export FACTORY_TEMPLATE_TIER=Standard
export GITHUB_TOKEN=<github-token>
export ET_API_URL=<hosted-et-api-url>
export BRANCH_NAME=<branch-name>
export IMPLEMENTATION_COMMIT_SHA=<implementation-commit-sha>
export PR_URL=https://github.com/wiinc1/engineering-team/pull/<pr-number>
export PR_NUMBER=<pr-number>
export DEPLOYMENT_URL=<hosted-staging-url>
export RELEASE_HEALTH_CHECK_PATH=/version
export REQUIRE_HEALTH_COMMIT=true
export RELEASE_ARTIFACT_DIR=observability/release/artifacts
export RELEASE_BUILD_COMMAND="<build-command>"
export RELEASE_COMPATIBILITY_COMMAND="<compatibility-test-command>"
export RELEASE_VULNERABILITY_COMMAND="<dependency-vulnerability-scan-command>"
export RELEASE_SECRET_COMMAND="<secret-scan-command>"
export PRODUCTION_SAFETY_EVIDENCE=observability/release/production-safety.json
export ROLLBACK_TARGET=<last-known-good-release-or-url>
export ROLLBACK_EVIDENCE=observability/release/rollback-verification.json
```

Generate the ordered delivery plan first. A blocked plan exits non-zero and marks
every command as `ready: false` with `blockedBy` reasons; do not run commands
labeled `[BLOCKED]`. Saved-plan execution reports include `planDigest` so the
pre-merge and post-merge evidence can be matched to the exact plan artifact.
The saved-plan execution audit also requires a passing
`real-autonomous-delivery-verification-report.v1` artifact from final delivery
verification.

```bash
npm run autonomy:plan-real-delivery -- \
  --release-env "$RELEASE_ENV" \
  --base-url "$ET_API_URL" \
  --operator-url "$DEPLOYMENT_URL" \
  --repository wiinc1/engineering-team \
  --branch "$BRANCH_NAME" \
  --implementation-commit-sha "$IMPLEMENTATION_COMMIT_SHA" \
  --pr-url "$PR_URL" \
  --pr-number "$PR_NUMBER" \
  --deployment-url "$DEPLOYMENT_URL" \
  --rollback-target "$ROLLBACK_TARGET" \
  --health-check-path "$RELEASE_HEALTH_CHECK_PATH" \
  --require-health-commit \
  --candidate-test-command "$RELEASE_COMPATIBILITY_COMMAND" \
  --release-build-command "$RELEASE_BUILD_COMMAND" \
  --release-compatibility-command "$RELEASE_COMPATIBILITY_COMMAND" \
  --release-vulnerability-command "$RELEASE_VULNERABILITY_COMMAND" \
  --release-secret-command "$RELEASE_SECRET_COMMAND" \
  --final-verification-report observability/real-autonomous-delivery-verification-report.json \
  --json \
  --report observability/real-delivery-plan.json

npm run autonomy:execute-real-delivery-plan -- \
  --plan observability/real-delivery-plan.json \
  --stage pre-merge \
  --report observability/real-delivery-plan-execution-pre-merge.json \
  --json
```

Create the low-risk candidate proof before replaying deploy closeout:

```bash
npm run autonomy:build-rollback-evidence -- \
  --release-env "$RELEASE_ENV" \
  --rollback-target "$ROLLBACK_TARGET" \
  --verification-status verified \
  --out "$ROLLBACK_EVIDENCE"

npm run autonomy:build-production-safety -- \
  --release-env "$RELEASE_ENV" \
  --deployment-url "$DEPLOYMENT_URL" \
  --commit-sha "$IMPLEMENTATION_COMMIT_SHA" \
  --validation-status passed \
  --risk-level low \
  --production-safe \
  --out "$PRODUCTION_SAFETY_EVIDENCE"

npm run autonomy:build-release-artifacts -- \
  --release-env "$RELEASE_ENV" \
  --commit-sha "$IMPLEMENTATION_COMMIT_SHA" \
  --deployment-url "$DEPLOYMENT_URL" \
  --health-check-path "$RELEASE_HEALTH_CHECK_PATH" \
  --require-health-commit \
  --rollback-target "$ROLLBACK_TARGET" \
  --repository wiinc1/engineering-team \
  --out-dir "$RELEASE_ARTIFACT_DIR" \
  --build-command "$RELEASE_BUILD_COMMAND" \
  --compatibility-command "$RELEASE_COMPATIBILITY_COMMAND" \
  --vulnerability-command "$RELEASE_VULNERABILITY_COMMAND" \
  --secret-command "$RELEASE_SECRET_COMMAND"

npm run autonomy:verify-real-delivery-candidate -- \
  --collect-github-evidence \
  --manifest /tmp/real-delivery-candidate.json \
  --out observability/real-delivery-candidate-proof.json \
  --run-test-commands \
  --branch "$BRANCH_NAME" \
  --implementation-commit-sha "$IMPLEMENTATION_COMMIT_SHA" \
  --pr-url "$PR_URL" \
  --pr-number "$PR_NUMBER" \
  --release-env "$RELEASE_ENV" \
  --deployment-url "$DEPLOYMENT_URL" \
  --health-check-path "$RELEASE_HEALTH_CHECK_PATH" \
  --require-health-commit \
  --production-safety-evidence "$PRODUCTION_SAFETY_EVIDENCE" \
  --rollback-target "$ROLLBACK_TARGET" \
  --rollback-evidence "$ROLLBACK_EVIDENCE" \
  --require-final-release-proof \
  --verify-deployment-health \
  --rollback-verified
```

Then replay phase 6 with live GitHub merge enabled:

```bash
node scripts/run-golden-path-phases.js \
  --from 6 --to 6 \
  --collect-real-evidence \
  --require-real-evidence \
  --agent-driven-phases \
  --auto-merge \
  --base-url "$ET_API_URL" \
  --operator-url "$DEPLOYMENT_URL" \
  --out observability/golden-path-postgres-pilot.json \
  --repository wiinc1/engineering-team \
  --branch "$BRANCH_NAME" \
  --implementation-commit-sha "$IMPLEMENTATION_COMMIT_SHA" \
  --pr-url "$PR_URL" \
  --pr-number "$PR_NUMBER" \
  --health-check-path "$RELEASE_HEALTH_CHECK_PATH" \
  --require-health-commit \
  --release-artifact-dir "$RELEASE_ARTIFACT_DIR" \
  --release-build-command "$RELEASE_BUILD_COMMAND" \
  --release-compatibility-command "$RELEASE_COMPATIBILITY_COMMAND" \
  --release-vulnerability-command "$RELEASE_VULNERABILITY_COMMAND" \
  --release-secret-command "$RELEASE_SECRET_COMMAND"
```

`--collect-real-evidence` reads the PR, changed files, executed checks, and
branch-protection required-check inventory from GitHub. Final candidate proof
generation must use `--collect-github-evidence`; manual `--checks-json`,
`--required-checks-json`, `--branch-protection-json`, and
`--merge-readiness-json` inputs are diagnostic-only and are rejected when
`--require-final-release-proof` is set.

Factory real-delivery runs follow the same rule in-process: before phase 6, the
factory candidate proof collector reads GitHub directly and fails closed if that
collection fails. It does not fall back to queued or manually supplied check
JSON for final proof.

When using `--use-existing-release-artifacts`, `--release-artifact-dir` must
already contain readable JSON for `build.json`, `compatibility-report.json`,
`vulnerability-scan.json`, and `secret-scan.json`, each with `status: "passed"`.
The plan and preflight reject the flag if those artifacts are missing, failed,
from a different release environment, or keyed to a different commit.

For production promotion, set `RELEASE_ENV=prod` and include
`--rollback-verified` only with a rollback-verification artifact from the target
deployment. The artifact must include `environment`, `rollback_target`,
`verification_status: "verified"`, and a valid `verified_at` timestamp. Without
both `--rollback-verified` and `--rollback-evidence`, the candidate and release
gates fail closed.

After the run, audit the generated factory evidence against the pre-run
candidate proof before calling it a real autonomous delivery. Set
`MERGE_COMMIT_SHA` from the GitHub merge result before executing the saved
post-merge plan. The post-merge executor regenerates release artifacts for the
merge commit, runs final candidate-continuity verification, and writes
`observability/real-autonomous-delivery-verification-report.json`:

```bash
export MERGE_COMMIT_SHA=<github-merge-commit-sha-after-merge>

npm run autonomy:execute-real-delivery-plan -- \
  --plan observability/real-delivery-plan.json \
  --stage post-merge \
  --execute \
  --report observability/real-delivery-plan-execution-post-merge.json \
  --json

npm run autonomy:verify-real-delivery-plan-execution -- \
  --plan observability/real-delivery-plan.json \
  --pre-merge-report observability/real-delivery-plan-execution-pre-merge.json \
  --post-merge-report observability/real-delivery-plan-execution-post-merge.json \
  --final-verification-report observability/real-autonomous-delivery-verification-report.json \
  --report observability/real-delivery-plan-execution-audit.json \
  --json
```

The candidate verifier runs before push/deploy from the current git worktree and
rejects default branches, docs-only changes, missing commit/PR identity, missing
low-risk scope, missing production-safety evidence, missing executable test
commands, broad change sets, missing hosted deployment targets, missing rollback
plans, and source-integrity failures. With `--run-test-commands`, it executes the
candidate's listed test commands and fails on any non-zero exit. With
`--require-final-release-proof`, it also requires `--production-safe`, a
matching production-safety artifact passed through
`--production-safety-evidence`, `--rollback-verified`, a matching
rollback-verification artifact passed through `--rollback-evidence`, and a live
hosted deployment health check through `--verify-deployment-health`. The
`--out` artifact is written even when the gate fails, so rejected candidates keep
their scoped test, rollback, and deployment-health evidence for review. The
post-run verifier rejects `phase6_complete` artifacts that still point at
localhost/private URLs, the default pilot PR, docs-only scope, missing test or
Merge readiness checks, missing deploy health, or missing verified rollback
evidence. It also requires candidate proof continuity and rejects final evidence
that no longer matches the pre-run low-risk candidate proof, including branch,
commit, PR, changed files, deployment URL, and rollback target.

Use a manifest when the local workspace contains unrelated work but the PR will
carry one scoped low-risk change:

```json
{
  "schemaVersion": "real-delivery-candidate.v1",
  "source": {
    "branchName": "<branch-name>",
    "commitSha": "<implementation-commit-sha>",
    "prUrl": "https://github.com/wiinc1/engineering-team/pull/<pr-number>",
    "prNumber": "<pr-number>"
  },
  "release": {
    "environment": "staging",
    "deploymentUrl": "https://<hosted-staging-url>",
    "healthCheckPath": "/",
    "productionSafetyEvidence": "observability/release/production-safety.json",
    "productionSafe": true
  },
  "rollback": {
    "target": "<last-known-good-release>",
    "plan": "Revert the scoped PR and redeploy the previous release.",
    "evidence": "observability/release/rollback-verification.json",
    "verified": false
  },
  "risk": {
    "level": "low",
    "productionSafe": true
  },
  "scope": {
    "maxChangedFiles": 10,
    "changedFiles": [
      "lib/task-platform/factory-delivery-queue-status.js",
      "lib/audit/factory-queue-http.js",
      "tests/unit/factory-queue-status.test.js"
    ]
  },
  "tests": {
    "commands": [
      "node --test tests/unit/factory-queue-status.test.js"
    ]
  }
}
```

Factory workers can use the same collector when processing queued work:

```bash
npm run factory:orchestrator -- \
  --once \
  --collect-real-evidence \
  --require-real-evidence \
  --release-env staging \
  --repository wiinc1/engineering-team \
  --branch "$BRANCH_NAME" \
  --implementation-commit-sha "$IMPLEMENTATION_COMMIT_SHA" \
  --pr-url "$PR_URL" \
  --pr-number "$PR_NUMBER" \
  --auto-merge \
  --fix-commit-sha "$FIX_COMMIT_SHA" \
  --deployment-url "$DEPLOYMENT_URL" \
  --production-safety-evidence "$PRODUCTION_SAFETY_EVIDENCE" \
  --rollback-target "$ROLLBACK_TARGET" \
  --rollback-evidence "$ROLLBACK_EVIDENCE" \
  --rollback-verified \
  --risk-level low \
  --production-safe \
  --health-check-path / \
  --test-command "node --test tests/unit/factory-queue-status.test.js" \
  --candidate-proof observability/factory-delivery/real-delivery-candidate-proof.json \
  --final-evidence observability/factory-delivery/real-autonomous-delivery-evidence.json
```

Before phases 2-6 run in real-evidence mode, the factory worker writes and
enforces a `real-delivery-candidate-proof.v1` artifact. Missing low-risk scope,
test commands, hosted deploy health, production-safety evidence, or verified
rollback evidence fails the item before phase execution. The factory queue
backend must remain `postgres` for staging and production. `--allow-file-queue`
is reserved for isolated local smoke fixtures.

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
- [ ] Local deploy validation (`lint`, `test:unit`, `standards:check`) recorded (GP-023)
- [ ] `observability/golden-path-pilot.json` committed with step timestamps

### Deliverable
Docs-only marker: golden-path section in README + evidence report.

### Risk
Simple, reversible, no production data/auth/schema changes.
```

### ET task creation (manual or scripted)

**Scripted bootstrap (preferred — local Postgres stack running):**

```bash
export AUTH_JWT_SECRET=golden-path-local-dev-secret

node scripts/seed-golden-path-phase0.js \
  --epic-issue 269 \
  --child-issue <CHILD_ISSUE_NUMBER> \
  --child-issue-url https://github.com/wiinc1/engineering-team/issues/<CHILD_ISSUE_NUMBER> \
  --base-url http://127.0.0.1:13000

# Fast isolated proof (file backend, no UI/forgeadapter fidelity):
node scripts/seed-golden-path-phase0.js --local \
  --epic-issue 269 \
  --child-issue <CHILD_ISSUE_NUMBER> \
  --child-issue-url https://github.com/wiinc1/engineering-team/issues/<CHILD_ISSUE_NUMBER>
```

**Hosted replay** (only when a deployed ET API + operator session are available):

```bash
# Preflight: workers + projection on Supabase (uses /api/v1 routes)
export AUTH_PROD_BASE_URL=https://factory.engineering-team.local
export AUDIT_WORKERS_SMOKE_BASE_URL="$AUTH_PROD_BASE_URL"
npm run audit:workers:production-smoke

node scripts/seed-golden-path-phase0.js \
  --epic-issue 269 \
  --child-issue <CHILD_ISSUE_NUMBER> \
  --child-issue-url https://github.com/wiinc1/engineering-team/issues/<CHILD_ISSUE_NUMBER> \
  --base-url https://<your-hosted-et-api>
```

`replay-golden-path-postgres.js` sets `PGSSLMODE=disable` before forge seed for local Docker Postgres; hosted replay uses Vercel `DATABASE_URL` with verified TLS.

Writes `observability/golden-path-pilot.json` with `projectId`, `taskId`, and completed steps `GP-001`, `GP-002`, `GP-005`.

**Manual UI fallback:** task creation with `DRAFT`, link `github_issue_url`, copy issue body into intake fields.

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
npm run audit:project -- . 100
```

See Issue #209 manual-action log for when this is `operator intervention` vs routine.

**Scripted Phase 1 (local Postgres — with `dev:golden-path:up` running):**

```bash
export AUTH_JWT_SECRET=golden-path-local-dev-secret

node scripts/run-golden-path-phase1.js --bootstrap \
  --base-url http://127.0.0.1:13000 \
  --child-issue <issue-number> \
  --child-issue-url https://github.com/wiinc1/engineering-team/issues/<issue-number>
```

Workers in the dev stack handle projection catch-up; golden-path phase runners only fall back to `npm run audit:project` when `workflow_projection_lag_seconds` stays above the threshold.

**Scripted Phase 1 (persistent file backend — fast proof, completed pilot #271):**

```bash
node scripts/run-golden-path-phase1.js --local --bootstrap \
  --child-issue <issue-number> \
  --child-issue-url https://github.com/wiinc1/engineering-team/issues/<issue-number>

node scripts/run-golden-path-phase1.js --local \
  --persist-dir observability/golden-path-local-stack/audit-data
```

**Hosted replay:**

```bash
node scripts/run-golden-path-phase1.js \
  --base-url https://<your-hosted-et-api> \
  --task-id <TASK_ID> \
  --child-issue <issue-number>
```

After each write on production Postgres, run bounded projection catch-up before the next gate.

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

### Phases 2–6 (scripted, local Postgres stack)

With `dev:golden-path:up` running:

```bash
export AUTH_JWT_SECRET=golden-path-local-dev-secret
export FORGE_SERVICE_TOKEN=local-golden-path-forge-token

node scripts/run-golden-path-phases.js \
  --base-url http://127.0.0.1:13000 \
  --from 2 --to 6 \
  --skip-delegation-smoke \
  --operator-url http://127.0.0.1:15173
```

Or use the file-backend persistent pilot dir from issue #271:

```bash
node scripts/run-golden-path-phases.js --local \
  --persist-dir observability/golden-path-local-stack/audit-data \
  --from 2 --to 6 --skip-delegation-smoke \
  --operator-url http://127.0.0.1:15173
```

### Seed task for forgeadapter (manual / debugging)

```bash
export DATABASE_URL=postgres://audit:audit@127.0.0.1:15432/engineering_team
export AUDIT_STORE_BACKEND=postgres
export FORGE_SERVICE_TOKEN=local-golden-path-forge-token
npm run forge:local-smoke:seed -- --task-id TSK-GOLDEN001
```

Verify:

```bash
curl -s -H "Authorization: Bearer local-golden-path-forge-token" \
  http://127.0.0.1:13000/tasks/TSK-GOLDEN001/forge-execution-readiness | jq .
```

### forgeadapter lifecycle smoke (CI-style, separate from dev stack)

```bash
cd forgeadapter
RUN_LOCAL_STACK_SMOKE=1 ENGINEERING_TEAM_DIR=../engineering-team \
  node --test tests/e2e/lifecycle-local-stack.test.js
```

### Manual forge start (GP-011)

```bash
curl -s -X POST \
  -H "Authorization: Bearer local-forgeadapter-token" \
  http://127.0.0.1:14010/tasks/TSK-GOLDEN001/start | jq .
```

**Bridge:** With `ET_FORGE_DISPATCH_ENABLED=true`, contract approval auto-calls forgeadapter start when execution-ready. Manual `curl` remains for debugging.

---

## Phase 3 — QA (intentional fail)

| Step | Action | System | Manual? |
| --- | --- | --- | --- |
| GP-015 | Record QA **fail** (`runType=initial`) | ET | no (`golden-path:smoke:gp-015`) |
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
  http://127.0.0.1:14010/tasks/TSK-GOLDEN001/resume | jq .
```

**Bridge:** With `ET_FORGE_DISPATCH_ENABLED=true`, initial QA fail auto-submits a forge QA reject packet (GP-016). Engineer submission v2 auto-calls forgeadapter resume (GP-018). QA retest pass auto-approves forge gates and records ET close recommendations (GP-020/GP-021). Manual `curl` remains for debugging.

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
  http://127.0.0.1:14010/tasks/TSK-GOLDEN001/complete | jq .
```

**Gap:** ET close review and forge gates are **parallel systems** — both must be satisfied manually.

---

## Phase 6 — Deploy + closeout

| Step | Action | System | Manual? |
| --- | --- | --- | --- |
| GP-022 | Merge PR (checks green) | GitHub | yes |
| GP-023 | **Local** deploy validation (`lint`, `test:unit`, `standards:check`) | engineering-team | yes |
| GP-024 | Supabase | — | **n/a** locally (use Docker Postgres); prod replay only |
| GP-025 | Redis | — | **out of scope** |
| GP-026 | SRE monitoring approval | ET | yes (waivable on local pilot) |
| GP-027 | Closeout report + manual-action log | ET | yes |

**Local (default):**

`vitest.config.ts` excludes `observability/**` so forgeadapter worktrees under `observability/golden-path-local-dev/` do not pollute GP-023 `test:unit` during phase 6 closeout.

`scripts/run-unit-tests.js` clears shell `DATABASE_URL`, `VERCEL`, and related golden-path env vars before `npm run test:unit` so local stack sessions do not route unit tests to shared Postgres.

```bash
# With dev stack up — validation only; UI already at http://127.0.0.1:15173
npm run lint && npm run test:unit && npm run standards:check

node scripts/run-golden-path-phases.js \
  --base-url http://127.0.0.1:13000 \
  --from 6 --to 6 \
  --operator-url http://127.0.0.1:15173
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
| PR + deploy | PR URL, merge SHA; GP-023 validation log; operator UI URL (`deploy.operatorUrl`) |

### Manual-action classifications

Same as #209:

- `routine observation` — read-only checks
- `required approval` — expected human gates
- `operator intervention` — corrective action after a blocker

---

## Factory orchestrator (single-server autonomous loop)

With the golden-path stack running on this server (`npm run dev:golden-path:up`), submit requirements and let the orchestrator advance each queued item through intake → phase 1 → phases 2–6.

```bash
# 1) Start stack (optionally enable continuous orchestrator ticks)
FF_FACTORY_ORCHESTRATOR_ENABLED=true \
OPENCLAW_BASE_URL=http://127.0.0.1:18789 \
npm run dev:golden-path:up

# 2) Submit requirements (JSON file or inline)
cat > /tmp/factory-requirements.json <<'EOF'
[
  {
    "title": "Add factory submit scope validation",
    "requirements": "Implement a low-risk bugfix that preserves code-change scope metadata when factory requirements are submitted inline. Include focused unit coverage for the parser and keep the rollback path to reverting the PR.",
    "templateTier": "Standard",
    "changeKind": "bugfix",
    "changedFiles": [
      "scripts/submit-factory-requirements.js",
      "tests/unit/factory-delivery.test.js"
    ]
  }
]
EOF
npm run factory:submit -- --file /tmp/factory-requirements.json
# Equivalent inline form:
npm run factory:submit -- \
  --title "Add factory submit scope validation" \
  --requirements "Preserve code-change scope metadata for inline factory submissions and add focused unit coverage." \
  --change-kind bugfix \
  --changed-file scripts/submit-factory-requirements.js \
  --changed-file tests/unit/factory-delivery.test.js
```

For hosted real-delivery queue items, include the PR, deployment, rollback,
health, and release-artifact inputs at submit time. Postgres submission runs the
same real-evidence preflight as the worker before inserting the row. On success,
the JSON response includes `items[].realDelivery.preflight.ok: true`; on failure,
no durable queue row is created.

```bash
npm run factory:submit -- \
  --title "Refresh release evidence after merge" \
  --requirements "Keep phase 6 release artifacts keyed to the GitHub merge commit." \
  --change-kind bugfix \
  --changed-file lib/task-platform/golden-path-release-evidence-refresh.js \
  --changed-file tests/unit/golden-path-phase6-real-merge.test.js \
  --base-url "$HOSTED_API_URL" \
  --operator-url "$HOSTED_OPERATOR_URL" \
  --repository wiinc1/engineering-team \
  --branch "$BRANCH_NAME" \
  --implementation-commit-sha "$COMMIT_SHA" \
  --pr-url "$PR_URL" \
  --auto-merge \
  --github-token "$GITHUB_TOKEN" \
  --checks-file observability/github-checks.json \
  --required-checks-file observability/required-checks.json \
  --branch-protection-file observability/branch-protection.json \
  --merge-readiness-file observability/merge-readiness.json \
  --test-command "node --test tests/unit/golden-path-phase6-real-merge.test.js" \
  --risk-level low \
  --production-safe \
  --production-safety-evidence observability/release/production-safety.json \
  --rollback-target "$ROLLBACK_TARGET" \
  --rollback-evidence observability/release/rollback-verification.json \
  --rollback-verified \
  --deployment-url "$DEPLOYMENT_URL" \
  --release-env staging \
  --health-check-path /version \
  --require-health-commit \
  --release-artifact-dir observability/release \
  --use-existing-release-artifacts

# 3) Advance queue (one-shot or loop)
npm run factory:orchestrator -- --once
# or continuous:
npm run factory:orchestrator -- --interval-ms 15000
```

Queue state is durable by default in Postgres table `factory_delivery_queue` with idempotent submit, row leases, retry backoff, expired-lease recovery, and `dead_letter` terminal state. Per-item evidence remains in `observability/factory-delivery/<queue-id>.json`. The Autonomy metrics dashboard and `GET /api/v1/factory/queue` expose the current pending, leased, retrying, completed, dead-letter, and per-item `realDelivery.preflight` state for operator review. After an SRE/admin reviews the failure and records a reason, `POST /api/v1/factory/queue/<queue-id>/requeue` with `factory-queue:write` requeues only tenant-scoped rows already in `dead_letter`, clears stale lease/error fields, and resumes from the recorded failed stage. Real-delivery requeue also runs the same preflight before mutating the row; if required proof is still missing, the row stays in `dead_letter`.

```bash
npm run audit:migrate
npm run factory:queue:migrate -- --dry-run
npm run factory:queue:migrate -- --database-url "$FACTORY_QUEUE_DATABASE_URL"
npm run factory:submit -- --file /tmp/factory-requirements.json
npm run factory:orchestrator -- --once

curl -sS -X POST "$OPERATOR_URL/api/v1/factory/queue/$QUEUE_ID/requeue" \
  -H "authorization: Bearer $SRE_TOKEN" \
  -H "content-type: application/json" \
  --data '{"reason":"transient dependency recovered and reviewed by SRE"}'
```

`factory:queue:migrate` imports the legacy `observability/factory-delivery-queue.json` rows into `factory_delivery_queue`. Existing file-queue `failed` items are imported as `dead_letter`. Legacy `phase6_complete` rows stay at `phase6_complete` with `completed_at = null`; the durable queue only records `completed` after final real-delivery evidence verification passes.

Use `FACTORY_QUEUE_BACKEND=file FACTORY_ALLOW_FILE_QUEUE=true` only for isolated local smoke fixtures with a non-default `FACTORY_QUEUE_PATH` or `--queue`. The migrated default `observability/factory-delivery-queue.json` path is reserved for the Postgres migration marker; writing live queue items there should fail.

The orchestrator reuses golden-path phase runners (`run-golden-path-phase1.js`, `run-golden-path-phases.js`) and existing `ET_FORGE_DISPATCH_ENABLED` bridge behavior from `audit-workers`.

---

## Automation priority (from manual-step inventory)

| Priority | Step IDs | Why |
| --- | --- | --- |
| P0 | GP-002 | Issue → task intake normalizer |
| P0 | GP-011, GP-016, GP-018, GP-020, GP-021 | **Implemented:** `et-forge-dispatch-bridge` when `ET_FORGE_DISPATCH_ENABLED=true` |
| P0 | GP-007 | Projection worker always-on (blocks workflow gates) |
| P1 | GP-015 | QA fail recording + forge QA reject coordination (phase runner + bridge) |
| P1 | GP-013 | Live OpenClaw delegation smoke (`--require-delegation-smoke` with real runtime URLs) |
| P2 | GP-003, GP-004, GP-014 | Agent-driven refine + implement |
| P2 | GP-023 | CI validation on merge (local proof already scripted) |
| P3 | GP-025 | Redis — only if target apps require it |

---

## Rollback

Docs-only pilot: revert the PR. Preserve task history, evidence JSON, and this runbook until metrics epic (#156) absorbs the learnings.

---

## Milestone A — coordinated stack factory reliability

Before agent-driven autonomy (Milestone B), prove the **local golden-path stack** (not Vercel/Supabase) runs workers, bridge, intake, and factory orchestrator reliably:

```bash
npm run dev:golden-path:up
export AUTH_JWT_SECRET=golden-path-local-dev-secret
npm run milestone-a:verify
```

Operator checklist: `docs/runbooks/milestone-a-hosted-factory.md`.

## Related docs

- `scripts/dev-golden-path-stack.js` — local dev stack entrypoint (`npm run dev:golden-path:up`)
- `docs/runbooks/audit-foundation.md` — Docker Postgres + audit workers
- `docs/runbooks/supervised-autonomous-pilot.md` — Issue #209 ET-only pilot
- `docs/runbooks/workflow-delivery-loop.md` — QA fail/retest schema
- `../forgeadapter/docs/runbooks/phase2-local-smoke.md` — forge local stack
- `docs/architecture/openclaw-forge-delivery-architecture.md` — target architecture
- `prd/software-factory.md` — full factory vision
