schema_version: "1.0"
standards_version: "0.1.0"
editable_paths:
  - src/
  - tests/
  - docs/
  - scripts/
  - dev-standards/
protected_paths:
  - repo-contract.yaml
  - agent-policy.yaml
  - check-manifest.yaml
  - dev-standards/
  - .github/workflows/
  - Makefile
explicit_instruction_paths:
  - docs/adr/
  - migrations/
forbidden_tasks:
  - release-to-production
  - standards-rewrite
  - secret-rotation
allowed_to_automate:
  - task: docs-update
    mode: fully-automated
  - task: test-addition
    mode: fully-automated
  - task: dependency-update
    mode: human-in-the-loop
  - task: release
    mode: never-automated
unsafe_for_agents:
  - secret-handling
  - production-credential-change
  - standards-policy-weakening
  - protected-path-edit-without-instruction
capabilities:
  low:
    - read
    - search
    - edit-allowed-paths
    - run-lint
    - run-typecheck
    - run-test
  medium:
    - add-tests
    - update-docs
    - refactor-within-boundaries
  high:
    - change-adapter-code-with-human-review
    - update-noncritical-ci-with-human-review
  critical: []
ai_safe_change:
  max_files: 8
  max_lines: 300
  forbidden_paths:
    - repo-contract.yaml
    - agent-policy.yaml
    - check-manifest.yaml
    - .github/workflows/
  required_commands:
    - make lint
    - make typecheck
    - make test
  required_evidence:
    - test-report
    - diff-summary
    - provenance-record
path_task_map:
  - when_paths:
      - repo-contract.yaml
      - agent-policy.yaml
      - check-manifest.yaml
      - dev-standards/**
      - .github/workflows/**
      - Makefile
    task: standards-policy
  - when_paths:
      - docs/**
    task: docs-update
change_kind_task_map:
  policy:
    - standards-policy
  release:
    - release
  migration:
    - migration
never_automated_change_kinds:
  - release
  - migration
review_mode_requirements_by_task:
  standards-policy: human-plus-evidence
  release: human-plus-evidence
  migration: human-plus-evidence
