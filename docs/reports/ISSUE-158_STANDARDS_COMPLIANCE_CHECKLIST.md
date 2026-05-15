# Standards Compliance Checklist

## Linked Standards
- Standards document: `docs/standards/software-development-standards.md`
- Required gap statement format: `Gap observed: X. Documented rationale: Y (source Z).`

## Change Metadata
- Change or task ID: Issue #158, browser verification gates.
- Owner: Codex implementation agent.
- Date: 2026-05-15.
- Scope summary: Expanded Playwright browser quality gates for visual screenshot baselines, real-browser accessibility traversal and contrast, Core Web Vitals budgets, CI WebKit coverage, artifact upload, diagrams, and browser-quality documentation.

## Standards Alignment
- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring, team and process.
- Evidence expected for this change: Playwright browser matrix configuration, visual screenshot baselines, real-browser accessibility gates, Core Web Vitals budgets, CI artifact upload, documentation updates, diagrams, and local verification command results.
- Gap observed: No unresolved standards gap remains for the issue scope. Documented rationale: issue #158 required automated browser verification gates and documented evidence for accessibility, visual regression, performance, CI artifacts, and release criteria (source https://github.com/wiinc1/engineering-team/issues/158).

## Architecture and Design
- Applicable: Yes.
- Evidence in this change: `playwright.config.ts` now uses the browser quality matrix helper from `tests/browser/browser-quality-config.mjs`; browser route fixtures live in `tests/browser/browser-quality-fixtures.ts`; workflow and architecture diagrams were added at `docs/diagrams/workflow-browser-verification-gates.mmd` and `docs/diagrams/architecture-browser-verification-gates.mmd`.
- Gap observed: Core Web Vitals budgets run against deterministic local preview fixtures rather than production RUM. Documented rationale: Observability should measure user experience directly and release validation should compare automated budgets against production signals after deploy (source `docs/standards/software-development-standards.md`).
- Documented rationale and source: Local gates block regressions before merge; production comparison remains part of post-deploy synthetic/RUM validation.

## Coding and Code Quality
- Applicable: Yes.
- Evidence in this change: New gate helpers are small, focused test-support modules; `tests/unit/browser-quality-config.test.js` covers matrix and budget helper behavior; dark-shell contrast styles were tightened in `src/app/styles.css`.
- Gap observed: No new code-quality gap observed in the issue scope. Documented rationale: Strict automated coding standards reduce cognitive load and defect classes (source `docs/standards/software-development-standards.md`).
- Documented rationale and source: Authored test and config files stay within repo maintainability caps.

## Testing and Quality Assurance
- Applicable: Yes.
- Evidence in this change: Added Playwright visual, accessibility, and Core Web Vitals gate suites under `tests/browser/browser-quality-*.browser.spec.ts`; committed screenshot baselines under `tests/browser/__screenshots__/browser-quality-visual.browser.spec.ts/`; added security fixture test coverage under `tests/security/browser-verification-gates.security.test.js`.
- Gap observed: Non-Chromium visual pixel baselines are intentionally not committed because cross-engine rendering differences would be noisy. Documented rationale: Tests should be automated and actionable; flaky non-deterministic checks create release risk rather than reducing it (source `docs/standards/software-development-standards.md`).
- Documented rationale and source: Firefox, mobile Chrome, and CI WebKit remain covered by route behavior and accessibility checks; Chromium owns screenshot diffs with a stricter local threshold, a documented CI tolerance for Linux runner font rasterization, and a viewport-level mobile task-detail baseline to avoid unstable full-page height rounding.

## Deployment and Release
- Applicable: Yes.
- Evidence in this change: `.github/workflows/verify.yml` and `.github/workflows/validation.yml` install WebKit and run browser verification with `PLAYWRIGHT_INCLUDE_WEBKIT=1`; failure artifacts are uploaded from `test-results/browser/**` and `playwright-report/**`.
- Gap observed: Local default matrix does not force WebKit because the browser engine may be absent on developer machines. Documented rationale: CI/CD gates should be reproducible while local opt-in constraints are documented (source `docs/standards/software-development-standards.md`).
- Documented rationale and source: CI defaults WebKit on; local developers can use `npm run test:browser:ci` when WebKit is installed.

## Observability and Monitoring
- Applicable: Yes.
- Evidence in this change: Core Web Vitals JSON attachments are emitted from the Playwright performance gate; README documents artifact paths and the expected CI upload locations.
- Gap observed: No production dashboard was added for `feature_browser_verification_runs_total`, `feature_browser_verification_duration_seconds`, or `feature_browser_verification_failures_total`. Documented rationale: Metrics should measure user experience directly and alert on user pain; this repo-local change emits CI artifacts but not runtime telemetry (source `docs/standards/software-development-standards.md`).
- Documented rationale and source: CI artifacts provide pre-merge diagnostics; production metrics can be added when the deployment monitoring stack consumes these gate outcomes.

## Authentication and Secret Handling
- Applicable: Yes.
- AuthN/AuthZ surfaces changed: No production auth surface changed; browser tests use deterministic local session and auth route fixtures only.
- Secret, token, cookie, password, or PII redaction evidence: `tests/security/browser-verification-gates.security.test.js` verifies the new browser gate fixtures do not embed production secret names, private keys, or real bearer tokens.
- Abuse-control or rate-limit evidence: Not applicable; no server auth or rate-limit code changed.
- Rollback or removal impact: Revert the browser quality gate files, CI workflow changes, README updates, diagrams, and contrast CSS changes; no data migration or runtime flag cleanup is required.
- Gap observed: No authentication behavior gap observed. Documented rationale: Threat modeling and security-by-design reviews require test fixtures to avoid live credentials (source `docs/standards/software-development-standards.md`).
- Documented rationale and source: Browser route fixtures use `/api`, `idp.example`, and generated dummy tokens.

## Team and Process
- Applicable: Yes.
- Evidence in this change: README, accessibility README, visual README, diagrams, and this checklist document the matrix, commands, artifact locations, flake policy, and remaining constraints.
- Gap observed: None in the handoff scope. Documented rationale: Documentation as code must be versioned and reviewed with the code it describes (source `docs/standards/software-development-standards.md`).
- Documented rationale and source: The handoff is committed beside the gate implementation.

## Required Evidence
- Commands run: `node --test tests/unit/browser-quality-config.test.js tests/security/browser-verification-gates.security.test.js`; `node scripts/run-playwright.js tests/browser/browser-quality-accessibility.browser.spec.ts tests/browser/browser-quality-performance.browser.spec.ts --project=chromium`; `node scripts/run-playwright.js tests/browser/browser-quality-visual.browser.spec.ts --project=chromium --update-snapshots`; `node scripts/run-playwright.js tests/browser/browser-quality-visual.browser.spec.ts --project=chromium`; `npm run test:browser:quality`; `PLAYWRIGHT_INCLUDE_WEBKIT=1 node scripts/run-playwright.js tests/browser/browser-quality-accessibility.browser.spec.ts tests/browser/browser-quality-performance.browser.spec.ts tests/browser/browser-quality-visual.browser.spec.ts --project=chromium --project=firefox --project=mobile-chrome --project=mobile-safari`; `PLAYWRIGHT_INCLUDE_WEBKIT=1 npm run test:browser`; `node scripts/run-playwright.js tests/browser/design-token-operationalization.browser.spec.ts --project=chromium`; `npm run lint`; `npm run typecheck`; `npm run test:ui`; `npm run build`; `npm run test:browser`; `npm test`; `npm run standards:check`; `npm run ownership:lint`; `npm run change:check`; `npm run design:tokens:check`; `npm run design:tokens:enforce`; `npm run design:audit:check`; `npm run design:change-guard`; `make standards-policy-gates`.
- Command result details:
  - `node --test tests/unit/browser-quality-config.test.js tests/security/browser-verification-gates.security.test.js` - passed, 3 tests.
  - `node scripts/run-playwright.js tests/browser/browser-quality-accessibility.browser.spec.ts tests/browser/browser-quality-performance.browser.spec.ts --project=chromium` - passed, 6 tests.
  - `node scripts/run-playwright.js tests/browser/browser-quality-visual.browser.spec.ts --project=chromium --update-snapshots` - passed, 10 snapshots written.
  - `node scripts/run-playwright.js tests/browser/browser-quality-visual.browser.spec.ts --project=chromium` - passed, 10 tests.
  - `npm run test:browser:quality` - passed on the final tree, 25 tests with 23 expected skips across Chromium, Firefox accessibility, and mobile Chrome.
  - `PLAYWRIGHT_INCLUDE_WEBKIT=1 node scripts/run-playwright.js tests/browser/browser-quality-accessibility.browser.spec.ts tests/browser/browser-quality-performance.browser.spec.ts tests/browser/browser-quality-visual.browser.spec.ts --project=chromium --project=firefox --project=mobile-chrome --project=mobile-safari` - passed on the final tree, 28 tests with 36 expected skips across Chromium, Firefox, mobile Chrome, and mobile Safari/WebKit.
  - `PLAYWRIGHT_INCLUDE_WEBKIT=1 npm run test:browser` - passed on the final tree, 200 tests with 36 expected skips across Chromium, Firefox, mobile Chrome, and mobile Safari/WebKit.
  - `node scripts/run-playwright.js tests/browser/design-token-operationalization.browser.spec.ts --project=chromium` - passed on the final tree, 4 tests.
  - `npm run lint` - passed.
  - `npm run typecheck` - passed.
  - `npm run test:ui` - passed, 147 Vitest tests plus role inbox and PM overview integration checks.
  - `npm run build` - passed.
  - `npm run test:browser` - passed through `npm test`, 154 browser tests with 23 expected skips.
  - `npm test` - passed on the final tree: 109 Node/unit/integration/security/property/performance tests passed, then 154 default browser tests passed with 23 expected skips.
  - `npm run standards:check` - passed.
  - `npm run ownership:lint` - passed.
  - `npm run change:check` - passed.
  - `npm run design:tokens:check` - passed.
  - `npm run design:tokens:enforce` - passed.
  - `npm run design:audit:check` - passed.
  - `npm run design:change-guard` - passed.
  - `make standards-policy-gates` - passed.
- Tests added or updated: `tests/unit/browser-quality-config.test.js`, `tests/security/browser-verification-gates.security.test.js`, `tests/browser/browser-quality-accessibility.browser.spec.ts`, `tests/browser/browser-quality-performance.browser.spec.ts`, `tests/browser/browser-quality-visual.browser.spec.ts`, `tests/browser/browser-quality-fixtures.ts`, and committed visual baselines.
- Rollout or rollback notes: `ff_browser_verification_gates` is a CI/config gate label. Roll back by reverting the gate files, screenshots, CI workflow changes, docs, and contrast CSS changes. CI WebKit can be temporarily disabled with `PLAYWRIGHT_SKIP_WEBKIT=1` only with issue-linked rationale.
- Docs updated: `README.md`, `CHANGELOG.md`, `tests/accessibility/README.md`, `tests/visual/README.md`, `docs/diagrams/workflow-browser-verification-gates.mmd`, `docs/diagrams/architecture-browser-verification-gates.mmd`, and this checklist.
