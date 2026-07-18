# LangGraph complete lifecycle

The production lifecycle is one checkpointed graph with the following stable nodes:

`intake -> pm_refinement -> execution_contract -> architect_handoff -> child_execution -> implementation -> qa -> review -> merge_readiness -> deployment -> sre -> closeout`.

QA may route to `fix` and back to `qa` up to the configured maximum. Retryable node failures route back to the same node under a per-node budget. Failure, cancellation, and exhaustion route to `terminal`; they never proceed to review, deployment, or closeout.

Domain code is supplied through lifecycle ports. Ports receive tenant, run, thread, node, attempt, namespace, and an idempotency key, but no LangGraph framework types. Every node emits an exact-once `node_started` and `node_finished` record. Specialist results must state whether work was delegated and name the truthful handler.

Production composition uses `createProductionLifecyclePorts` and the canonical service binding in `lib/task-platform/langgraph-lifecycle-services.js`. Before each node, the binding resolves the tenant-scoped factory run from PostgreSQL `factory_delivery_queue`; forged tenant/run identities, file stores, incomplete handler bundles, or modules outside the application revision fail closed. Intake is the only operation allowed before a canonical task exists. Its start is persisted in the append-only `langgraph_checkpoint.factory_lifecycle_events` ledger; the intake handler must create the task and bind `factory_delivery_queue.task_id` before its finish record. Every later operation requires that task. Task-bound start/finish records also use `task.langgraph_node_started` and `task.langgraph_node_finished` in the canonical audit store with the same stable node-attempt idempotency key. A replay always reconciles a previously written ledger record into canonical task audit history after the task becomes available.

Migration `022_langgraph_lifecycle_events.sql` defines the sanitized run-level evidence ledger, tenant/idempotency uniqueness, task binding, bounded fields, indexes, append-only mutation guards, and data-preserving rollback refusal. The ledger is independent of checkpoint-row retention so lifecycle evidence survives ordinary thread cleanup and application rollback.

The revision-controlled handler module is selected with `LANGGRAPH_LIFECYCLE_SERVICES_MODULE`; enabled API processes refuse startup when it is absent or incomplete. The module factory is loaded at process startup but materialized lazily with the API's canonical PostgreSQL store when the runtime initializes. This prevents a production composition from creating a second audit-store boundary and lets intake task creation, queue binding, lifecycle evidence, and canonical task audit share the deployed store. `lib/task-platform/langgraph-production-handlers.js` is the production composition root: it atomically creates and binds canonical intake, delegates specialist work, requires structured QA/implementation/SRE evidence, collects live GitHub merge-readiness proof, verifies the deployed health response against the exact commit SHA, and closes the canonical task and factory run. Test fixtures are never a production composition root.

Domain operations add idempotent `task.langgraph_domain_operation_completed` records and the corresponding canonical task events. Database transactions contain only indexed PostgreSQL reads and writes; specialist, GitHub, health, and audit calls occur outside row-lock transactions. Intake and closeout lock the factory queue row first so concurrent paths use a consistent lock order.

Child work is validated as a dependency graph. Independent ready children execute concurrently using stable `child:<id>` namespaces; blocked children wait for dependencies. Re-execution uses the same node/child idempotency identity so a checkpoint resume cannot repeat a completed external effect.

The task and audit stores remain canonical. Checkpoint state contains only bounded routing metadata, sanitized artifact references, decisions, attempts, child status, and terminal reason. Raw task rows, prompts, credentials, adapter responses, and deployment payloads are prohibited.

Legacy equivalence is a versioned contract at `config/langgraph-lifecycle-equivalence.v1.json`. It maps every GP-001–GP-027 step exactly once to a graph node and inventories PM, Architect, Jr/Sr/Principal Engineer, QA, SRE, and UX ownership; mandatory governance gates; release evidence; and success/remediation/failure/cancel/restart branches. `npm run langgraph:lifecycle:equivalence` compares the mapping with the canonical manual-step inventory and completed PostgreSQL golden-path evidence and fails on loss, duplication, unknown nodes, or version drift.

The lifecycle remains disabled for production starts until the interrupt/API work, hardening gates, and exclusive cutover stories are complete.
