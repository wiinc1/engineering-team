# Standards Compliance Checklist

## Linked Standards
- Standards document: `docs/standards/software-development-standards.md`
- Required gap statement format: `Gap observed: X. Documented rationale: Y (source Z).`

## Issue #240 Addendum
- Change or task ID: Issue #240, persisted AI agent routing through assignment, inbox, and PM overview surfaces.
- Scope summary: Preserved the existing source-only browser visual contract while changing roster source and supported-role owner routing semantics.
- Evidence in this change: `src/app/AppRouteModel.test.tsx` keeps the canonical role inbox and PM overview route model covered; `DESIGN.md` records that the assignment select, role inbox, and PM overview visual contract is unchanged; `docs/api/task-owner-surfaces-openapi.yml` records persisted owner metadata readability for historical owners.
- Gap observed: Dynamic role policy remains outside this change. Documented rationale: Unsupported roles must stay out of live routing until a versioned role-policy layer owns role keys, assignment eligibility, inbox buckets, PM overview buckets, delegation mapping, permissions, and metrics dimensions (source issue #240).

## Change Metadata
- Change or task ID: Issue #154, frontend source modularization.
- Owner: Codex implementation agent.
- Date: 2026-05-15.
- Scope summary: Restored readable browser source, split the app shell into route/model modules, added a strict browser-source readability lint gate, updated browser ownership documentation, and recorded frontend modularization diagrams.

## Standards Alignment
- Applicable standards areas: architecture and design; coding and code quality; testing and quality assurance; deployment and release; observability and monitoring; authentication and secret handling; team and process.
- Standards baseline reviewed: `docs/standards/software-development-standards.md`.
- Evidence expected for this change: Feature-sliced browser route modules, strict browser-source readability linting, updated maintainability baseline for newly visible legacy complexity, full required verification commands, README ownership notes, and issue diagrams.
- Gap observed: Newly readable legacy browser modules still include functions above the repo maintainability cap after the first source split. Documented rationale: Smaller files and functions reduce review risk, change blast radius, and maintenance cost (source https://github.com/wiinc1/engineering-team/blob/main/docs/standards/software-development-standards.md).

## Architecture and Design
- Applicable: Yes.
- Evidence in this change: `src/app/App.jsx` now orchestrates shell/session flow while route ownership lives in `src/app/routes/AuthRoute.jsx`, `src/app/routes/CreateTaskRoute.jsx`, `src/app/routes/AdminUsersRoute.jsx`, `src/app/routes/TaskWorkspaceRoute.jsx`, and `src/app/routes/TaskDetailRoute.jsx`; shared route and formatting helpers live in `src/app/app-model.jsx`; diagrams were added at `docs/diagrams/workflow-frontend-source-modularization.mmd` and `docs/diagrams/architecture-frontend-source-modularization.mmd`.
- Gap observed: The route split is feature-sliced and every browser source module remains below the issue's 800-line acceptance cap, but several newly readable legacy route functions still exceed the repo's 50-line function cap and three modules exceed the 400-line source-file cap. Documented rationale: Smaller files and functions reduce review risk, change blast radius, and maintenance cost (source `docs/standards/software-development-standards.md`).
- Documented rationale and source: Newly visible legacy complexity is tracked in `config/maintainability-baseline.json`; follow-up work should continue splitting `App`, task detail, workspace, and adapter functions into smaller authored components/helpers.

## Coding and Code Quality
- Applicable: Yes.
- Evidence in this change: `scripts/check-browser-source-readability.js` runs from `npm run lint` and scans production browser files under `src/app/` and `src/features/` without readability allowlist entries. `config/lint-source-allowlist.json` no longer allowlists the restored production browser source files touched by this change.
- Gap observed: Legacy compact tests and non-browser modules remain in `config/lint-source-allowlist.json`. Documented rationale: The standards baseline allows tracked legacy violations to prevent high-risk big-bang cleanup while ratcheting against new unreviewed compact source (source `docs/standards/software-development-standards.md`).
- Documented rationale and source: The strict browser-source gate covers the issue scope; remaining legacy allowlist entries are owned by `@engineering-team/governance` with follow-up text in `config/lint-source-allowlist.json`.

## Testing and Quality Assurance
- Applicable: Yes.
- Evidence in this change: Added `tests/unit/governance/browser-source-readability.test.js` for the new readability gate and `src/app/AppRouteModel.test.tsx` for extracted route/query helpers. Existing route smoke, visual, accessibility, performance, browser, and full-suite tests passed.
- Gap observed: No automated test gap remains for the issue acceptance evidence. Documented rationale: The required command matrix passed locally and covers unit, integration, UI, browser, visual, accessibility, performance, security, property, and chaos checks (source issue #154).
- Documented rationale and source: See the command evidence below.

## Deployment and Release
- Applicable: Yes.
- Evidence in this change: No public API, auth endpoint, or runtime feature-flag branch was added; the source-only rollout label is documented as `ff_frontend_source_modularization`.
- Gap observed: Production release monitoring was not run in this local workflow. Documented rationale: Production verification depends on automated deployment health, synthetic sign-in/task-route checks, RUM Core Web Vitals, route error rates, and rollback readiness after deploy (source issue #154).
- Documented rationale and source: Release through normal browser gates; monitor sign-in, task workspace, and task detail synthetic paths for at least one hour after production rollout.

## Observability and Monitoring
- Applicable: Yes.
- Evidence in this change: No new runtime telemetry was introduced because this is a source-layout refactor with behavior preserved by existing test suites.
- Gap observed: The proposed issue metrics `feature_frontend_source_modularization_route_errors_total{route}` and `feature_frontend_source_modularization_render_duration_seconds{route}` were not implemented because no runtime route instrumentation was changed. Documented rationale: Observability should measure user experience directly and alerts must map to user pain (source `docs/standards/software-development-standards.md`).
- Documented rationale and source: Existing browser quality checks and production synthetic monitoring remain the release evidence.

## Authentication and Secret Handling
- Applicable: Yes.
- AuthN/AuthZ surfaces changed: Auth route rendering moved into `src/app/routes/AuthRoute.jsx`; session helper behavior and auth endpoint request shapes are preserved.
- Secret, token, cookie, password, or PII redaction evidence: `npm test`, `npm run test:ui`, and `npm run test:browser` passed existing auth/session/security coverage; no raw-token logging was added.
- Abuse-control or rate-limit evidence: No server auth or rate-limit code changed.
- Rollback or removal impact: Revert this refactor and `package.json` lint hook changes to restore the previous app-source layout; no data migration or runtime flag cleanup is required.
- Gap observed: No authentication behavior gap observed in local automated coverage. Documented rationale: Threat modeling and security-by-design reviews require auth behavior to remain verified when auth surfaces are moved (source `docs/standards/software-development-standards.md`).
- Documented rationale and source: Existing auth shell and browser tests cover protected route restore, callback restore, expired-session redirect, registration form, approval state, and reset-mode flows.

## Team and Process
- Applicable: Yes.
- Evidence in this change: README browser ownership notes, Mermaid workflow/architecture diagrams, and this standards checklist were added or updated with the source split.
- Gap observed: Follow-up maintainability work remains for smaller route functions and finer-grained task-detail helpers. Documented rationale: Documentation must be versioned and reviewed with the code it describes (source `docs/standards/software-development-standards.md`).
- Documented rationale and source: The maintainability baseline records the current debt explicitly so future changes can ratchet it down.

## Required Evidence
- Commands run:
  - `npx vitest run src/app/AppRouteModel.test.tsx` - passed, 3 tests.
  - `npm run lint` - passed; repo lint scanned 260 files and browser source readability scanned 33 files.
  - `npm run typecheck` - passed.
  - `npm run test:ui` - passed; 21 Vitest files / 144 tests plus role-inbox and PM-overview integrations.
  - `npm run test:browser` - passed; 105 Playwright browser tests.
  - `npm test` - passed; full unit/contract/integration/e2e/property/performance/security/chaos suite plus 105 browser tests.
  - `npm run standards:check` - passed; maintainability baseline has 35 tracked legacy findings at or below baseline and coverage policy reported 97.99618320610686% total line coverage.
  - `npm run design:tokens:check` - passed.
  - `npm run design:tokens:enforce` - passed.
  - `npm run design:audit:check` - passed.
  - `npm run design:change-guard` - passed with one design artifact for the source-only UI refactor.
  - `npm run ownership:lint` - passed.
  - `npm run change:check` - passed.
  - `git diff --check --cached` - passed.
- Tests added or updated: `tests/unit/governance/browser-source-readability.test.js`, `src/app/AppRouteModel.test.tsx`, and existing route smoke coverage in `src/app/AppNavigation.test.tsx` ran against the extracted modules.
- Rollout or rollback notes: `ff_frontend_source_modularization` is documented as a source/refactor rollout label only; no runtime branch was added. Roll back by reverting the refactor commit, including `package.json`, `scripts/check-browser-source-readability.js`, `src/app/routes/`, `src/app/app-model.jsx`, README, diagrams, and baseline changes.
- Docs updated: `DESIGN.md`, `README.md`, `docs/diagrams/workflow-frontend-source-modularization.mmd`, `docs/diagrams/architecture-frontend-source-modularization.mmd`, and this checklist.

## Issue #252 Addendum - Canonical Task Workspace List Reads

- Change or task ID: Issue #252, route task workspace list reads to the canonical task-platform API.
- Owner: Codex implementation agent.
- Date: 2026-05-31.
- Scope summary: The task-detail adapter now reads the workspace list from `/v1/tasks` first, normalizes canonical task-platform records into the existing list shape, preserves legacy-shaped compatibility rows, and falls back to `/tasks` only if the canonical list request fails.
- Standards baseline reviewed: `docs/standards/software-development-standards.md`.
- Applicable standards areas: architecture and design; coding and code quality; testing and quality assurance; deployment and release; observability and monitoring.
- Standards gaps or exceptions: No new exception. Existing legacy task-detail adapter maintainability findings remain at or below the recorded baseline while the canonical-list mapper is isolated in a smaller helper.
- Evidence in this change: `src/features/task-detail/canonical-list.browser.js`, `src/features/task-detail/canonical-list.js`, `tests/unit/task-detail-canonical-list.test.js`, `tests/browser/task-detail.browser.spec.ts`, and `DESIGN.md`.
- Validation evidence: `node --test tests/unit/task-detail-adapter.test.js tests/unit/task-detail-canonical-list.test.js`; `npx vitest run src/app/AppNavigation.test.tsx src/app/App.test.tsx`; `npm run standards:check`.
- Rollout and rollback: Deploy PR #253 to move normal workspace list reads off the expensive legacy projection path. Roll back by reverting the adapter and canonical-list helper changes, which restores `/tasks` as the primary workspace list source.
