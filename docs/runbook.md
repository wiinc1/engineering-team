# Runbook

## Scope

This runbook is the root operator entry point for the Engineering Team Software
Factory control plane. It points to exact local verification commands, release
evidence, production auth checks, task-platform recovery, monitoring assets,
rollback controls, and protected-path ownership.

Detailed domain runbooks remain authoritative for their domains:

- Production auth status: `docs/runbooks/production-auth-status.md`
- Production identity provider: `docs/runbooks/production-identity-provider.md`
- Audit foundation: `docs/runbooks/audit-foundation.md`
- Execution Contract refinement: `docs/runbooks/execution-contract-refinement.md`
- Task platform rollout: `docs/runbooks/task-platform-rollout.md`
- Workflow delivery loop: `docs/runbooks/workflow-delivery-loop.md`
- Specialist delegation: `docs/runbooks/specialist-delegation.md`
- Orchestration scheduler and visibility: `docs/runbooks/orchestration-scheduler.md`, `docs/runbooks/orchestration-visibility.md`
- Dependency planner: `docs/runbooks/dependency-planner.md`

## Verification

### Full local ship gate

`make verify` is the canonical local merge-readiness command for the real
application runtime and the standards system. It runs DESIGN.md gates,
standards policy validators, `npm run lint`, `npm run typecheck`, `npm run
test:unit`, `npm run test:browser`, `npm run build`, `npm run
standards:check`, Python standards tests, artifact provenance, and test-policy
validation.

```bash
make verify
```

Use this before protected-path, runtime, broad product, deployment, or release
work. The pre-push hook also runs `make verify`.

### Fast local checks

Run these before small documentation or governance changes:

```bash
make standards-policy-gates
npm run standards:check
```

Run focused tests for the changed area. Examples:

```bash
node --test tests/unit/governance/*.test.js
python3 -m unittest tests/test_docs_freshness_validator.py
```

### Browser and application checks

Run these before browser, auth, task workspace, task detail, assignment, or
route changes:

```bash
npm run test:unit
npm run test:browser
npm run build
```

For browser-quality gate changes, run the focused quality slice and the CI
WebKit matrix before merging:

```bash
npm run test:browser:quality
PLAYWRIGHT_INCLUDE_WEBKIT=1 npm run test:browser
```

Run the complete Node/browser suite before merging broad product or platform
changes, or run `make verify` when you also need standards and design evidence:

```bash
npm test
```

### Standards and DESIGN.md checks

`make standards-policy-gates` is the standards-only policy slice. `npm run
standards:check` is the Node standards, maintainability, and coverage-policy
slice. `make verify` runs both of those plus the application runtime gates.

```bash
make standards-policy-gates
npm run standards:check
```

### Tracked-file linting

`npm run lint` discovers authored JavaScript and TypeScript files from git
tracked and untracked, non-ignored files instead of a hand-maintained target
list. Current included roots are `api/`, `lib/`, `scripts/`, `src/`, and
`tests/`; current code extensions are `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`,
and `.tsx`.

The lint gate skips explicit generated and third-party boundaries such as
`generated/`, `node_modules/`, `dist/`, `coverage/`, `build/`, `third_party/`,
`vendor/`, `.artifacts/`, and temporary/report output directories. Findings
are line-oriented and redaction-safe.

Use `config/lint-source-allowlist.json` only for legitimate readability
exceptions. Each exception must include the exact path or grouped paths, the
readability rule, owner, reason, and follow-up. Lint fails stale entries when
the path is no longer scanned or the readability finding no longer exists.

For UI token work, run:

```bash
npm run design:tokens
npm run design:tokens:check
npm run design:tokens:enforce
npm run design:audit:check
npm run design:change-guard
make verify
```

### CI mapping

| Local command | GitHub Actions job or step |
|---|---|
| `npm run pr:check`, `npm run change:check`, `npm run ownership:lint` | `Pull request metadata` in `.github/workflows/validation.yml` |
| `npm run coverage`, `npm run standards:check`, `npm run test:unit` | `Repo validation` in `.github/workflows/validation.yml` |
| `npm run test:browser` | `Browser validation` in `.github/workflows/validation.yml` |
| `make verify` | `verify` in `.github/workflows/verify.yml` |
| `npm run governance:drift:check` | `Governance drift report` in `.github/workflows/governance-drift.yml` |

Read `DESIGN.md` before UI changes, change reusable visual semantics there
first, and avoid hard-coded visual values in migrated CSS. A rare one-off must
use `DESIGN-TOKEN-EXCEPTION: <short reason and follow-up if reusable>`.
Reusable exceptions must become `DESIGN.md` tokens.

### Local hooks

Install local hooks once per clone:

```bash
scripts/setup-local-hooks.sh
```

The pre-commit hook runs token drift, token usage, generated audit, and design
change guard checks. The pre-push hook runs `make verify`.

If an authored UI file changes but there is truly no visual or UX impact,
create `docs/design/no-design-impact.txt` with a short reason. Keep the marker
local, do not use it for reusable visual decisions, and remove it after the
change is complete. The guard automatically treats trailing-whitespace-only UI
diffs as lint cleanup, so those diffs do not need the marker or a design
artifact.

## Local Development

Start the browser app:

```bash
npm run dev
```

Start local PostgreSQL only. This is the standard backend for local task
platform development and host-run API scripts:

```bash
npm run dev:postgres:up
```

Start the audit API, workers, PostgreSQL, and Pushgateway:

```bash
npm run dev:audit:up
```

Stop local services:

```bash
npm run dev:audit:down
```

Reset disposable local database state:

```bash
npm run dev:postgres:reset
```

Use this placeholder local host database URL shape for host-run scripts:

```bash
DATABASE_URL=postgres://<local-user>:<local-password>@127.0.0.1:5432/<local-database>
```

The file backend is a fallback-only test/dev harness. It requires an explicit
local/test opt-in:

```bash
AUDIT_STORE_BACKEND=file ALLOW_FILE_AUDIT_BACKEND=true node <isolated-test-script>
```

Production and staging must use PostgreSQL. Runtime startup fails closed when
`DATABASE_URL` is missing and no explicit local/test file fallback is set.

## Release Evidence

For any production-affecting change, capture:

- issue or PR reference
- commit SHA
- deployment URL or deployment ID when deployed
- commands run and pass/fail results
- test, browser, security, performance, and standards evidence paths
- updated docs or explicit no-impact rationale
- monitoring dashboard and alert evidence
- rollback target and rollback verification
- redacted smoke artifacts when auth or task-platform behavior changes

The release gate is environment-specific. `dev` can validate with local lint,
typecheck, and test evidence. `staging` and `prod` must include a live
`deploy-record`, `post-deploy-health`, immutable artifact evidence, and a
rollback target; `prod` also requires explicit `rollback-verification`.
Hosted health evidence must name the environment, deployment URL, checked SHA,
and status. Production rollback evidence must name the rollback target,
verification status, and verification timestamp.
Assemble the final gate input from concrete artifact files instead of editing
the release evidence bundle by hand:

```bash
python3 dev-standards/tooling/build_release_evidence.py \
  --environment staging \
  --evidence build=.artifacts/build.json \
  --evidence compatibility-report=.artifacts/compatibility-report.json \
  --evidence vulnerability-scan=.artifacts/vulnerability-scan.json \
  --evidence secret-scan=.artifacts/secret-scan.json \
  --deploy-record .artifacts/deploy-record.json \
  --post-deploy-health .artifacts/post-deploy-health.json \
  --immutable-artifact .artifacts/immutable-artifact.json
```

For production, add `--rollback-verification .artifacts/rollback-verification.json`.
Use `RELEASE_ENV=staging make standards-policy-gates` or
`RELEASE_ENV=prod make standards-policy-gates` before claiming hosted
promotion readiness.

Golden-path strict mode can assemble those artifacts from a real GitHub PR and
hosted health check when the branch, commit, PR, required checks, deployment URL,
and rollback target already exist:

```bash
RELEASE_ENV=staging \
CHANGE_KIND=bugfix \
FACTORY_TEMPLATE_TIER=Standard \
DEPLOYMENT_URL=<hosted-staging-url> \
ROLLBACK_TARGET=<last-known-good-release-or-url> \
GITHUB_TOKEN=<github-token> \
node scripts/run-golden-path-phases.js \
  --from 6 --to 6 \
  --collect-real-evidence \
  --require-real-evidence \
  --agent-driven-phases \
  --pr-url https://github.com/wiinc1/engineering-team/pull/<pr-number>
```

For `RELEASE_ENV=prod`, add `--rollback-verified` only after rollback has been
verified. Otherwise production release evidence fails closed.

Generated evidence must not include raw secrets, raw cookies, bearer tokens,
database URLs, API keys, passwords, CSRF values, raw email bodies, or private
production identifiers.

## Production Auth Operations

Current canonical production auth posture is documented in
`docs/runbooks/production-auth-status.md`.

Active production strategy: `registration`.

Before shipping auth-affecting production changes:

```bash
npm run auth:config:check
npm run auth:config:check
npm run auth:registration:production-smoke
npm run auth:status:check -- --require-complete
```

OIDC is supported only when explicitly selected and freshly evidenced:

```bash
npm run auth:oidc:production-smoke -- --require-complete
```

Canonical auth evidence artifacts:

- `observability/registration-auth-production-smoke.json`
- `observability/oidc-production-smoke.json` when OIDC is selected
- `observability/auth-config-diagnostics.json`

Rollback target: restore the last known-good registration deployment and auth
configuration. The emergency `internal-bootstrap` strategy requires explicit
approval and must stay disabled in normal production builds.

## Task Platform Operations

Use `docs/runbooks/task-platform-rollout.md` for detailed rollout, smoke, and
rollback procedures.

Local or environment rollout sequence:

```bash
DATABASE_URL=postgres://... TENANT_ID=engineering-team npm run task-platform:rollout
```

Individual recovery commands:

```bash
DATABASE_URL=postgres://... npm run audit:migrate
DATABASE_URL=postgres://... TENANT_ID=engineering-team npm run task-platform:backfill
DATABASE_URL=postgres://... TENANT_ID=engineering-team npm run task-platform:verify
```

`npm run task-platform:verify` fails when canonical rows and sync checkpoints
drift. The JSON output includes `database.drift.findings` and remediation for
missing checkpoints, version mismatches, stale projection sequence numbers, and
failed sync statuses.

If task projections drift:

```bash
npm run audit:rebuild -- /path/to/repo-root
npm run audit:project -- /path/to/repo-root
```

If outbox delivery stalls:

```bash
npm run audit:outbox -- /path/to/repo-root
```

Rollback posture is additive-first:

1. Stop read-path cutover work.
2. Keep legacy audit-backed routes available during the incident.
3. Disable assignment or task-platform flags only when their surface is the incident source.
4. Stop creating merge-readiness reviews if current-review uniqueness or stale-write conflicts appear.
5. Disable GitHub check-run client configuration to stop external writes while keeping structured review rows readable.
6. Rebuild projections or rerun idempotent backfill only after root cause is understood.

## Monitoring And Alerts

Monitoring assets live under:

- `monitoring/dashboards/`
- `monitoring/alerts/`
- `observability/` for generated local or smoke artifacts

Key dashboards and alerts:

| Domain | Dashboard | Alerts |
|---|---|---|
| Audit foundation | `monitoring/dashboards/audit-foundation.json` | `monitoring/alerts/audit-foundation.yml` |
| Task assignment | `monitoring/dashboards/task-assignment.json` | `monitoring/alerts/task-assignment.yml` |
| Registration auth | `monitoring/dashboards/registration-auth-security.json` | `monitoring/alerts/registration-auth-security.yml` |
| Production auth | `monitoring/dashboards/production-auth-status.json` | `monitoring/alerts/auth-availability.yml` |
| Delegation | `monitoring/dashboards/real-specialist-delegation.json` | `monitoring/alerts/real-specialist-delegation.yml` |
| Orchestration | `monitoring/dashboards/orchestration-visibility.json`, `monitoring/dashboards/orchestration-scheduler.json` | matching orchestration alert files |
| Dependency planner | `monitoring/dashboards/dependency-planner.json` | `monitoring/alerts/dependency-planner.yml` |

During rollout or incident review, inspect:

- structured workflow audit log: `observability/workflow-audit.log`
- production auth smoke artifacts
- task-platform rollout verification output
- browser route errors and Core Web Vitals where available
- projection queue and outbox worker logs

## Feature Flags And Kill Switches

Feature-flag details live in `docs/feature-flags.md`.

Common controls:

- `FF_ASSIGN_AI_AGENT_TO_TASK`
- `FF_ASSIGN_AI_AGENT_TO_TASK_KILLSWITCH`
- `FF_REAL_SPECIALIST_DELEGATION`
- `FF_SPECIALIST_DELEGATION`
- `FF_DEPENDENCY_PLANNER`
- `FF_ORCHESTRATION_SCHEDULER`
- `FF_ORCHESTRATION_VISIBILITY`
- `FF_TASK_DETAIL_PAGE`
- auth strategy environment gates such as `AUTH_PRODUCTION_AUTH_STRATEGY`

Rollback should prefer a documented kill switch or feature flag when one exists.
If no safe flag exists, roll back the deployment and keep evidence of the
deployment ID, commit SHA, and verification result.

## Protected Paths And Emergency Review

Protected paths:

- `repo-contract.yaml`
- `agent-policy.yaml`
- `check-manifest.yaml`
- `dev-standards/`
- `.github/workflows/`
- `Makefile`
- `DESIGN.md`

Owner: primary and backup owner are declared in `repo-contract.yaml`.

Normal protected-path changes require:

- explicit human instruction
- human-plus-evidence review mode
- change metadata
- approval proof
- traceability evidence
- docs freshness evidence
- `make verify`

Emergency protected-path changes must:

1. Capture incident context and affected paths before editing.
2. Keep the change minimal and reversible.
3. Preserve or strengthen existing gates.
4. Run the fastest focused validation first.
5. Run `make verify` before final closure unless the incident owner records why that command is temporarily impossible.
6. Add follow-up work for any deferred verification.

## External System Failures

| System | Symptom | First response |
|---|---|---|
| Coordinated stack | Deployment fails, proxies break, or protected routes miss the API | Check Docker/operator host logs, reverse-proxy routes, env names, and auth config; restart stack or roll back to last known-good release |
| PostgreSQL or Supabase | Auth/task/audit writes fail or migrations hang | Stop rollout, verify `DATABASE_URL`, inspect migration state, run read-only SQL checks before retry |
| Resend | Verification or reset email delivery fails | Preserve generic user response, inspect registration dashboard/alerts, rerun auth smoke after provider recovery |
| OIDC provider | Hosted sign-in or callback fails | Confirm selected strategy is really `oidc`, inspect OIDC smoke artifact, revert to approved registration config only with product/security approval |
| GitHub | Merge-readiness check, PR summary, or branch-protection evidence fails | Treat as non-passing; verifier is read-only and must not mutate branch settings |
| Pushgateway | Local metric push fails | Continue state recovery, inspect worker logs, rerun metrics push after service recovery |

## Incident Closure

Close an incident or production-remediation issue only after:

- the active failure is mitigated or rolled back
- automated smoke or synthetic checks pass
- dashboards and alerts return to baseline
- evidence artifacts are redacted and linked
- rollback target is documented
- follow-up issues exist for deferred repairs or known gaps
- the GitHub issue or PR is updated with commands, evidence paths, and residual risk

## Diagrams

- Workflow: `docs/diagrams/workflow-architecture-runbooks.mmd`
- Container architecture: `docs/diagrams/architecture-architecture-runbooks.mmd`
