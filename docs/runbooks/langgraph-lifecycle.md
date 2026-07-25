# LangGraph lifecycle operations

## Normal execution

1. Verify LangGraph checkpoint health and Graphile worker readiness.
2. Confirm the factory run's canonical tenant, task, derived thread ID, and workflow version.
3. Enqueue `factory.langgraph.start.v1`; never invoke the graph directly from an API route.
4. Inspect sanitized thread summaries, canonical node events, and job-runtime delivery status.

## Retry and recovery

- Retryable failures self-route only while the node budget remains.
- QA failure routes through `fix` and returns to QA; exhaustion becomes `dead_letter`.
- A worker restart resumes from the accepted checkpoint. Do not edit checkpoint rows.
- A failed, cancelled, or dead-letter run is terminal. Create an authorized recovery decision through the operational API supplied by LANGGRAPH-03.

## Emergency response

1. Activate the global LangGraph kill switch to stop new invocation without deleting checkpoints.
2. Drain Graphile claims and verify active leases expire or release.
3. Check for concurrent ownership, missing canonical node evidence, or duplicate-effect alerts.
4. Restore the checkpoint database only through the tested backup/restore procedure, then reconcile registry, checkpoints, canonical task state, and audit events before resuming.

Never fall back to the legacy sequencer, bypass required review gates, or claim specialist delegation without persisted attribution evidence.
