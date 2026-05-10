# Registration Login and Signup UX Research Plan

Last researched: 2026-05-08

## Purpose

This document captures the login and signup UX research reviewed for the registration-auth browser experience and turns it into an implementation plan. It is intended to guide follow-up GitHub issues, design review, and implementation PRs for the `/sign-in`, registration, email verification, and password reset flows.

## Implementation Status

Implemented on 2026-05-08:

- `/sign-in` now defaults to one focused password sign-in form.
- Account creation is public from `/sign-in`, but new accounts require admin approval before app access.
- Password reset is a separate mode behind a secondary action.
- Production registration auth no longer shows `API base URL`.
- Auth copy uses `Engineering Team` product language instead of issue/browser-shell terminology.
- Password fields now support show/hide controls, password-manager autocomplete, spellcheck suppression, and no autocapitalization.
- Registration and reset password states show the backend password policy hint.
- Auth styling now uses one quieter panel, tighter radii, reduced decoration, and mobile-specific layout behavior.
- Visual, unit, and browser tests cover the default sign-in, create-account, reset-request, reset-confirm, email verification, enterprise OIDC, internal fallback, and no-login-path states.

## Product Context

The current browser app is an operational workflow tool. The primary unauthenticated user is a team member who needs to quickly reach protected task workspace routes, inboxes, PM overview routes, and task detail routes. The login page should therefore behave like a work-focused SaaS auth screen: direct, low-distraction, accessible, and secure.

Current implementation inspected:

- `src/app/App.jsx` renders the unauthenticated auth shell.
- `src/app/styles.css` defines `.app-shell--auth`, `.auth-card`, `.session-form`, and auth button styles.
- `tests/visual/auth-sign-in.visual.spec.tsx` and `tests/visual/__snapshots__/auth-sign-in.visual.spec.tsx.snap` document the rendered registration state.
- `tests/browser/auth-shell.browser.spec.ts` asserts the current registration auth screen and visual shell styles.

## Research Sources

- GitHub login: https://github.com/login
- GitHub passkey sign-in docs: https://docs.github.com/en/enterprise-cloud@latest/authentication/authenticating-with-a-passkey/signing-in-with-a-passkey
- Slack sign-in help: https://slack.com/hc/articles/212681477-Sign-in-to-Slack
- Linear login methods: https://linear.app/docs/login-methods
- Notion login methods: https://www.notion.com/en-gb/help/log-in-and-out
- Stripe passkey sign-in: https://support.stripe.com/questions/sign-in-using-a-passkey
- Stripe SSO docs: https://docs.stripe.com/get-started/account/sso
- Atlassian account login: https://support.atlassian.com/atlassian-account/docs/log-in-to-your-atlassian-account/
- GOV.UK password input: https://design-system.service.gov.uk/components/password-input/
- GOV.UK passwords pattern: https://design-system.service.gov.uk/patterns/passwords/
- Baymard sign-in guidance: https://baymard.com/blog/simplifying-sign-in
- Baymard password creation guidance: https://baymard.com/blog/password-requirements-and-password-reset

## Research Findings

### 1. Best login pages keep one dominant path

GitHub keeps email/username and password as the central path, with forgot-password, account creation, and passkey actions placed as secondary choices. The useful pattern is not the exact GitHub layout; it is the hierarchy: one primary action, recovery close to the password field, and account creation outside the core sign-in form.

### 2. Password recovery should be close but not equal to login

Baymard guidance emphasizes making password recovery easy to find, especially near the password field. GOV.UK also recommends avoiding account-existence leaks and using safe reset flows. The current reset form is visible as a peer form, which gives recovery too much weight and increases scanning cost.

### 3. Password fields need usability support

GOV.UK recommends password inputs with:

- `type="password"`
- correct `autocomplete` values
- no spellcheck or autocapitalization
- show/hide password control
- generic failed-login messaging that does not reveal whether the email or password was wrong
- password clearing after failed login
- paste support for password manager users

The current implementation has useful `autocomplete` values, but it does not expose a show/hide control and does not explicitly disable spellcheck/autocapitalization on password fields.

### 4. Signup should be a dedicated flow

Baymard and NN/g-style registration guidance consistently treats account creation as user effort. Users should only see signup fields when they are creating an account. The current page renders login, registration, and reset forms together, which makes the screen feel like an internal utility instead of a focused auth experience.

### 5. Modern auth pages increasingly support passkeys and org-controlled SSO

GitHub, Linear, Notion, Stripe, Atlassian, and Vercel all support passkeys, SSO, or multiple login methods. This app should not add those prematurely if the backend policy is not ready, but the UI should be structured so password auth, future passkeys, and future SSO can coexist without crowding the default form.

### 6. Operational SaaS auth screens should be quiet and scannable

This product is a work tool. A login page should use restrained surfaces, predictable spacing, and direct copy. The current auth card uses a 24px radius, nested form cards, gradients, and route-heavy copy. Those choices add visual weight without helping the user complete authentication.

## Current UX Gaps

### Flow and hierarchy

- Login, account creation, and password reset are visible simultaneously.
- `Create account` and `Reset password` appear as peer form actions instead of secondary navigation.
- The sign-in form includes `API base URL`, which is operator configuration rather than end-user auth.
- There is no explicit auth mode state such as `signIn`, `register`, or `resetRequest`.

### Content

- The eyebrow `Authenticated browser shell for US-002` is internal implementation language.
- The heading `Sign in to the workflow app` is generic.
- Supporting copy lists internal route families rather than explaining the product value.
- Reset and registration success copy is safe, but the surrounding page structure makes the flow feel unfinished.

### Interaction

- Password fields lack show/hide controls.
- Password fields do not explicitly set `spellCheck={false}` and `autoCapitalize="none"`.
- Registration does not show password requirements near the create-password field.
- Reset password request is not presented as a focused email-only step.

### Visual Design

- `.auth-card` uses a large 24px radius and gradient background.
- Each child `.session-form` is itself card-like, creating nested framed surfaces.
- The auth screen feels more decorative than the rest of the operational app.
- Mobile layout keeps substantial auth padding at small widths.

### Accessibility and Testing

- Labels are present, which is good.
- Existing tests assert the current all-forms-at-once behavior, so tests must be updated when modes are introduced.
- Visual snapshots should cover the default sign-in, create-account, reset-request, verification-complete, and reset-confirm states.

## Target Experience

### Default sign-in

```text
Engineering Team

Sign in
Access your task workspace and inboxes.

Email address
Password                                      Forgot password?

[Sign in]

New here? Create an account
```

### Create account mode

```text
Create your account
Create an account. An admin will approve access before you can use Engineering Team.

Name
Email address
Password

[Create account]

Already have an account? Sign in
```

Notes:

- Public signup is available, but backend registration mode must be `admin-approved`.
- Created accounts remain `pending_approval` and cannot sign in until an admin activates them.
- Show concise password requirements near the password input.
- After submission, show a verification-pending state that tells the user to check email.

### Forgot password mode

```text
Reset your password
Enter the email address for your account.

Email address

[Send reset instructions]

Back to sign in
```

Notes:

- Always show a generic success message after submission.
- Do not reveal whether an account exists for the email.

### Password reset confirmation

```text
Set a new password

New password

[Set new password]
```

Notes:

- Add show/hide control.
- Use the same password requirements as account creation.
- Route back to sign-in with clear success copy.

## Implementation Plan

### Phase 1: Restructure auth modes

Goal: remove simultaneous forms and establish one primary task per screen.

Tasks:

- Add an auth UI mode state for `signIn`, `register`, and `resetRequest`.
- Support public registration through the `Create an account` action and `?mode=register`.
- Support `?mode=reset` for password reset direct linking.
- Render only the form for the current mode.
- Move `Create account` and `Forgot password?` into secondary text-link actions.
- Keep email values when switching modes so the user does not retype.
- Update visual and browser tests to assert mode-specific rendering.

Acceptance criteria:

- `/sign-in` defaults to only the sign-in form.
- `/sign-in` exposes a public `Create account` action.
- `Create account` opens only the registration form.
- `?mode=register` opens only the registration form.
- Registration copy states that admin approval is required before app access.
- `Forgot password?` opens only the reset-request form.
- Switching back to sign-in preserves the typed email address.
- Existing enterprise OIDC and internal bootstrap states still render only when configured.

### Phase 2: Remove production-only configuration from user auth

Goal: keep operator controls out of the normal production login path.

Tasks:

- Hide `API base URL` from registration sign-in in production auth mode.
- Keep API base URL input only for explicit internal bootstrap or local/dev fallback modes.
- Treat Vercel production and preview browser bundles as registration by default unless a strategy explicitly selects OIDC or internal bootstrap.
- Ensure login, registration, and reset requests still use the resolved same-origin API base URL when the field is hidden.
- Update tests that currently expect `API base URL` in the registration state.

Acceptance criteria:

- Registration production sign-in does not show `API base URL`.
- Internal bootstrap fallback can still show API base URL when explicitly selected.
- Browser tests verify production users do not see operator configuration.

### Phase 3: Rewrite auth copy

Goal: replace implementation language with product-facing copy.

Tasks:

- Replace `Authenticated browser shell for US-002` with a product identity label or remove the eyebrow.
- Replace `Sign in to the workflow app` with `Sign in to Engineering Team`.
- Replace route-heavy lede copy with concise value copy.
- Tailor mode copy for sign-in, create-account, reset-request, verification, and reset-confirm flows.
- Keep safe copy for expired sessions, removed magic links, and invalid reset links.

Acceptance criteria:

- No user-facing auth copy references issue IDs, browser shell implementation details, or internal route lists.
- Expired-session and sign-out notices remain clear.
- Tests assert updated headings and core copy.

### Phase 4: Improve password input behavior

Goal: reduce password entry errors while preserving security.

Tasks:

- Add show/hide password controls for current password, create password, and reset password.
- Add accessible names such as `Show password` and `Hide password`.
- Set password inputs to `spellCheck={false}` and `autoCapitalize="none"`.
- Keep `autocomplete="current-password"` for login.
- Keep `autocomplete="new-password"` for registration and reset confirmation.
- Show concise password requirements where users create or reset passwords.
- Clear password values after failed login attempts if not already handled by backend/UI behavior.

Acceptance criteria:

- Keyboard users can tab to and activate password visibility controls.
- Screen reader labels distinguish each password toggle.
- Password manager behavior remains supported.
- Failed login messaging does not reveal whether email or password was wrong.

### Phase 5: Simplify auth visual design

Goal: align the auth surface with a quiet operational SaaS style.

Tasks:

- Use one primary auth panel instead of nested card-like forms.
- Reduce auth panel radius from 24px to a tighter radius consistent with the app.
- Remove or reduce gradients and decorative background treatment.
- Tighten mobile padding and preserve minimum tap target sizes.
- Keep focus-visible styles strong for inputs, links, and buttons.

Acceptance criteria:

- Auth screen has one clear panel and one visible primary action.
- Text and controls do not overflow at small mobile widths.
- Visual snapshots cover desktop and mobile auth states.
- The screen still feels consistent with the rest of the app.

### Phase 6: Prepare for future auth methods

Goal: avoid painting the UI into a password-only corner.

Tasks:

- Define a compact auth-method area above or below the password form.
- Add no-op design slots for future passkey and SSO methods, but do not render unsupported methods.
- Keep enterprise SSO rendering conditional on configured OIDC/SAML policy.
- Document passkeys as a future enhancement that needs backend WebAuthn support.

Acceptance criteria:

- Password auth remains the only visible method unless another method is configured.
- Future passkey/SSO additions can be introduced without redesigning the page.
- Auth method ordering remains deterministic and testable.

## Suggested GitHub Issue Breakdown

1. Restructure `/sign-in` into mode-specific login, signup, and password reset views.
2. Hide production auth operator configuration from end users.
3. Replace internal auth screen copy with product-facing copy.
4. Add accessible password visibility controls and password-entry hardening.
5. Simplify auth visual design and update responsive states.
6. Add test coverage for auth modes, copy, accessibility, and responsive snapshots.
7. Document future passkey and SSO extension points.

## Verification Plan

Run targeted checks after implementation:

- Unit and browser tests covering sign-in, registration, reset request, email verification, reset confirmation, expired session, and sign-out notices.
- Visual snapshots for each auth mode.
- Keyboard-only walkthrough for all modes.
- Desktop and mobile viewport inspection.
- Negative auth tests verifying generic login and reset messaging.
- Regression check that protected deep links still redirect to sign-in and restore after successful login.

## Open Product Decisions

- Decision: anyone can create an account from public sign-in.
- Decision: new accounts require admin approval before they can use the app.
- What product name should replace `workflow app` everywhere in auth copy?
- Should enterprise SSO return as a visible option after registration auth stabilizes?
- Should passkeys be planned now, or deferred until a separate WebAuthn backend issue is approved?
