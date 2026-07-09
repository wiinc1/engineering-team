import json


def evidence_payload(generated_at: str, *keys: str) -> str:
    payload = {key: {"generated_at": generated_at} for key in keys}
    return json.dumps(payload)


REPO_CONTRACT_TEXT = """
schema_version: "1.0"
change_management:
  metadata_file: .artifacts/change-metadata.json
  change_kind_rules:
    - change_kind: migration
      allowed_reference_prefixes:
        - ADR-
      required_release_evidence:
        - rollback-verification
    - change_kind: release
      allowed_reference_prefixes:
        - ADR-
      required_release_evidence:
        - rollback-verification
        - standards-approval-record
release_management:
  evidence_file: .artifacts/release-evidence.json
  default_environment: dev
  freshness_days:
    dev: 7
    staging: 3
    prod: 1
  irreversible_change_evidence:
    - rollback-verification
  environments:
    dev:
      require_live_deploy_proof: false
      required_live_checks: []
      require_post_deploy_health: false
    staging:
      require_live_deploy_proof: true
      required_live_checks:
        - deploy-record
      require_post_deploy_health: true
      required_artifact_fields:
        - deployed_sha
        - environment
        - deployment_url
        - rollback_target
      required_post_deploy_health_fields:
        - environment
        - deployment_url
        - checked_sha
        - status
        - commit_verified
    prod:
      require_live_deploy_proof: true
      required_live_checks:
        - deploy-record
        - rollback-verification
      require_post_deploy_health: true
      required_artifact_fields:
        - deployed_sha
        - environment
        - deployment_url
        - rollback_target
      required_post_deploy_health_fields:
        - environment
        - deployment_url
        - checked_sha
        - status
        - commit_verified
      required_rollback_fields:
        - rollback_target
        - verification_status
        - verified_at
"""


MANIFEST_TEXT = """
schema_version: "1.0"
standards_version: "0.1.0"
merge_checks:
  - id: verify
    description: verify
    command: make verify
    required: true
release_checks:
  - id: maintainability
    description: report
    evidence:
      - maintainability-report
    environments:
      - dev
    freshness_days: 7
  - id: tests
    description: tests
    evidence:
      - unittest-report
    environments:
      - dev
    freshness_days: 7
promotion_gates:
  - environment: dev
    required_evidence:
      - lint
      - typecheck
      - test
    require_immutable_artifact: false
  - environment: staging
    required_evidence:
      - build
      - maintainability-report
    require_immutable_artifact: true
  - environment: prod
    required_evidence:
      - immutable-artifact
    require_immutable_artifact: true
"""
