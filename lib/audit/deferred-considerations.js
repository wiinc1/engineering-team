const { StandardHttpError } = require('../http/standard');

const DEFERRED_CONSIDERATION_POLICY_VERSION = 'deferred-considerations.v1';

const DEFERRED_CONSIDERATION_STATUSES = Object.freeze([
  'captured',
  'reviewed',
  'promoted',
  'closed_no_action',
]);

const OPEN_DEFERRED_CONSIDERATION_STATUSES = new Set(['captured', 'reviewed']);

const DEFERRED_CONSIDERATION_EVENT_TYPES = new Set([
  'task.deferred_consideration_captured',
  'task.deferred_consideration_reviewed',
  'task.deferred_consideration_promoted',
  'task.deferred_consideration_closed',
]);

const REVIEW_ACTIONS = Object.freeze(['leave_deferred', 'convert_blocker']);
const BLOCKER_CONVERSION_TYPES = Object.freeze([
  'refinement_blocking_question',
  'operator_decision_required_exception',
]);

function deferredError(statusCode, code, message, details) {
  return new StandardHttpError(statusCode, code, message, details);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeOptionalText(value) {
  const text = normalizeText(value);
  return text || null;
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeText(entry))
      .filter(Boolean);
  }
  return String(value || '')
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function latestExecutionContractVersion(history = []) {
  const latest = [...history]
    .filter((event) => event?.event_type === 'task.execution_contract_version_recorded')
    .sort((left, right) => Number(right.sequence_number || 0) - Number(left.sequence_number || 0))[0];
  return Number(latest?.payload?.contract?.version || latest?.payload?.version) || null;
}

function normalizeDeferredConsiderationInput(body = {}, {
  taskId,
  history = [],
  considerationId = null,
  actorId = null,
  capturedAt = null,
} = {}) {
  const title = normalizeText(firstDefined(body.title, body.name, body.summary));
  const knownContext = normalizeText(firstDefined(body.known_context, body.knownContext, body.context));
  const rationale = normalizeText(firstDefined(body.rationale, body.deferral_rationale, body.deferralRationale));
  const sourceSection = normalizeText(firstDefined(body.source_section, body.sourceSection, body.source));
  const sourceComment = normalizeOptionalText(firstDefined(body.source_comment, body.sourceComment, body.comment));
  const sourceAgent = normalizeOptionalText(firstDefined(body.source_agent, body.sourceAgent, body.agent));
  const owner = normalizeText(firstDefined(body.owner, body.owner_id, body.ownerId));
  const revisitTrigger = normalizeOptionalText(firstDefined(body.revisit_trigger, body.revisitTrigger));
  const revisitDate = normalizeOptionalText(firstDefined(body.revisit_date, body.revisitDate));
  const openQuestions = normalizeArray(firstDefined(body.open_questions, body.openQuestions));
  const missingFields = [];

  if (!title) missingFields.push('title');
  if (!knownContext) missingFields.push('known_context');
  if (!rationale) missingFields.push('rationale');
  if (!sourceSection) missingFields.push('source_section');
  if (!sourceComment && !sourceAgent) missingFields.push('source_comment_or_source_agent');
  if (!owner) missingFields.push('owner');
  if (!revisitTrigger && !revisitDate) missingFields.push('revisit_trigger_or_revisit_date');

  if (missingFields.length) {
    throw deferredError(
      400,
      'missing_deferred_consideration_fields',
      'Deferred Considerations require title, known context, deferral rationale, source, owner, and a revisit trigger or date.',
      { missing_fields: missingFields },
    );
  }

  return {
    deferred_consideration_id: considerationId || normalizeOptionalText(firstDefined(body.id, body.deferred_consideration_id, body.deferredConsiderationId)),
    task_id: taskId,
    source_task_id: taskId,
    source_execution_contract_version: Number(firstDefined(body.source_execution_contract_version, body.sourceExecutionContractVersion)) || latestExecutionContractVersion(history),
    title,
    known_context: knownContext,
    rationale,
    source_section: sourceSection,
    source_comment: sourceComment,
    source_agent: sourceAgent,
    owner,
    revisit_trigger: revisitTrigger,
    revisit_date: revisitDate,
    open_questions: openQuestions,
    status: 'captured',
    captured_at: capturedAt,
    captured_by: actorId,
    policy_version: DEFERRED_CONSIDERATION_POLICY_VERSION,
  };
}

function normalizeDeferredConsiderationReview(body = {}) {
  const action = normalizeText(firstDefined(body.action, body.review_action, body.reviewAction, 'leave_deferred')).toLowerCase();
  if (!REVIEW_ACTIONS.includes(action)) {
    throw deferredError(400, 'invalid_deferred_consideration_review_action', 'Deferred Consideration review action must leave it deferred or convert a blocker.', {
      allowed_actions: REVIEW_ACTIONS,
    });
  }

  const blockingCurrentProgress = Boolean(firstDefined(body.blocking_current_progress, body.blockingCurrentProgress, false));
  const conversionType = normalizeText(firstDefined(body.conversion_type, body.conversionType)).toLowerCase();
  if (blockingCurrentProgress && !BLOCKER_CONVERSION_TYPES.includes(conversionType)) {
    throw deferredError(409, 'deferred_consideration_blocker_requires_conversion', 'A Deferred Consideration that blocks current progress must be converted into a blocking refinement question or operator_decision_required exception.', {
      allowed_conversion_types: BLOCKER_CONVERSION_TYPES,
    });
  }
  if (action === 'convert_blocker' && !BLOCKER_CONVERSION_TYPES.includes(conversionType)) {
    throw deferredError(400, 'invalid_deferred_consideration_conversion_type', 'Blocker conversion type must be refinement_blocking_question or operator_decision_required_exception.', {
      allowed_conversion_types: BLOCKER_CONVERSION_TYPES,
    });
  }

  return {
    action,
    status: 'reviewed',
    review_note: normalizeOptionalText(firstDefined(body.review_note, body.reviewNote, body.note)),
    blocking_current_progress: blockingCurrentProgress || action === 'convert_blocker',
    conversion_type: conversionType || null,
    owner: normalizeOptionalText(firstDefined(body.owner, body.owner_id, body.ownerId)),
    revisit_trigger: normalizeOptionalText(firstDefined(body.revisit_trigger, body.revisitTrigger)),
    revisit_date: normalizeOptionalText(firstDefined(body.revisit_date, body.revisitDate)),
    open_questions: normalizeArray(firstDefined(body.open_questions, body.openQuestions)),
    policy_version: DEFERRED_CONSIDERATION_POLICY_VERSION,
  };
}

function normalizeDeferredConsiderationClose(body = {}) {
  const rationale = normalizeText(firstDefined(body.rationale, body.close_rationale, body.closeRationale, body.reason));
  if (!rationale) {
    throw deferredError(400, 'missing_deferred_consideration_close_rationale', 'Closing a Deferred Consideration with no action requires rationale.');
  }
  return {
    status: 'closed_no_action',
    rationale,
    policy_version: DEFERRED_CONSIDERATION_POLICY_VERSION,
  };
}

function normalizePromoteBody(body = {}) {
  return {
    title: normalizeOptionalText(body.title),
    priority: normalizeOptionalText(body.priority),
    task_type: normalizeOptionalText(firstDefined(body.task_type, body.taskType)) || 'deferred_consideration_intake',
    open_questions: normalizeArray(firstDefined(body.open_questions, body.openQuestions)),
    promotion_note: normalizeOptionalText(firstDefined(body.promotion_note, body.promotionNote, body.note)),
    idempotency_key: normalizeOptionalText(firstDefined(body.idempotencyKey, body.idempotency_key)),
    actor_type: normalizeOptionalText(body.actorType) || 'user',
  };
}

function isDeferredConsiderationEventType(eventType) {
  return DEFERRED_CONSIDERATION_EVENT_TYPES.has(eventType);
}

function cloneConsideration(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}

function eventConsiderationId(event) {
  return normalizeText(
    event?.payload?.deferred_consideration_id
      || event?.payload?.deferred_consideration?.deferred_consideration_id
      || event?.payload?.deferred_consideration?.id
      || event?.payload?.id,
  );
}

function deriveDeferredConsiderations(history = []) {
  const itemsById = new Map();
  const ordered = [...history].sort((left, right) => Number(left.sequence_number || 0) - Number(right.sequence_number || 0));

  for (const event of ordered) {
    if (!isDeferredConsiderationEventType(event?.event_type)) continue;
    const payload = event.payload || {};
    const id = eventConsiderationId(event);
    if (!id) continue;

    if (event.event_type === 'task.deferred_consideration_captured') {
      const source = payload.deferred_consideration || payload;
      itemsById.set(id, {
        id,
        deferred_consideration_id: id,
        task_id: source.task_id || event.task_id,
        source_task_id: source.source_task_id || event.task_id,
        source_execution_contract_version: source.source_execution_contract_version || null,
        title: source.title || id,
        known_context: source.known_context || null,
        rationale: source.rationale || null,
        source_section: source.source_section || null,
        source_comment: source.source_comment || null,
        source_agent: source.source_agent || null,
        owner: source.owner || null,
        revisit_trigger: source.revisit_trigger || null,
        revisit_date: source.revisit_date || null,
        open_questions: Array.isArray(source.open_questions) ? [...source.open_questions] : [],
        status: 'captured',
        captured_at: event.occurred_at || source.captured_at || null,
        captured_by: event.actor_id || source.captured_by || null,
        reviewed_at: null,
        reviewed_by: null,
        review_note: null,
        blocking_current_progress: false,
        conversion_type: null,
        promotion_link: null,
        promoted_intake_task_id: null,
        closed_at: null,
        closed_by: null,
        close_rationale: null,
        policy_version: source.policy_version || DEFERRED_CONSIDERATION_POLICY_VERSION,
        history: [],
      });
    }

    const existing = itemsById.get(id);
    if (!existing) continue;
    existing.history.push({
      event_id: event.event_id,
      event_type: event.event_type,
      occurred_at: event.occurred_at || null,
      actor_id: event.actor_id || null,
    });

    if (event.event_type === 'task.deferred_consideration_reviewed') {
      existing.status = 'reviewed';
      existing.reviewed_at = event.occurred_at || null;
      existing.reviewed_by = event.actor_id || null;
      existing.review_note = payload.review_note || existing.review_note;
      existing.blocking_current_progress = Boolean(payload.blocking_current_progress);
      existing.conversion_type = payload.conversion_type || existing.conversion_type;
      existing.owner = payload.owner || existing.owner;
      existing.revisit_trigger = payload.revisit_trigger || existing.revisit_trigger;
      existing.revisit_date = payload.revisit_date || existing.revisit_date;
      if (Array.isArray(payload.open_questions) && payload.open_questions.length) {
        existing.open_questions = payload.open_questions;
      }
    } else if (event.event_type === 'task.deferred_consideration_promoted') {
      existing.status = 'promoted';
      existing.promoted_at = event.occurred_at || null;
      existing.promoted_by = event.actor_id || null;
      existing.promoted_intake_task_id = payload.promoted_intake_task_id || payload.promotion_link?.task_id || null;
      existing.promotion_link = payload.promotion_link || (existing.promoted_intake_task_id ? { task_id: existing.promoted_intake_task_id } : null);
      existing.promotion_note = payload.promotion_note || null;
    } else if (event.event_type === 'task.deferred_consideration_closed') {
      existing.status = 'closed_no_action';
      existing.closed_at = event.occurred_at || null;
      existing.closed_by = event.actor_id || null;
      existing.close_rationale = payload.rationale || payload.close_rationale || null;
    }
  }

  const items = [...itemsById.values()].sort((left, right) => {
    const leftOpen = OPEN_DEFERRED_CONSIDERATION_STATUSES.has(left.status) ? 1 : 0;
    const rightOpen = OPEN_DEFERRED_CONSIDERATION_STATUSES.has(right.status) ? 1 : 0;
    if (leftOpen !== rightOpen) return rightOpen - leftOpen;
    return String(right.reviewed_at || right.captured_at || '').localeCompare(String(left.reviewed_at || left.captured_at || ''));
  });
  const unresolved = items.filter((item) => OPEN_DEFERRED_CONSIDERATION_STATUSES.has(item.status));

  return {
    items,
    unresolved,
    summary: {
      total: items.length,
      unresolved_count: unresolved.length,
      captured_count: items.filter((item) => item.status === 'captured').length,
      reviewed_count: items.filter((item) => item.status === 'reviewed').length,
      promoted_count: items.filter((item) => item.status === 'promoted').length,
      closed_no_action_count: items.filter((item) => item.status === 'closed_no_action').length,
      blocking_current_progress_count: unresolved.filter((item) => item.blocking_current_progress).length,
      policy_version: DEFERRED_CONSIDERATION_POLICY_VERSION,
    },
  };
}

function compactDeferredConsiderationForApproval(item) {
  return {
    id: item.id || item.deferred_consideration_id,
    title: item.title,
    status: item.status,
    scope_status: 'not_in_current_scope',
    source_section: item.source_section || null,
    rationale: item.rationale || null,
    revisit_trigger: item.revisit_trigger || null,
    revisit_date: item.revisit_date || null,
  };
}

function closeoutProjectionFromDeferredConsiderations(projection = deriveDeferredConsiderations()) {
  return {
    policy_version: DEFERRED_CONSIDERATION_POLICY_VERSION,
    unresolved_count: projection.summary.unresolved_count,
    blocks_qa_verification: false,
    blocks_operator_closeout: false,
    available_actions: ['leave_deferred', 'promote_to_intake_draft', 'close_no_action'],
    unresolved: projection.unresolved.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      owner: item.owner,
      revisit_trigger: item.revisit_trigger,
      revisit_date: item.revisit_date,
      source_section: item.source_section,
      actions: ['leave_deferred', 'promote_to_intake_draft', 'close_no_action'],
    })),
  };
}

function buildPromotedIntakeRawRequirements(consideration, sourceTask = {}, body = {}) {
  const openQuestions = [
    ...(Array.isArray(consideration.open_questions) ? consideration.open_questions : []),
    ...(Array.isArray(body.open_questions) ? body.open_questions : []),
  ];
  return [
    `Deferred Consideration promotion from ${consideration.source_task_id || sourceTask.task_id || 'source task'}.`,
    '',
    `Source Task ID: ${consideration.source_task_id || sourceTask.task_id || ''}`,
    `Source Execution Contract Version: ${consideration.source_execution_contract_version || 'not recorded'}`,
    `Deferred Consideration ID: ${consideration.id || consideration.deferred_consideration_id}`,
    `Title: ${consideration.title}`,
    '',
    'Known context:',
    consideration.known_context || 'No known context recorded.',
    '',
    'Rationale for deferring:',
    consideration.rationale || 'No rationale recorded.',
    '',
    'Open questions:',
    openQuestions.length ? openQuestions.map((entry) => `- ${entry}`).join('\n') : '- None recorded.',
    '',
    body.promotion_note ? `Promotion note:\n${body.promotion_note}` : '',
  ].filter((entry) => entry !== '').join('\n');
}

function cloneDeferredConsideration(item) {
  return cloneConsideration(item);
}

module.exports = {
  BLOCKER_CONVERSION_TYPES,
  DEFERRED_CONSIDERATION_EVENT_TYPES,
  DEFERRED_CONSIDERATION_POLICY_VERSION,
  DEFERRED_CONSIDERATION_STATUSES,
  OPEN_DEFERRED_CONSIDERATION_STATUSES,
  REVIEW_ACTIONS,
  buildPromotedIntakeRawRequirements,
  cloneDeferredConsideration,
  closeoutProjectionFromDeferredConsiderations,
  compactDeferredConsiderationForApproval,
  deriveDeferredConsiderations,
  isDeferredConsiderationEventType,
  normalizeDeferredConsiderationClose,
  normalizeDeferredConsiderationInput,
  normalizeDeferredConsiderationReview,
  normalizePromoteBody,
};
