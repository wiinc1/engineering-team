# LangGraph Operations and Emergency Recovery

Deploy migration `020`, the read API, and task-detail rendering with `FF_LANGGRAPH_CONTROLS=false`. After compatibility checks pass, set the flag to true only while `FF_LANGGRAPH_RUNTIME=true` and the global kill switch is false.

At a wait, verify thread ID, interrupt type, checkpoint freshness, authorized role, and next action. Submit accept, reject, or a bounded edit once. A stale or concurrent response returns `langgraph_decision_conflict`; refresh instead of modifying checkpoint rows. Retry is limited to the current eligible failed node and its configured budget. Cancellation waits for exclusive thread ownership, stops subsequent dispatch, routes to terminal evidence, and retains checkpoint and action history.

Emergency procedure:

1. Set `FF_LANGGRAPH_CONTROLS=false` to disable mutations while preserving reads.
2. Set `LANGGRAPH_GLOBAL_KILL_SWITCH=true` to block new invocation/resume.
3. Inspect active leases, stale threads, pending interrupts, and Graphile delivery state.
4. Reconcile the one thread owner before releasing or retrying work. Never edit LangGraph checkpoint rows.
5. Restore controls only after checkpoint storage, worker readiness, and audit/action ledgers agree.

Rollback keeps migration `020` and all history by default. Physical rollback is allowed only when both interrupt and run-action ledgers are empty; the down migration refuses retained interrupt evidence.
