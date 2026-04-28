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
