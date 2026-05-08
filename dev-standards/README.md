# Development Standards v0.1

This directory is the seed standards package for a future central standards
repository. It is written as an authoritative `v0.1` baseline for solo,
AI-assisted repositories.

The package is organized as:

- `STANDARDS_VERSION.md`: version and rollout intent
- `policies/`: human-readable standards and operating rules
- `schemas/`: machine-readable schemas for required repo policy files
- `profiles/`: base profile, repo-type profiles, and overlays
- `templates/`: starter examples for required repo-local files
- `templates/DESIGN.md`: optional Google-style visual identity template for
  repos that ship user-facing UI or generated design surfaces

## Intended Model

Every repo should eventually consume:

1. One shared `base` profile.
2. Exactly one repo-type profile:
   - `application`
   - `library`
   - `infrastructure`
   - `automation`
3. Zero or more risk overlays:
   - `production-affecting`
   - `security-sensitive`
   - `public-interface`
   - `stateful`
   - `critical`

Every repo should also define these local, machine-readable files:

- `repo-contract.yaml`
- `agent-policy.yaml`
- `check-manifest.yaml`

Repos with user-facing UI or visual brand surfaces may also declare
`visual_identity` in `repo-contract.yaml` and maintain a protected root
`DESIGN.md`.

## Immediate Use

This package is ready to be used as the control surface for future repo
bootstrapping and CI policy work. It does not yet include executable validators
or reusable CI workflows; those should be implemented next against the schemas
and policy contracts defined here.

Key policy areas currently covered:

- core repo structure and architecture
- testing and verification
- change control and release discipline
- AI-agent governance
- maintainability thresholds and refactoring ratchets
- optional visual identity governance for UI-bearing repos
