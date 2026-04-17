const TASK_LOCK_EVENT_TYPES = new Set([
  'task.lock_acquired',
  'task.lock_released',
  'task.lock_conflict',
]);

const DEFAULT_TASK_LOCK_TTL_SECONDS = 15 * 60;

function isTaskLockEventType(eventType) {
  return TASK_LOCK_EVENT_TYPES.has(eventType);
}

function normalizeTaskLock(state = {}) {
  state = state || {};
  const ownerId = state.lock_owner || null;
  const expiresAt = state.lock_expires_at || null;
  if (!ownerId || !expiresAt) return null;
  return {
    ownerId,
    acquiredAt: state.lock_acquired_at || null,
    expiresAt,
    reason: state.lock_reason || '',
    action: state.lock_action || '',
  };
}

function isLockExpired(lock, now = Date.now()) {
  if (!lock?.expiresAt) return true;
  const expiresAt = Date.parse(lock.expiresAt);
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt <= now;
}

function getActiveTaskLock(state = {}, now = Date.now()) {
  const lock = normalizeTaskLock(state);
  if (!lock) return null;
  return isLockExpired(lock, now) ? null : lock;
}

function createTaskLockPayload({ actorId, reason, action, ttlSeconds = DEFAULT_TASK_LOCK_TTL_SECONDS, now = Date.now() }) {
  const normalizedTtl = Number.isFinite(Number(ttlSeconds)) && Number(ttlSeconds) > 0
    ? Math.min(24 * 60 * 60, Number(ttlSeconds))
    : DEFAULT_TASK_LOCK_TTL_SECONDS;
  const acquiredAt = new Date(now).toISOString();
  return {
    owner_id: actorId,
    reason: String(reason || 'Mutating workflow change in progress.').trim(),
    action: String(action || 'edit').trim(),
    ttl_seconds: normalizedTtl,
    acquired_at: acquiredAt,
    expires_at: new Date(now + (normalizedTtl * 1000)).toISOString(),
  };
}

module.exports = {
  DEFAULT_TASK_LOCK_TTL_SECONDS,
  TASK_LOCK_EVENT_TYPES,
  createTaskLockPayload,
  getActiveTaskLock,
  isLockExpired,
  isTaskLockEventType,
};
