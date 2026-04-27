# Production Identity Provider Integration

## Purpose

This runbook documents the provider-backed JWT validation path and the explicit no-IdP internal-bootstrap production path.

The audit and workflow APIs can now validate bearer tokens using either:

- legacy/shared-secret HMAC JWT verification
- JWKS-backed provider verification
- mixed rollout mode where provider-issued tokens and compatibility HMAC tokens are both accepted

The browser app now supports:

- production hosted OIDC Authorization Code + PKCE sign-in
- direct use of provider-issued bearer tokens against the existing API verifier
- internal `POST /auth/session` bootstrap when explicitly selected as the production strategy because no external IdP exists

## Configuration

### Required provider settings

- `AUTH_JWT_ISSUER`
- `AUTH_JWT_AUDIENCE`
- `AUTH_JWT_JWKS_URL`

### Browser OIDC settings

- `VITE_OIDC_DISCOVERY_URL`
- `VITE_OIDC_CLIENT_ID`

Optional browser settings:

- `VITE_OIDC_REDIRECT_URI`
  - default: `<origin>/auth/callback`
- `VITE_OIDC_SCOPE`
  - default: `openid profile email`
- `VITE_OIDC_LOGOUT_URL`
- `VITE_OIDC_LOGOUT_REDIRECT_URI`
  - default: `<origin>/sign-in?reason=signed_out`

### Optional claim-mapping overrides

- `AUTH_JWT_ACTOR_CLAIM`
  - default: `sub`
- `AUTH_JWT_TENANT_CLAIM`
  - default: `tenant_id`
- `AUTH_JWT_ROLES_CLAIM`
  - default: `roles`

### Optional JWKS cache control

- `AUTH_JWT_JWKS_CACHE_MS`
  - default: `300000`
  - used when the JWKS response does not provide a usable `Cache-Control: max-age=...`

### Compatibility mode

- `AUTH_PRODUCTION_AUTH_STRATEGY`
  - `oidc`: require external OIDC browser config and provider JWT verifier settings
  - `magic-link`: require invite-only first-party email auth, DB sessions, CSRF, and Resend delivery
  - `internal-bootstrap`: allow signed internal browser bootstrap in production when no external IdP exists
- `VITE_AUTH_PRODUCTION_AUTH_STRATEGY`
  - browser-visible strategy used by the SPA; set to `magic-link` for production magic-link builds
- `AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY`
  - name-only production gate evidence for deployments that inject `window.__ENGINEERING_TEAM_RUNTIME_CONFIG__.productionAuthStrategy = "magic-link"` at runtime instead of baking `VITE_AUTH_PRODUCTION_AUTH_STRATEGY` into the bundle
- `AUTH_SESSION_SECRET`
  - required for `magic-link`; used to hash session, CSRF, and magic-link tokens before persistence
- `AUTH_EMAIL_PROVIDER`
  - production value: `resend`
- `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `AUTH_PUBLIC_APP_URL`
  - required to deliver production magic-link email without exposing token material outside the link
  - `AUTH_PUBLIC_APP_URL` must be an `https://` URL in production
- `AUTH_MAGIC_LINK_TTL_MINUTES`, `AUTH_SESSION_TTL_HOURS`
  - production values must be exactly `15` minutes and `8` hours
- `AUTH_JWT_SECRET`
  - when present, HS256 compatibility tokens remain valid
- `AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP`
  - defaults to enabled in local/test-like environments
  - disable it in production to turn off `POST /auth/session`
- `VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED`
  - controls whether the browser sign-in screen renders the internal fallback form
  - required for the explicit `internal-bootstrap` production strategy

## Validation rules

For provider-backed JWTs the API verifies:

- signature using the configured JWKS document
- `iss` against `AUTH_JWT_ISSUER`
- `aud` against `AUTH_JWT_AUDIENCE`
- `exp`
- `nbf`

If claim mapping is overridden, the request principal is derived from the configured claim names rather than the default `sub` / `tenant_id` / `roles` fields.

## JWKS refresh behavior

- JWKS documents are cached in process
- cache lifetime uses `Cache-Control: max-age=...` when provided
- otherwise the API uses `AUTH_JWT_JWKS_CACHE_MS`
- if a token arrives with an unknown `kid`, the API forces one immediate JWKS refresh before failing the request

## Browser behavior

Production OIDC path:

- `/sign-in` starts hosted enterprise sign-in
- the SPA stores PKCE transaction state in `sessionStorage`
- `/auth/callback` exchanges the authorization code directly with the provider token endpoint
- the returned provider access token is stored as the browser bearer token

Internal/local fallback:

- `POST /auth/session` still signs compatibility HS256 browser-session tokens
- that path requires `AUTH_JWT_SECRET`
- it should be disabled in production by setting `AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP=false`

Production no-IdP path:

- durable path: select `AUTH_PRODUCTION_AUTH_STRATEGY=magic-link`
- configure `DATABASE_URL`, `AUTH_SESSION_SECRET`, `AUTH_EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `AUTH_PUBLIC_APP_URL=https://...`, `AUTH_MAGIC_LINK_TTL_MINUTES=15`, and `AUTH_SESSION_TTL_HOURS=8`
- expose the browser strategy with `VITE_AUTH_PRODUCTION_AUTH_STRATEGY=magic-link`; if the deployment injects runtime config instead, set `window.__ENGINEERING_TEAM_RUNTIME_CONFIG__.productionAuthStrategy = "magic-link"` and declare `AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY=magic-link` for the production gate
- set `AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP=false` and `VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED=false`
- provision invited users at `/admin/users` with email, tenant ID, actor ID, roles, and status
- smoke `/sign-in` by requesting a link for an invited user, consuming it, verifying `/auth/me`, loading protected views, and signing out
- run `npm run auth:magic-link:production-smoke` to write redacted machine-check evidence to `observability/magic-link-production-smoke.json`
- temporary path: `internal-bootstrap` remains only for explicitly approved emergency remediation while #92 is incomplete

Operational guidance:

- local/internal compatibility mode: keep `AUTH_JWT_SECRET`, `AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP=true`, and `VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED=true`
- production OIDC mode: configure OIDC + JWKS settings, set `AUTH_PRODUCTION_AUTH_STRATEGY=oidc`, set `AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP=false`, and set `VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED=false`
- production no-IdP mode: configure `AUTH_PRODUCTION_AUTH_STRATEGY=magic-link`, expose browser strategy `magic-link`, and keep internal bootstrap disabled
- preview mode: either configure a preview-specific OIDC redirect URI/strategy, use the same approved internal-bootstrap strategy, or allow the app to show the no-login-path configuration state.

## Build and release gates

Run the deterministic production gate before release:

```bash
npm run auth:config:check
```

Production `npm run build` runs the same gate before Vite emits deployable assets and writes `observability/auth-config-diagnostics.json`. The artifact contains boolean status and missing variable names only. It must not contain raw environment values, tokens, provider URLs, client IDs, authorization codes, or secrets.

Vercel production env-name validation is name-only:

```bash
npm run auth:config:check:vercel
```

The script inspects `vercel env ls production --format json` output. It must not use `vercel env pull`, write `.env` files, or print values. Confirm that production has either the OIDC names (`VITE_OIDC_DISCOVERY_URL`, `VITE_OIDC_CLIENT_ID`, `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`, `AUTH_JWT_JWKS_URL`), the magic-link names (`DATABASE_URL`, `AUTH_PRODUCTION_AUTH_STRATEGY`, `AUTH_SESSION_SECRET`, `AUTH_EMAIL_PROVIDER`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `AUTH_PUBLIC_APP_URL`, `AUTH_MAGIC_LINK_TTL_MINUTES`, `AUTH_SESSION_TTL_HOURS`, plus either `VITE_AUTH_PRODUCTION_AUTH_STRATEGY` or `AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY`), or the temporary internal-bootstrap names (`AUTH_PRODUCTION_AUTH_STRATEGY`, `AUTH_JWT_SECRET`, `VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED`, `AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP`).

Name-only Vercel validation cannot inspect values. The local production gate enforces `AUTH_PUBLIC_APP_URL` as HTTPS, `AUTH_MAGIC_LINK_TTL_MINUTES=15`, `AUTH_SESSION_TTL_HOURS=8`, and browser strategy `magic-link` through either `VITE_AUTH_PRODUCTION_AUTH_STRATEGY` or the documented runtime-config evidence variable.

## Production remediation evidence

Environment changes alone do not complete remediation. The production configuration owner must trigger and inspect a new production deployment after auth settings change. Attach:

- deployment URL or ID
- build commit
- Ready status
- build timestamp
- selected production auth strategy
- effective production redirect URI ending in `/auth/callback` when OIDC is selected
- IdP allowlist confirmation when OIDC is selected
- production sign-in smoke result from an approved test/operator account or auth-code holder
- post-login protected-view data check showing usable data or an intentional empty state
- monitoring evidence for login-path availability and callback-failure alerting
- rollback evidence identifying the last known-good production OIDC deployment/config

Rollback means restoring the last known-good working production auth deployment/config for the selected strategy. Do not switch strategies during rollback unless a separate emergency exception is approved.

For magic-link production remediation, run the smoke in two phases because the sign-in link arrives through Resend:

```bash
AUTH_PROD_BASE_URL=https://app.example \
AUTH_PROD_INVITED_EMAIL=approved-test-admin@example.com \
AUTH_PROD_UNKNOWN_EMAIL=unknown-smoke@example.com \
AUTH_PROD_TASK_DETAIL_PATH=/tasks/TSK-123 \
npm run auth:magic-link:production-smoke
```

After the invited user receives the Resend email, rerun with the received link:

```bash
AUTH_PROD_BASE_URL=https://app.example \
AUTH_PROD_INVITED_EMAIL=approved-test-admin@example.com \
AUTH_PROD_UNKNOWN_EMAIL=unknown-smoke@example.com \
AUTH_PROD_MAGIC_LINK_URL='https://app.example/auth/magic-link/consume?token=...' \
AUTH_PROD_TASK_DETAIL_PATH=/tasks/TSK-123 \
npm run auth:magic-link:production-smoke -- --require-complete
```

The smoke artifact stores hashes of email addresses and magic-link token material, never raw email bodies, tokens, cookies, CSRF values, or Resend API keys. It verifies generic request responses, cookie and CSRF cookie issuance, `/auth/me`, protected routes, replay rejection, logout revocation, and post-logout auth rejection. Operators still need to attach Vercel Ready status, Resend delivery evidence, production invited-user evidence, monitoring counts/rates, and rollback evidence.

Use `--dry-run` only to validate command wiring and redacted artifact shape. Dry-run mode skips network calls and does not count as production smoke evidence.

## Ownership

| Area | Owner |
| --- | --- |
| Code implementation and deterministic tests | Engineering implementation owner |
| Vercel env vars | Production configuration owner |
| IdP client settings and redirect URI allowlist | Production configuration owner when OIDC exists |
| JWKS verifier settings | Production configuration owner when OIDC exists |
| Internal bootstrap auth-code issuance and secret rotation | Production configuration owner when no IdP exists |
| Production smoke execution | Release operator |
| Rollback approval | Production auth approver |
| Monitoring and alert thresholds | Operations owner |

## Monitoring

Use `monitoring/alerts/auth-availability.yml` for the initial auth availability rules. A no-login-path deploy signal alerts immediately. Callback failures alert at 5 failures in 10 minutes or when the callback failure rate is greater than 25% over 10 minutes with at least 10 attempts. Telemetry and evidence must contain only deployment identifiers, counts, thresholds, and non-secret error classifications.

## Verification

Minimum validation commands:

```bash
npm run auth:config:check
npm run auth:config:check:vercel
node --test tests/unit/audit-jwt-auth.test.js
node --test tests/unit/auth-config-check.test.js
node --test tests/security/audit-api.security.test.js
node --test tests/unit/audit-api.test.js
node --test tests/unit/task-browser-session.test.js
npm run test:ui:vitest -- src/app/AuthAppShell.test.tsx
```

The automated coverage includes:

- RS256/JWKS verification
- JWKS refresh on `kid` rotation
- custom claim mapping
- mixed-mode compatibility for browser bootstrap tokens during JWKS rollout
- OIDC callback exchange and PKCE transaction coverage in the browser session helpers
- browser-shell callback restore coverage for protected routes
