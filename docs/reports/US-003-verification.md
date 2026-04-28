# US-003 Verification

## Results

- Raw requirements only create a Task in `DRAFT` with `intakeDraft: true`.
- Missing title falls back to `Untitled intake draft`; priority and task type remain unset.
- Task list, board, PM inbox, and detail surfaces label Intake Drafts and show `PM refinement required`.
- Audit history records `task.created` and `task.refinement_requested` without implementation-start or dispatch events.
- Cookie-session `/tasks/create` submissions include the shared CSRF token header instead of bearer-only auth.
- Malformed non-string raw requirements are rejected before task creation.
- Intake creation returns `task_creation_failed` and records `task.intake_creation_failed` instead of normal actionable intake state when PM refinement routing or canonical task persistence fails.
- Intake Draft stage advancement is blocked until PM refinement creates a non-intake execution contract.
- Optional intake titles are capped at 120 characters.

## Commands

- `node --test tests/unit/audit-api.test.js tests/unit/task-schema.test.js tests/contract/audit-openapi.contract.test.js` - 80 passed.
- `./node_modules/.bin/vitest run src/app/App.test.tsx tests/unit/task-creation-form.test.tsx` - 81 passed.
- `node --test tests/unit/task-schema.test.js tests/unit/task-creation-adapter.test.js tests/unit/features/task-creation/adapter.test.js tests/unit/task-detail-adapter.test.js tests/unit/audit-api.test.js tests/security/audit-api.security.test.js tests/contract/audit-openapi.contract.test.js` - 129 passed.
- `node --test tests/e2e/audit-foundation.e2e.test.js` - 11 passed.
- `node scripts/run-playwright.js tests/browser/task-detail.browser.spec.ts -g "labels intake draft" --project=chromium` - 1 passed.
- `npm run lint` - passed.
- `npm run typecheck` - passed.
- `env VITE_OIDC_DISCOVERY_URL=https://idp.example/.well-known/openid-configuration VITE_OIDC_CLIENT_ID=engineering-team-browser AUTH_JWT_ISSUER=https://idp.example AUTH_JWT_AUDIENCE=engineering-team AUTH_JWT_JWKS_URL=https://idp.example/.well-known/jwks.json npm run build` - passed.
- `npm run test` - passed after installing the missing local Playwright Firefox browser with `npx playwright install firefox`.
- `npm run standards:check` - passed.
- `npm run ownership:lint` - passed.
- `npm run change:check` - passed.
- `npm run build:browser` - passed.

## Rollout

Raw intake creation is guarded by `FF_INTAKE_DRAFT_CREATION`. Disable the flag to reject raw intake creation with `503` while preserving legacy refined-field task creation.

## Standards Alignment

- Applicable standards areas: testing and quality assurance, architecture and design, security, team and process
- Evidence in this report: API, UI, e2e, browser, contract, security, lint, typecheck, and standards verification for US-003
- Gap observed: this report covers repo-local verification only, not production telemetry. Documented rationale: automated verification catches defects before release, while operational quality requires direct runtime measurement after deployment (source https://sre.google/books/).

## Required Evidence

- Commands run: listed above
- Tests added or updated: see `docs/reports/test_report_US-003.md`
- Rollout or rollback notes: `FF_INTAKE_DRAFT_CREATION`
- Docs updated: design, story, API, runbook, ADR, and report artifacts for US-003
