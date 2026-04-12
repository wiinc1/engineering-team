# USER STORY — Authenticated Browser App Shell

**Story ID:** US-002  
**Template Tier:** Standard  
**Standards Verified:** Story authored from `docs/templates/USER_STORY_TEMPLATE.md` for the current repo shape and existing browser runtime constraints.

## 1. User Story

As an internal workflow user,
I want to sign in to the browser app and land in a navigable app shell,
so that I can use the task board, task list, and task detail views without manually pasting a JWT or knowing a task ID in advance.

**Business Context & Success Metrics**

The repo already has a usable task-detail browser runtime, but it is still intentionally thin. The current entry flow requires a user to open a deep link such as `/tasks/TSK-42` and manually paste a bearer JWT into a session bootstrap panel. That is acceptable for engineering validation, but it is the main blocker to actual day-to-day usage.

This story turns the current thin runtime into an internally usable application shell by adding:
- a real sign-in/session bootstrap flow
- a default authenticated landing route
- shared app-shell navigation across board, list, and detail surfaces
- protected-route behavior for expired or missing sessions

**Success Metrics**
- 90% of internal users can reach a usable authenticated landing page in under 60 seconds without developer assistance.
- 95% of successful sign-ins create a working session that can load `/tasks`, `/tasks?view=board`, and `/tasks/:id` without manual token entry.
- 0 manual JWT pasting steps remain in the default happy path for internal users.
- Protected routes redirect unauthenticated users to sign-in in 100% of automated coverage scenarios.
- Session-expiry handling returns the user to sign-in with a clear recovery path in under 2 user actions.

## 2. Acceptance Criteria

### Must Have

**Scenario 1 — Internal user signs in and lands in the app shell**  
Given an internal user opens the browser app without an active session  
When they complete the supported sign-in flow  
Then the app stores a valid authenticated session  
And redirects the user to the default landing page  
And the global app shell navigation is visible.

**Scenario 2 — Authenticated user can navigate to board, list, and detail surfaces**  
Given a user has an active authenticated session  
When they use the app navigation  
Then they can open the task list view  
And they can open the board view  
And they can open a task detail route without manually providing a token.

**Scenario 3 — Unauthenticated user is blocked from protected routes**  
Given a user has no active authenticated session  
When they attempt to open `/tasks`, `/tasks?view=board`, or `/tasks/:taskId`  
Then the app redirects them to the sign-in route  
And no protected data is rendered before the redirect completes.

**Scenario 4 — Expired or invalid session is handled cleanly**  
Given a user has a stale, expired, or invalid session  
When a protected API request returns an authentication failure  
Then the app clears the invalid session  
And redirects the user to sign-in  
And shows a recoverable message explaining that they need to sign in again.

**Scenario 5 — Authorized role-specific controls remain gated after sign-in**  
Given two authenticated users with different roles  
When both users open the same task detail surface  
Then both can access the shared read surfaces allowed by `state:read`  
And only authorized PM/admin users see assignment controls  
And unauthorized users do not see write-capable task-management controls.

### Nice to Have

**Scenario 6 — Session survives browser refresh within allowed lifetime**  
Given a user has an active authenticated session  
When they refresh the browser tab  
Then the app restores the session from its persisted storage  
And keeps the user on their last valid route.

**Scenario 7 — User can sign out explicitly**  
Given a user has an active authenticated session  
When they select sign out from the app shell  
Then the stored session is removed  
And the user is returned to sign-in  
And protected routes are inaccessible until they authenticate again.

## 3. Workflow & User Journey

**User Journey (step-by-step)**
1. User opens the browser app root URL.
2. User sees a sign-in screen instead of a raw session bootstrap panel.
3. User authenticates through the supported internal auth method.
4. App stores the authenticated session and claims needed for API access.
5. User lands on a default home route, likely the task list or board.
6. User uses top-level navigation to move between list, board, and task detail views.
7. User opens a task detail page and sees only the controls allowed for their role.
8. If the session expires, the app sends the user back to sign-in with a clear explanation.

**System Flow (technical)**
1. Browser app root route → auth/session bootstrap module
2. Sign-in UI submit → auth provider or internal token-exchange endpoint
3. Auth success → normalized session storage → claim parsing
4. Session state → protected-route guard → app shell router
5. App shell navigation → list/board/detail routes
6. Route adapters → existing `/tasks`, `/tasks/:id`, `/tasks/:id/detail`, `/ai-agents`, and assignment endpoints
7. API `401/403` auth failures → centralized session invalidation handler
8. Session invalidation → redirect to sign-in with user-facing recovery message

**Error & Edge Cases**
- Sign-in request fails due to network timeout.
- Auth provider returns invalid token shape or missing claims.
- User is authenticated but lacks required tenant claim.
- Stored session exists but cannot be parsed after a deploy.
- Browser refresh happens during session write or route transition.
- Protected API request returns `401` while a user is on a deep-linked detail route.
- User opens a shared task-detail link with no session and must be redirected safely.
- Role claims change between sessions and the app must not reuse stale authorization state.

**Required Diagram**
- Mermaid workflow diagram to be committed at: `/docs/diagrams/workflow-US-002.mmd`

## 4. Automated Test Deliverables

**Required automated deliverables for Standard tier**

```text
tests/
├── unit/
│   └── auth-app-shell.test.ts
├── integration/
│   └── auth-app-shell.integration.test.ts
├── e2e/
│   └── auth-app-shell.spec.ts
│   └── page-objects/
│       └── AuthAppShellPage.ts
├── contract/
│   └── pact-auth-session.spec.ts
├── visual/
│   └── auth-app-shell.visual.spec.ts
├── accessibility/
│   └── auth-app-shell.a11y.spec.ts
├── performance/
│   └── lighthouse-auth-shell.spec.ts
└── security/
    └── auth-app-shell-security.spec.ts

regression/
└── Tag all new scenarios with @regression
```

**Additional Standard Tier Test Requirements**
- Unit tests for session parsing, route guarding, sign-out behavior, and auth-failure recovery.
- Integration tests for authenticated navigation, unauthenticated redirects, and stale-session invalidation.
- E2E coverage for every Given-When-Then scenario in Section 2.
- Contract tests for any auth/session endpoint or token-exchange response used by the browser runtime.
- Visual regression coverage for sign-in, signed-in shell, and expired-session states.
- Accessibility validation with axe-core on sign-in and app-shell routes.
- Lighthouse CI for the signed-in landing page.
- Security automation for unauthorized route access, stale token replay, and storage/session handling regressions.
- Mutation testing configuration targeting 80%+ mutation score for auth-guard and session logic.

**Test Data Management**
- Fixtures committed under `tests/fixtures/auth-app-shell/`
- Factory functions for session claims, signed-in users, and expired-session states
- Seed data for authenticated list/board/detail navigation flows

## 5. Data Model & Schema

Not required for Standard tier.

## 6. Architecture & Integration

**Pattern**
- Feature-sliced browser application architecture with auth/session bootstrap, protected-route guards, and shared shell navigation layered on top of the existing task list/detail adapters.

**New/Changed Components**
- Sign-in route and sign-in form UI
- Session bootstrap and persistence module
- Route guard for protected browser routes
- Shared app shell with navigation across board, list, and detail surfaces
- Auth failure boundary/redirect handling
- Session-aware route initialization for deep links

**Required Diagram**
- C4 context/container diagram to be committed at: `/docs/diagrams/architecture-US-002.mmd`

**External Integrations**
- Internal auth provider or token-exchange endpoint for browser sign-in
- Existing audit/task APIs protected by bearer JWTs

**Retry/Timeout Configuration**
- Sign-in request timeout target: 5s
- Protected API fetch retry: no blind retry on `401`; single retry permitted on transient network failure before surfacing an error
- Session restore on app load must complete within 500ms before route guard decides whether to redirect

**Circuit Breaker Settings**
- Reuse platform default fetch/backoff behavior for browser-to-API calls
- Do not retry invalid credentials or malformed token responses

**Feature Flag**
- Flag name: `ff_authenticated_browser_app_shell`
- Platform: Unleash
- Targeting rules: internal environments first, then internal users with sign-in enabled, then broader tenant rollout if adopted beyond internal use

## 7. API Design

**API Contract**
- Existing protected task APIs remain authoritative:
  - `GET /tasks`
  - `GET /tasks/{taskId}`
  - `GET /tasks/{taskId}/detail`
  - `GET /ai-agents`
  - `PATCH /tasks/{taskId}/assignment`
- If the chosen auth implementation needs browser-friendly bootstrap or token exchange, define:
  - `POST /auth/session`
  - compatibility alias: `POST /api/auth/session`

**Request body**

```json
{
  "authCode": "temporary-login-code-or-equivalent"
}
```

**Success response**

```json
{
  "success": true,
  "data": {
    "accessToken": "jwt-token",
    "expiresAt": "2026-04-10T01:00:00.000Z",
    "claims": {
      "tenant_id": "tenant-a",
      "actor_id": "pm-1",
      "roles": ["pm"]
    }
  }
}
```

**Validation/error response examples**
- `400` malformed auth bootstrap request
- `401` invalid credentials or expired login exchange
- `403` authenticated but not permitted to access the application
- `502` upstream auth provider unavailable

**Committed spec location**
- `/docs/api/authenticated-browser-app-openapi.yml`

**Versioning Strategy**
- Additive endpoint change only; existing task APIs remain unchanged.
- Use existing versionless internal API style unless the auth provider requires a separate versioned namespace.

**Backwards Compatibility**
- Breaking changes: none to existing task APIs
- Existing manual JWT bootstrap can remain behind a fallback internal-only path during rollout
- Existing browser detail/list adapters should continue to function when a bearer token is already present

**Automated API Testing**
- OpenAPI linting via Spectral
- Contract verification for auth/session response shape
- Integration coverage for `401`, `403`, and malformed bootstrap requests

## 8. Security & Compliance

**Standard Tier Security Requirements**
- Authentication changes are session-based in the browser, backed by bearer JWT access to the existing APIs.
- Authorization remains role-based and server-authoritative; the client must not infer write permission beyond the claims and server responses.
- Protected routes must not render sensitive task data before session validation completes.
- Session storage and invalidation behavior must be covered by automated tests for replay, expiry, and sign-out.
- Unauthorized access must return `401/403` and redirect safely without leaving stale protected data on screen.
- Audit-sensitive actions such as assignment must continue to rely on server-side authorization, not client gating alone.

## 8a. Standardized Error Logging

**Mandatory implementation requirements**
- All auth/session bootstrap API routes must use the project’s centralized error handling and structured logging conventions.
- Browser session bootstrap failures must map to standardized, user-safe error states instead of ad hoc messages.
- Any new API route must return structured error payloads and avoid manual inline error formatting.
- Client-side auth failure handling must centralize `401/403` recovery rather than duplicating logic per route.
- No `console.log` or `console.error` usage in auth/session implementation paths; use the existing logging approach where server-side logging is needed.

## 9. Definition of Done

- [ ] User can sign in without manually pasting a JWT.
- [ ] Authenticated landing page exists and is reachable from the app root.
- [ ] Protected routes redirect unauthenticated users safely.
- [ ] Board, list, and detail routes all work behind the authenticated app shell.
- [ ] Session expiry and explicit sign-out are both covered by automated tests.
- [ ] Role-gated write controls remain visible only to authorized users.
- [ ] Required diagrams and API spec are authored at the documented paths.
- [ ] Full Standard-tier automated test matrix is added and passing.

## 10. Out of Scope

- External customer-facing identity flows
- Social login or consumer identity providers
- Multi-tenant self-service account management
- Full live-update subscriptions for task changes
- Native mobile authentication
- Replacing server-side RBAC with client-side role logic
