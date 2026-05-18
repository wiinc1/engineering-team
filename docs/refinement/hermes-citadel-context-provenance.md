# Hermes/Citadel Context Provenance Discovery

## Status

- Issue: https://github.com/wiinc1/engineering-team/issues/213
- Scope: discovery and design only.
- Baseline reviewed: `docs/standards/software-development-standards.md`, `docs/product/software-factory-control-plane-prd.md`, `docs/runbooks/audit-foundation.md`, and `lib/audit/control-plane.js`.
- Related diagram: `docs/diagrams/workflow-hermes-citadel-context-provenance-discovery.mmd`

This document inventories candidate Hermes and Citadel sources for future external-context ingestion into the Software Factory control plane. It does not approve source access, create a connector, define committed product requirements, or authorize any automated workflow decision from external facts.

## Standards Alignment

The discovery follows the repo standards baseline by keeping the change documentation-only, making access and provenance gaps explicit, and separating design decisions from implementation commitments. Any later implementation must add a standards compliance checklist, owner approval evidence, schema tests, redaction tests, role-visibility tests, and rollout controls before connector code is merged.

Gap observed: Hermes and Citadel source contracts, owners, and data-classification rules are not present in this repository. Documented rationale: Issue #213 asks for provenance discovery before implementation, so unverified source facts are tracked as `blocked`, `unknown`, or `needs owner decision` instead of being promoted into committed requirements (source https://github.com/wiinc1/engineering-team/issues/213).

## Required Evidence

- Source inventory includes access method, access owner, freshness semantics, tenant boundary, redaction rule, allowed signal types, status, and next owner action for every candidate source.
- Provenance mapping targets `control-plane-context-provenance.v1` and the existing `external_sources` category.
- Authority boundaries block external context from directly changing requirements, approvals, dispatch, closeout, or operator intent.
- Conflict rules route scope, acceptance, risk, routing, timeline, customer-impact, and compliance conflicts to PM-owned blocking questions and operator resolution.
- Restricted records expose role-scoped notes without raw restricted facts for unauthorized roles.
- Follow-up implementation slices are owner-assigned and dependency-ordered.

## Discovery Principles

- Treat Hermes and Citadel as read-only external context providers until owners approve access, retention, freshness, tenant isolation, and redaction.
- Store external facts as provenance, not as committed requirements.
- Prefer source summaries and stable safe references over raw records.
- Fail closed when access, freshness, tenant binding, or redaction cannot be verified.
- Preserve operator intent as the controlling input unless the operator explicitly resolves a PM-owned blocking question.
- Show restricted-context notes to unauthorized roles, but never expose raw restricted facts through those notes.

## Candidate Source Inventory

Status values are limited to `verified`, `blocked`, `unknown`, and `needs owner decision`.

| System | Candidate source or signal | Access method | Access owner | Freshness semantics | Tenant boundary | Redaction rule | Allowed signal types | Status | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hermes | Account profile summary | Owner-approved read-only API or export; no direct DB access | Hermes product owner | Source update timestamp required; stale after owner-defined SLA | Match by canonical tenant/customer ID only | Remove contact names, emails, free-text notes, and account-private identifiers | customer impact, routing context, scope constraints | needs owner decision | Confirm owner, endpoint/export, tenant key, SLA, and allowed fields |
| Hermes | Contract, entitlement, or SOW summary | Owner-approved contract summary view | Hermes product owner plus legal/commercial owner | Use source document effective date and last reviewed timestamp; stale if effective window is expired or review timestamp missing | Match by contract tenant ID and active agreement ID | Expose entitlement category and constraint summary only; no pricing, signatures, private terms, or raw legal text | scope constraints, acceptance constraints, dependency context | blocked | Legal/commercial owner must approve summary shape before any ingestion |
| Hermes | Support or escalation summary | Owner-approved ticket summary API or curated export | Hermes support operations owner | Fresh only with ticket updated timestamp inside owner-defined SLA | Match by tenant ID; exclude cross-customer tickets | Redact names, emails, incident transcripts, attachments, credentials, and customer-sensitive narrative | customer impact, risk, timeline, operational urgency | needs owner decision | Define which ticket states and severities are allowed as summarized signals |
| Hermes | Product usage or adoption aggregate | Aggregated analytics export with minimum cohort rules | Hermes analytics owner | Freshness is analytics window end time; stale when window exceeds SLA | Tenant-scoped aggregate only; no user-level events | Aggregate counts/rates only; suppress low-count cohorts and raw event streams | customer impact, rollout readiness, validation confidence | unknown | Identify analytics owner, aggregation thresholds, and permitted metrics |
| Hermes | Deployment or environment constraint summary | Owner-curated environment metadata view | Hermes platform owner | Fresh with environment config version and update timestamp | Tenant environment ID must map to task tenant | Redact hostnames, IPs, credentials, secrets, and private topology | implementation risk, release constraints, operational dependencies | unknown | Confirm whether a safe metadata surface exists |
| Citadel | Security control inventory summary | Owner-approved compliance/control API or export | Citadel security governance owner | Freshness from control attestation timestamp; stale after compliance owner SLA | Tenant, product, or control-scope binding must be explicit | Expose control IDs, status category, and remediation summary only; no evidence attachments or assessor notes | compliance route, risk, reviewer routing | needs owner decision | Confirm allowed control fields and mapping to Software Factory risk flags |
| Citadel | Risk exception or audit finding summary | Owner-approved restricted summary view | Citadel risk owner | Freshness from exception/finding status timestamp; expired at exception end date | Tenant/product/control scope must be explicit | Redact finding details, exploit paths, attachments, names, and private evidence | compliance blockers, risk, timeline, release constraints | blocked | Security/risk owner must approve restricted-note wording and visibility |
| Citadel | Data classification and PII handling summary | Owner-approved classification registry view | Citadel data governance owner | Fresh with classification version and review timestamp | Bind to tenant data domain or product data category | Expose classification label and handling rule only; no sample records or sensitive fields | compliance route, security review requirement, redaction policy | needs owner decision | Confirm classification taxonomy and source reference format |
| Citadel | Access role or permission boundary summary | Owner-approved identity/governance summary | Citadel identity governance owner | Fresh with policy version and effective timestamp | Role mappings must be tenant/product scoped | Redact user identities and membership lists; expose role class and approval requirement only | role visibility, approval routing, security risk | unknown | Identify owner and whether role-class summaries are available |
| Citadel | Incident or posture signal summary | Owner-approved restricted security posture feed | Citadel security operations owner | Fresh with incident/posture timestamp; stale on unresolved status after SLA | Tenant/product/security-scope binding required | Redact incident details, exploit indicators, detections, IOCs, names, and raw logs | high-risk blocker, timeline impact, compliance route | blocked | Security operations owner must define safe signal taxonomy and escalation wording |

No Hermes or Citadel row is `verified` in this discovery because this repository does not contain source-system contracts, owner approvals, or live access evidence for those systems. Future implementation must prove verification per source before moving any row to `verified`.

## Provenance Mapping

Hermes and Citadel facts map into the existing `control-plane-context-provenance.v1` policy surface under `external_sources`. The current normalizer accepts entries with `label`, `reference`, `source_type`, `source_event_id`, `used_for_decision`, and `notes`; future implementation can preserve those fields while carrying a richer external-source payload in the referenced decision or contract metadata.

| Future field | `control-plane-context-provenance.v1` mapping | Rule |
| --- | --- | --- |
| `policy_version` | `control-plane-context-provenance.v1` | Always set by the context provenance normalizer. |
| `category` | `external_sources` | Hermes and Citadel never use source-intake or repo-doc categories. |
| `source_system` | `external_sources[].source_type` | Use `hermes` or `citadel`; do not overload with endpoint names. |
| `safe_source_reference` | `external_sources[].reference` | Stable, redacted reference such as `hermes:account-summary:<tenant-hash>:<record-id-hash>`. |
| `summary_label` | `external_sources[].label` | Human-readable, redacted summary title. |
| `source_event_id` | `external_sources[].source_event_id` | Optional source update/event/version ID when approved for exposure. |
| `used_for_decision` | `external_sources[].used_for_decision` | Default `false` until PM/operator resolution allows use. |
| `notes` | `external_sources[].notes` | Redacted rationale, freshness status, and role-visibility class. |
| `fact_type` | Adjacent decision `input_facts.external_context[].fact_type` | Allowed values should be bounded to scope, acceptance, risk, routing, timeline, customer impact, compliance, freshness, and access. |
| `freshness` | Adjacent decision `input_facts.external_context[].freshness` | Include source updated time, fetched time, SLA, and status `fresh`, `stale`, `expired`, or `unknown`. |
| `tenant_boundary` | Adjacent decision `input_facts.external_context[].tenant_boundary` | Include tenant binding method and isolation result; fail closed when not verified. |
| `redaction` | Adjacent decision `input_facts.external_context[].redaction` | Include class, omitted fields, and restricted-note rule. |
| `owner` | Adjacent decision `input_facts.external_context[].owner` | Include source owner and approval state. |
| `conflict_resolution` | Adjacent decision `input_facts.external_context[].conflict_resolution` | Link PM blocking question and operator resolution when required. |

Example redacted provenance entry:

```json
{
  "policy_version": "control-plane-context-provenance.v1",
  "external_sources": [
    {
      "label": "Citadel compliance route summary for tenant-scoped data classification",
      "reference": "citadel:data-classification:tenant-4f2a:class-9c10",
      "source_type": "citadel",
      "source_event_id": "classification-version-2026-05-01",
      "used_for_decision": false,
      "notes": "Restricted summary only. Raw classification evidence is hidden from unauthorized roles. Freshness: unknown until owner SLA is approved."
    }
  ]
}
```

## Authority Boundaries

External context can inform PM refinement, blocking questions, risk review, and operator-facing notes. It cannot directly:

- create, modify, or delete committed requirements;
- satisfy acceptance criteria;
- approve an Execution Contract, artifact bundle, dispatch gate, QA gate, SRE gate, or closeout gate;
- choose or override an assignee;
- override operator-stated intent;
- accept risk, compliance exceptions, or restricted-data handling;
- close a task or mark evidence complete.

If a Hermes or Citadel fact appears to conflict with the operator intake, the approved Execution Contract, or repo-owned standards, the system must stop at a PM-owned blocking question. The external fact remains context-only unless the operator resolves the question and the PM updates the appropriate authoritative artifact through the normal workflow.

## Conflict Routing

Route a PM-owned blocking question when an external fact could affect any of these areas:

- scope or committed requirements;
- acceptance criteria or definition of done;
- risk tier, security classification, or compliance route;
- reviewer routing, dispatch routing, or owner assignment;
- timeline, rollout, rollback, or release sequencing;
- customer impact or escalation priority;
- tenant boundary, access eligibility, freshness, or redaction validity.

Required blocking-question payload:

| Field | Requirement |
| --- | --- |
| `source_summary` | Redacted Hermes/Citadel summary only. |
| `safe_source_reference` | Stable redacted reference from provenance. |
| `fact_type` | One of the allowed fact types listed in the provenance mapping. |
| `freshness_status` | `fresh`, `stale`, `expired`, or `unknown`. |
| `tenant_boundary_status` | `verified`, `blocked`, `unknown`, or `needs owner decision`. |
| `proposed_impact` | What would change if the operator accepts the fact. |
| `authority_boundary` | Explicit statement that the external fact cannot update committed artifacts by itself. |
| `owner` | PM owner plus required source owner or security/legal owner. |
| `operator_resolution` | Required before promotion into committed scope, risk, routing, timeline, or compliance decisions. |

## Restricted Records and Role Visibility

Restricted Hermes/Citadel records must be represented as role-scoped notes. Unauthorized roles see that restricted context exists, why it matters, who owns it, and the next required action. They do not see raw facts.

| Role | Visibility | Prohibited exposure |
| --- | --- | --- |
| Operator | Redacted conflict summary, owner, freshness, and resolution options when operator action is required | Raw restricted facts unless the source owner authorizes operator access |
| PM | Redacted summary, safe reference, owner metadata, freshness, tenant boundary, and conflict-routing fields | Raw legal, security, incident, personal, or credential-bearing records |
| Architect | Architecture-relevant redacted summary after PM routing | Commercial terms, personal data, security exploit detail, incident raw data |
| UX | User-impact or workflow summary after PM routing | Security, legal, contract, personal, or incident details not needed for UX decisions |
| QA | Acceptance/risk summary and test-impact notes after PM routing | Raw restricted facts and source evidence attachments |
| SRE | Operational risk, rollout, freshness, and incident-class summaries after PM/security routing | Raw customer records, credentials, and non-operational restricted facts |
| Engineer | Approved Execution Contract text, implementation-relevant restricted note, and safe source reference only when needed | Raw Hermes/Citadel facts, source records, and unresolved conflict details |
| Read-only stakeholder | Final approved artifact text and unresolved restricted-context note when relevant | Any raw restricted source detail |

Restricted-context note format:

```text
Restricted external context exists from <Hermes|Citadel>.
Reason: <risk/compliance/customer-impact/timeline/scope>.
Owner: <PM/source owner/security owner>.
Freshness: <fresh/stale/expired/unknown>.
Next required action: <blocking question, owner decision, or operator resolution>.
Raw source facts are hidden for this role.
```

## Follow-up Implementation Issues

These are recommended implementation slices, not part of this discovery PR.

| Slice | Owner | Dependencies | Ready-for-agent acceptance |
| --- | --- | --- | --- |
| External context source registry | Platform PM and Platform Engineering | Hermes and Citadel source-owner confirmation | Registry stores source owner, access method, allowed signal types, freshness SLA, tenant binding, redaction class, and status enum for each source. |
| Provenance payload schema and fixtures | Platform Engineering and Security | Source registry shape | Schema examples validate `external_sources` entries, adjacent `input_facts.external_context`, safe references, freshness states, tenant boundary states, and redaction metadata. |
| Hermes read-only summary adapter | Hermes owner and Platform Engineering | Approved Hermes access, tenant key, redaction rules, schema fixtures | Adapter emits redacted summaries only, fails closed on stale/unknown tenant binding, and records provenance without committing requirements. |
| Citadel read-only summary adapter | Citadel security/risk owner and Platform Engineering | Approved Citadel access, role visibility rules, schema fixtures | Adapter emits restricted summaries only, fails closed on blocked access or stale controls, and never exposes raw security evidence. |
| PM blocking-question workflow for external conflicts | Product Management and Platform Engineering | Provenance schema and source registry | Conflicting external facts create PM-owned blocking questions with operator-resolution requirements before any committed artifact changes. |
| Role-scoped restricted-context notes | Security, UX, and Platform Engineering | Citadel redaction approval and role matrix | Unauthorized roles see restricted notes with owner, reason, freshness, and next action while raw facts remain hidden. |
| Observability for freshness and access failures | SRE and Platform Engineering | Adapter implementation | Metrics and structured logs capture source access result, freshness status, tenant-boundary result, redaction outcome, and blocking-question creation without logging raw facts. |

## Open Owner Decisions

- Who owns Hermes account, contract, support, analytics, and environment summary approvals?
- Who owns Citadel control, risk, classification, identity, and incident summary approvals?
- Which stable tenant key maps Hermes/Citadel records to Software Factory tenants?
- What freshness SLA applies to each source and signal type?
- Which roles may see each redacted summary class?
- What retention and caching policy applies to external-source summaries?
- Which safe source reference format is approved for audit logs and PR-visible evidence?
- Which source failures are retriable, blocking, or explicitly ignored?
- Which source summaries require legal, security, or customer-success approval before display?

## Non-goals

- No Hermes or Citadel connector is built in this slice.
- No runtime code changes are required by this discovery.
- No external source is marked verified without owner approval and source-contract evidence.
- No GitHub issue is created for follow-up implementation unless a PM/operator explicitly requests issue creation.
