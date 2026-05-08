# Core Standard

## 1. Intent

These standards exist to make repositories:

- safe to change
- easy to understand
- machine-checkable
- AI-agent compatible
- operationally reliable

The standards optimize for solo maintenance with strong automation, not for
informal human review.

## 2. Non-Negotiable Rules

- No direct commits to `main`.
- `main` must be protected.
- Required checks must pass before merge.
- `make lint`, `make typecheck`, `make test`, `make build`, and `make verify`
  are mandatory entrypoints.
- `make verify` must be sufficient for merge readiness for normal changes.
- Manual testing may supplement automation, but it must not be the merge gate.
- Standards and policy files are protected paths.
- Local repo policy may tighten central policy, but may not weaken it without a
  formal waiver.

## 3. Repository Model

Every repo must declare:

- one primary deployment unit
- one primary runtime model
- one repo profile
- zero or more risk overlays
- support tier
- production criticality
- critical paths
- compatibility matrix
- non-functional requirements

## 4. Required Top-Level Paths

Reserved top-level paths:

- `src/`
- `tests/`
- `docs/`
- `scripts/`
- `config/`
- `generated/`
- `third_party/`
- `.artifacts/`

Repo profiles may mark subsets as required, optional, or forbidden.

## 5. File Classification

Every repo must classify paths into:

- `authored`
- `generated`
- `third_party`
- `secrets`
- `artifacts`

Generated output must not be mixed into authored paths by default.

## 6. Internal Source Layout

Internal `src/` layout is profile-driven and must be enforced in CI.

Defaults:

- `application`: `domain`, `application`, `adapters`, `interfaces`, `shared`
- `library`: `core`, `api`, `adapters`, `shared`
- `infrastructure`: `modules`, `platform`, `integrations`, `policies`, `shared`
- `automation`: `workflows`, `tasks`, `adapters`, `runtime`, `shared`

## 7. Architecture Rules

- Dependency direction must be explicit and machine-enforced.
- Core logic must not depend on frameworks, vendor SDKs, environment variables,
  or network/database clients directly.
- Business logic must not live in controllers, entrypoints, or scripts.
- Shared code must remain small and non-domain-specific.
- External integrations must sit behind typed adapters.
- Configuration must be loaded through one typed config layer.

## 8. Complexity and Change Size

Complexity must be capped by automated thresholds:

- function length
- file length
- nesting depth
- cyclomatic or cognitive complexity
- public-surface size
- duplication thresholds

Changes must be small, single-purpose, and reversible by default. Large changes
require documented justification and staged rollout.

Maintainability thresholds and legacy ratchet behavior are defined in
`policies/maintainability-standard.md`.

## 9. Source of Truth Hierarchy

When artifacts disagree, precedence is:

1. `repo-contract.yaml`
2. protected policy files
3. versioned code and migrations
4. ADRs and architecture docs
5. runbooks
6. `README.md` and generated docs

## 10. Documentation Minimum

Every repo must maintain:

- `README.md`
- `docs/architecture.md`
- `docs/runbook.md`
- `docs/adr/`
- `CHANGELOG.md` or equivalent
- `repo-contract.yaml`
- `agent-policy.yaml`
- `check-manifest.yaml`

Documentation freshness must be checked in CI for change classes that affect it.

## 11. Waivers

Waivers are allowed only if they are:

- machine-tracked
- time-boxed
- owner-assigned
- mitigation-backed
- linked to a follow-up work item

Expired waivers fail CI.
