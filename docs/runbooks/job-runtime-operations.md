# Job Runtime Operator Runbook

1. Open **Autonomous delivery metrics → Job runtime operations**.
2. Enter the delivery UUID and inspect status, attempts, last stable error, and prior operator actions.
3. For a failed or redelivery-pending job, record a specific recovery reason and choose **Retry** or **Requeue**.
4. Cancel only jobs for which the control is enabled. Running jobs are deliberately protected from cancellation because Graphile may hold a live lock.
5. If an action reports `job_action_conflict`, refresh the job and use the new `operatorVersion`; do not blindly repeat an old request.
6. Use drain for planned maintenance or incident containment. Drain stops new claims and gives active work the configured graceful shutdown interval.

Every action must include a unique idempotency key. Repeating the same key returns the recorded outcome and does not call Graphile Worker again. Escalate `job_runtime_unavailable` after checking database health, worker readiness, and pool saturation. Do not query or update the Graphile schema directly.

Rollback: stop operator traffic, verify the action ledger is empty, apply `019_job_runtime_operations.down.sql`, and deploy the prior application version. The rollback refuses to discard existing action history.
