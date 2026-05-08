# Production Auth Status

Last updated: 2026-05-07  
Tracking issue: Issue #151  
Related production remediation issue: Issue #137

## Current Decision

Active production strategy: `magic-link`

The current durable no-IdP production login path is invite-only magic-link auth. Production must expose the browser strategy as `magic-link`, keep internal bootstrap disabled, and use the same-origin Vercel `/backend` API rewrite for protected app routes.

Internal bootstrap is not the production closure path. It remains available only for local/internal use or an explicitly approved emergency exception.

## Deployment State

Repository implementation and deterministic local checks exist for the magic-link path, but Issue #151 cannot ship until a fresh production smoke artifact is captured on or after 2026-05-07 and passes:

```bash
npm run auth:status:check -- --require-complete
```

The historical April issue #92 smoke artifact proves the earlier remediation path worked at that time. It must not be used to close Issue #137 or Issue #151.

## Evidence Artifact

Canonical production smoke artifact:

```text
observability/magic-link-production-smoke.json
```

The artifact must be produced by:

```bash
npm run auth:magic-link:production-smoke -- --require-complete
```

It must contain:

- generated timestamp for the fresh smoke run
- selected auth strategy: `magic-link`
- deployment URL or deployment ID
- rollback target
- redacted invited-email hash
- redacted unknown-email hash
- redacted magic-link token hash
- all smoke summary checks set to `true`

It must not contain raw email addresses, raw magic-link URLs, tokens, cookies, CSRF values, Resend API keys, email bodies, or session secrets.

## Rollback Target

Rollback target: restore the last known-good working magic-link deployment and auth configuration for the selected strategy.

Do not switch production auth strategy during rollback unless a separate emergency exception is approved. A rollback record must identify the deployment URL or ID, selected auth strategy, and configuration owner confirmation.

## Required Production Checks

Before Issue #151 can move to the ship portion of the workflow:

- `npm run auth:config:check:vercel` passes with name-only production env evidence.
- `npm run auth:config:check` passes in an environment containing production auth variables.
- `/sign-in` shows the email magic-link form.
- `/sign-in` does not show the trusted auth-code fallback.
- Link request returns the generic success message.
- Unknown-email request returns the same generic message and sends no usable login.
- Resend delivery is confirmed without raw token material.
- Link consume sets session and CSRF cookies.
- `/auth/me` returns the seeded admin session.
- Protected routes load after consume.
- Replaying the consumed link is rejected.
- Logout revokes the session.
- Post-logout `/auth/me` is rejected.
- Monitoring evidence contains counts and classifications only.
- Rollback target is identified.

## OIDC Status

OIDC remains supported when a production identity provider exists. If production switches to `oidc`, update this status document, the production identity provider runbook, and the Issue #151 audit before shipping. The selected OIDC production evidence must include hosted callback, token/session validation, protected route access, logout behavior, IdP allowlist confirmation, and rollback target.

OIDC parity command:

```bash
npm run auth:oidc:production-smoke -- --require-complete
```

That command writes `observability/oidc-production-smoke.json` by default. It expects a production access token obtained through hosted OIDC sign-in and records only token hashes, deployment metadata, callback/session/protected-route/logout classifications, and rollback evidence.
