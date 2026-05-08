# Change Control Standard

## 1. Change Classes

Every non-trivial change must declare:

- work item, issue, or ADR reference
- risk level: `low`, `medium`, `high`, or `critical`
- reversibility: `reversible`, `conditionally-reversible`, or `irreversible`
- review mode
- affected critical paths

## 2. Review Modes

- `automated-only`
- `human-approve`
- `human-plus-evidence`

Protected files, standards, migrations, releases, and security-sensitive changes
require `human-plus-evidence`.

## 3. Required Change Template Content

Every non-trivial change must capture:

- purpose and scope
- risk level
- affected systems and boundaries
- test evidence
- architecture or schema impact
- rollout plan
- rollback or compensation plan
- operational verification
- agent provenance
- waiver references

## 4. Release and Promotion

Production-affecting repos must promote through explicit environments:

- `dev`
- `staging`
- `prod`

Promotion gates must escalate evidence at each stage. Releases must come from
immutable versioned artifacts, not branches.

## 5. Evidence Artifacts

Passing checks are not sufficient by themselves. Repos must preserve explicit
evidence artifacts for promotion and release, including:

- test reports
- coverage reports
- compatibility results
- security scan results
- deployment verification records

Evidence must have freshness and expiry rules.

## 6. Emergency Change Policy

Emergency changes may compress process, but may not skip:

- traceability
- post-change verification
- rollback or compensation planning
- retrospective follow-up

## 7. Freeze Rules

Repos must define merge and release freeze behavior for:

- broken `main`
- incidents
- security events
- policy tampering
- other elevated-risk periods

## 8. Stop-the-Line Failures

Each repo must declare immediate release blockers, including at minimum:

- broken required verification
- secret exposure or policy breach
- failed critical-path tests
- incompatible migration or interface change
- missing rollback path for production-affecting changes
- expired required-control waiver
- protected-file or CI tampering
