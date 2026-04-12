const WORKFLOW_THREAD_EVENT_TYPES = new Set([
  'task.workflow_thread_created',
  'task.workflow_thread_reply_added',
  'task.workflow_thread_resolved',
  'task.workflow_thread_reopened',
]);

const WORKFLOW_COMMENT_TYPES = Object.freeze(['question', 'escalation', 'consultation', 'decision', 'note']);
const WORKFLOW_THREAD_STATES = Object.freeze({
  OPEN: 'open',
  RESOLVED: 'resolved',
});

function isWorkflowThreadEventType(eventType) {
  return WORKFLOW_THREAD_EVENT_TYPES.has(eventType);
}

function normalizeCommentType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return WORKFLOW_COMMENT_TYPES.includes(normalized) ? normalized : 'note';
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function defaultNotificationTargets(commentType, blocking) {
  switch (commentType) {
    case 'question':
      return blocking ? ['pm', 'architect'] : ['architect'];
    case 'escalation':
      return ['pm', 'engineer', 'sre'];
    case 'consultation':
      return ['architect', 'engineer'];
    case 'decision':
      return ['pm', 'architect', 'engineer', 'qa'];
    default:
      return blocking ? ['pm', 'architect'] : ['followers'];
  }
}

function deriveWorkflowThreads(history = []) {
  const threads = new Map();
  const ordered = [...history].sort((left, right) => (left.sequence_number || 0) - (right.sequence_number || 0));

  for (const event of ordered) {
    const payload = event.payload || {};

    if (event.event_type === 'task.comment_workflow_recorded') {
      const threadId = payload.thread_id || payload.comment_id || event.event_id;
      const commentType = normalizeCommentType(payload.comment_type);
      const existing = threads.get(threadId) || {
        id: threadId,
        commentType,
        state: WORKFLOW_THREAD_STATES.OPEN,
        blocking: Boolean(payload.blocking),
        title: payload.title || payload.prompt || payload.summary || payload.body || 'Workflow note',
        body: payload.body || payload.summary || '',
        linkedEventId: payload.linked_event_id || null,
        createdAt: event.occurred_at || null,
        createdBy: event.actor_id || null,
        lastUpdatedAt: event.occurred_at || null,
        resolvedAt: null,
        resolvedBy: null,
        notificationTargets: defaultNotificationTargets(commentType, Boolean(payload.blocking)),
        messages: [],
      };
      existing.commentType = commentType;
      existing.blocking = payload.blocking != null ? Boolean(payload.blocking) : existing.blocking;
      existing.title = payload.title || existing.title;
      existing.body = payload.body || payload.summary || existing.body;
      existing.linkedEventId = payload.linked_event_id || existing.linkedEventId;
      existing.lastUpdatedAt = event.occurred_at || existing.lastUpdatedAt;
      existing.notificationTargets = normalizeArray(payload.notification_targets).length
        ? normalizeArray(payload.notification_targets)
        : existing.notificationTargets;
      existing.messages.push({
        id: event.event_id,
        eventType: event.event_type,
        actorId: event.actor_id || null,
        actorType: event.actor_type || null,
        occurredAt: event.occurred_at || null,
        body: payload.body || payload.summary || '',
        linkedEventId: payload.linked_event_id || null,
      });
      threads.set(threadId, existing);
      continue;
    }

    if (!isWorkflowThreadEventType(event.event_type)) continue;

    const threadId = payload.thread_id;
    if (!threadId) continue;
    const commentType = normalizeCommentType(payload.comment_type);
    const existing = threads.get(threadId) || {
      id: threadId,
      commentType,
      state: WORKFLOW_THREAD_STATES.OPEN,
      blocking: Boolean(payload.blocking),
      title: payload.title || payload.body || 'Workflow thread',
      body: payload.body || '',
      linkedEventId: payload.linked_event_id || null,
      createdAt: event.occurred_at || null,
      createdBy: event.actor_id || null,
      lastUpdatedAt: event.occurred_at || null,
      resolvedAt: null,
      resolvedBy: null,
      notificationTargets: normalizeArray(payload.notification_targets).length
        ? normalizeArray(payload.notification_targets)
        : defaultNotificationTargets(commentType, Boolean(payload.blocking)),
      messages: [],
    };

    existing.commentType = commentType || existing.commentType;
    existing.blocking = payload.blocking != null ? Boolean(payload.blocking) : existing.blocking;
    existing.linkedEventId = payload.linked_event_id || existing.linkedEventId;
    existing.lastUpdatedAt = event.occurred_at || existing.lastUpdatedAt;
    existing.notificationTargets = normalizeArray(payload.notification_targets).length
      ? normalizeArray(payload.notification_targets)
      : existing.notificationTargets;

    switch (event.event_type) {
      case 'task.workflow_thread_created':
        existing.state = WORKFLOW_THREAD_STATES.OPEN;
        existing.title = payload.title || existing.title;
        existing.body = payload.body || existing.body;
        existing.createdAt = event.occurred_at || existing.createdAt;
        existing.createdBy = event.actor_id || existing.createdBy;
        break;
      case 'task.workflow_thread_reply_added':
        break;
      case 'task.workflow_thread_resolved':
        existing.state = WORKFLOW_THREAD_STATES.RESOLVED;
        existing.resolvedAt = event.occurred_at || existing.resolvedAt;
        existing.resolvedBy = event.actor_id || existing.resolvedBy;
        break;
      case 'task.workflow_thread_reopened':
        existing.state = WORKFLOW_THREAD_STATES.OPEN;
        existing.resolvedAt = null;
        existing.resolvedBy = null;
        break;
      default:
        break;
    }

    existing.messages.push({
      id: event.event_id,
      eventType: event.event_type,
      actorId: event.actor_id || null,
      actorType: event.actor_type || null,
      occurredAt: event.occurred_at || null,
      body: payload.body || payload.resolution || payload.title || '',
      linkedEventId: payload.linked_event_id || null,
    });
    threads.set(threadId, existing);
  }

  const items = [...threads.values()].sort((left, right) => {
    const leftPinned = left.blocking && left.state !== WORKFLOW_THREAD_STATES.RESOLVED ? 1 : 0;
    const rightPinned = right.blocking && right.state !== WORKFLOW_THREAD_STATES.RESOLVED ? 1 : 0;
    if (leftPinned !== rightPinned) return rightPinned - leftPinned;
    return String(right.lastUpdatedAt || '').localeCompare(String(left.lastUpdatedAt || ''));
  });

  return {
    items,
    summary: {
      total: items.length,
      unresolvedCount: items.filter((item) => item.state !== WORKFLOW_THREAD_STATES.RESOLVED).length,
      unresolvedBlockingCount: items.filter((item) => item.blocking && item.state !== WORKFLOW_THREAD_STATES.RESOLVED).length,
      resolvedCount: items.filter((item) => item.state === WORKFLOW_THREAD_STATES.RESOLVED).length,
    },
  };
}

module.exports = {
  WORKFLOW_COMMENT_TYPES,
  WORKFLOW_THREAD_EVENT_TYPES,
  WORKFLOW_THREAD_STATES,
  defaultNotificationTargets,
  deriveWorkflowThreads,
  isWorkflowThreadEventType,
  normalizeCommentType,
  normalizeArray,
};
