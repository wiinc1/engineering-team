# Issue 137 Design

## Context

Issue #137 restores a production-usable login path for deployments that do not
have an external identity provider available yet. The production path is the
existing invite-only magic-link flow backed by the audit database, email
delivery, httpOnly session cookies, and CSRF protection.

The internal browser bootstrap remains a local/internal compatibility fallback
only. Production deployments should leave it disabled unless an explicitly
approved emergency exception is active.

## Implemented Design

- `scripts/seed-auth-admin.js` provides a dry-run-first operator workflow for
  creating or updating the first production admin identity through the existing
  magic-link auth service.
- The script requires `DATABASE_URL`, `AUTH_ADMIN_EMAIL`, and
  `AUTH_ADMIN_ACTOR_ID`, and it accepts optional tenant, role, status, user ID,
  and operator attribution settings.
- The default run is read-only; operators must pass `--apply` before the script
  writes to the production database.
- Script output redacts the admin email as a short SHA-256 digest and never
  prints the database URL or raw email address.
- The browser no-login state now tells users that the deployment has no enabled
  sign-in method and directs them to the production operator.

## Rollout

1. Configure production for `magic-link` auth, Resend email delivery, HTTPS app
   URL, 15-minute magic-link TTL, 8-hour session TTL, and disabled internal
   bootstrap.
2. Dry-run the admin seed script and confirm the redacted target identity.
3. Re-run the script with `--apply` to upsert the first enabled admin.
4. Request and consume a magic link against the deployed production URL.
5. Attach the production evidence to issue #137 before closing it.

## Rollback

Revert the application change and restore the last known-good production auth
deployment/configuration. Do not switch production auth strategies during
rollback without a separate emergency exception.
