const WORKFLOW_AUDIT_EVENT_TYPES = Object.freeze([
  'task.created',
  'task.refinement_requested',
  'task.intake_creation_failed',
  'task.stage_changed',
  'task.skill_escalation_requested',
  'task.architect_handoff_recorded',
  'task.retiered',
  'task.engineer_submission_recorded',
  'task.check_in_recorded',
  'task.lock_acquired',
  'task.lock_released',
  'task.lock_conflict',
  'task.assigned',
  'task.reassigned',
  'task.unassigned',
  'task.blocked',
  'task.unblocked',
  'task.priority_changed',
  'task.escalated',
  'task.escalation_resolved',
  'task.child_link_added',
  'task.child_link_removed',
  'task.orchestration_evaluated',
  'task.decision_recorded',
  'task.decision_revised',
  'task.comment_workflow_recorded',
  'task.workflow_thread_created',
  'task.workflow_thread_reply_added',
  'task.workflow_thread_resolved',
  'task.workflow_thread_reopened',
  'task.qa_result_recorded',
  'task.review_question_asked',
  'task.review_question_answered',
  'task.review_question_resolved',
  'task.review_question_reopened',
  'task.rollback_recorded',
  'task.ghosting_review_created',
  'task.sre_monitoring_started',
  'task.sre_approval_recorded',
  'task.github_pr_synced',
  'task.github_pr_comment_recorded',
  'task.pm_business_context_completed',
  'task.closed'
]);

function isWorkflowAuditEventType(eventType) {
  return WORKFLOW_AUDIT_EVENT_TYPES.includes(eventType);
}

module.exports = {
  WORKFLOW_AUDIT_EVENT_TYPES,
  isWorkflowAuditEventType,
};
