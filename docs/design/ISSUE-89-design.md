# ISSUE-89 Login Auth Configuration Design

## Research & Context

Issue 89 reports production users blocked at `/sign-in` because enterprise sign-in is disabled when OIDC browser configuration is absent. The pivoted requirement recognizes that no production IdP currently exists, so production must support an explicitly selected internal-bootstrap strategy with release validation, safe diagnostics, operator evidence, monitoring, and clear no-login-path copy.

## Coverage Gap Analysis

Existing coverage exercises sign-in, callback restore, and internal fallback behavior, but did not cover production auth strategy validation, Vercel env-name checks for OIDC or internal-bootstrap modes, diagnostics redaction, no-login-path copy, auth alert thresholds, or visual baselines for the sign-in states.

## User Story

As an authorized workflow app user, I need production `/sign-in` to provide the selected approved auth path, even when no external IdP exists, so I can access protected workflow routes.

## Feasibility Check

The fix can be implemented as a release/build gate around explicit auth strategies. Live Vercel, redeploy, and real production smoke evidence require production credentials and are tracked as external remediation under the `production-remediation-pending` label.

## Technical Plan

- Add `lib/auth/config-check.js` with deterministic production strategy validation.
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
| Block production builds with no selected auth path | `scripts/check-auth-config.js --target production` in `npm run build` |
| Validate browser OIDC and backend JWKS config | `validateAuthConfig` OIDC required variable checks |
| Allow production internal bootstrap only when explicit | `AUTH_PRODUCTION_AUTH_STRATEGY=internal-bootstrap` plus required bootstrap vars |
| Vercel env-name validation without values | `npm run auth:config:check:vercel` accepts complete OIDC or internal-bootstrap name sets |
| Non-secret diagnostics artifact | `observability/auth-config-diagnostics.json` |
| Safe sign-in copy | `/sign-in` no-login-path alert update and UI test |
| Visual regression states | `tests/visual/auth-sign-in.visual.spec.ts` |
| Auth monitoring thresholds | `monitoring/alerts/auth-availability.yml` |
| Production evidence separation | Runbook and issue label retain production-remediation-pending state |

## Design Constraints

No public runtime diagnostics endpoint is added. Scripts must not print secret values. Production remediation must use a named strategy; internal bootstrap is allowed only while explicitly selected because no IdP exists.
