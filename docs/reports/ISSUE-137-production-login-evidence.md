# Issue #137 Production Login Evidence

Historical note: this report is retained as pre-registration magic-link audit evidence. Issues #160-#167 replace the active production path with registration auth, and magic-link evidence no longer satisfies the production ship gate.

Date opened for remediation: 2026-05-04
Issue: https://github.com/wiinc1/engineering-team/issues/137
Canonical status: `docs/runbooks/production-auth-status.md`
Issue #151 ship gate: `npm run auth:status:check -- --require-complete`

## Decision

Issue #137 reports that the landing/sign-in page has no usable login option. The originally proposed durable no-IdP path was magic-link auth, and the historical checklist below is retained for audit context. Issues #160-#167 supersede that path with registration auth:

- `AUTH_PRODUCTION_AUTH_STRATEGY=registration`
- browser strategy exposed with `VITE_AUTH_PRODUCTION_AUTH_STRATEGY=registration`
- internal bootstrap and magic-link UI removed from the production sign-in path
- Vercel browser API base kept at `VITE_TASK_API_BASE_URL=/backend`
- credential login, email verification, password reset, session, CSRF, and logout behavior verified by fresh production smoke evidence

Internal bootstrap remains available only for explicitly approved emergency or local/internal fallback use. It is not the production closure path for this issue.

Issue #151 reconciliation note: fresh registration production evidence was recaptured on 2026-05-15. The April issue #92 smoke artifact remains historical evidence and must not be reused to close issue #137 or issue #151.

## Historical Magic-Link Operator Checklist

- [ ] Confirm Vercel production env names with `npm run auth:config:check:vercel`.
- [ ] Confirm production values with `npm run auth:config:check` in an environment containing production auth variables.
- [ ] Confirm the production deployment is built with `VITE_AUTH_PRODUCTION_AUTH_STRATEGY=magic-link`.
- [ ] Confirm the browser app reads the Vite auth strategy by loading `/sign-in` and verifying the `Email address` magic-link form appears without `window.__ENGINEERING_TEAM_RUNTIME_CONFIG__` injection.
- [ ] Confirm `AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP=false`.
- [ ] Confirm `VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED=false`.
- [ ] Confirm `VITE_TASK_API_BASE_URL=/backend`.
- [ ] Confirm `AUTH_PUBLIC_APP_URL` is the production `https://` app origin.
- [ ] Confirm Resend sender/domain status for `AUTH_EMAIL_FROM`.

## Historical First Admin Seed

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

## Historical Magic-Link Production Smoke

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

## Current Closure Evidence

Attach these before closing issue #137:

- [ ] Vercel deployment URL or deployment ID.
- [ ] build commit SHA.
- [ ] Vercel Ready status.
- [ ] build timestamp.
- [x] selected production auth strategy: `registration`.
- [ ] `npm run auth:config:check:vercel` output with names only.
- [ ] redacted `observability/auth-config-diagnostics.json`.
- [ ] redacted first-admin seed output.
- [x] redacted `observability/registration-auth-production-smoke.json` from deployed production smoke.
- [x] `npm run auth:status:check -- --require-complete` passes against fresh issue #151 evidence.
- [x] password reset generic response evidence without raw token material.
- [x] monitoring dashboard and alert definitions for registration auth status and abuse controls.
- [x] rollback target identifying the last known-good deployment/config for the selected strategy.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, security, and observability and monitoring.
- Evidence in this report: accepted auth strategy decisions, historical magic-link audit context, current registration closure evidence requirements, and rollback evidence requirements.
- Gap observed: No remaining compliance gap. Documented rationale: Issue #137 now closes through the registration cutover evidence path; fresh production evidence exists through `observability/registration-auth-production-smoke.json`, and `npm run auth:status:check -- --require-complete` passes (source https://github.com/wiinc1/engineering-team/issues/137).

## Required Evidence

- Commands run: `npm run lint`; `npm run typecheck`; `npm run ownership:lint`; `npm run change:check`; `npm run standards:check`; `npm run test:unit`; `npm test`; `npm run coverage`; `npm run auth:registration:production-smoke`; `npm run auth:status:check -- --require-complete`.
- Tests added or updated: `tests/unit/registration-auth.test.js`; `tests/unit/registration-api.test.js`; `tests/unit/registration-production-smoke.test.js`; `src/app/registration-auth-flows.test.tsx`; `src/app/session-browser-registration.test.tsx`; `tests/browser/auth-shell.browser.spec.ts`; `tests/visual/auth-sign-in.visual.spec.tsx`; `tests/visual/__snapshots__/auth-sign-in.visual.spec.tsx.snap`.
- Rollout or rollback notes: roll out by setting production registration env names/values, redeploying, ensuring the production smoke account is available, and completing deployed-origin registration smoke. Roll back by restoring the recorded last known-good production auth deployment/config for the selected strategy; do not switch auth strategies during rollback without a separate emergency exception.
- Docs updated: `README.md`; `docs/runbooks/production-identity-provider.md`; `docs/reports/ISSUE-137-production-login-evidence.md`.

## Current Status

Fresh production registration evidence was recaptured on 2026-05-15. Do not close issue #137 or issue #151 using the April issue #92 smoke artifact alone. Closure uses the canonical status gate in `docs/runbooks/production-auth-status.md`, which now passes:

```bash
npm run auth:status:check -- --require-complete
```
