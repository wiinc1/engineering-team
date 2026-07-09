const RECOVERABLE_QUEUE_STAGES = Object.freeze(['queued', 'intake_complete', 'phase1_complete', 'phase6_complete']);
const DEFAULT_QUEUE_RETRY_BASE_SECONDS = 30;
const DEFAULT_QUEUE_MAX_ATTEMPTS = 5;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function retryDelaySeconds(attempts, baseSeconds) {
  return Math.min(15 * 60, positiveInteger(baseSeconds, DEFAULT_QUEUE_RETRY_BASE_SECONDS) * attempts);
}

function recoverableFailedStage(item = {}) {
  const stage = String(item._queueLease?.claimedStage || item.stage || '').trim();
  return RECOVERABLE_QUEUE_STAGES.includes(stage) ? stage : 'queued';
}

function releaseMetadata(claimedItem, nextItem, outcome, deadLetter, attempts) {
  const claimedRealDelivery = claimedItem.metadata?.realDelivery || {};
  const nextRealDelivery = nextItem.metadata?.realDelivery || {};
  const metadata = {
    ...(claimedItem.metadata || {}),
    ...(nextItem.metadata || {}),
    lastOutcomeAction: outcome.action || null,
  };
  if (Object.keys(claimedRealDelivery).length || Object.keys(nextRealDelivery).length) {
    metadata.realDelivery = {
      ...claimedRealDelivery,
      ...nextRealDelivery,
    };
  }
  if (!deadLetter) return metadata;
  metadata.deadLetter = {
    ...(claimedItem.metadata?.deadLetter || {}),
    ...(nextItem.metadata?.deadLetter || {}),
    failedStage: recoverableFailedStage(claimedItem),
    failedAction: outcome.action || null,
    failureAttempts: attempts,
  };
  return metadata;
}

function releaseParamsForOutcome(claim, outcome = {}, config = {}) {
  const claimedItem = claim.item || {};
  const nextItem = outcome.item || claimedItem;
  const workerId = claimedItem._queueLease?.workerId || config.workerId;
  const lockedAt = claimedItem._queueLease?.lockedAt || claimedItem.lockedAt || null;
  const currentAttempts = Number(claimedItem._queueLease?.attempts ?? claimedItem.attempts ?? 0);
  const maxAttempts = positiveInteger(
    config.factoryQueueMaxAttempts || claimedItem._queueLease?.maxAttempts || claimedItem.maxAttempts,
    DEFAULT_QUEUE_MAX_ATTEMPTS,
  );
  const errorMessage = outcome.error?.message || (outcome.action === 'error' ? nextItem.lastError : null) || null;
  const attempts = errorMessage ? currentAttempts + 1 : 0;
  const deadLetter = Boolean(errorMessage && attempts >= maxAttempts);
  const nextStage = deadLetter
    ? 'dead_letter'
    : errorMessage
    ? claimedItem._queueLease?.claimedStage || claimedItem.stage
    : nextItem.stage;
  return {
    params: [
      claimedItem.tenantId || config.tenantId,
      claimedItem.id,
      workerId,
      nextStage,
      nextItem.taskId || null,
      nextItem.projectId || null,
      nextItem.projectName || null,
      nextItem.evidencePath || null,
      nextItem.persistDir || null,
      nextItem.forgeTaskId || null,
      nextItem.evidenceStatus || null,
      outcome.action || nextItem.lastAction || null,
      errorMessage,
      attempts,
      retryDelaySeconds(attempts || 1, config.factoryQueueRetryBaseSeconds),
      deadLetter,
      nextStage === 'completed',
      JSON.stringify(releaseMetadata(claimedItem, nextItem, outcome, deadLetter, attempts)),
      lockedAt,
    ],
    deadLetter,
    errorMessage,
  };
}

module.exports = {
  RECOVERABLE_QUEUE_STAGES,
  DEFAULT_QUEUE_RETRY_BASE_SECONDS,
  DEFAULT_QUEUE_MAX_ATTEMPTS,
  releaseParamsForOutcome,
};
