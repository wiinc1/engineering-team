# Repo Standards Template

This repository is a reusable template for bootstrapping the repo-local
standards control plane into a new project.

It includes:

- `dev-standards/` with policies, schemas, profiles, templates, and validators
- root standards control files:
  - `repo-contract.yaml`
  - `agent-policy.yaml`
  - `check-manifest.yaml`
- a deterministic `Makefile` command contract with `make verify`
- a baseline GitHub `verify` workflow
- starter docs, changelog, and ADR records
- validator regression tests and helper fixtures

## First edits after creating a repo from this template

Update these files first:

- `repo-contract.yaml`
- `agent-policy.yaml`
- `check-manifest.yaml`
- `docs/architecture.md`
- `docs/runbook.md`
- `docs/adr/ADR-001.md`

At minimum, replace the generic repo identity, owner, runtime model, profile,
protected paths, architecture boundaries, and critical paths with values that
match the new repository.

## What this template does not claim by default

This template installs repo-local controls that can be honestly supported
without external infrastructure. It does not claim live deployment proof,
integration proof, or external audit immutability unless the target repository
adds real systems for those controls.
