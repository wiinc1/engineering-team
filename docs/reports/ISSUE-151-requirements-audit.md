# Issue #151 Requirements Audit

Date: 2026-05-07  
Issue: https://github.com/wiinc1/engineering-team/issues/151  
Status: Repo implementation and deterministic verification complete; ship gate blocked until fresh production smoke evidence is available.

## Requirement Audit

| Requirement | Implementation evidence | Verification status | Ship impact |
|---|---|---|---|
| README and auth runbooks show one current active strategy, deployment state, evidence artifact, and rollback target | `docs/runbooks/production-auth-status.md`; README production auth section; `docs/runbooks/production-identity-provider.md` | Implemented in repo; verified by `npm run auth:status:check` | Pass for repo docs |
| Magic-link production smoke validates request, consume, `/auth/me`, protected routes, logout, replay rejection, and unknown-email suppression with redacted evidence | `scripts/verify-magic-link-production.js`; `tests/unit/magic-link-production-smoke.test.js`; artifact path `observability/magic-link-production-smoke.json` | Script and tests implemented; live smoke still requires production operator email/link | Blocks ship until fresh production run passes |
| OIDC production path is available when selected | `scripts/verify-oidc-production-smoke.js`; `lib/auth/oidc-production-smoke.js`; `docs/runbooks/production-auth-status.md`; `docs/runbooks/production-identity-provider.md`; existing browser OIDC callback tests | Implemented as OIDC-equivalent smoke and validator; not selected for current production strategy | Not blocking for current `magic-link` strategy |
| Internal bootstrap disabled in production and hidden on `/sign-in` | Existing config gate and browser tests; `src/app/auth-runtime-env.test.tsx`; `tests/browser/auth-shell.browser.spec.ts`; `docs/runbooks/production-auth-status.md` | Implemented; targeted tests required before ship | Pass after tests |
| Issue #137 closure must use fresh evidence, not April issue #92 evidence | `docs/reports/ISSUE-137-production-login-evidence.md`; `lib/auth/production-status.js`; `npm run auth:status:check -- --require-complete` | Implemented; require-complete intentionally fails until fresh evidence exists | Blocks ship until fresh production run passes |
| Deployment metadata included when available | `scripts/verify-magic-link-production.js`; `tests/unit/magic-link-production-smoke.test.js`; validator requires selected strategy, deployment URL/ID, and rollback target for ship | Implemented | Pass after fresh artifact includes metadata |
| Required workflow diagram | `docs/diagrams/workflow-production-auth-status-evidence.mmd` | Implemented; verified by status doc check | Pass |
| Required architecture diagram | `docs/diagrams/architecture-production-auth-status-evidence.mmd` | Implemented; verified by status doc check | Pass |
| Monitoring/dashboard status references | `monitoring/dashboards/production-auth-status.json`; existing `monitoring/alerts/auth-availability.yml` | Implemented; verified by status doc check | Pass |

## Ship Gate

Issue #151 must not move to the ship portion of the workflow until this command passes against a fresh production artifact generated on or after 2026-05-07:

```bash
npm run auth:status:check -- --require-complete
```

At the time this audit was added, the checked-in smoke artifact is historical issue #92 evidence from 2026-04-28. It is useful regression evidence but is intentionally rejected by the Issue #151 ship gate.

## Standards Alignment

Issue #151 uses the standard compliance checklist below. The applicable standards areas are security, deployment and release, observability and monitoring, testing and quality assurance, and team process.

- Applicable standards areas: security, deployment and release, observability and monitoring, testing and quality assurance, coding and code quality, team and process.
- Evidence expected for this change: canonical production-auth status, docs consistency check, fresh production smoke artifact validation, sign-in UI verification, redaction validation, rollback evidence, and ship-gate audit.
- Gap observed: fresh production smoke evidence for Issue #151 is not present in this local workspace. Documented rationale: production authentication changes require direct operational verification on the deployed origin because local tests cannot prove deployed env values, provider delivery, cookie behavior, protected-route access, or rollback readiness (source https://github.com/wiinc1/engineering-team/issues/151).

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
- Gap observed: Fresh deployed-origin smoke evidence is not present in this workspace. Documented rationale: local architecture checks cannot prove the deployed auth provider, cookie, email delivery, protected-route, or rollback behavior (source https://github.com/wiinc1/engineering-team/issues/151).

### Coding and Code Quality

- Applicable: Yes
- Evidence in this change: `lib/auth/magic-link-production-smoke.js`, `lib/auth/oidc-production-smoke.js`, smoke CLIs, `lib/auth/production-status.js`, `scripts/verify-production-auth-status.js`, and unit coverage.
- Gap observed: `npm run standards:check` still reports unrelated maintainability violations in task-creation/navigation/workspace files. Documented rationale: those files are outside the Issue #151 change set and remain current-main cleanup work (source local `npm run standards:check` output on 2026-05-07).

### Testing and Quality Assurance

- Applicable: Yes
- Evidence in this change: production status validator tests, magic-link smoke evidence tests, targeted auth UI/browser tests, full suite, lint, and typecheck.
- Gap observed: Live production smoke with a freshly delivered link has not run. Documented rationale: the command needs production deployment access plus a fresh delivered magic-link URL and must be performed against the deployed origin before ship (source https://github.com/wiinc1/engineering-team/issues/151).

### Deployment and Release

- Applicable: Yes
- Evidence in this change: `npm run auth:status:check -- --require-complete` enforces the release gate and rejects stale issue #92 evidence.
- Gap observed: Ship gate currently fails because checked-in evidence predates 2026-05-07 and lacks selected auth strategy and rollback target metadata. Documented rationale: Issue #151 requires fresh production evidence rather than April issue #92 evidence before closure (source local `npm run auth:status:check -- --require-complete` output on 2026-05-07).

### Observability and Monitoring

- Applicable: Yes
- Evidence in this change: `monitoring/dashboards/production-auth-status.json`, production status runbook monitoring references, and redacted smoke evidence validation.
- Gap observed: Dashboard entries are status references until fresh production smoke and synthetic monitor evidence are attached. Documented rationale: production monitoring proof depends on deployed telemetry and must be captured with the production smoke artifact (source https://github.com/wiinc1/engineering-team/issues/151).

### Team and Process

- Applicable: Yes
- Evidence in this change: Issue #137 evidence report now points to Issue #151 and refuses stale issue #92-only closure evidence.
- Gap observed: Issue #137 closure remains pending until fresh Issue #151 evidence exists. Documented rationale: issue closure must be based on current deployed behavior, not historical April evidence (source `docs/reports/ISSUE-137-production-login-evidence.md`).

## Required Evidence

- Applicable standards areas: security, deployment and release, observability and monitoring, testing and quality assurance.
- Evidence expected for this change: canonical production-auth status, docs consistency check, fresh production smoke artifact validation, sign-in UI verification, redaction validation, rollback evidence, and ship-gate audit.
- Gap observed: fresh production smoke evidence for Issue #151 is not present in this local workspace. Documented rationale: production authentication changes require direct operational verification on the deployed origin because local tests cannot prove deployed env values, provider delivery, cookie behavior, protected-route access, or rollback readiness (source https://github.com/wiinc1/engineering-team/issues/151).
- Commands run: deterministic repository checks listed below; `npm run auth:status:check -- --require-complete` remains the explicit ship gate and currently blocks on stale production evidence.
- Tests added or updated: `tests/unit/magic-link-production-smoke.test.js`, `tests/unit/oidc-production-smoke.test.js`, `tests/unit/production-auth-status.test.js`.
- Rollout or rollback notes: production rollout requires fresh magic-link smoke evidence, monitoring counts/classifications only, and rollback target for the selected `magic-link` strategy.
- Docs updated: README, production identity provider runbook, canonical production auth status runbook, Issue #137 evidence report, Issue #151 audit report, diagrams, and production auth dashboard stub.

## Verification Commands

Commands run on 2026-05-07:

```bash
node --test tests/unit/magic-link-production-smoke.test.js tests/unit/production-auth-status.test.js tests/unit/auth-config-check.test.js tests/unit/auth-admin-seed.test.js
./node_modules/.bin/vitest run src/app/auth-runtime-env.test.tsx src/app/AuthAppShell.test.tsx tests/visual/auth-sign-in.visual.spec.tsx
node scripts/run-playwright.js tests/browser/auth-shell.browser.spec.ts --project=chromium
DATABASE_URL=postgres://example AUTH_PRODUCTION_AUTH_STRATEGY=magic-link VITE_AUTH_PRODUCTION_AUTH_STRATEGY=magic-link AUTH_SESSION_SECRET=session-secret AUTH_EMAIL_PROVIDER=resend RESEND_API_KEY=resend-secret AUTH_EMAIL_FROM='Workflow <noreply@example.com>' AUTH_PUBLIC_APP_URL=https://app.example AUTH_MAGIC_LINK_TTL_MINUTES=15 AUTH_SESSION_TTL_HOURS=8 AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP=false VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED=false npm run auth:config:check
AUTH_PRODUCTION_AUTH_STRATEGY=oidc VITE_OIDC_DISCOVERY_URL=https://idp.example/.well-known/openid-configuration VITE_OIDC_CLIENT_ID=browser-client AUTH_JWT_ISSUER=https://idp.example AUTH_JWT_AUDIENCE=engineering-team AUTH_JWT_JWKS_URL=https://idp.example/.well-known/jwks.json AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP=false VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED=false npm run auth:config:check
npm run auth:config:check:vercel
AUTH_PROD_BASE_URL=https://app.example AUTH_PROD_INVITED_EMAIL=admin@example.com AUTH_PROD_UNKNOWN_EMAIL=unknown@example.com AUTH_PROD_AUTH_STRATEGY=magic-link AUTH_PROD_DEPLOYMENT_ID=dpl_dry AUTH_PROD_DEPLOYMENT_STATUS=Ready AUTH_PROD_COMMIT_SHA=abc1234 AUTH_PROD_BUILD_TIMESTAMP=2026-05-07T12:00:00.000Z AUTH_PROD_ROLLBACK_TARGET=last-known-good-magic-link-config npm run auth:magic-link:production-smoke -- --dry-run --evidence-out /tmp/issue-151-dry-run-smoke.json
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

Observed result before live production smoke: deterministic repo checks pass, including `npm run standards:check`, and `npm run auth:status:check -- --require-complete` fails with stale/missing fresh evidence. That failure is the correct ship blocker.

## Audit Iterations

- 2026-05-07 initial audit: implemented canonical magic-link status, evidence validation, docs reconciliation, diagrams, dashboard reference, and Issue #137 stale-evidence closure guard.
- 2026-05-07 follow-up audit: found missing OIDC-equivalent production smoke/validator path. Resolved with `npm run auth:oidc:production-smoke`, OIDC evidence validation, unit coverage, docs, diagrams, and dashboard reference.
- 2026-05-07 follow-up audit: found absolute `--evidence` paths were treated as repo-relative. Resolved in `lib/auth/production-status.js` and covered by `tests/unit/production-auth-status.test.js`.
- 2026-05-07 follow-up audit: found repository maintainability hard-cap failures in task creation and workspace tests. Resolved by decomposing overlong React component/test functions; `npm run standards:check`, targeted Vitest/Playwright checks, and full `npm test` now pass.
- Remaining non-codebase gap: fresh deployed production smoke evidence is still unavailable locally, so the ship gate must continue to fail until an operator runs the selected-strategy smoke against production.
