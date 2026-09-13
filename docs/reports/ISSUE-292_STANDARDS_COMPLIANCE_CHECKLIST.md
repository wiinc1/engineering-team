# Standards Compliance Checklist

## Linked Standards
- Standards document: `docs/standards/software-development-standards.md`
- Required gap statement format: `Gap observed: X. Documented rationale: Y (source Z).`

## Change Metadata
- Change or task ID: GitLab #292
- Owner: engineering-team
- Date: 2026-09-13
- Scope summary: Pluggable specialist runtime provider (Grok default, OpenClaw and extra runners selectable) without rewriting factory orchestration.

## Architecture and Design
- Applicable: yes
- Evidence in this change: `lib/software-factory/specialist-runtime-provider.js`, runner contract, workflow and architecture diagrams.
- Gap observed: OpenClaw remained hard-wired in live proof and stack health after the host deleted OpenClaw.
- Documented rationale and source: The coordinator already speaks a stdin/stdout runner port; provider selection belongs in one registry (source `docs/runbooks/specialist-delegation.md`, GitLab #292).

## Coding and Code Quality
- Applicable: yes
- Evidence in this change: Grok adapter, retained OpenClaw adapter, provider registry, factory-orchestration/live-proof/stack health wiring.
- Gap observed: none for this slice.
- Documented rationale and source: n/a.

## Testing and Quality Assurance
- Applicable: yes
- Evidence in this change: unit, contract, and integration tests for selection, override, unknown provider, Grok runner contract, and CLI health.
- Gap observed: Full live Grok smoke against a billed model is host-dependent; stubbed CLI proves the adapter contract.
- Documented rationale and source: Live-smoke remains `npm run test:delegation:live-smoke:grok` when the operator wants a real Grok session (source GitLab #292 §16).

## Deployment and Release
- Applicable: yes
- Evidence in this change: factory-stack env example and `buildServiceEnv` emit `SPECIALIST_RUNTIME_PROVIDER=grok` by default.
- Gap observed: none.
- Documented rationale and source: n/a.

## Observability and Monitoring
- Applicable: yes
- Evidence in this change: `runtimeProvider` on runner ownership; doctor CLI; live-proof metadata.
- Gap observed: none.
- Documented rationale and source: n/a.

## Authentication and Secret Handling
- Applicable: yes
- AuthN/AuthZ surfaces changed: none
- Secret, token, cookie, password, or PII redaction evidence: runners must not log credentials; Grok/OpenClaw env only.
- Abuse-control or rate-limit evidence: n/a
- Rollback or removal impact: `SPECIALIST_RUNTIME_PROVIDER=openclaw` restores the previous adapter if OpenClaw is installed.
- Gap observed: none.
- Documented rationale and source: n/a.

## Team and Process
- Applicable: yes
- Evidence in this change: GitLab #292, runbook, feature-flag, and runner-contract docs.
- Gap observed: none.
- Documented rationale and source: n/a.

## Required Evidence
- Commands run: focused specialist-runtime unit/contract/integration tests; factory-orchestration and factory-proof-profile tests; `npm run specialist-runtime:doctor` as available.
- Tests added or updated: `tests/unit/specialist-runtime-provider.test.js`, `tests/unit/grok-specialist-runner.test.js`, `tests/contract/specialist-runtime-runner.contract.test.js`, `tests/integration/specialist-runtime-provider.integration.test.js`, plus updated factory proof/orchestration/PM refinement tests.
- Rollout or rollback notes: default provider `grok`; keep OpenClaw adapter selectable; rollback is env-only.
- Docs updated: specialist-delegation runbook, golden-path runbook, feature flags, runner contract, diagrams, factory-stack env example.
