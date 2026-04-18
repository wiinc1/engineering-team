# Production Identity Provider Integration

## Purpose

This runbook documents the provider-backed JWT validation path and browser cutover path added for `SF-018` / `TSK-004`.

The audit and workflow APIs can now validate bearer tokens using either:

- legacy/shared-secret HMAC JWT verification
- JWKS-backed provider verification
- mixed rollout mode where provider-issued tokens and compatibility HMAC tokens are both accepted

The browser app now supports:

- production hosted OIDC Authorization Code + PKCE sign-in
- direct use of provider-issued bearer tokens against the existing API verifier
- internal/local `POST /auth/session` fallback only when explicitly enabled

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

- `AUTH_JWT_SECRET`
  - when present, HS256 compatibility tokens remain valid
- `AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP`
  - defaults to enabled in local/test-like environments
  - disable it in production to turn off `POST /auth/session`
- `VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED`
  - controls whether the browser sign-in screen renders the internal fallback form
  - leave enabled only for local/internal environments

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

Production/default path:

- `/sign-in` starts hosted enterprise sign-in
- the SPA stores PKCE transaction state in `sessionStorage`
- `/auth/callback` exchanges the authorization code directly with the provider token endpoint
- the returned provider access token is stored as the browser bearer token

Internal/local fallback:

- `POST /auth/session` still signs compatibility HS256 browser-session tokens
- that path requires `AUTH_JWT_SECRET`
- it should be disabled in production by setting `AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP=false`

Operational guidance:

- local/internal compatibility mode: keep `AUTH_JWT_SECRET`, `AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP=true`, and `VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED=true`
- production IdP-only mode: configure OIDC + JWKS settings, set `AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP=false`, and set `VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED=false`
- mixed rollout mode: keep `AUTH_JWT_SECRET`, leave the server fallback enabled only where needed, and move production browser traffic to the hosted OIDC path first

## Verification

Minimum validation commands:

```bash
node --test tests/unit/audit-jwt-auth.test.js
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
