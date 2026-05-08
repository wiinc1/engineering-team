# Agent Governance Standard

## 1. Intent

AI agents are allowed to contribute code, documentation, and low-risk
maintenance, but they operate inside explicit repo-local boundaries.

## 2. Core Rules

- Agents may never commit directly to `main`.
- Agent-authored changes must meet the same baseline gates as human changes.
- Agent-authored changes must also satisfy stricter provenance and verification
  rules.
- Agents may not change standards, policy, CI, release authority, secrets,
  protected paths, or security-critical controls without explicit human
  instruction or a higher review mode.

## 3. Mandatory Repo-Local Policy

Every repo must define `agent-policy.yaml` declaring:

- editable paths
- protected paths
- forbidden tasks
- review mode by risk level
- capability matrix by risk level
- `allowed-to-automate` matrix
- `unsafe-for-agents` list
- `AI-safe` change criteria

## 4. Capability Model

Capabilities must be separated by risk:

- `low`: read, search, edit allowed paths, run local verification
- `medium`: dependency updates, tests, docs, refactors inside declared
  boundaries
- `high`: changes to critical paths, adapters, migrations, deployment logic, or
  CI only with stronger verification and human-in-the-loop review
- `critical`: standards, policy, security controls, release authority, secrets,
  protected paths, or emergency overrides are never autonomous

## 5. Provenance

Every agent-authored non-trivial change must record:

- that an agent participated
- what class of agent acted
- change risk
- review mode
- verification evidence reference
- whether protected paths were touched

Commit, branch, or change metadata must make agent involvement durable and
queryable.

## 6. AI-Safe Change Criteria

Repos must define explicit criteria for low-risk autonomous changes. Default
expectations:

- small diff size
- limited file count
- no protected-path edits
- no standards, CI, migration, or release changes
- deterministic command usage only
- complete lint, typecheck, and test evidence
- no new waivers

## 7. Stop Conditions

Agents must stop and require human intervention when:

- protected paths are implicated
- required evidence is unavailable
- rollback is unclear
- policy files would need to be weakened
- change risk is `critical`
- repo is under merge or release freeze

## 8. Auditability

Privileged agent actions must have auditable records beyond ordinary Git
history, including evidence references and explicit authority context.
