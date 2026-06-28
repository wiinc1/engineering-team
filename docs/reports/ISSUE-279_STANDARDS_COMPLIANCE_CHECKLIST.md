# Standards Compliance Checklist

## Change Metadata
- Change or task ID: PR #292, issue #279 Command Center desktop redesign.
- Owner: OpenClaw implementation agent.
- Date: 2026-06-28.
- Scope summary: Grouped sidebar navigation, desktop command bar, urgency-lane queue grouping, expanded inspector, and design anchor asset for the Command Center redesign.

## Standards Alignment
- Standards baseline reviewed: `docs/standards/software-development-standards.md`.
- Applicable standards areas: architecture and design; coding and code quality; testing and quality assurance; deployment and release; observability and monitoring.
- Evidence expected for this change: design token enforcement, browser regression baselines, unit tests for queue grouping, AppNavigation vitest coverage, and golden-path reseed script.
- Gap observed: Mobile layout is out of scope for issue #279. Documented rationale: browser CI still exercises mobile projects with updated baselines only where route chrome changed, without delivering a dedicated mobile redesign (source https://github.com/wiinc1/engineering-team/issues/279).

## Architecture and Design
- Evidence: `src/app/shell/GroupedAppNav.jsx`, `src/app/shell/CommandBar.jsx`, `src/app/routes/CommandCenterQueue.jsx`, `src/app/command-center-queue.mjs`.
- Grouped nav preserves existing route model while renaming operator-facing labels to Command Center / Queue / Board.
- Design anchor: `docs/design/assets/command-console-redesign-target.png`.

## Testing and QA
- Tests added or updated:
  - `tests/unit/command-center-queue.test.js`
  - `src/app/AppNavigation.test.tsx`
  - `tests/browser/task-workspace.browser.spec.ts`
  - `tests/browser/auth-shell.browser.spec.ts`
  - `tests/browser/golden-path-task-workspace.browser.spec.ts`
  - `tests/browser/__screenshots__/browser-quality-visual.browser.spec.ts/task-workspace-*.png`

## Required Evidence
- Commands run: `npm run lint`; `npm run typecheck`; `npm run design:tokens:enforce`; `node --test tests/unit/command-center-queue.test.js`; `npx vitest run src/app/AppNavigation.test.tsx`; `node scripts/run-playwright.js tests/browser/task-workspace.browser.spec.ts tests/browser/auth-shell.browser.spec.ts --project=chromium`; `node scripts/run-playwright.js tests/browser/browser-quality-visual.browser.spec.ts --project=chromium --update-snapshots`.
- Tests added or updated: `tests/unit/command-center-queue.test.js`; `src/app/AppNavigation.test.tsx`; `src/app/App.test.tsx`; `tests/integration/board-owner-filtering.integration.test.js`; `tests/browser/task-workspace.browser.spec.ts`; `tests/browser/auth-shell.browser.spec.ts`; `tests/browser/golden-path-task-workspace.browser.spec.ts`; `tests/browser/__screenshots__/browser-quality-visual.browser.spec.ts/task-workspace-desktop.png`; `tests/browser/__screenshots__/browser-quality-visual.browser.spec.ts/task-workspace-mobile.png`.
- Rollout or rollback notes: merge PR #292; operators reseed with `npm run golden-path:reseed:issue-279` for `design_full` proof. Rollback by reverting PR #292 to restore prior nav and queue chrome.
- Docs updated: `DESIGN.md`; `docs/design/assets/command-console-redesign-target.png`; `scripts/reseed-issue-279-local.js`; `docs/reports/ISSUE-279_STANDARDS_COMPLIANCE_CHECKLIST.md`.