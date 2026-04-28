# Refinement Decision Log: Software Factory Execution Contracts

**Date:** 2026-04-28  
**Status:** Accepted domain decisions  
**Task ID:** Not assigned  
**Related PR:** [#100](https://github.com/wiinc1/engineering-team/pull/100)  
**Related prior work:** [#96](https://github.com/wiinc1/engineering-team/pull/96), [#95](https://github.com/wiinc1/engineering-team/issues/95)

## Context

This decision log captures a grilling/refinement session about the intended product direction for the Software Factory control plane.

This log uses a transitional `CONTEXT-2026-04-28` filename because Task-backed Intake Draft creation and Task ID generation are not implemented yet. Future Refinement Decision Logs should use the Task ID naming convention defined in `CONTEXT.md`, such as `docs/refinement/TSK-123-create-intake-drafts.md`.

## Accepted Decisions

### Product Category

The product is an internal Software Factory control plane, not a Kanban board.

The control plane exists to create, assign, execute, review, and close software work across humans and AI agents, with auditability and PM/SRE governance as first-class behavior.

### Primary Operator

The Software Factory operator creates the initial task requirements. The operator currently approves the full Execution Contract, but the product direction is progressive autonomy: reduce required operator involvement once the control plane proves it can refine, route, execute, and verify work reliably.

### Intake and Task Identity

Initial task requirements are an Intake Draft, not an execution-ready contract.

Intake Draft is the first stage of the same Task, not a separate Intake entity. The Task ID is generated at Intake Draft creation and anchors intake, refinement threads, decision logs, generated stories, PRs, commits, and evidence.

Task IDs should be human-readable and sequential where possible, with opaque IDs only as a fallback.

### Execution Contract

The Execution Contract is the canonical artifact produced by Task Refinement.

The authoritative contract is structured, versioned Task data. A Markdown user story is generated from that data for human review, repo artifacts, PRs, and docs.

The contract is the filled-out `USER_STORY_TEMPLATE.md` for the selected tier:

- Simple: sections 1, 2, 4, 11, 12, 15, 16, and 17.
- Standard: sections 1 through 4, 6 through 7, 10 through 12, and 15 through 17.
- Complex: sections 1 through 12 and 14 through 17.
- Epic: sections 1 through 17.

Material changes create a new Execution Contract version. Typo fixes and non-substantive formatting corrections may be metadata-only edits.

### Role Contributions

The Product Manager owns refinement overall and edits the full Execution Contract before approval.

The Architect owns technical feasibility, current-stack constraints, API/data/architecture sections, and tiering changes.

UX is required for every contract that changes what a human must understand, decide, approve, monitor, or recover from. UX owns workflow clarity, role queues, task detail hierarchy, blocking-question UX, escalation UX, status visualization, accessibility, visual validation, and trust signals.

QA owns testability during refinement. QA verifies the acceptance criteria and evidence plan are automatable and credible.

SRE reviews before implementation when deployment, observability, reliability, authentication, data, or production behavior is affected.

Principal Engineer review is required before approval when high-risk engineering triggers exist.

### Test-Driven Delivery

Test-Driven Delivery is the delivery standard.

Automated tests and evidence expectations are defined during refinement. Implementation proceeds by writing failing or pending automated tests before or alongside production code. Manual testing is not accepted as completion evidence.

QA approval is required before Operator Approval for Standard, Complex, and Epic contracts. It is optional for Simple contracts unless risk flags exist.

### Dispatch Gates

Implementation dispatch is blocked unless:

- required tier sections are complete
- required role approvals are recorded
- QA testability approval is present when required
- SRE pre-implementation review is present when required
- Principal review is present when triggered
- Operator Approval or explicit auto-approval policy is recorded
- the verification report skeleton exists for Standard, Complex, and Epic tasks

### Engineer Tier Routing

Engineer assignment uses risk-based tier routing.

Sr Engineer is the default implementation tier for most Standard work.

Jr Engineer handles constrained Simple tasks, tests, fixtures, docs, and refactors where patterns are already clear. Jr Engineer should not be assigned implementation before a clear failing or pending test plan exists.

Principal Engineer is reserved for hard problems, critical-path design review, production-risk decisions, cross-cutting architecture, repeated failed attempts, and escalation.

For Standard and higher tiers, the default implementation flow dispatches Sr Engineer for implementation and QA for test scaffolding or coverage review in parallel.

### Quality Hierarchy

Automated gates come first. Sr/Principal review comes second.

Senior review focuses on design judgment, risk, maintainability, and correctness gaps that tests may miss. It must not compensate for missing tests, weak evidence, or skipped gates.

### Failure Loop

When implementation fails required tests or misses the Execution Contract, work returns first to the implementing Engineer with failing evidence attached.

Escalate to Principal only after repeated failure, unclear root cause, high-risk regression, or evidence that the contract itself is wrong.

PM, Architect, UX, or QA update the contract only when the failure reveals a contract defect.

### GitHub Issues

GitHub issues are optional, not required by default.

The Task is the authoritative workflow record. The remote repo is the durable audit surface through committed artifacts and PRs.

Create GitHub issues only when GitHub-native backlog or project tracking is needed.

### Repo Artifacts

Generated Markdown user stories should live under `docs/user-stories/` for now and use Task ID plus slug once Task IDs are available.

Approved generated stories are immutable for material changes. Material changes require a new approved Execution Contract version and generated story version or amendment.

Refinement Decision Logs live under `docs/refinement/` and summarize important decisions rather than raw transcripts.

Implementation evidence reports live under `docs/reports/`, named by Task ID and slug.

Use one combined Task-level verification report by default. Split reports only when risk, regulation, audience, or Complex/Epic scope justifies it.

## Alternatives Considered

- Treat the product as a Kanban board.
- Create a separate Intake entity before Task creation.
- Make GitHub issues mandatory for every task.
- Use Principal Engineer as a default implementation lane.
- Make UX responsible only for Section 10 UI details.
- Use model judgment as the primary reviewer-routing mechanism.
- Produce multiple full Execution Contract alternatives by default.

All were rejected in favor of a Task-centered control plane with structured Execution Contracts, deterministic gates, and lightweight generated repo artifacts.

## Follow-Ups

- Implement US-003: create Intake Drafts from raw operator requirements.
- Revise US-003 and issue #95 language so GitHub issues are optional rather than implied as required.
- Create a future Complex-tier story: `Generate Execution Contracts Through Specialist Refinement`.
- Create deterministic reviewer-routing policy and contract validation.
- Generate verification report skeletons from approved Execution Contracts.

## Resulting Contract Version

These decisions are reflected in `CONTEXT.md` as of PR #100.
