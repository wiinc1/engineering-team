# Security Audit US-003

## Scope

US-003 adds raw Intake Draft creation through `POST /tasks` and new list/detail visibility for Intake Draft state.

## Evidence

- `tests/security/audit-api.security.test.js` rejects unauthenticated intake creation.
- The same test rejects callers without `tasks:create` permission.
- Blank raw requirements are rejected with `400` before task creation.
- Non-string raw requirement payloads are rejected with `400 invalid_raw_requirements` before task creation.
- Overlong optional intake titles are rejected with `400 invalid_intake_title` before task creation.
- Cookie-session browser submissions reuse the shared CSRF header helper for `/tasks/create`.
- `FF_INTAKE_DRAFT_CREATION=false` rejects raw intake creation with `503` and the canonical feature id `ff_intake_draft_creation`.
- Intake creation records PM refinement routing only; it does not claim implementation started or dispatch delivery work.
- Generic stage changes from Intake Drafts are rejected until PM refinement creates a non-intake execution contract.
- Incomplete creation steps return `500 task_creation_failed` and record `task.intake_creation_failed` when possible rather than reporting a successful `201` response.
- `npm audit --audit-level=high` reports 0 vulnerabilities after refreshing the lockfile through `npm audit fix`.

## Review Notes

- Raw operator requirements are stored and displayed as task context. They should be treated as operator-provided content and not as executable instructions for agents until PM refinement completes.
- The legacy refined-field creation payload remains available for compatibility and continues to require existing task creation permission.

## Standards Alignment

- Applicable standards areas: security, testing and quality assurance, team and process
- Evidence in this report: auth, authorization, validation, feature-flag, and audit-history security coverage for the intake endpoint
- Gap observed: this audit does not include external penetration testing or production WAF/log review. Documented rationale: security evidence scope is repo-local and should be explicit so deployment controls can be evaluated separately (source https://www.microsoft.com/en-us/securityengineering/sdl).

## Required Evidence

- Commands run: see `docs/reports/US-003-verification.md`
- Tests added or updated: `tests/security/audit-api.security.test.js`, `tests/unit/audit-api.test.js`, `src/app/App.test.tsx`
- Rollout or rollback notes: disable `FF_INTAKE_DRAFT_CREATION` if raw intake creation must be stopped
- Docs updated: security audit report for US-003
