# Standards Compliance Checklist

## Linked Standards

- Standards document: `docs/standards/software-development-standards.md`
- Required gap statement format: `Gap observed: X. Documented rationale: Y (source Z).`

## Change Metadata

- Change or task ID: `ISSUE-193`
- Owner: `wiinc1`
- Date: 2026-05-14
- Scope summary: Replace static lint target selection with git-discovered authored source checks, readability detection, validated allowlist metadata, documentation, diagrams, and focused tests.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring, team and process.
- Evidence expected for this change: tracked-file lint implementation, explicit include/exclude policy, source-readability checks, allowlist validation and stale-entry tests, redaction-safe diagnostics, timing evidence, docs, diagrams, and passing lint/typecheck/test/standards gates.
- Gap observed: None. Documented rationale: issue #193 requested path-discovery based quality gates so new authored source files cannot bypass lint and readability checks accidentally (source https://github.com/wiinc1/engineering-team/issues/193).

## Architecture and Design

- Applicable: yes
- Evidence in this change: `scripts/lint-repo.js` owns discovery, classification, readability checks, allowlist validation, stale-entry detection, and deterministic diagnostics; `docs/diagrams/architecture-tracked-file-linting.mmd` documents the gate boundary.
- Gap observed: None. Documented rationale: the implementation keeps the existing npm lint entrypoint while changing target selection from static paths to discovered authored source boundaries (source https://github.com/wiinc1/engineering-team/issues/193).

## Coding and Code Quality

- Applicable: yes
- Evidence in this change: `npm run lint` now scans `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, and `.tsx` under `api/`, `lib/`, `scripts/`, `src/`, and `tests/`, skips explicit generated and third-party boundaries, and validates `config/lint-source-allowlist.json`.
- Gap observed: Legacy compact source remains allowlisted. Documented rationale: the new readability gate blocks new compact authored files while preserving existing compact-source debt behind owner/reason/follow-up metadata until a dedicated maintainability cleanup reformats it (source https://github.com/wiinc1/engineering-team/issues/193).

## Testing and Quality Assurance

- Applicable: yes
- Evidence in this change: unit tests cover include/exclude classification, generated/bundled/minified detection, allowlist metadata, suppression, and stale entries; integration tests exercise untracked file discovery, excluded paths, and allowlisted compact source; contract, security, and performance tests cover schema behavior, redacted output, and local runtime budget.
- Gap observed: None. Documented rationale: issue #193 requires automated negative coverage for excluded paths, new source files, minified source, stale allowlist entries, and secret-safe output (source https://github.com/wiinc1/engineering-team/issues/193).

## Deployment and Release

- Applicable: yes
- Evidence in this change: the gate remains local and CI tooling under the existing `npm run lint`, `npm run standards:check`, `npm run test:unit`, and `npm test` entrypoints; no production runtime route or deploy configuration changes are required.
- Gap observed: None. Documented rationale: this development-quality gate changes pre-release verification only and is reversible by restoring the previous lint implementation and removing the allowlist config/tests/docs (source https://github.com/wiinc1/engineering-team/issues/193).

## Observability and Monitoring

- Applicable: yes
- Evidence in this change: lint output includes files scanned, binary skipped count, allowlisted readability findings, and duration; failure output stays line-oriented with rule, path, line, and remediation.
- Gap observed: No production metric was added. Documented rationale: issue #193 is a CI/local tooling rollout, and deterministic command output is the observability surface for this gate (source https://github.com/wiinc1/engineering-team/issues/193).

## Authentication and Secret Handling

- Applicable: yes
- AuthN/AuthZ surfaces changed: no authentication or authorization runtime behavior changed.
- Secret, token, cookie, password, or PII redaction evidence: `tests/security/lint-repo-output.security.test.js` verifies lint diagnostics do not print source lines or secret-like values from file contents.
- Abuse-control or rate-limit evidence: not applicable because no request-handling behavior changed.
- Rollback or removal impact: rollback by reverting the lint script, allowlist config, docs, diagrams, and test wiring; no production data migration or runtime cleanup is required.
- Gap observed: None. Documented rationale: deterministic diagnostics provide file, line, rule, and remediation without echoing raw source content (source https://github.com/wiinc1/engineering-team/issues/193).

## Team and Process

- Applicable: yes
- Evidence in this change: README, runbook, standards maintenance docs, diagrams, and this checklist document lint scope, exclusions, allowlist policy, rollout, and rollback.
- Gap observed: None. Documented rationale: documentation-as-code keeps quality-gate behavior reviewable with the same change that modifies the gate (source https://github.com/wiinc1/engineering-team/issues/193).

## Required Evidence

- Commands run: `node --test tests/unit/governance/lint-repo.test.js`; `node --test tests/integration/lint-repo.integration.test.js`; `node --test tests/contract/lint-source-allowlist.contract.test.js`; `node --test tests/security/lint-repo-output.security.test.js`; `node --test tests/performance/tracked-file-linting.performance.test.js`; `node --test tests/unit/governance/design-operationalization.test.js`; `npm run lint`; `npm run standards:check`; `npm run change:check`; `npm run ownership:lint`; `npm run typecheck`; `npm run test:unit`; `npm test`; `npm run test:ui:vitest`; `make verify`. `npm run lint` scanned 251 files in roughly 0.05-0.10s with 50 legacy compact-source readability findings allowlisted. Final `make verify` passed without a no-design-impact marker because the design change guard now treats trailing-whitespace-only UI diffs as lint cleanup rather than visual semantics changes.
- Tests added or updated: `tests/unit/governance/lint-repo.test.js`; `tests/integration/lint-repo.integration.test.js`; `tests/contract/lint-source-allowlist.contract.test.js`; `tests/security/lint-repo-output.security.test.js`; `tests/performance/tracked-file-linting.performance.test.js`; `tests/unit/governance/design-operationalization.test.js`; `package.json` aggregate test wiring.
- Rollout or rollback notes: local and CI lint gate rollout through the existing `npm run lint` command; rollback by reverting the lint script, allowlist config, package test wiring, docs, and diagrams.
- Docs updated: `README.md`; `docs/runbook.md`; `docs/standards/change-governance-maintenance.md`; `docs/diagrams/workflow-tracked-file-linting.mmd`; `docs/diagrams/architecture-tracked-file-linting.mmd`; `docs/reports/ISSUE-193_STANDARDS_COMPLIANCE_CHECKLIST.md`.
