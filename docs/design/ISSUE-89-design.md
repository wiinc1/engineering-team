# ISSUE-89 Login Auth Configuration Design

## Research & Context

Issue 89 reports production users blocked at `/sign-in` because enterprise sign-in is disabled when OIDC browser configuration is absent. The existing app already has OIDC Authorization Code + PKCE support in `src/app/session.js` and `/sign-in` UI in `src/app/App.jsx`; the gap is release validation, safe diagnostics, operator evidence, monitoring, and clearer no-login-path copy.

## Coverage Gap Analysis

Existing coverage exercises sign-in, callback restore, and internal fallback behavior, but did not cover production auth configuration validation, Vercel env-name checks, diagnostics redaction, no-login-path copy, auth alert thresholds, or visual baselines for the three sign-in states.

## User Story

As an authorized workflow app user, I need production `/sign-in` to start enterprise OIDC instead of presenting a disabled-only login path, so I can access protected workflow routes.

## Feasibility Check

The fix can be implemented as a release/build gate around the existing OIDC flow. Live Vercel, IdP allowlist, redeploy, and real production smoke evidence require production credentials and are tracked as external remediation under the `production-remediation-pending` label.

## Technical Plan

- Add `lib/auth/config-check.js` with deterministic production validation.
- Add `npm run auth:config:check` and `npm run auth:config:check:vercel`.
- Run the production auth gate at the start of `npm run build`.
- Emit `observability/auth-config-diagnostics.json` with booleans and missing names only.
- Improve `/sign-in` no-login-path copy without exposing raw config.
- Add visual snapshots for configured OIDC, no-login-path, and local fallback states.
- Add monitoring rule definitions for no-login-path and callback failure thresholds.
- Update runbook, README, `.env.example`, and workflow diagram.

## Requirements Matrix

| Requirement | Implementation |
| --- | --- |
| Block production builds with no login path | `scripts/check-auth-config.js --target production` in `npm run build` |
| Validate browser OIDC and backend JWKS config | `validateAuthConfig` required variable checks |
| Reject production internal bootstrap | `VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED` and `AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP` true-state errors |
| Vercel env-name validation without values | `npm run auth:config:check:vercel` |
| Non-secret diagnostics artifact | `observability/auth-config-diagnostics.json` |
| Safe sign-in copy | `/sign-in` no-login-path alert update and UI test |
| Visual regression states | `tests/visual/auth-sign-in.visual.spec.ts` |
| Auth monitoring thresholds | `monitoring/alerts/auth-availability.yml` |
| Production evidence separation | Runbook and issue label retain production-remediation-pending state |

## Design Constraints

No public runtime diagnostics endpoint is added. Scripts must not print secret values. Production remediation cannot use internal bootstrap as the fix or rollback path.
