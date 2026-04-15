# US-002 Design

## Research & Context
## Evidence
- The existing browser app is a single React shell in `src/app/App.jsx` that mounts list, inbox, PM overview, task detail, and task creation routes behind a manual session bootstrap panel.
- Session state before this change was stored in `sessionStorage` via `src/app/session.browser.js` as `{ bearerToken, apiBaseUrl }`, which required manual JWT pasting.
- The audit API already enforces JWT bearer auth and tenant claims in `lib/audit/http.js` and `lib/auth/jwt.js`, so the missing piece was browser-friendly session issuance plus client route protection.
- The repo does not include the requested workflow orchestrators such as `.workflow/state.json`, `.agent/skills/test-coverage-gap-analysis`, or `npm run ag:workflow ...`, so story execution had to be mapped onto the real repo structure and available test runners.

## Coverage Gap Analysis
## Evidence
- Existing UI coverage in `src/app/App.test.tsx` validated task detail, list, board, PM overview, and inbox behavior, but it did not validate sign-in, protected-route redirects, or expired-session recovery.
- Existing unit coverage in `tests/unit/task-browser-session.test.js` covered token/header storage basics, but it did not validate expiry logic, claim extraction, or auth bootstrap code generation.
- Existing API coverage in `tests/unit/audit-api.test.js` covered protected task routes, but it did not cover a browser auth bootstrap endpoint.
- Gap-fill plan implemented in this change:
- add session helper tests for claim parsing, expiry, authenticated-session checks, and auth-code generation
- add API tests for `POST /auth/session` and `/api/auth/session`
- add UI tests for protected-route redirect, sign-in success, and expired-session redirect
- add adapter coverage for centralized 401 auth-failure callback handling

## User Story
## Evidence
- As an internal workflow user, I want to sign in to the browser app and land in a navigable app shell so that I can use task board, task list, PM overview, inbox, and task detail views without manual JWT handling.
- Acceptance criteria implemented in scope:
- unauthenticated visits to protected routes redirect to `/sign-in`
- sign-in exchanges an internal auth bootstrap code for a JWT session
- authenticated users land on `/tasks` by default and keep shared shell navigation
- expired sessions redirect back to sign-in with a recovery message
- role-gated controls remain based on token roles, so PM/admin-only assignment behavior is preserved
- Explicit repo-scope reality check:
- this repo does not contain external identity provider integration
- the supported browser sign-in flow is an internal auth bootstrap exchange backed by `POST /auth/session`
- manual JWT pasting is removed from the default path but can still be preserved as an internal fallback later if needed

## Feasibility Check
## Evidence
- Backend feasibility: the audit API already signs and verifies HMAC JWTs, so adding a session bootstrap route was low-risk and reused the existing JWT secret and claims shape.
- Frontend feasibility: route state already lived in `App.jsx`, so adding a protected-route guard and sign-in route did not require a router rewrite.
- Failure-mode validation:
- expired-token handling can be centralized in the browser data client by firing an auth-failure callback on `401`, avoiding per-route duplication
- detail-route `403` restricted states remain server-authoritative and are not treated as forced sign-out events
- Risk notes:
- full workflow automation and closeout scripts from the requested process are absent in this checkout
- the browser test surface is concentrated in one large `App.test.tsx`, so broad-suite runtime remains the main verification risk area

## Technical Plan
## Evidence
- Browser session model:
- extend `src/app/session.browser.js` and `src/app/session.js` to support expiry-aware sessions, claim reads, authenticated-session checks, and internal auth-code generation
- API bootstrap:
- add `POST /auth/session` and `/api/auth/session` support in `lib/audit/http.js`
- reuse HMAC JWT signing in `lib/auth/jwt.js`
- Browser shell:
- guard `/`, `/tasks`, `/tasks?view=board`, `/overview/pm`, `/inbox/*`, and `/tasks/:id`
- add a first-class `/sign-in` route and internal sign-in form
- add shared authenticated navigation plus explicit sign-out
- keep existing route modules and detail/list adapters intact
- extend the authenticated shell with a dedicated `/overview/governance` route so governance review tasks stay out of standard delivery views
- preserve canonical owner-role grouping even when projected assignee ids use tier-specific variants such as `engineer-jr`, `engineer-sr`, or `engineer-principal`
- Centralized auth recovery:
- add `onAuthFailure` handling in the task-detail API client for `401` and invalid-token cases
- redirect to sign-in with a recoverable message when session-authenticated requests fail
- Artifacts created for the story:
- `docs/api/authenticated-browser-app-openapi.yml`
- `docs/diagrams/workflow-US-002.mmd`
- `docs/diagrams/architecture-US-002.mmd`

## Change Ownership Notes
## Evidence
- Changes under `src/app/App.jsx`, `src/app/session.js`, and `src/app/session.browser.js` should carry adjacent browser-shell evidence in the same PR.
- The nearest evidence artifacts for those surfaces are:
- `src/app/App.test.tsx`
- `src/app/AuthAppShell.test.tsx`
- `tests/browser/auth-shell.browser.spec.ts`
- `docs/api/authenticated-browser-app-openapi.yml`
- this design document
- Browser-shell route additions in this slice:
- `/overview/governance` is a protected route in the authenticated shell
- governance review tasks are shown only on that dedicated route and are intentionally excluded from the default task list, board, and PM overview delivery surfaces
- tier-specific engineer owners still collapse into the canonical `engineer` route family for inbox and overview grouping while preserving human-readable labels in the UI
- `/inbox/sre` is a protected route in the authenticated shell and now renders a deployment-aware monitoring dashboard for tasks actively in the `SRE_MONITORING` stage
- `/inbox/human` is a protected route in the authenticated shell and now renders governed close-review decision cards for cancellation recommendations and exceptional-dispute escalations
- protected `/tasks/{taskId}` sessions can now surface the SRE-only anomaly-child-task form on task detail, so browser-shell auth coverage must continue to protect that route restoration path as detail capabilities expand
