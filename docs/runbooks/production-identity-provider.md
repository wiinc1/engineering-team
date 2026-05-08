# Production Identity Provider And Registration Auth

Last updated: 2026-05-08

This runbook documents the production authentication posture after the registration cutover.

## Active Strategy

The active no-IdP strategy is registration auth:

- `AUTH_PRODUCTION_AUTH_STRATEGY=registration`
- browser strategy is `registration`
- internal bootstrap flags are false or unset
- `/auth/login` creates the cookie session
- `/auth/password-reset/request` and `/auth/email/verify/request` return generic responses
- `/auth/magic-link/request` returns `410`
- `/auth/magic-link/consume` redirects to `/sign-in?reason=magic_link_removed`

The historical magic-link implementation and artifacts are retained only as audit history for Issue #151 and earlier production remediation. They are not a valid production strategy after Issue #167.

## Required Environment

Registration production checks require these names to exist in Vercel:

```text
DATABASE_URL
AUTH_PRODUCTION_AUTH_STRATEGY
AUTH_SESSION_SECRET
AUTH_EMAIL_PROVIDER
RESEND_API_KEY
AUTH_EMAIL_FROM
AUTH_PUBLIC_APP_URL
AUTH_REGISTRATION_MODE
AUTH_REGISTRATION_DEFAULT_TENANT
AUTH_SESSION_TTL_HOURS
AUTH_EMAIL_VERIFICATION_TTL_HOURS
AUTH_PASSWORD_RESET_TTL_MINUTES
VITE_AUTH_PRODUCTION_AUTH_STRATEGY or AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY
```

Local value validation additionally enforces:

- `AUTH_PRODUCTION_AUTH_STRATEGY=registration`
- browser runtime strategy is `registration`
- `AUTH_EMAIL_PROVIDER=resend`
- `AUTH_PUBLIC_APP_URL` is HTTPS
- `AUTH_REGISTRATION_MODE=admin-approved`
- `AUTH_SESSION_TTL_HOURS=8`
- `AUTH_EMAIL_VERIFICATION_TTL_HOURS=24`
- `AUTH_PASSWORD_RESET_TTL_MINUTES=30`

## Operator Workflow

1. Seed or update the first admin:

   ```bash
   npm run auth:admin:seed
   npm run auth:admin:seed -- --apply
   ```

2. Validate configuration:

   ```bash
   npm run auth:config:check:vercel
   npm run auth:config:check
   ```

3. Capture production smoke evidence:

   ```bash
   npm run auth:registration:production-smoke
   ```

4. Run the ship gate:

   ```bash
   npm run auth:status:check -- --require-complete
   ```

See `docs/runbooks/production-auth-status.md` for the canonical evidence fields and rollback target requirements.

## OIDC

OIDC remains supported when selected explicitly with `AUTH_PRODUCTION_AUTH_STRATEGY=oidc`. OIDC production still requires browser discovery/client configuration, provider JWT verifier variables, hosted callback validation, protected-route validation, logout validation, and rollback evidence.

OIDC parity command:

```bash
npm run auth:oidc:production-smoke -- --require-complete
```

## Rollback

The standard rollback is the last known-good registration deployment and configuration. Emergency internal bootstrap rollback requires explicit operator approval and must keep the browser bootstrap flags scoped to the emergency window. Re-enabling magic-link production sign-in requires a new product/security decision because the active registration contract removes that path.
