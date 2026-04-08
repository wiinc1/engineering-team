const REVIEW_QUESTION_EVENT_TYPES = new Set([
  'task.review_question_asked',
  'task.review_question_answered',
  'task.review_question_resolved',
  'task.review_question_reopened',
]);

const REVIEW_QUESTION_STATES = Object.freeze({
  OPEN: 'open',
  ANSWERED: 'answered',
  RESOLVED: 'resolved',
});

function isReviewQuestionEventType(eventType) {
  return REVIEW_QUESTION_EVENT_TYPES.has(eventType);
}

function deriveReviewQuestions(history = []) {
  const threads = new Map();
  const ordered = [...history].sort((left, right) => (left.sequence_number || 0) - (right.sequence_number || 0));

  for (const event of ordered) {
    if (!isReviewQuestionEventType(event.event_type)) continue;
    const payload = event.payload || {};
    const questionId = payload.question_id;
    if (!questionId) continue;

    const existing = threads.get(questionId) || {
      id: questionId,
      blocking: Boolean(payload.blocking),
      state: REVIEW_QUESTION_STATES.OPEN,
      createdAt: event.occurred_at || null,
      createdBy: event.actor_id || null,
      prompt: payload.prompt || payload.body || '',
      answer: null,
      resolution: null,
      resolvedAt: null,
      resolvedBy: null,
      lastUpdatedAt: event.occurred_at || null,
      messages: [],
      history: [],
    };

    existing.blocking = payload.blocking != null ? Boolean(payload.blocking) : existing.blocking;
    existing.lastUpdatedAt = event.occurred_at || existing.lastUpdatedAt;

    const message = {
      id: event.event_id,
      eventType: event.event_type,
      actorId: event.actor_id || null,
      actorType: event.actor_type || null,
      occurredAt: event.occurred_at || null,
      body: payload.body || payload.prompt || payload.resolution || '',
      state: payload.state || null,
    };
    existing.messages.push(message);
    existing.history.push({
      id: event.event_id,
      type: event.event_type,
      actorId: event.actor_id || null,
      occurredAt: event.occurred_at || null,
      body: payload.body || payload.prompt || payload.resolution || '',
      state: payload.state || null,
    });

    switch (event.event_type) {
      case 'task.review_question_asked':
        existing.prompt = payload.prompt || payload.body || existing.prompt;
        existing.state = REVIEW_QUESTION_STATES.OPEN;
        existing.answer = null;
        existing.resolution = null;
        existing.resolvedAt = null;
        existing.resolvedBy = null;
        break;
      case 'task.review_question_answered':
        existing.answer = payload.body || existing.answer;
        existing.state = REVIEW_QUESTION_STATES.ANSWERED;
        break;
      case 'task.review_question_resolved':
        existing.resolution = payload.resolution || payload.body || existing.resolution;
        existing.state = REVIEW_QUESTION_STATES.RESOLVED;
        existing.resolvedAt = event.occurred_at || existing.resolvedAt;
        existing.resolvedBy = event.actor_id || existing.resolvedBy;
        break;
      case 'task.review_question_reopened':
        existing.state = REVIEW_QUESTION_STATES.OPEN;
        existing.resolution = null;
        existing.resolvedAt = null;
        existing.resolvedBy = null;
        break;
      default:
        break;
    }

    threads.set(questionId, existing);
  }

  const items = [...threads.values()].sort((left, right) => {
    const leftUnresolved = left.state !== REVIEW_QUESTION_STATES.RESOLVED ? 1 : 0;
    const rightUnresolved = right.state !== REVIEW_QUESTION_STATES.RESOLVED ? 1 : 0;
    if (leftUnresolved !== rightUnresolved) return rightUnresolved - leftUnresolved;
    if (left.blocking !== right.blocking) return Number(right.blocking) - Number(left.blocking);
    return String(right.lastUpdatedAt || '').localeCompare(String(left.lastUpdatedAt || ''));
  });

  const unresolvedBlocking = items.filter((item) => item.blocking && item.state !== REVIEW_QUESTION_STATES.RESOLVED);
  const unresolved = items.filter((item) => item.state !== REVIEW_QUESTION_STATES.RESOLVED);

  return {
    items,
    summary: {
      total: items.length,
      unresolvedCount: unresolved.length,
      unresolvedBlockingCount: unresolvedBlocking.length,
      answeredCount: items.filter((item) => item.state === REVIEW_QUESTION_STATES.ANSWERED).length,
      resolvedCount: items.filter((item) => item.state === REVIEW_QUESTION_STATES.RESOLVED).length,
      blocking: unresolvedBlocking.length > 0,
    },
  };
}

module.exports = {
  REVIEW_QUESTION_EVENT_TYPES,
  REVIEW_QUESTION_STATES,
  isReviewQuestionEventType,
  deriveReviewQuestions,
};