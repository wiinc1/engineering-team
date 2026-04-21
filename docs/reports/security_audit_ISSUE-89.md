# Security Audit: ISSUE-89

## Standards Alignment

- Applicable standards areas: security; deployment and release; observability and monitoring
- Evidence expected for this change: secret-redaction validation, production fallback rejection, JWKS verifier config validation, name-only Vercel env validation, and monitoring redaction evidence
- Gap observed: production smoke evidence and IdP allowlist verification are not available from the local workspace. Documented rationale: those checks require production operator credentials and must be attached before issue closure under `production-remediation-pending` (source https://github.com/wiinc1/engineering-team/issues/89).

## Required Evidence

- Commands run: `node --test tests/unit/auth-config-check.test.js`, `npm run test:security`, `npm run build` with production OIDC/JWKS env vars
- Tests added or updated: `tests/unit/auth-config-check.test.js`, `src/app/AuthAppShell.test.tsx`, `monitoring/alerts/auth-availability.yml`
- Rollout or rollback notes: revert PR 90 for code rollback; production rollback restores the last known-good OIDC config/deployment and keeps internal bootstrap disabled
- Docs updated: `docs/runbooks/production-identity-provider.md`, `docs/reports/security_audit_ISSUE-89.md`, `README.md`

## Findings

- Production validation fails when OIDC browser config or JWKS verifier config is missing.
- Production validation rejects internal browser bootstrap fallback flags when enabled.
- Diagnostics output contains boolean status and missing variable names only.
- Vercel validation reads env names only and does not call `vercel env pull`.
- `/sign-in` no-login-path copy avoids raw env names, URLs, client IDs, tokens, authorization codes, and secrets.
- Auth alert definitions document count/rate thresholds and redacted evidence categories.

## Residual Risk

Production IdP redirect allowlist verification and real OIDC smoke require operator access and must be attached as external release evidence before the issue is closed.
