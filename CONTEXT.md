# Engineering Team Context

## Glossary

### Software Factory control plane

An internal product for creating, assigning, executing, reviewing, and closing software work across humans and AI agents, with auditability and PM/SRE governance as first-class product behavior.

The Kanban board is one view of the control plane, not the product category.

### Software Factory operator

The primary human user of the Software Factory control plane.

The operator creates the initial task requirements that start delivery work and remains accountable for turning the request into verified, closed software delivery.

This is distinct from a release operator, who executes production release or smoke-test procedures.

### Initial task requirements

The operator-authored intake draft that starts delivery work.

Initial task requirements are not yet an execution-ready contract. The control plane must refine them into an execution-ready task by adding acceptance criteria, dependencies, owner routing, verification requirements, and risk flags before agent implementation begins.

### Task refinement

The pre-execution process that converts initial task requirements into an execution-ready task.

The Product Manager owns task refinement overall. The Architect contributes technical feasibility, implementation constraints, and current-stack guidance. The UX Designer owns user workflow and usability requirements, including interaction flows, accessibility needs, and edge-case user journeys.

Business-domain intent remains owned by the Product Manager. The Software Factory operator approves or corrects the refined task before execution begins.

### Execution-ready task

A refined task that is ready to dispatch for implementation.

An execution-ready task has a selected template tier and all required pre-execution story sections completed for that tier: user story, business context, success metrics, Given-When-Then acceptance criteria, standards alignment, workflow and user journey when required, UX requirements when user-facing, architecture/API/data/security/deployment/observability impacts when applicable, dependencies and risks when required, and required automated evidence.

Implementation outputs such as code, tests, diagrams, runbooks, dashboards, and production validation artifacts belong to delivery and Definition of Done, not pre-execution readiness.

### Specialist delivery workflow

The execution model for an approved execution-ready task.

Delivery is a coordinated workflow of specialist agents rather than a single implementation handoff. The Product Manager produces the story contract, the Architect and UX Designer contribute during refinement, the appropriate Engineer implements, QA verifies functional and regression behavior, and SRE verifies operational readiness before closure.

### Software Factory lifecycle

The canonical domain lifecycle for work in the control plane:

1. Intake Draft
2. Task Refinement
3. Operator Approval
4. Implementation
5. QA Verification
6. SRE Verification
7. Operator Closeout

Board statuses are views over this lifecycle, not the lifecycle itself.

### Operator Approval

The stage where the Software Factory operator approves the full execution contract before implementation begins.

Approval covers refined requirements, scope and non-goals, template tier, agent routing, dependencies, risks, and required verification evidence.

### Progressive autonomy

The product direction for reducing required operator involvement as the Software Factory control plane proves it can refine, route, execute, and verify work reliably.

The operator remains in the approval path until they are comfortable delegating some or all approval decisions to the control plane under explicit policy.

The first candidate for automation is auto-approval of low-risk Simple-tier tasks. A task may bypass explicit operator approval only when it is Simple tier, touches no production authentication, security, or data-model paths, has complete acceptance criteria, has no unresolved dependencies, and has a clear rollback path.

### Operator-trusted autonomous delivery rate

The product's primary success metric.

It measures the percentage of tasks that move from approved or auto-approved refined intake to verified closeout without the Software Factory operator needing to intervene after approval, while still passing QA, SRE, and required evidence gates.

### Operator intervention

An operator action after approval that repairs, clarifies, or completes a workflow the control plane should have handled.

Operator interventions include changing task scope, clarifying missing requirements, resolving agent confusion, restarting failed workflow routing, manually verifying evidence, or deciding whether to accept incomplete work.

Routine status viewing and final closeout acknowledgement do not count as operator intervention.

### Refinement blocking question

A targeted question raised during task refinement when missing or ambiguous requirements prevent the task from becoming execution-ready.

The Product Manager owns consolidating blocking questions for the Software Factory operator. The Architect and UX Designer may contribute blocking questions from technical feasibility, current-stack, workflow, usability, or accessibility concerns.

The control plane must resolve refinement blocking questions before requesting Operator Approval or dispatching implementation.

Refinement blocking questions should be presented one decision cluster at a time. Each cluster should include the recommended answer and the consequence of accepting it.

### Intake-to-execution-ready refinement workflow

The next highest-value product capability for the Software Factory control plane.

This workflow lets the Software Factory operator submit initial task requirements, then coordinates Product Manager, Architect, and UX Designer refinement into a reviewable execution contract with blocking questions, recommended answers, and an approval or auto-approval decision.

### Intake Draft stage

The first stage of a Task in the Software Factory lifecycle.

An Intake Draft is the operator's raw initial task requirements plus minimal metadata. It is not a separate domain object from Task. The same Task ID, task detail surface, and audit trail should carry the work from Intake Draft through refinement, approval, delivery, verification, and closeout.

Refinement fills in the execution contract fields before Operator Approval.

Only raw requirements text is strictly required to create an Intake Draft. Title, priority, urgency, desired outcome, and task type are optional at intake and may be suggested by the Product Manager during refinement.

After an Intake Draft is created, it enters Product Manager refinement automatically. The control plane should create a PM-owned refinement work item or stage assignment, with Architect and UX Designer contribution requests created as needed based on task tier, user-facing impact, and technical ambiguity.

Architect and UX Designer refinement contributions are conditional.

Architect contribution is mandatory for Standard, Complex, or Epic tasks; data-model changes; API changes; production or security paths; and unclear technical feasibility.

UX Designer contribution is mandatory for user-facing changes, role workflow changes, task detail/list/board changes, and accessibility-sensitive flows.

Simple backend or internal changes may skip Architect or UX contribution when the Product Manager documents why the contribution is unnecessary.

Near-term UI work should optimize first for creating Intake Drafts and second for reviewing refined execution contracts.

The current app already has task detail and review surfaces, but intake is inverted because it asks the operator for refined fields before refinement begins.

The broader product direction includes the full Intake-to-execution-ready refinement workflow. The next implementation story should be scoped narrowly to Intake Draft creation: raw requirements text is enough, the Task is persisted in `DRAFT`, PM refinement routing is created, and the draft is visible in task list/detail.

Next implementation story title: Create Intake Drafts From Raw Operator Requirements.

The next implementation story should use the Standard template tier because it changes a user-facing form, API validation, task persistence semantics, PM refinement routing, and task list/detail visibility while excluding the full multi-specialist refinement workflow.

Next implementation story user story: As a Software Factory operator, I want to create an Intake Draft from raw initial requirements, so that the control plane can start PM refinement without requiring me to pre-fill the execution-ready story contract.

Next implementation story must-have acceptance criteria:

1. Given the operator opens task creation, when they enter only raw requirements text and submit, then a Task is created in `DRAFT` as an Intake Draft.
2. Given optional title, priority, or type are omitted, when the draft is created, then the system stores safe defaults or leaves those fields unset without blocking intake.
3. Given an Intake Draft is created, when task list or task detail loads, then it is visibly labeled as Intake Draft and its next required action is PM refinement.
4. Given an Intake Draft is created, when the audit or task history is inspected, then creation and PM refinement routing are recorded without claiming implementation has started.

Next implementation story out of scope: full Product Manager, Architect, and UX Designer refinement generation; auto-approval; implementation dispatch; QA or SRE verification changes; production release automation; and multi-task decomposition.

For the narrow story, PM refinement routing should be recorded as task state metadata and audit/history rather than a separate child task. The target state is `current_owner=pm`, `next_required_action='PM refinement required'`, and a new audit event named `task.refinement_requested`.

For the first Intake Draft implementation, the creation form should collect raw requirements text and an optional title only. Priority, task type, urgency, owner, acceptance criteria, and Definition of Done are refinement outputs unless the operator includes them naturally in the raw requirements text.

If the operator omits a title, the system should use the placeholder title `Untitled intake draft` and include the Task ID in list and detail contexts. The Product Manager can propose the real title during refinement.

Raw requirements text should appear on task detail above refined execution-contract sections, labeled `Operator intake requirements`. It should remain visible after refinement so future agents can compare the refined contract against the operator's original intent.

Raw intake requirements may be revised before Operator Approval, but revisions must be recorded as new audit events rather than silent edits. The original intake text remains preserved in history, and Product Manager refinement must use the latest revision while retaining visibility into earlier revisions.

After Operator Approval, changes to intake requirements are scope-change events rather than intake revisions.

Intake requirement revision is a follow-up capability, not part of the first Intake Draft creation story.

### Execution Contract

The canonical artifact produced by Task Refinement.

The Execution Contract is a versioned section of the same Task, owned by the Product Manager, composed from Product Manager, Architect, and UX Designer contributions, and used as the dispatch source only after Operator Approval or policy-based auto-approval.

An Execution Contract is the filled-out `USER_STORY_TEMPLATE.md` for the selected template tier. The required sections are:

- Simple: sections 1, 2, 4, 11, 12, 15, 16, and 17.
- Standard: sections 1 through 4, 6 through 7, 10 through 12, and 15 through 17.
- Complex: sections 1 through 12 and 14 through 17.
- Epic: sections 1 through 17.

The contract also records which sections were contributed or approved by the Product Manager, Architect, and UX Designer.

The authoritative Execution Contract is structured, versioned Task data so the control plane can validate readiness, route work, and measure autonomy. A Markdown user story is generated from that data for human review, GitHub issues, PRs, and docs.

A new Execution Contract version is required for any material change before dispatch or any scope change after approval. Material changes include acceptance criteria changes, tier changes, technical approach changes, UX workflow changes, rollout or verification changes, owner or routing changes, dependency or risk changes, and resolved blocking questions that alter the contract.

Typo fixes and non-substantive formatting corrections may be metadata-only edits without a new Execution Contract version.

Before approval, the Product Manager can edit the full Execution Contract. The Architect can edit and approve technical sections. The UX Designer can edit and approve UX sections. The Software Factory operator approves the whole Execution Contract until progressive autonomy policy delegates approval.

After approval, material edits create a new Execution Contract version and require re-approval unless an explicit auto-approval policy applies.

During refinement, the Product Manager requests section-specific reviews instead of open-ended help. The Architect receives technical sections required by tier, such as Architecture & Integration, API Design, Data Model, Security, Performance, and Dependencies/Risks.

UX Designer contribution is required for every Execution Contract that changes what a human must understand, decide, approve, monitor, or recover from, even when the implementation is mostly backend. UX owns or reviews Workflow & User Journey, user-facing Acceptance Criteria, UI/UX Requirements, role inbox and queue behavior, task detail information hierarchy, blocking-question and escalation UX, stage/status visualization, Operator Approval and closeout experience, progressive-autonomy trust signals, accessibility, and visual validation requirements.

QA contribution is required during Execution Contract refinement as the owner of testability. QA does not own business intent or technical design, but must confirm acceptance criteria are testable, each Given-When-Then scenario maps to automated tests, expected test files and commands are named, required negative/security/accessibility/performance/contract coverage is specified for the selected tier, and manual testing is not accepted as completion evidence.

### Test-Driven Delivery

The delivery standard for Software Factory work.

Automated tests and evidence expectations are defined during refinement, and implementation proceeds by writing failing or pending automated tests before or alongside production code. Work is not done until the automated evidence required by the Execution Contract passes.

QA approval is required before Operator Approval for Standard, Complex, and Epic Execution Contracts. QA approval means the contract is testable and the Test-Driven Delivery plan is credible; it does not mean implementation has passed QA.

QA approval is optional for Simple Execution Contracts unless risk flags exist.

When the Execution Contract is stable enough, QA should write or scaffold acceptance and regression tests in parallel with Engineer implementation. Engineer remains accountable for making the implementation pass the required automated tests. QA should not become a post-implementation bottleneck.

SRE review is required before implementation for Standard, Complex, and Epic Execution Contracts when deployment, observability, reliability, authentication, data, or production behavior is affected. SRE validates rollout and rollback, monitoring, alerting, synthetic checks, operational risk, and production evidence expectations.

SRE pre-implementation review is optional for Simple local-only changes unless risk flags exist. This review is separate from post-implementation SRE Verification.

The Product Manager should present an Execution Contract for Operator Approval only after all required role reviews are complete, unless a refinement blocking question needs the operator's decision. The operator should see either a ready-to-approve contract or one decision cluster that cannot be resolved without them.

When required role reviewers disagree during refinement, the Product Manager owns resolution first. Unresolved material disagreements become a single operator decision cluster summarizing the disagreement, each role's position, the PM recommendation, tradeoffs, and the consequence of accepting the recommendation.

Implementation dispatch is blocked unless the selected tier's required Execution Contract sections are complete, required role approvals are recorded, QA testability approval is present when required, SRE pre-implementation review is present when required, and Operator Approval or explicit auto-approval policy is recorded.

Engineer assignment uses risk-based tier routing. Sr Engineer is the default implementation tier for most Standard work. Jr Engineer handles constrained Simple tasks, tests, fixtures, docs, and refactors where patterns are already clear. Principal Engineer is reserved for hard problems, critical-path design review, production-risk decisions, cross-cutting architecture, and escalation when lower tiers hit ambiguity.

Principal Engineer should increase system leverage and quality, not serve as routine implementation throughput.

For Standard and higher tiers, the default implementation flow dispatches Sr Engineer for implementation and QA for test scaffolding or coverage review in parallel. SRE and Principal Engineer join implementation only when their risk triggers apply. For Simple tasks, Sr Engineer or Jr Engineer can execute alone when the required tests are already clear.

Jr Engineer should not be assigned implementation before a clear failing or pending test plan exists. Jr Engineer work should follow an existing pattern and a defined Test-Driven Delivery path, or run in parallel on fixtures, tests, docs, and constrained refactors under Sr Engineer oversight.

Sr Engineer may propose or delegate bounded Jr Engineer subtasks during implementation. Architect remains accountable for tiering changes, and Product Manager remains accountable for scope. Jr subtasks must have clear inputs, expected outputs, test expectations, and no ambiguous product decisions.

Principal Engineer involvement is required when the Execution Contract includes cross-cutting architecture, production authentication or security, data-model migrations, irreversible or hard-to-rollback changes, ambiguous system boundaries, performance or reliability risk, repeated failed implementation attempts, or disagreement between Architect and Sr Engineer on feasibility.

When Principal Engineer involvement is triggered, Principal review is required before implementation dispatch and before Operator Approval. This prevents approval of a plan that Principal would later reject during implementation.

Implementation quality relies on automated gates first and senior review second. Sr Engineer and Principal Engineer review focuses on design judgment, risk, maintainability, and correctness gaps that tests may miss. Review must not compensate for missing tests, weak evidence, or skipped quality gates.

When implementation fails required tests or misses the Execution Contract, the work returns first to the implementing Engineer with the failing evidence attached. Escalate to Principal Engineer only after repeated failure, unclear root cause, high-risk regression, or evidence that the Execution Contract itself is wrong.

PM, Architect, UX Designer, or QA should update the Execution Contract only when the failure reveals a contract defect.

The control plane should measure engineer-tier performance by outcomes and interventions, not vanity productivity. Useful measures include first-pass QA/SRE verification rate, rework loops, escaped defects, operator interventions, cycle time by tier and task type, Principal escalation rate, and Execution Contract defect rate.

Do not rank agents by lines of code, commit count, or raw task count.

Principal Engineer review is not required for every Sr Engineer PR. Principal review should be risk-triggered, sampled, or requested by Architect, Sr Engineer, QA, or SRE. Mandatory Principal review on every Sr PR would reduce velocity and make the system depend on Principal as a final safety net.

Architect remains available during implementation as a bounded escalation path, not an active co-implementer. Architect answers questions that affect system boundaries, tiering, API or data contracts, and architecture decisions. Routine coding questions remain with Sr Engineer or Jr Engineer.

UX Designer remains available after approval for UX acceptance questions and changed human workflows. UX re-review is required when implementation changes the approved flow, copy, information hierarchy, accessibility behavior, or trust signal. UX is not a general reviewer for non-user-facing implementation details.

After US-003, the next deferred product capability should be the Execution Contract refinement workflow. Engineer-tier routing and dispatch automation depend on having a structured, approved contract with tier, risk, testability, UX, and SRE signals.

Deferred story title: Generate Execution Contracts Through Specialist Refinement.

The narrow scope of `Generate Execution Contracts Through Specialist Refinement` is to generate and approve a structured Execution Contract from an existing Intake Draft without dispatching implementation.

In scope: Product Manager creates the draft Execution Contract from the Intake Draft; Architect, UX Designer, QA, and SRE reviews are requested based on tier and risk rules; required reviewers contribute or approve their sections; blocking questions are consolidated for the operator one decision cluster at a time; Operator Approval records the approved Execution Contract version; and a Markdown user story is generated from structured contract data.

Out of scope: Engineer implementation dispatch, auto-approval, Jr/Sr/Principal runtime routing automation, QA/SRE post-implementation verification, and contract revision after implementation starts.

`Generate Execution Contracts Through Specialist Refinement` should use the Complex template tier because it introduces a major workflow, multiple role-specific review paths, structured contract data, approval gates, generated Markdown artifacts, and blocking-question handling. It is not Epic unless implementation dispatch and autonomous delivery loops are included in the same story.

The primary success metric for `Generate Execution Contracts Through Specialist Refinement` is approval-ready contract rate: the percentage of Intake Drafts that become approval-ready Execution Contracts without operator intervention beyond answering consolidated blocking decision clusters.

The refinement workflow should produce one recommended Execution Contract. Alternatives should be summarized only when there is a meaningful tradeoff that requires operator decision context.

Required reviewers for an Intake Draft are selected by a deterministic reviewer routing matrix derived from template tier and risk flags. Architect is required for technical, API, data, security, and feasibility risk. UX Designer is required for human workflow impact. QA is required for Standard, Complex, and Epic contracts. SRE is required for operational, production, reliability, observability, authentication, or data risk. Principal Engineer is required for high-risk engineering triggers.

Product Manager may add reviewers freely. Product Manager may skip otherwise required reviewers only with documented rationale and, for Standard or higher contracts, operator-visible justification.

Reviewer routing should use hard-coded deterministic rules first and model judgment second. Rules handle non-negotiable triggers such as tier, authentication/security, production behavior, data migrations, human workflow changes, and Standard-or-higher QA. Model judgment may propose additional reviewers, risk flags, and rationale, but may not remove required reviewers without policy.

When deterministic rules and model judgment disagree about required reviewers, the stricter route wins by default. If either source flags a required reviewer, include that reviewer unless the Product Manager documents a downgrade and the downgrade is visible to the operator before approval.

Blocking questions are separate workflow thread objects linked to the Task. Resolved decisions from those threads are copied into the relevant Execution Contract version. Threads preserve discussion and resolution history, while the Execution Contract remains the clean approved artifact.

Operator Approval may proceed with unresolved non-blocking comments if the Product Manager marks them non-blocking and the approval summary calls them out. Unresolved blocking questions prevent Operator Approval.

The generated Markdown user story is committed to the repo at Execution Contract approval time. It becomes the human-readable implementation contract for PRs and review. Implementation later updates evidence reports, not the approved contract unless a new Execution Contract version is approved.

Approved generated Markdown user stories should live under `docs/user-stories/` for now, matching existing repo convention. The Task detail and GitHub issue should link to the generated story. Status folders such as `docs/user-stories/approved/` and `docs/user-stories/implemented/` may be introduced later if story volume requires them.

GitHub issues are optional, not required by default. The Task is the authoritative workflow record, and the remote repo is the durable audit surface through committed artifacts and PRs.

Create GitHub issues only when GitHub-native backlog or project tracking is needed. Otherwise, use the Task ID plus committed Execution Contract, refinement decision log, ADRs, PR discussion, implementation commits, and evidence reports as the durable record of requirements, decisions, implementation discussion, and verification.

### Refinement Decision Log

The committed repo artifact that preserves the important refinement conversation for a Task.

The Refinement Decision Log summarizes blocking questions, operator answers, alternatives considered, reviewer positions, Product Manager recommendations, operator decisions, and the resulting Execution Contract version. It is not a raw transcript.

Refinement Decision Logs live under `docs/refinement/` and are named by Task ID and slug, for example `docs/refinement/TSK-123-create-intake-drafts.md`.

Every Standard, Complex, and Epic task should have a Refinement Decision Log. Simple tasks need a Refinement Decision Log only when there are blocking questions, reviewer disagreements, or meaningful tradeoffs.

US-003 and issue #95 should be revised separately to remove any implication that GitHub issues are required by default. Issue #95 may remain as an implementation tracker because it already exists, but future workflow should treat GitHub issues as optional.

The Task ID is generated at Intake Draft creation. It anchors intake, refinement threads, Refinement Decision Logs, generated stories, PRs, implementation commits, and evidence. The approved Execution Contract and generated user story are later artifacts of the same Task, not a new identity.

Generated artifact filenames should use Task ID as the primary identifier plus a readable slug, for example `docs/user-stories/TSK-123-create-intake-drafts-from-raw-operator-requirements.md`. Story IDs are reserved for manually curated or legacy stories that require them.

Task IDs should be human-readable and sequential where possible, such as `TSK-123`. Opaque IDs are acceptable as a fallback when distributed or offline creation makes sequencing difficult, but the control plane should keep display aliases short for operator conversations, filenames, and PRs.

Implementation PRs should be titled with both Task ID and generated story title, for example `[TSK-123] Create Intake Drafts From Raw Operator Requirements`. PR bodies should link to the Task, generated user story, Refinement Decision Log, and evidence report paths.

Approved generated user stories are immutable for material changes. Material changes require a new approved Execution Contract version and a generated story version or amendment section that links to the new contract version and Refinement Decision Log. Minor typo fixes are allowed when they do not change meaning.

Implementation evidence reports are required for Standard, Complex, and Epic tasks. Simple tasks require an evidence report only when risk flags exist. Evidence reports summarize commands run, tests, coverage gaps, rollout and rollback notes, docs updated, and deviations from the approved Execution Contract.

Implementation evidence reports live under `docs/reports/` and are named by Task ID and slug, for example `docs/reports/TSK-123-intake-draft-creation-verification.md`.

Use one combined Task-level verification report by default, with sections for test, security, SRE, customer or operator review, and rollout evidence. Create separate reports only when risk, regulation, audience, or Complex/Epic scope justifies them.

The control plane should generate the verification report skeleton at implementation start, prefilled with required evidence from the approved Execution Contract. During delivery, agents fill in actual commands, results, deviations, and links.

Implementation must not start for Standard, Complex, or Epic tasks until the verification report skeleton exists. Simple tasks may skip the skeleton unless risk flags require a report.
