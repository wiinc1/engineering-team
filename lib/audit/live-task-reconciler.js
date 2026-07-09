const RESTRICTED_DETAIL_KEYS = new Set(['activity', 'auditLog', 'comments', 'context', 'orchestration', 'relations', 'telemetry']);

function compareLiveUpdateVersions(current, incoming) {
  const currentVersion = Number(current?.version ?? current?.payload?.task?.version ?? 0);
  const incomingVersion = Number(incoming?.version ?? incoming?.payload?.task?.version ?? 0);
  if (incomingVersion !== currentVersion) return incomingVersion > currentVersion ? 1 : -1;
  const currentTime = Date.parse(current?.updatedAt || current?.payload?.task?.freshness?.last_updated_at || '');
  const incomingTime = Date.parse(incoming?.updatedAt || incoming?.payload?.task?.freshness?.last_updated_at || '');
  const safeCurrentTime = Number.isFinite(currentTime) ? currentTime : 0;
  const safeIncomingTime = Number.isFinite(incomingTime) ? incomingTime : 0;
  if (safeIncomingTime === safeCurrentTime) return 0;
  return safeIncomingTime > safeCurrentTime ? 1 : -1;
}

function permissionSafeMerge(existing = {}, patch = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (!RESTRICTED_DETAIL_KEYS.has(key)) clean[key] = value;
  }
  return { ...existing, ...clean };
}

function liveUpdateKey(update = {}) {
  const tenantKey = update.tenantId || update.payload?.task?.tenant_id || update.payload?.project?.tenantId || 'default';
  return `${update.entityType}:${tenantKey}:${update.entityId}`;
}

function reconcileLiveUpdates(current = {}, updates = []) {
  const accepted = [];
  const ignored = [];
  const versions = new Map(Object.entries(current.versions || {}));
  for (const update of updates) {
    const key = liveUpdateKey(update);
    const prior = versions.get(key);
    if (prior && compareLiveUpdateVersions(prior, update) <= 0) {
      ignored.push(update);
      continue;
    }
    versions.set(key, update);
    accepted.push(update);
  }
  return { accepted, ignored, versions: Object.fromEntries(versions) };
}

module.exports = {
  compareLiveUpdateVersions,
  liveUpdateKey,
  permissionSafeMerge,
  reconcileLiveUpdates,
};
