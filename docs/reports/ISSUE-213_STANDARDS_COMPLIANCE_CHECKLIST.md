# Standards Compliance Checklist

## Linked Standards

- Standards document: `docs/standards/software-development-standards.md`
- Required gap statement format: `Gap observed: X. Documented rationale: Y (source Z).`

## Change Metadata

- Change or task ID: GitHub issue #213
- Owner: Codex implementation agent
- Date: 2026-05-17
- Scope summary: Document Hermes/Citadel external-context provenance discovery, authority boundaries, redaction rules, role visibility, and follow-up implementation slices.

## Standards Alignment

- Standards baseline reviewed: `docs/standards/software-development-standards.md`
- Applicable standards areas: Architecture and Design; Testing and Quality Assurance; Deployment and Release; Observability and Monitoring; Authentication and Secret Handling; Team and Process.
- Evidence expected for this change: Discovery document, workflow diagram, candidate source inventory, `control-plane-context-provenance.v1` mapping, authority-boundary rules, restricted-record visibility rules, recommended follow-up issues, and required validation commands.
- Gap observed: Hermes and Citadel source contracts, owners, access methods, freshness semantics, tenant boundaries, and redaction approvals are not available in this repository. Documented rationale: Issue #213 requires discovery before implementation, so unverified external source details remain `blocked`, `unknown`, or `needs owner decision` rather than becoming committed product requirements (source https://github.com/wiinc1/engineering-team/issues/213).

## Architecture and Design

- Applicable: Yes
- Evidence in this change: `docs/refinement/hermes-citadel-context-provenance.md` and `docs/diagrams/workflow-hermes-citadel-context-provenance-discovery.mmd`
- Gap observed: No runtime connector architecture is approved in this slice. Documented rationale: Issue #213 is documentation/design only and explicitly does not authorize building a connector (source https://github.com/wiinc1/engineering-team/issues/213).

## Coding and Code Quality

- Applicable: No
- Evidence in this change: No runtime code changed.
- Gap observed: No code implementation exists for Hermes/Citadel ingestion. Documented rationale: This discovery intentionally records requirements, boundaries, and follow-up slices before implementation (source https://github.com/wiinc1/engineering-team/issues/213).

## Testing and Quality Assurance

- Applicable: Yes
- Evidence in this change: Documentation validation through `npm run standards:check`, `npm run lint`, and `npm run change:check`.
- Gap observed: No executable schema examples are introduced. Documented rationale: Issue #213 marks tests as not applicable unless executable schema examples are introduced, and this PR adds documentation and a Mermaid diagram only (source https://github.com/wiinc1/engineering-team/issues/213).

## Deployment and Release

- Applicable: Yes
- Evidence in this change: Discovery document states rollout and runtime observability are not applicable until follow-up connector issues are approved.
- Gap observed: No deployment flag, rollback flag, or runtime release path exists in this slice. Documented rationale: The change is documentation-only and creates no runtime behavior to deploy or roll back (source https://github.com/wiinc1/engineering-team/issues/213).

## Observability and Monitoring

- Applicable: Yes
- Evidence in this change: Follow-up implementation slices require metrics and logs for source access result, freshness status, tenant-boundary result, redaction outcome, and blocking-question creation.
- Gap observed: No runtime metrics are added. Documented rationale: Observability is not applicable until Hermes/Citadel adapters are approved and implemented (source https://github.com/wiinc1/engineering-team/issues/213).

## Authentication and Secret Handling

- Applicable: Yes
- AuthN/AuthZ surfaces changed: None.
- Secret, token, cookie, password, or PII redaction evidence: The discovery requires safe source references, redacted summaries, role-scoped restricted-context notes, and fail-closed behavior for unverified redaction.
- Abuse-control or rate-limit evidence: Not applicable to this documentation-only slice.
- Rollback or removal impact: Revert the documentation PR if the discovery direction is rejected.
- Gap observed: Source-owner approvals and allowed-field contracts are unavailable. Documented rationale: The discovery records those as owner decisions before any connector can access restricted Hermes or Citadel records (source https://github.com/wiinc1/engineering-team/issues/213).

## Team and Process

- Applicable: Yes
- Evidence in this change: Candidate source inventory names owners, statuses, next actions, and follow-up slices with owner/dependency ordering.
- Gap observed: Follow-up implementation issues are recommended but not created. Documented rationale: Issue #213 requires recommendations; actual issue creation should wait for PM/operator confirmation of the discovery slices (source https://github.com/wiinc1/engineering-team/issues/213).

## Required Evidence

- Commands run: `npm run standards:check`; `npm run lint`; `npm run change:check`; `git diff --check`; `npm test`; `npm run build`.
- Tests added or updated: None; documentation-only discovery.
- Rollout or rollback notes: No runtime rollout; rollback is a normal git revert of the documentation and diagram.
- Docs updated: `docs/refinement/hermes-citadel-context-provenance.md`; `docs/diagrams/workflow-hermes-citadel-context-provenance-discovery.mmd`; this checklist.
