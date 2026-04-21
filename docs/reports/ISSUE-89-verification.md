# ISSUE-89 Verification

## Standards Alignment

- Applicable standards areas: deployment and release; security; authentication; testing and quality assurance; observability and monitoring
- Evidence expected for this change: production auth strategy gate, Vercel env-name validation, non-secret diagnostics artifact, UI/browser coverage, visual sign-in baselines, monitoring rules, and production-remediation evidence checklist
- Gap observed: the local workflow cannot complete live production Vercel remediation evidence. Documented rationale: production credentials and approved operator-account smoke execution are external release tasks, so issue 89 remains `production-remediation-pending` after code completion (source https://github.com/wiinc1/engineering-team/issues/89).

## Required Evidence

- Commands run: `node --test tests/unit/auth-config-check.test.js`, `npm run test:unit`, `npm run test:security`, `node scripts/run-playwright.js tests/browser/auth-shell.browser.spec.ts`, `npm run lint`, `npm run typecheck`, `npm run build` with production OIDC/JWKS env vars
- Tests added or updated: `tests/unit/auth-config-check.test.js`, `src/app/AuthAppShell.test.tsx`, `tests/visual/auth-sign-in.visual.spec.tsx`, `tests/visual/__snapshots__/auth-sign-in.visual.spec.tsx.snap`, `tests/fixtures/auth-vercel-env-names.json`
- Rollout or rollback notes: Vercel preview can build as preview/no-login-path; production must select `oidc` or `internal-bootstrap` and rolls back by restoring the last known-good auth deployment/config for that selected strategy
- Docs updated: `docs/design/ISSUE-89-design.md`, `docs/diagrams/workflow-ISSUE-89-login-auth-config.mmd`, `docs/reports/ISSUE-89-verification.md`, `docs/runbooks/production-identity-provider.md`, `README.md`

## Automated Evidence

- Production auth strategy validator added and wired to `npm run auth:config:check`.
- `npm run build` runs the production validator before Vite emits deployable assets.
- Name-only Vercel env validation added as `npm run auth:config:check:vercel`.
- Non-secret diagnostics artifact generation added at `observability/auth-config-diagnostics.json`.
- UI and visual tests cover configured OIDC, no-login-path, and local fallback sign-in states.
- Monitoring thresholds are defined in `monitoring/alerts/auth-availability.yml`.
- Local verification passed on April 21, 2026: `npm run test:unit`, `npm run test:security`, `node scripts/run-playwright.js tests/browser/auth-shell.browser.spec.ts`, `npm run lint`, `npm run typecheck`, and `npm run build` with production OIDC/JWKS env vars.
- The requested full-suite runner `.agent/skills/full-test-suite-runner/scripts/run-all-tests.mjs` is absent in this checkout.

## Release Evidence Still Required

- Vercel production env-name validation output from the production project.
- Selected production auth strategy evidence.
- Effective production `/auth/callback` redirect URI allowlist confirmation when OIDC is selected.
- New production deployment URL or ID, commit, Ready status, and build timestamp.
- Production sign-in smoke with an approved test/operator account or auth-code holder.
- Post-login protected-view data or intentional empty-state evidence.
- Monitoring and rollback evidence.
