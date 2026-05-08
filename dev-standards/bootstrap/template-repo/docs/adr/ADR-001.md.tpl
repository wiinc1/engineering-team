# ADR-001: Adopt the Repo-Local Standards Control Plane

## Status

Accepted

## Context

This repository needs machine-checkable development standards instead of
standalone prose guidance.

## Decision

Adopt the repo-local standards control plane built from:

- `dev-standards/`
- `repo-contract.yaml`
- `agent-policy.yaml`
- `check-manifest.yaml`
- `Makefile`

Use `make verify` as the authoritative local and CI verification command.

## Consequences

- Standards are versioned with the repository.
- Policy changes become protected-path changes.
- External-system-dependent controls remain blocked until the repository has the
  real systems they depend on.
