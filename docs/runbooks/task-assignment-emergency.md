# Emergency Runbook — Task Assignment Kill Switch

## Kill switch
- Flag: `ff_assign-ai-agent-to-task_killswitch`
- Owners: On-call engineer, Product Manager, CTO
- SLA: disable within 2 minutes of decision

## Symptoms requiring kill switch
- Assignment attempts corrupt ownership data
- Error rate spikes above rollback threshold
- Unauthorized ownership changes are detected
- Task queues become inconsistent after assignment changes

## Command / dashboard action
- Set `ff_assign-ai-agent-to-task` to 0%
- If impact persists, enable global kill switch `ff_assign-ai-agent-to-task_killswitch`

## Notification steps
1. Notify `#incidents`
2. Notify `#engineering-updates`
3. Link affected issue/PR and dashboard
4. Record incident timeline in post-mortem doc

## Post-mortem template
- Summary
- Customer impact
- Root cause
- Detection gap
- Corrective actions
- Follow-up owner and due date
