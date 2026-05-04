# Issue #137 Production Login Evidence

Date opened for remediation: 2026-05-04
Issue: https://github.com/wiinc1/engineering-team/issues/137

## Decision

Issue #137 reports that the landing/sign-in page has no usable login option. The accepted remediation path is the durable no-IdP production strategy:

- `AUTH_PRODUCTION_AUTH_STRATEGY=magic-link`
- browser strategy exposed with `VITE_AUTH_PRODUCTION_AUTH_STRATEGY=magic-link`
- internal bootstrap disabled with `AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP=false` and `VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED=false`
- Vercel browser API base kept at `VITE_TASK_API_BASE_URL=/backend`
- first admin provisioned through the audited dry-run/apply script before `/admin/users` can be used

Internal bootstrap remains available only for explicitly approved emergency or local/internal fallback use. It is not the production closure path for this issue.

## Operator Setup Checklist

- [ ] Confirm Vercel production env names with `npm run auth:config:check:vercel`.
- [ ] Confirm production values with `npm run auth:config:check` in an environment containing production auth variables.
- [ ] Confirm the production deployment is built with `VITE_AUTH_PRODUCTION_AUTH_STRATEGY=magic-link`.
- [ ] Confirm the browser app reads the Vite auth strategy by loading `/sign-in` and verifying the `Email address` magic-link form appears without `window.__ENGINEERING_TEAM_RUNTIME_CONFIG__` injection.
- [ ] Confirm `AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP=false`.
- [ ] Confirm `VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED=false`.
- [ ] Confirm `VITE_TASK_API_BASE_URL=/backend`.
- [ ] Confirm `AUTH_PUBLIC_APP_URL` is the production `https://` app origin.
- [ ] Confirm Resend sender/domain status for `AUTH_EMAIL_FROM`.

## First Admin Seed

Dry-run:

```bash
DATABASE_URL='postgres://...' \
AUTH_ADMIN_EMAIL='approved-admin@example.com' \
AUTH_ADMIN_ACTOR_ID='approved-admin-actor' \
AUTH_ADMIN_TENANT_ID='tenant-int' \
AUTH_ADMIN_ROLES='admin,pm' \
npm run auth:admin:seed
```

Apply after the production configuration owner confirms the redacted plan:

```bash
DATABASE_URL='postgres://...' \
AUTH_ADMIN_EMAIL='approved-admin@example.com' \
AUTH_ADMIN_ACTOR_ID='approved-admin-actor' \
AUTH_ADMIN_TENANT_ID='tenant-int' \
AUTH_ADMIN_ROLES='admin,pm' \
npm run auth:admin:seed -- --apply
```

Seed evidence to attach:

- [ ] redacted dry-run plan
- [ ] redacted apply result
- [ ] seeded actor ID
- [ ] seeded tenant ID
- [ ] seeded roles
- [ ] confirmation that raw email, database URL, tokens, and secrets were not printed

## Production Smoke

Phase 1 requests the link and records generic response evidence:

```bash
AUTH_PROD_BASE_URL='https://engineering-team-zeta.vercel.app' \
AUTH_PROD_INVITED_EMAIL='approved-admin@example.com' \
AUTH_PROD_UNKNOWN_EMAIL='unknown-smoke@example.com' \
AUTH_PROD_TASK_DETAIL_PATH='/tasks/TSK-123' \
npm run auth:magic-link:production-smoke
```

Phase 2 consumes the received Resend link and requires a complete pass:

```bash
AUTH_PROD_BASE_URL='https://engineering-team-zeta.vercel.app' \
AUTH_PROD_INVITED_EMAIL='approved-admin@example.com' \
AUTH_PROD_UNKNOWN_EMAIL='unknown-smoke@example.com' \
AUTH_PROD_MAGIC_LINK_URL='https://engineering-team-zeta.vercel.app/auth/magic-link/consume?token=...' \
AUTH_PROD_TASK_DETAIL_PATH='/tasks/TSK-123' \
npm run auth:magic-link:production-smoke -- --require-complete
```

Required pass criteria:

- [ ] `/sign-in` renders the email magic-link form.
- [ ] enterprise sign-in is not the only visible login path.
- [ ] internal bootstrap form is not visible.
- [ ] invited-email request returns the generic success message.
- [ ] unknown-email request returns the same generic success message and sends no usable login.
- [ ] Resend delivery for the invited user is confirmed.
- [ ] magic-link consume sets session and CSRF cookies.
- [ ] `/auth/me` returns the seeded admin session.
- [ ] protected task routes load after consume.
- [ ] replaying the consumed link is rejected.
- [ ] logout revokes the session.
- [ ] post-logout auth check is rejected.

## Closure Evidence

Attach these before closing issue #137:

- [ ] Vercel deployment URL or deployment ID.
- [ ] build commit SHA.
- [ ] Vercel Ready status.
- [ ] build timestamp.
- [ ] selected production auth strategy: `magic-link`.
- [ ] `npm run auth:config:check:vercel` output with names only.
- [ ] redacted `observability/auth-config-diagnostics.json`.
- [ ] redacted first-admin seed output.
- [ ] redacted `observability/magic-link-production-smoke.json` from `--require-complete`.
- [ ] Resend delivery evidence without raw token material.
- [ ] monitoring evidence for `auth-no-login-path-after-deploy`.
- [ ] rollback target identifying the last known-good deployment/config for the selected strategy.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, security, and observability and monitoring.
- Evidence in this report: accepted auth strategy decisions, operator setup checklist, first-admin seed evidence requirements, complete production magic-link smoke criteria, closure evidence requirements, and rollback evidence requirements.
- Gap observed: fresh production evidence is still pending for issue #137. Documented rationale: the repo implements and verifies the durable magic-link path, but production env mutation, Resend delivery, and live smoke execution remain production-operator responsibilities (source https://github.com/wiinc1/engineering-team/issues/137).

## Required Evidence

- Commands run: `node --test tests/unit/auth-admin-seed.test.js tests/unit/auth-config-check.test.js`; `./node_modules/.bin/vitest run src/app/AuthAppShell.test.tsx tests/visual/auth-sign-in.visual.spec.tsx`; `node scripts/run-playwright.js tests/browser/auth-shell.browser.spec.ts --project=chromium`; production-like `npm run build` with dummy magic-link env; `npm run coverage`; `npm run standards:check`.
- Tests added or updated: `tests/unit/auth-admin-seed.test.js`; `src/app/AuthAppShell.test.tsx`; `tests/browser/auth-shell.browser.spec.ts`; `tests/visual/auth-sign-in.visual.spec.tsx`; `tests/visual/__snapshots__/auth-sign-in.visual.spec.tsx.snap`.
- Rollout or rollback notes: roll out by setting production magic-link env names/values, redeploying, seeding the first admin, and completing the two-phase production smoke. Roll back by restoring the last known-good production auth deployment/config for the selected strategy; do not switch auth strategies during rollback without a separate emergency exception.
- Docs updated: `README.md`; `docs/runbooks/production-identity-provider.md`; `docs/reports/ISSUE-137-production-login-evidence.md`.

## Current Status

Fresh production evidence is still pending. Do not close issue #137 using the April issue #92 smoke artifact alone.
