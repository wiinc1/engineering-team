# Issues #160-#167 Registration Auth Audit

Date: 2026-05-08
Scope: Replace the magic-link production path with registration auth, credential storage, email verification, password reset, abuse controls, browser UX, production gates, and removal behavior.

## Product Policy

Registration auth is the no-IdP production strategy. The active production registration mode is explicit through `AUTH_REGISTRATION_MODE=admin-approved`: anyone can create an account, but an admin must activate the account before it can use the app.

The service still recognizes `open` and `invite-only` for non-production/local compatibility, but they are not the selected production policy.

Magic-link is historical after cutover. `/auth/magic-link/request` returns `410`, and `/auth/magic-link/consume` redirects to `/sign-in?reason=magic_link_removed` without creating a session.

Issue #151 and PR #159 are reconciled as historical production-auth evidence paths. The active closure evidence is registration-based through PR #168, `observability/registration-auth-production-smoke.json`, and `npm run auth:status:check -- --require-complete`.

The `ff_registration_*` labels in the issue text are implemented as explicit environment/status gates: `AUTH_PRODUCTION_AUTH_STRATEGY`, browser runtime strategy evidence, `AUTH_REGISTRATION_MODE`, email-verification and password-reset TTL variables, redacted abuse-control monitoring, and removed magic-link endpoint behavior.

## Requirement Matrix

| Issue | Requirement coverage | Implementation evidence | Verification |
|---|---|---|---|
| #160 Define registration auth product policy and migration plan | active strategy, modes, first-admin seed, rollback, Issue #151 supersession | `docs/runbooks/production-auth-status.md`, `docs/runbooks/production-identity-provider.md`, `docs/diagrams/workflow-registration-auth-strategy.mmd`, `config/change-ownership-map.json` | `tests/unit/production-auth-status.test.js`, `tests/unit/auth-config-check.test.js` |
| #161 Add credential data model and password hashing service | scrypt hash service, credential table, migration rollback, existing-user credential attach without identity changes | `lib/auth/credentials.js`, `lib/auth/registration.js`, `db/migrations/011_registration_auth.sql`, `db/migrations/011_registration_auth.down.sql`, `docs/diagrams/schema-registration-credentials.mmd` | `tests/unit/registration-auth.test.js`, `tests/integration/registration-auth-migration-postgres.integration.test.js` |
| #162 Add email verification and password reset | hashed single-use expiring tokens, generic unknown-email responses, reset credential rotation and session revocation | `lib/auth/registration.js`, `db/migrations/011_registration_auth.sql`, `docs/diagrams/workflow-email-verification-password-reset.mmd` | `tests/unit/registration-auth.test.js`, `tests/unit/registration-api.test.js` |
| #163 Implement registration and login APIs | `/auth/register`, `/auth/login`, `/auth/me`, `/auth/logout`, disabled registration failure, cookie/CSRF session | `lib/audit/http.js`, `lib/auth/registration.js`, `docs/api/authenticated-browser-app-openapi.yml`, `docs/diagrams/workflow-registration-login-api.mmd` | `tests/unit/registration-api.test.js` |
| #164 Add security observability and abuse controls | email/IP rate limits, registration-spike classification, login throttling, reset throttling, redacted audit, dashboard, alerts | `lib/auth/registration.js`, `monitoring/dashboards/registration-auth-security.json`, `monitoring/alerts/registration-auth-security.yml`, `docs/diagrams/workflow-registration-auth-abuse-controls.mmd`, `docs/diagrams/schema-registration-auth-abuse-controls.mmd` | `tests/unit/registration-auth.test.js`, `tests/unit/registration-production-smoke.test.js` |
| #165 Build registration browser UX | login, registration, verification, reset controls; no magic-link/internal bootstrap for registration strategy; route restore | `src/app/App.jsx`, `src/app/session.browser.js`, `src/app/session.js`, `docs/diagrams/workflow-registration-browser-ux.mmd` | `src/app/auth-runtime-env.test.tsx`, `src/app/registration-auth-flows.test.tsx`, `tests/browser/auth-shell.browser.spec.ts`, `tests/visual/auth-sign-in.visual.spec.tsx` |
| #166 Replace magic-link production gates | registration config validator, registration smoke, status validator, Vercel name-only validation | `lib/auth/config-check.js`, `lib/auth/registration-production-smoke.js`, `lib/auth/production-status.js`, `scripts/verify-registration-production.js`, `scripts/verify-production-auth-status.js`, `docs/diagrams/workflow-registration-production-gates.mmd` | `tests/unit/auth-config-check.test.js`, `tests/unit/registration-production-smoke.test.js`, `tests/unit/production-auth-status.test.js` |
| #167 Remove magic-link auth after registration cutover | removed endpoints, browser hidden state, docs mark magic-link historical, production status rejects magic-link evidence | `lib/audit/http.js`, `src/app/App.jsx`, `docs/runbooks/production-auth-status.md`, `docs/runbooks/production-identity-provider.md`, `docs/diagrams/workflow-remove-magic-link-auth.mmd` | `tests/unit/registration-api.test.js`, `tests/unit/production-auth-status.test.js`, `tests/browser/auth-shell.browser.spec.ts` |

## Audit Loop

Initial gaps found:

- No credential model or hashing service.
- No registration login API.
- Magic-link remained the production status strategy.
- Browser rendered magic-link UI when no IdP existed.
- Production status accepted magic-link evidence.
- Docs and Vercel env validation described magic-link as active.
- The generic Postgres migration runner treated `*.down.sql` rollback files as forward migrations.

Resolved in this branch:

- Added credential, token, and rollback migrations.
- Added registration service with password hashing, sessions, CSRF, reset, verification, and rate limits.
- Replaced production config/status checks with registration gates.
- Added registration browser forms, verification/reset routes, and removed magic-link UI copy.
- Disabled magic-link request/consume routes for active sign-in.
- Added diagrams, dashboard, alerts, OpenAPI, runbooks, and ownership mapping.
- Updated the migration runner to skip rollback files during normal forward migration and added a regression test.
- Added live Postgres coverage for the registration auth migration apply, rollback, and reapply cycle in an isolated test schema.

## Standards Alignment

- Applicable standards areas: architecture and design; coding and code quality; testing and quality assurance; deployment and release; observability and monitoring; team and process.
- Evidence in this report: Requirement matrix, audit loop, production smoke evidence, registration security dashboard and alert references, and test/gate results recorded below.
- Gap observed: No remaining compliance gap. Documented rationale: the 2026-05-08 audit loop resolved the missing deployed smoke evidence, migration-runner rollback-file issue, PR #159 traceability, conceptual flag mapping, and live registration migration rollback/reapply coverage; fresh deployed registration smoke evidence is present in `observability/registration-auth-production-smoke.json`, and `npm run auth:status:check -- --require-complete` passes for the selected `registration` strategy (source https://github.com/wiinc1/engineering-team/issues/166).

## Required Evidence

- Commands run: `npm run lint`; `npm run typecheck`; `npm run ownership:lint`; `npm run change:check`; `npm run standards:check`; `npm run test:unit`; `npm test`; `npm run coverage`; `npm run auth:registration:production-smoke`; `npm run auth:status:check -- --require-complete`.
- Tests added or updated: `tests/unit/registration-auth.test.js`, `tests/unit/registration-api.test.js`, `tests/unit/registration-production-smoke.test.js`, `src/app/registration-auth-flows.test.tsx`, `src/app/session-browser-registration.test.tsx`, `src/app/App.test.tsx`, `tests/browser/auth-shell.browser.spec.ts`, `tests/visual/auth-sign-in.visual.spec.tsx`.
- Rollout or rollback notes: Registration production gates reject stale magic-link evidence and require fresh `npm run auth:registration:production-smoke` evidence before merge/ship; rollback is documented in `docs/runbooks/production-identity-provider.md`. The production smoke run on 2026-05-08 passed against deployment `dpl_EnEg7kdTW8Gad945cqjueAHhpte1` and records rollback target metadata.
- Docs updated: `docs/runbooks/production-auth-status.md`, `docs/runbooks/production-identity-provider.md`, `docs/api/authenticated-browser-app-openapi.yml`, registration diagrams, monitoring alert/dashboard files, and this audit report.

Ship dependency resolved:

- A real production smoke artifact was captured with `npm run auth:registration:production-smoke` against `https://engineering-team-2fvxttcgz-wiinc1-hotmailcoms-projects.vercel.app` on 2026-05-08. It verifies credential login, session and CSRF cookies, `/auth/me`, protected routes, generic password reset response, logout revocation, post-logout rejection, magic-link removal, rollback target metadata, and redacted evidence. The release gate now passes with `npm run auth:status:check -- --require-complete`.
