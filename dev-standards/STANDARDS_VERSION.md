# Standards Version

- Version: `0.1.0`
- Status: `authoritative`
- Change level: `major-initial`
- Intended adoption mode: staged rollout

## Scope

`v0.1.0` defines the baseline standards system for:

- repository structure
- architecture boundaries
- maintainability thresholds and refactoring ratchets
- testing and verification
- release and rollback discipline
- observability and operational readiness
- documentation freshness
- dependency governance
- waiver handling
- AI-agent governance
- optional visual identity governance for UI-bearing repositories

## Rollout Guidance

- Hard fail immediately:
  - required verification commands
  - broken tests
  - secrets and security policy violations
  - protected path violations
  - expired waivers
  - stale required visual identity review metadata
- Soft fail initially:
  - documentation freshness
  - ADR completeness
  - directory conformance drift in legacy repos
  - scorecard-only metrics
- Warn initially:
  - newly introduced noncritical policies until templates and tooling stabilize

## Adoption Rule

Each repo must declare:

- adopted standards version
- active repo profile
- active risk overlays
- active waivers
- migration deadline if not on the current version
