# Testing Standard

## 1. Goal

Testing exists to eliminate manual merge gating and to prove correctness,
compatibility, rollback safety, and operational readiness.

## 2. Required Test Pyramid

Every repo must implement a minimum automated test pyramid:

- unit tests for core logic
- integration tests for boundary interactions
- system or end-to-end tests for critical flows
- smoke tests for deployability and health
- security and static analysis where risk requires it

## 3. Test Placement

Hybrid placement is required:

- unit tests colocated with source or in the same module subtree
- integration, system, and end-to-end tests under `tests/`
- fixtures under `tests/fixtures/`
- helpers under `tests/helpers/`

## 4. Hermeticity

Tests must be hermetic by default.

- no live network in normal unit or integration runs
- no dependency on wall-clock time
- no dependency on shared mutable external environments
- no hidden reliance on nondeterministic ordering

Live dependencies are allowed only in explicitly marked and isolated test layers.

## 5. Mocking Policy

- Do not mock core domain behavior that can be tested directly.
- Mock unstable or expensive external boundaries in unit tests.
- Adapter boundaries require contract tests.
- Critical integrations require integration or system tests in realistic
  environments.
- Shared mocks must not reimplement production logic.

## 6. Flakiness

Flaky tests are defects.

- repeated flakes on protected paths block release
- quarantine is temporary and tracked
- every quarantine needs owner, expiry, and remediation issue
- rerun-to-green without classification is prohibited

## 7. Coverage Policy

Coverage policy is risk-based, not percentage-only.

Every repo class must define numeric thresholds within centrally approved bounds.
At minimum:

- regression tests for every bug fix
- changed-lines coverage checks
- stronger thresholds for critical paths
- branch coverage for decision-heavy and security-sensitive code

## 8. Compatibility and Migration Testing

The following changes require compatibility checks against the previous supported
version:

- schema changes
- public APIs
- file or event formats
- infrastructure changes

Stateful systems must test:

- upgrade path
- downgrade path where supported
- rollback or compensation path
- post-migration integrity

## 9. Ephemeral Environments

Integration and system tests must use ephemeral, production-like environments
where practical. Long-lived shared environments are not an acceptable primary
verification surface.

## 10. Performance and Failure Testing

Production-affecting repos must define:

- performance budgets
- resource limits
- failure-mode tests
- disaster recovery or restore drills for critical systems

## 11. Required Command Contract

Every repo must expose:

- `make lint`
- `make typecheck`
- `make test`
- `make build`
- `make verify`

`make verify` must execute the repo's required merge-readiness evidence path.
