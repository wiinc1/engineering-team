'use strict';

const REVIEW_EVENT = 'task.pm_architect_human_review_recorded';
const APPROVAL_EVENT = 'task.execution_contract_approved';

function historyItems(body = {}) {
  const value = body?.data?.items || body?.items || body?.data || body;
  return Array.isArray(value) ? value : [];
}

function eventValue(event, snake, camel) {
  return event?.[snake] || event?.[camel] || null;
}

function roleProvenance(review, event) {
  return {
    actorId: review?.actorId || review?.actor_id || eventValue(event, 'actor_id', 'actorId'),
    actorType: review?.actorType || review?.actor_type || eventValue(event, 'actor_type', 'actorType'),
    reviewedAt: review?.reviewedAt || review?.reviewed_at || eventValue(event, 'occurred_at', 'occurredAt'),
    eventId: eventValue(event, 'event_id', 'eventId'),
  };
}

function extractFactoryApprovalProvenance(historyBody = {}) {
  const entries = historyItems(historyBody);
  const reviewEvent = entries.find((entry) => eventValue(entry, 'event_type', 'eventType') === REVIEW_EVENT);
  const approvalEvent = entries.find((entry) => eventValue(entry, 'event_type', 'eventType') === APPROVAL_EVENT);
  const reviews = reviewEvent?.payload?.reviews || reviewEvent?.payload?.human_reviews || {};
  return {
    policyVersion: 'factory-closeout-approval-provenance.v1',
    humanReview: reviewEvent ? {
      eventId: eventValue(reviewEvent, 'event_id', 'eventId'),
      eventType: REVIEW_EVENT,
      recordedAt: eventValue(reviewEvent, 'occurred_at', 'occurredAt'),
      roles: {
        pm: roleProvenance(reviews.pm, reviewEvent),
        architect: roleProvenance(reviews.architect, reviewEvent),
      },
    } : null,
    approval: approvalEvent ? {
      eventId: eventValue(approvalEvent, 'event_id', 'eventId'),
      eventType: APPROVAL_EVENT,
      approvedAt: eventValue(approvalEvent, 'occurred_at', 'occurredAt'),
      actorId: eventValue(approvalEvent, 'actor_id', 'actorId'),
      actorType: eventValue(approvalEvent, 'actor_type', 'actorType'),
      approvalMode: approvalEvent.payload?.approval_mode || approvalEvent.payload?.approvalMode || null,
    } : null,
  };
}

async function attachFactoryApprovalProvenance(response, { ctx, taskId, apiSend }) {
  const history = await apiSend(
    ctx, `/tasks/${encodeURIComponent(taskId)}/history?limit=500`, 'GET', ['reader', 'pm'],
  );
  const provenance = extractFactoryApprovalProvenance(history.ok ? history.body : {});
  const data = response?.body?.data;
  if (!data || typeof data !== 'object') return response;
  const policy = data.autoApprovalPolicy && typeof data.autoApprovalPolicy === 'object'
    ? data.autoApprovalPolicy : {};
  data.autoApprovalPolicy = { ...policy, auditProvenance: provenance };
  return response;
}

function requiresHumanReview(ctx, options, contractBody) {
  return ctx.agentDrivenPhase1
    || options.agentDrivenPhases === true
    || contractBody.require_human_pm_architect_review === true;
}

async function recordGoldenPathHumanReview({
  ctx, options, contractBody, taskId, api, apiSend, runProjectionCatchUp,
}) {
  api.projectionPostContract = await runProjectionCatchUp(ctx, 'execution-contract-recorded');
  if (!requiresHumanReview(ctx, options, contractBody)) return;
  api.humanPmArchitectReview = await apiSend(
    ctx,
    `/api/v1/tasks/${encodeURIComponent(taskId)}/execution-contract/human-pm-architect-review`,
    'POST',
    ['pm', 'operator', 'admin', 'reader'],
    {
      role: 'both',
      reason: 'Supervised human acceptance of agent-authored PM/Architect proposals (Q6 / factory proof).',
      actorType: 'human',
      actorId: ctx.actorId || 'factory-operator',
    },
  );
  if (!api.humanPmArchitectReview.ok) {
    throw new Error(
      `Human PM/Architect review failed (${api.humanPmArchitectReview.status}): `
      + `${JSON.stringify(api.humanPmArchitectReview.body)}`,
    );
  }
  api.projectionPostHumanReview = await runProjectionCatchUp(ctx, 'pm-architect-human-review-recorded');
}

module.exports = {
  recordGoldenPathHumanReview,
  requiresHumanReview,
  extractFactoryApprovalProvenance,
  attachFactoryApprovalProvenance,
};
