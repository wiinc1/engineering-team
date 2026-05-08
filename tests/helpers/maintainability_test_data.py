import textwrap


CONTRACT_TEXT = textwrap.dedent(
    """
    schema_version: "1.0"
    standards_version: "0.1.0"
    repo:
      name: demo
      type: automation
      primary_deployment_unit: worker
      runtime_model: cli
      production_affecting: false
    profile: automation
    overlays: []
    ownership:
      primary_owner: owner
      backup_owner: owner
    runtime:
      languages:
        - name: python
          version: "3.12"
      toolchains:
        - python3
      package_managers:
        - pip
    commands:
      lint: make lint
      typecheck: make typecheck
      test: make test
      build: make build
      verify: make verify
    directories:
      reserved_paths:
        - src/
        - tests/
        - docs/
        - scripts/
        - config/
        - generated/
        - third_party/
        - .artifacts/
      classifications:
        src/: authored
        tests/: authored
      protected_paths:
        - repo-contract.yaml
    architecture:
      internal_layout:
        - src/workflows
      dependency_rules:
        - runtime depends inward only
      boundary_map:
        - from: src/workflows
          to: src/workflows
          rule: allow
      state_ownership:
        - resource: queue
          owner: src/workflows
      source_of_truth:
        - repo-contract.yaml
    critical_paths:
      - name: worker
        description: core worker path
        stronger_controls:
          - tests
    quality_gates:
      risk_taxonomy:
        - low
        - medium
        - high
        - critical
      review_modes:
        - automated-only
        - human-approve
        - human-plus-evidence
      stop_the_line:
        - broken main
      test_layers:
        - unit
      documentation_requirements:
        - update docs when architecture changes
      coverage_policy:
        strategy: risk-based
    maintainability:
      include_globs:
        - src/**/*.py
        - tests/**/*.py
        - repo-contract.yaml
      exclude_globs:
        - third_party/**
      thresholds:
        authored_source_file_lines:
          warning: 8
          hard_fail: 10
        test_file_lines:
          warning: 12
          hard_fail: 14
        function_lines:
          warning: 4
          hard_fail: 6
        complexity:
          warning: 3
          hard_fail: 4
        nesting_depth:
          warning: 2
          hard_fail: 3
        public_exports:
          warning: 2
          hard_fail: 3
      ratchet_rule: touched noncompliant files must improve on each change and require a waiver if still over limit
      protected_signals:
        - total_file_line_count
        - over_limit_function_count
        - maximum_function_length
        - maximum_complexity
        - maximum_nesting_depth
        - public_export_count
      duplication:
        warning_block_lines: 4
        hard_fail_block_lines: 6
      hotspots:
        history_window: 20
        warning_touches: 2
        hard_fail_touches: 4
      repeated_waiver_limits:
        warning_count: 1
        hard_fail_count: 3
    support:
      tier: active
      criticality: low
    compatibility:
      matrix:
        - os: linux
      deprecation_policy:
        minimum_notice_days: 30
    nfrs:
      reliability:
        target: "99%"
      security:
        baseline: standard
      recoverability:
        rto_minutes: 10
    """
).strip() + "\n"


def legacy_function(depth: int, leaf: str) -> str:
    lines = ["def legacy():"]
    for level in range(depth):
        lines.append(f'{"    " * (level + 1)}if True:')
    lines.append(f'{"    " * (depth + 1)}return {leaf}')
    lines.append("    return 0")
    return "\n".join(lines) + "\n"
