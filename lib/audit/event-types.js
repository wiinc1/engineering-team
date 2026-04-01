const WORKFLOW_AUDIT_EVENT_TYPES = Object.freeze([
  'task.created',
  'task.stage_changed',
  'task.assigned',
  'task.unassigned',
  'task.blocked',
  'task.unblocked',
  'task.priority_changed',
  'task.escalated',
  'task.escalation_resolved',
  'task.child_link_added',
  'task.child_link_removed',
  'task.decision_recorded',
  'task.decision_revised',
  'task.comment_workflow_recorded',
  'task.rollback_recorded',
  'task.closed'
]);

function isWorkflowAuditEventType(eventType) {
  return WORKFLOW_AUDIT_EVENT_TYPES.includes(eventType);
}

module.exports = {
  WORKFLOW_AUDIT_EVENT_TYPES,
  isWorkflowAuditEventType,
};
