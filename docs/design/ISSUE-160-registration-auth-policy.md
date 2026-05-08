# Issue #160 Registration Auth Policy

Decision date: 2026-05-08

## Decision

Use registration auth as the active no-IdP production strategy. Keep OIDC available only when selected explicitly. Keep internal bootstrap as an emergency/local fallback. Treat magic-link as historical after the cutover.

Issue #151 and PR #159 are reconciled by this decision. PR #159 documented the earlier magic-link/OIDC production-auth status evidence path for Issue #151; the registration cutover supersedes that path with registration smoke evidence, registration production gates, and historical-only magic-link evidence.

## Issue Flag Mapping

The issues used `ff_registration_*` names as conceptual rollout controls. The implemented production gates are environment and status-check controls:

| Issue wording | Implemented control | Purpose |
|---|---|---|
| `ff_registration_auth_strategy` | `AUTH_PRODUCTION_AUTH_STRATEGY=registration` plus `VITE_AUTH_PRODUCTION_AUTH_STRATEGY=registration` or runtime-config evidence | selects registration as the active backend and browser auth strategy |
| `ff_registration_credentials` | `AUTH_REGISTRATION_MODE` plus credential schema and password service | enables credential-backed registration modes |
| `ff_registration_email_verification` | `AUTH_REQUIRE_EMAIL_VERIFICATION` and `AUTH_EMAIL_VERIFICATION_TTL_HOURS` | controls pending-verification behavior and token expiry |
| `ff_registration_password_reset` | `AUTH_PASSWORD_RESET_TTL_MINUTES` and the reset endpoints | controls reset token expiry and reset flow availability |
| `ff_registration_abuse_controls` | registration service rate-limit and audit settings | applies login, registration, and reset abuse controls |
| `ff_registration_magic_link_removed` | production status checks plus removed `/auth/magic-link/*` behavior | prevents magic-link from satisfying production gates |

## Registration Modes

| Mode | Registration behavior | Login behavior | Operator requirement |
|---|---|---|---|
| `open` | creates an active or pending-verification user | active users can login | monitor registration spikes |
| `invite-only` | requires an existing invite or configured invite code | active invited users can login after credential creation | operator owns invite source |
| `admin-approved` | creates a pending-approval user | admin must activate before login | admin review queue required |

## First Admin

The first admin is seeded with `npm run auth:admin:seed -- --apply`. The command prints only redacted identifiers and writes to `auth_users`.

## Browser UI Matrix

| Strategy | Visible controls | Hidden controls |
|---|---|---|
| `registration` | email/password login, create account, reset password | magic-link, trusted auth-code fallback |
| `oidc` | enterprise sign-in | registration forms, magic-link, trusted auth-code fallback |
| `internal-bootstrap` | trusted auth-code fallback in local/internal contexts | magic-link |
| no strategy | safe no-login-path error | raw env values and provider secrets |

## Migration

1. Add credential and token schema.
2. Seed first admin or attach credentials to existing active users without changing tenant, actor, roles, or status.
3. Enable registration strategy in config and browser runtime.
4. Capture registration production smoke.
5. Remove magic-link from active UI, API, and production status gates.

## Rollback

Rollback target is the last known-good registration deployment and configuration. Emergency internal bootstrap can be used only with explicit approval. Magic-link is not an automatic rollback target after Issue #167.
