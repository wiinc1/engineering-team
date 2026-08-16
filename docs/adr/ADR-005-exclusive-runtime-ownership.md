# ADR-005: Evidence-bound exclusive runtime ownership

## Status

Accepted for implementation; production activation pending automated evidence for issues #283, #284, #289, and #290.

## Decision

Use an immutable database epoch as the only authority for runtime ownership. `jobs` targets Graphile Worker and `factory` targets LangGraph. Production enablement requires a UUID epoch in configuration and every start/claim/effect boundary checks the current active record. No percentage selection, shadow side effects, fallback, or dual ownership exists.

The production evidence gate is exact-revision, automated, expiring, provenance-labeled, redacted, and threshold-aware. Missing or failing load, soak, DR, security, alert, synthetic, kill-switch, or rollback proof blocks epoch activation. Legacy executable paths are removed only after the post-cutover soak; immutable migration history remains.

## Consequences

Stale processes fail closed and rollback must reconcile ownership before changing an epoch. The database adds small append-only control/history tables. Operations require a short freeze and coordinated Graphile/LangGraph gate. Until hosted evidence exists, both cutovers correctly report blocked and legacy remains available solely for controlled pre-cutover reconciliation.

## Standards Alignment

- Applicable standards areas: architecture and design, coding quality, testing, deployment, observability, security, and team process.
- Evidence expected for this change: ownership migration, guards, matrix/property tests, exact-revision evidence gate, runbook, diagrams, and production reconciliation.
- Gap observed: production ownership is not activated. Documented rationale: hosted soak, DR, security, and in-flight reconciliation evidence does not exist yet, so the automated gate must block activation (source http://192.168.1.116/wiinc1/engineering-team/-/work_items/291).

## Required Evidence

- Commands run: focused runtime/cutover tests, Docker integration, security, load, chaos, soak, DR, standards, build, and repository verification.
- Tests added or updated: release threshold validation, ownership matrices, epoch fencing, rollback decisions, runtime guards, and artifact contracts.
- Rollout or rollback notes: one full freeze/reconcile/switch; rollback only with exclusive ownership proof; no percentage or fallback execution.
- Docs updated: shared architecture, cutover/DR runbook, compliance reports, and Graphile/LangGraph 04/05 diagrams.
