# Issue #151 Requirements Audit

Date: 2026-05-08
Issue: https://github.com/wiinc1/engineering-team/issues/151  
Status: Superseded by registration cutover in Issues #160-#167; fresh registration production smoke evidence was captured and the ship gate now passes.

## Registration Cutover Update

Issue #160 defines the registration product policy and migration plan. Issue #167 removes magic-link from the active production contract. The Issue #151 production-auth status validator remains the release gate, but `AUTH_PRODUCTION_AUTH_STRATEGY=registration`, `observability/registration-auth-production-smoke.json`, and `npm run auth:registration:production-smoke` are now the required path.

## Requirement Audit

| Requirement | Implementation evidence | Verification status | Ship impact |
|---|---|---|---|
| README and auth runbooks show one current active strategy, deployment state, evidence artifact, and rollback target | `docs/runbooks/production-auth-status.md`; README production auth section; `docs/runbooks/production-identity-provider.md` | Implemented in repo; verified by `npm run auth:status:check` | Pass for repo docs |
| Registration production smoke validates credential login, `/auth/me`, protected routes, reset generic response, logout, and magic-link removal with redacted evidence | `scripts/verify-registration-production.js`; `tests/unit/registration-production-smoke.test.js`; artifact path `observability/registration-auth-production-smoke.json` | Implemented; live smoke passed on 2026-05-08 against deployment `dpl_EnEg7kdTW8Gad945cqjueAHhpte1` | Pass |
| OIDC production path is available when selected | `scripts/verify-oidc-production-smoke.js`; `lib/auth/oidc-production-smoke.js`; `docs/runbooks/production-auth-status.md`; `docs/runbooks/production-identity-provider.md`; existing browser OIDC callback tests | Implemented as OIDC-equivalent smoke and validator; not selected for current production strategy | Not blocking for current `registration` strategy |
| Internal bootstrap disabled in production and hidden on `/sign-in` | Existing config gate and browser tests; `src/app/auth-runtime-env.test.tsx`; `tests/browser/auth-shell.browser.spec.ts`; `docs/runbooks/production-auth-status.md` | Implemented; targeted browser and runtime tests passed | Pass |
| Issue #137 closure must use fresh evidence, not April issue #92 evidence | `docs/reports/ISSUE-137-production-login-evidence.md`; `lib/auth/production-status.js`; `npm run auth:status:check -- --require-complete` | Implemented; require-complete passes against fresh registration evidence | Pass |
| Deployment metadata included when available | `scripts/verify-registration-production.js`; `tests/unit/registration-production-smoke.test.js`; validator requires selected strategy, deployment URL/ID, and rollback target for ship | Implemented; artifact includes deployment URL, ID, selected strategy, and rollback target | Pass |
| Required workflow diagram | `docs/diagrams/workflow-production-auth-status-evidence.mmd` | Implemented; verified by status doc check | Pass |
| Required architecture diagram | `docs/diagrams/architecture-production-auth-status-evidence.mmd` | Implemented; verified by status doc check | Pass |
| Monitoring/dashboard status references | `monitoring/dashboards/production-auth-status.json`; existing `monitoring/alerts/auth-availability.yml` | Implemented; verified by status doc check | Pass |

## Ship Gate

Issue #151 may move to the ship portion of the workflow only after this command passes against a fresh production artifact generated on or after 2026-05-07:

```bash
npm run auth:status:check -- --require-complete
```

The ship gate passed on 2026-05-08 against `observability/registration-auth-production-smoke.json`, generated from the deployed registration auth candidate. Historical issue #92 and magic-link smoke artifacts remain audit history only and are intentionally rejected for this cutover.

## Standards Alignment

Issue #151 uses the standard compliance checklist below. The applicable standards areas are security, deployment and release, observability and monitoring, testing and quality assurance, and team process.

- Applicable standards areas: security, deployment and release, observability and monitoring, testing and quality assurance, coding and code quality, team and process.
- Evidence expected for this change: canonical production-auth status, docs consistency check, fresh production smoke artifact validation, sign-in UI verification, redaction validation, rollback evidence, and ship-gate audit.
- Gap observed: No remaining compliance gap. Documented rationale: the 2026-05-08 audit loop captured fresh deployed evidence verifying deployed env values, cookie behavior, protected-route access, logout revocation, reset generic response, magic-link removal, and rollback metadata for the selected registration strategy (source https://github.com/wiinc1/engineering-team/issues/151).

## Standards Compliance Checklist

### Linked Standards

- Standards document: `docs/standards/software-development-standards.md`
- Required gap statement format: `Gap observed: X. Documented rationale: Y (source Z).`

### Change Metadata

- Change or task ID: Issue #151
- Owner: Production auth owner
- Date: 2026-05-07
- Scope summary: Reconcile production auth status docs, validate smoke evidence shape, block issue closure on stale production auth evidence, and document rollback/monitoring status.

### Architecture and Design

- Applicable: Yes
- Evidence in this change: canonical status runbook, workflow diagram, architecture diagram, production smoke implementation split into CLI and reusable auth library.
- No gap remains. Fresh deployed-origin registration smoke evidence now proves the deployed auth provider path, cookie behavior, protected-route access, and rollback metadata required by Issue #151.

### Coding and Code Quality

- Applicable: Yes
- Evidence in this change: `lib/auth/registration-production-smoke.js`, `lib/auth/production-smoke-common.js`, `lib/auth/oidc-production-smoke.js`, smoke CLIs, `lib/auth/production-status.js`, `scripts/verify-production-auth-status.js`, and unit coverage.
- No gap remains. `npm run standards:check` passes after the maintainability gate was updated to ignore deleted tracked files during removal work.

### Testing and Quality Assurance

- Applicable: Yes
- Evidence in this change: production status validator tests, registration smoke evidence tests, targeted auth UI/browser tests, full suite, lint, and typecheck.
- No gap remains. Live production smoke ran with a dedicated registration account against the deployed origin on 2026-05-08 and passed.

### Deployment and Release

- Applicable: Yes
- Evidence in this change: `npm run auth:status:check -- --require-complete` enforces the release gate and rejects stale issue #92 evidence.
- No gap remains. `npm run auth:status:check -- --require-complete` passes because the checked-in registration evidence is fresh and includes selected strategy plus rollback target metadata.

### Observability and Monitoring

- Applicable: Yes
- Evidence in this change: `monitoring/dashboards/production-auth-status.json`, production status runbook monitoring references, and redacted smoke evidence validation.
- No gap remains for repository compliance. Monitoring dashboard and alert definitions are present, and the production smoke artifact supplies the deployed registration auth status evidence used by the release gate.

### Team and Process

- Applicable: Yes
- Evidence in this change: Issue #137 evidence report now points to Issue #151 and refuses stale issue #92-only closure evidence.
- No gap remains. Issue #137 closure can use the fresh registration evidence path because historical April evidence is no longer the active ship criterion.

## Required Evidence

- Applicable standards areas: security, deployment and release, observability and monitoring, testing and quality assurance.
- Evidence expected for this change: canonical production-auth status, docs consistency check, fresh production smoke artifact validation, sign-in UI verification, redaction validation, rollback evidence, and ship-gate audit.
- No gap remains. Fresh production smoke evidence for Issue #151 is present in this workspace and was generated against the deployed origin on 2026-05-08.
- Commands run: deterministic repository checks listed below; `npm run auth:registration:production-smoke` against the deployed origin; `npm run auth:status:check -- --require-complete`.
- Tests added or updated: `tests/unit/registration-production-smoke.test.js`, `tests/unit/oidc-production-smoke.test.js`, `tests/unit/production-auth-status.test.js`.
- Rollout or rollback notes: production rollout requires fresh registration smoke evidence, monitoring counts/classifications only, and rollback target for the selected `registration` strategy.
- Docs updated: README, production identity provider runbook, canonical production auth status runbook, Issue #137 evidence report, Issue #151 audit report, diagrams, and production auth dashboard stub.

## Verification Commands

Commands run on 2026-05-07:

```bash
node --test tests/unit/registration-production-smoke.test.js tests/unit/production-auth-status.test.js tests/unit/auth-config-check.test.js tests/unit/auth-admin-seed.test.js
./node_modules/.bin/vitest run src/app/auth-runtime-env.test.tsx src/app/AuthAppShell.test.tsx src/app/registration-auth-flows.test.tsx tests/visual/auth-sign-in.visual.spec.tsx
node scripts/run-playwright.js tests/browser/auth-shell.browser.spec.ts --project=chromium
DATABASE_URL=postgres://example AUTH_PRODUCTION_AUTH_STRATEGY=registration VITE_AUTH_PRODUCTION_AUTH_STRATEGY=registration AUTH_SESSION_SECRET=session-secret AUTH_EMAIL_PROVIDER=resend RESEND_API_KEY=resend-secret AUTH_EMAIL_FROM='Workflow <noreply@example.com>' AUTH_PUBLIC_APP_URL=https://app.example AUTH_REGISTRATION_MODE=admin-approved AUTH_REQUIRE_EMAIL_VERIFICATION=true AUTH_EMAIL_VERIFICATION_TTL_HOURS=24 AUTH_PASSWORD_RESET_TTL_MINUTES=30 AUTH_SESSION_TTL_HOURS=8 AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP=false VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED=false npm run auth:config:check
AUTH_PRODUCTION_AUTH_STRATEGY=oidc VITE_OIDC_DISCOVERY_URL=https://idp.example/.well-known/openid-configuration VITE_OIDC_CLIENT_ID=browser-client AUTH_JWT_ISSUER=https://idp.example AUTH_JWT_AUDIENCE=engineering-team AUTH_JWT_JWKS_URL=https://idp.example/.well-known/jwks.json AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP=false VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED=false npm run auth:config:check
npm run auth:config:check:vercel
AUTH_PROD_BASE_URL=https://app.example AUTH_PROD_REGISTRATION_EMAIL=smoke@example.com AUTH_PROD_REGISTRATION_PASSWORD=redacted-password AUTH_PROD_AUTH_STRATEGY=registration AUTH_PROD_DEPLOYMENT_ID=dpl_dry AUTH_PROD_COMMIT_SHA=abc1234 AUTH_PROD_ROLLBACK_TARGET=last-known-good-registration-config npm run auth:registration:production-smoke -- --allow-http --out /tmp/issue-151-dry-run-smoke.json
AUTH_PROD_BASE_URL=https://app.example AUTH_PROD_OIDC_DISCOVERY_URL=https://idp.example/.well-known/openid-configuration AUTH_PROD_OIDC_CLIENT_ID=browser-client AUTH_PROD_OIDC_ACCESS_TOKEN=redacted-token AUTH_PROD_OIDC_LOGOUT_URL=https://idp.example/logout AUTH_PROD_ROLLBACK_TARGET=last-known-good-oidc-config npm run auth:oidc:production-smoke -- --dry-run --evidence-out /tmp/issue-151-oidc-dry-run-smoke.json
npm run auth:status:check
npm run auth:status:check -- --require-complete
npm run test:ui
npm run test:security
npm run test:browser
npm run lint
npm run typecheck
npm test
npm run standards:check
npx vitest run tests/unit/task-creation-page.test.tsx src/app/AppNavigation.test.tsx
npx playwright test tests/browser/task-workspace.browser.spec.ts
```

Additional commands run on 2026-05-08:

```bash
npm run lint
npm run typecheck
npm run ownership:lint
npm run change:check
npm run standards:check
npm run test:unit
npm test
npm run coverage
AUTH_PROD_BASE_URL=https://engineering-team-2fvxttcgz-wiinc1-hotmailcoms-projects.vercel.app VERCEL_DEPLOYMENT_ID=dpl_EnEg7kdTW8Gad945cqjueAHhpte1 npm run auth:registration:production-smoke
npm run auth:status:check -- --require-complete
```

Observed result after live production smoke: deterministic repo checks pass, the deployed-origin smoke artifact is fresh and redacted, and `npm run auth:status:check -- --require-complete` passes.

## Audit Iterations

- 2026-05-07 initial audit: implemented canonical magic-link status, evidence validation, docs reconciliation, diagrams, dashboard reference, and Issue #137 stale-evidence closure guard.
- 2026-05-07 follow-up audit: found missing OIDC-equivalent production smoke/validator path. Resolved with `npm run auth:oidc:production-smoke`, OIDC evidence validation, unit coverage, docs, diagrams, and dashboard reference.
- 2026-05-07 follow-up audit: found absolute `--evidence` paths were treated as repo-relative. Resolved in `lib/auth/production-status.js` and covered by `tests/unit/production-auth-status.test.js`.
- 2026-05-07 follow-up audit: found repository maintainability hard-cap failures in task creation and workspace tests. Resolved by decomposing overlong React component/test functions; `npm run standards:check`, targeted Vitest/Playwright checks, and full `npm test` now pass.
- 2026-05-08 final audit: captured deployed registration smoke evidence, verified the status gate with `--require-complete`, re-ran repository gates, and found no remaining compliance gaps for Issue #151 or the registration cutover.
