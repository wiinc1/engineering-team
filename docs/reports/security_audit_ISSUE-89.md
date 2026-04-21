# Security Audit: ISSUE-89

## Standards Alignment

- Applicable standards areas: security; deployment and release; observability and monitoring
- Evidence expected for this change: secret-redaction validation, explicit production auth strategy validation, JWKS verifier config validation for OIDC, name-only Vercel env validation, and monitoring redaction evidence
- Gap observed: production smoke evidence is not available from the local workspace. Documented rationale: those checks require production operator credentials and must be attached before issue closure under `production-remediation-pending` (source https://github.com/wiinc1/engineering-team/issues/89).

## Required Evidence

- Commands run: `node --test tests/unit/auth-config-check.test.js`, `npm run test:security`, `npm run build` with production OIDC/JWKS env vars
- Tests added or updated: `tests/unit/auth-config-check.test.js`, `src/app/AuthAppShell.test.tsx`, `monitoring/alerts/auth-availability.yml`
- Rollout or rollback notes: production rollback restores the last known-good auth config/deployment for the selected strategy; internal bootstrap is allowed only when `AUTH_PRODUCTION_AUTH_STRATEGY=internal-bootstrap`
- Docs updated: `docs/runbooks/production-identity-provider.md`, `docs/reports/security_audit_ISSUE-89.md`, `README.md`

## Findings

- Production validation fails when no complete auth strategy is configured.
- Production validation allows internal browser bootstrap only when the explicit `internal-bootstrap` strategy and required secret/flags are configured.
- Diagnostics output contains boolean status and missing variable names only.
- Vercel validation reads env names only and does not call `vercel env pull`.
- `/sign-in` no-login-path copy avoids raw env names, URLs, client IDs, tokens, authorization codes, and secrets.
- Auth alert definitions document count/rate thresholds and redacted evidence categories.

## Residual Risk

Real production sign-in smoke requires operator access and must be attached as external release evidence before the issue is closed.
