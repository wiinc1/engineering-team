schema_version: "1.0"
standards_version: "0.1.0"
merge_checks:
  - id: lint
    description: formatting and policy gate
    command: make lint
    required: true
  - id: typecheck
    description: static verification gate
    command: make typecheck
    required: true
  - id: test
    description: automated test suite
    command: make test
    required: true
  - id: build
    description: reproducible build gate
    command: make build
    required: true
  - id: verify
    description: aggregate merge-readiness gate
    command: make verify
    required: true
release_checks:
  - id: compatibility
    description: supported-version compatibility evidence
    evidence:
      - compatibility-report
  - id: security
    description: security scan evidence
    evidence:
      - vulnerability-scan
      - secret-scan
test_artifacts:
  test_results: .artifacts/test-results.json
  coverage: .artifacts/coverage-summary.json
  flaky_registry: .artifacts/flaky-test-registry.json
  contract_report: .artifacts/contract-test-report.json
promotion_gates:
  - environment: dev
    required_evidence:
      - lint
      - typecheck
      - test
