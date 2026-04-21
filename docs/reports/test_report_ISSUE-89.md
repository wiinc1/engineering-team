# Test Report: ISSUE-89

## Standards Alignment

- Applicable standards areas: testing and quality assurance; deployment and release; security; observability and monitoring
- Evidence expected for this change: deterministic auth strategy validation commands, UI and visual sign-in coverage, browser callback coverage, security validation, and production-remediation evidence tracking
- Gap observed: live Vercel production env-name validation, redeploy inspection, production sign-in smoke, and post-login data checks were not run locally. Documented rationale: those checks require production credentials and operator access, so issue 89 remains `production-remediation-pending` until that release evidence is attached (source https://github.com/wiinc1/engineering-team/issues/89).

## Required Evidence

- Commands run: `node --test tests/unit/auth-config-check.test.js`, `npm run test:unit`, `npm run test:security`, `node scripts/run-playwright.js tests/browser/auth-shell.browser.spec.ts`, `npm run lint`, `npm run typecheck`, `npm run build` with production OIDC/JWKS env vars
- Tests added or updated: `tests/unit/auth-config-check.test.js`, `src/app/AuthAppShell.test.tsx`, `tests/visual/auth-sign-in.visual.spec.tsx`, `tests/visual/__snapshots__/auth-sign-in.visual.spec.tsx.snap`
- Rollout or rollback notes: code can roll back by reverting PR 90; production auth rollback remains restoring the last known-good OIDC deployment/config rather than enabling internal bootstrap
- Docs updated: `docs/design/ISSUE-89-design.md`, `docs/reports/*ISSUE-89*.md`, `docs/runbooks/production-identity-provider.md`, `README.md`, `.env.example`

## Scope

Deterministic coverage was added for production auth config validation, Vercel env-name parsing, diagnostics redaction, no-login-path sign-in copy, visual sign-in states, and auth availability alert thresholds.

## Commands

- `node --test tests/unit/auth-config-check.test.js`
- `npm run test:unit`
- `npm run test:security`
- `node scripts/run-playwright.js tests/browser/auth-shell.browser.spec.ts`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ui:vitest -- src/app/AuthAppShell.test.tsx tests/visual/auth-sign-in.visual.spec.tsx`
- `npm run auth:config:check` with production OIDC/JWKS env vars
- `npm run auth:config:check -- --target development` with local fallback enabled
- `node scripts/check-auth-config.js --vercel --vercel-json tests/fixtures/auth-vercel-env-names.json`
- `npm run build` with production OIDC/JWKS env vars

## Notes

Live Vercel env-name validation, production redeploy inspection, IdP allowlist verification, production OIDC smoke, and post-login data checks require production credentials and remain release evidence under `production-remediation-pending`.
