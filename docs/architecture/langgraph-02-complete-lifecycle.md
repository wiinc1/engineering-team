# LangGraph complete lifecycle

The production lifecycle is one checkpointed graph with the following stable nodes:

`intake -> pm_refinement -> execution_contract -> architect_handoff -> child_execution -> implementation -> qa -> review -> merge_readiness -> deployment -> sre -> closeout`.

QA may route to `fix` and back to `qa` up to the configured maximum. Retryable node failures route back to the same node under a per-node budget. Failure, cancellation, and exhaustion route to `terminal`; they never proceed to review, deployment, or closeout.

Domain code is supplied through lifecycle ports. Ports receive tenant, run, thread, node, attempt, namespace, and an idempotency key, but no LangGraph framework types. Every node emits a canonical `node_started` and `node_finished` record. Specialist results must state whether work was delegated and name the truthful handler.

Child work is validated as a dependency graph. Independent ready children execute concurrently using stable `child:<id>` namespaces; blocked children wait for dependencies. Re-execution uses the same node/child idempotency identity so a checkpoint resume cannot repeat a completed external effect.

The task and audit stores remain canonical. Checkpoint state contains only bounded routing metadata, sanitized artifact references, decisions, attempts, child status, and terminal reason. Raw task rows, prompts, credentials, adapter responses, and deployment payloads are prohibited.

The lifecycle remains disabled for production starts until the interrupt/API work, hardening gates, and exclusive cutover stories are complete.
