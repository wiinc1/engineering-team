# Standards Compliance Checklist

## Linked Standards

- Standards document: `docs/standards/software-development-standards.md`
- Required gap statement format: `Gap observed: X. Documented rationale: Y (source Z).`

## Change Metadata

- Change or task ID: `ISSUE-194`
- Owner: `wiinc1`
- Date: 2026-05-14
- Scope summary: Align governance metadata and verification commands with the real React/Vite/Node/PostgreSQL runtime, update CI setup, document gate mapping, and add regression tests.

## Standards Alignment

- Applicable standards areas: architecture and design, coding and code quality, testing and quality assurance, deployment and release, observability and monitoring, team and process.
- Evidence expected for this change: updated repo contract, check manifest, Makefile runtime gates, verify workflow dependency setup, architecture/runbook/branch-protection mapping, Mermaid diagrams, and focused governance tests.
- Gap observed: None. Documented rationale: issue #194 requested that repo governance and verification gates reflect the actual runtime instead of only Python standards tooling (source https://github.com/wiinc1/engineering-team/issues/194).

## Architecture and Design

- Applicable: yes
- Evidence in this change: `repo-contract.yaml`, `docs/architecture.md`, `docs/diagrams/workflow-governance-runtime-gates.mmd`, and `docs/diagrams/architecture-governance-runtime-gates.mmd` describe runtime layers, state ownership, and gate flow.
- Gap observed: None. Documented rationale: architecture metadata now covers app, API, auth, audit, task-platform, browser feature modules, monitoring, scripts, standards, and deployment sources (source https://github.com/wiinc1/engineering-team/issues/194).

## Coding and Code Quality

- Applicable: yes
- Evidence in this change: `Makefile`, `package.json`, `.github/workflows/verify.yml`, and `tests/unit/governance/runtime-gates-contract.test.js` keep the command contract executable and regression-tested.
- Gap observed: None. Documented rationale: the implementation reuses existing Makefile, npm, and GitHub Actions entrypoints instead of adding a parallel verification framework (source https://github.com/wiinc1/engineering-team/issues/194).

## Testing and Quality Assurance

- Applicable: yes
- Evidence in this change: the new governance test asserts runtime declarations, Makefile command wiring, manifest mapping, verify workflow setup, docs, branch-protection mapping, and diagrams.
- Gap observed: None. Documented rationale: focused tests guard against stale or missing runtime declarations and command drift (source https://github.com/wiinc1/engineering-team/issues/194).

## Deployment and Release

- Applicable: yes
- Evidence in this change: `.github/workflows/verify.yml` installs Node dependencies and Playwright browsers before running `make verify`; `.github/BRANCH_PROTECTION.md` maps required status checks to their local commands.
- Gap observed: None. Documented rationale: the verify workflow now has the dependencies required by the expanded local ship gate (source https://github.com/wiinc1/engineering-team/issues/194).

## Observability and Monitoring

- Applicable: yes
- Evidence in this change: `repo-contract.yaml` declares monitoring and observability ownership; docs link governance gates to runtime evidence and deployment previews.
- Gap observed: None. Documented rationale: monitoring assets and redacted diagnostics are part of the runtime governance contract, but no production monitoring behavior changed (source https://github.com/wiinc1/engineering-team/issues/194).

## Authentication and Secret Handling

- Applicable: yes
- AuthN/AuthZ surfaces changed: no auth runtime behavior changed.
- Secret, token, cookie, password, or PII redaction evidence: the build gate writes non-secret auth diagnostics only; new docs and diagrams avoid secret assignments and private key material.
- Abuse-control or rate-limit evidence: not applicable because no auth request behavior changed.
- Rollback or removal impact: revert the governance wiring commit if the expanded local ship gate creates an unintended blocker, then restore the prior Makefile and workflow dependency setup.
- Gap observed: None. Documented rationale: local builds default the auth config check to a development target unless `AUTH_CONFIG_TARGET` or `VERCEL_ENV` selects another target, preserving production enforcement on Vercel while allowing local verification (source https://github.com/wiinc1/engineering-team/issues/194).

## Team and Process

- Applicable: yes
- Evidence in this change: `README.md`, `docs/runbook.md`, and `.github/BRANCH_PROTECTION.md` distinguish standards-only checks from the full local ship gate and map local commands to CI checks.
- Gap observed: None. Documented rationale: maintainers now have one documented aggregate gate for runtime plus standards, and a separate standards-only slice for narrow policy work (source https://github.com/wiinc1/engineering-team/issues/194).

## Required Evidence

- Commands run: `npm run build` before the change failed because missing production auth variables; after the change `python3 dev-standards/tooling/validate_policy_files.py --repo-root .`, `node --test tests/unit/governance/runtime-gates-contract.test.js`, `npm run lint`, `npm run typecheck`, `npm run standards:check`, `npm run test:unit`, `npm run test:browser`, `npm run build`, `make verify`, and `git diff --check` passed. The first `make verify` attempt hit an existing flaky Vitest board-owner timeout; the immediate rerun passed.
- Tests added or updated: `tests/unit/governance/runtime-gates-contract.test.js`.
- Rollout or rollback notes: no production rollout required; rollback by reverting the contract, Makefile, package build target default, workflow, docs, diagrams, and governance test.
- Docs updated: `README.md`; `docs/architecture.md`; `docs/runbook.md`; `.github/BRANCH_PROTECTION.md`; `docs/diagrams/workflow-governance-runtime-gates.mmd`; `docs/diagrams/architecture-governance-runtime-gates.mmd`; `docs/reports/ISSUE-194_STANDARDS_COMPLIANCE_CHECKLIST.md`.
