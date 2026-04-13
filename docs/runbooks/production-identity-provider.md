# Production Identity Provider Integration

## Purpose

This runbook documents the provider-backed JWT validation path added for `SF-018`.

The audit and workflow APIs can now validate bearer tokens using either:

- legacy/shared-secret HMAC JWT verification
- JWKS-backed provider verification
- mixed rollout mode where provider-issued tokens and compatibility HMAC tokens are both accepted

## Configuration

### Required provider settings

- `AUTH_JWT_ISSUER`
- `AUTH_JWT_AUDIENCE`
- `AUTH_JWT_JWKS_URL`

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
  - this allows `/auth/session` browser bootstrap to keep working during migration while the API also accepts provider-issued JWKS tokens

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

## Browser bootstrap behavior

`/auth/session` still signs compatibility HS256 browser-session tokens. That path now requires `AUTH_JWT_SECRET`.

Operational guidance:

- local/internal compatibility mode: keep `AUTH_JWT_SECRET`
- production IdP-only mode: disable or replace `/auth/session` before removing `AUTH_JWT_SECRET`
- mixed rollout mode: keep `AUTH_JWT_SECRET` and configure JWKS settings so both token classes are accepted during migration

## Verification

Minimum validation commands:

```bash
node --test tests/unit/audit-jwt-auth.test.js
node --test tests/security/audit-api.security.test.js
node --test tests/unit/audit-api.test.js
```

The automated coverage includes:

- RS256/JWKS verification
- JWKS refresh on `kid` rotation
- custom claim mapping
- mixed-mode compatibility for browser bootstrap tokens during JWKS rollout
