# Production Auth Status

Last updated: 2026-05-08
Tracking issues: Issue #151, Issue #160, Issue #166, Issue #167
Related production remediation issue: Issue #137

## Current Decision

Active production strategy: `registration`

Registration auth replaces the durable no-IdP magic-link path. Production must expose the browser strategy as `registration`, keep internal bootstrap disabled, and use the same-origin Vercel `/backend` API rewrite for protected app routes.

Issue #151 is superseded by the registration cutover work in Issues #160-#167. The production status gate still exists, but its selected strategy and smoke evidence are now registration-based. Magic-link evidence is historical only and cannot satisfy the ship gate.

PR #159 is the prior Issue #151 production-auth evidence path and is reconciled as historical. Its magic-link/OIDC status evidence is superseded by PR #168, the registration smoke artifact, and this runbook's registration-only production gate.

Production registration mode must be explicit and approval-gated:

- `admin-approved`: anyone can create an account, but the account stays pending until an admin activates it.
- `open` and `invite-only` remain recognized by the service for non-production/local compatibility, but they are not valid production registration modes for this product policy.

First-admin creation remains operator-owned through `npm run auth:admin:seed -- --apply`. The seed workflow writes only redacted identifiers and never prints database URLs, raw email addresses, passwords, cookies, or secrets.

## Deployment State

Before moving to the ship portion of the workflow:

```bash
npm run auth:config:check:vercel
npm run auth:config:check
npm run auth:registration:production-smoke
npm run auth:status:check -- --require-complete
```

The status check requires fresh production smoke evidence generated on or after 2026-05-08. The historical April issue #92 smoke and the Issue #151 magic-link smoke artifact remain audit history only.

## Evidence Artifact

Canonical production smoke artifact:

```text
observability/registration-auth-production-smoke.json
```

It must contain:

- generated timestamp for the fresh smoke run
- selected auth strategy: `registration`
- deployment URL or deployment ID
- rollback target
- redacted registration-email hash
- redacted password-reset-email hash
- login/session/CSRF classifications
- `/auth/me`, protected route, logout, and post-logout classifications
- password-reset generic-response classification
- magic-link removal evidence showing `/auth/magic-link/request` returns `410`
- all smoke summary checks set to `true`

It must not contain raw email addresses, passwords, raw tokens, cookies, CSRF values, Resend API keys, email bodies, or session secrets.

## Rollback Target

Rollback target: restore the last known-good registration deployment and auth configuration.

If registration must be rolled back before full removal is complete, use the documented emergency `internal-bootstrap` strategy only with explicit approval. Do not re-enable magic-link production sign-in without a new security and product decision, because Issue #167 removes magic-link from the active production contract.

## Required Production Checks

- `AUTH_PRODUCTION_AUTH_STRATEGY=registration`.
- Browser runtime strategy is `registration` through `VITE_AUTH_PRODUCTION_AUTH_STRATEGY` or documented runtime config evidence.
- `AUTH_PUBLIC_APP_URL` is HTTPS.
- `AUTH_SESSION_TTL_HOURS=8`.
- `AUTH_EMAIL_VERIFICATION_TTL_HOURS=24`.
- `AUTH_PASSWORD_RESET_TTL_MINUTES=30`.
- `AUTH_REGISTRATION_MODE=admin-approved`.
- `/sign-in` shows email/password login, registration, and password reset controls.
- `/sign-in` does not show magic-link copy or the trusted auth-code fallback for registration deployments.
- `/auth/login` sets session and CSRF cookies.
- `/auth/me` returns the seeded registration smoke principal.
- Protected routes load after login.
- `/auth/password-reset/request` returns a generic response.
- `/auth/magic-link/request` returns `410`.
- `/auth/magic-link/consume` redirects to `/sign-in?reason=magic_link_removed` and never creates a session.
- Logout revokes the session.
- Post-logout `/auth/me` is rejected.
- Monitoring evidence contains counts and classifications only.
- Rollback target is identified.

## Conceptual Flag Mapping

The registration issues used `ff_registration_*` labels for rollout decisions. Production uses explicit environment gates and status checks instead of standalone feature-flag rows:

| Issue label | Production gate |
|---|---|
| `ff_registration_auth_strategy` | `AUTH_PRODUCTION_AUTH_STRATEGY=registration` and browser runtime strategy evidence |
| `ff_registration_credentials` | `AUTH_REGISTRATION_MODE` plus applied credential migration |
| `ff_registration_email_verification` | `AUTH_REQUIRE_EMAIL_VERIFICATION` and `AUTH_EMAIL_VERIFICATION_TTL_HOURS` |
| `ff_registration_password_reset` | `AUTH_PASSWORD_RESET_TTL_MINUTES` and reset endpoint smoke evidence |
| `ff_registration_abuse_controls` | login, registration, reset throttling and redacted monitoring evidence |
| `ff_registration_magic_link_removed` | `/auth/magic-link/request` returns `410`, consume redirects without a session, and magic-link evidence is rejected |

## Monitoring And Alerts

- Dashboard: `monitoring/dashboards/registration-auth-security.json`.
- Alerts: `monitoring/alerts/registration-auth-security.yml`.
- Signals covered: registration attempts, login success/failure, password reset requests, lockouts, deprecated magic-link endpoint hits, and registration smoke results.
- Investigation evidence must contain hashed identifiers, counts, classifications, and runbook links only.

## OIDC Status

OIDC remains supported when a production identity provider exists and is selected explicitly. If production switches to `oidc`, update this status document, the production identity provider runbook, and the registration audit before shipping. The selected OIDC production evidence must include hosted callback, token/session validation, protected route access, logout behavior, IdP allowlist confirmation, and rollback target.

OIDC parity command:

```bash
npm run auth:oidc:production-smoke -- --require-complete
```

That command writes `observability/oidc-production-smoke.json` by default. It expects a production access token obtained through hosted OIDC sign-in and records only token hashes, deployment metadata, callback/session/protected-route/logout classifications, and rollback evidence.
