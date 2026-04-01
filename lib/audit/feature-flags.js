function isAuditFoundationEnabled(options = {}) {
  if (typeof options.auditFoundationEnabled === 'boolean') return options.auditFoundationEnabled;
  const raw = options.ffAuditFoundation ?? process.env.FF_AUDIT_FOUNDATION;
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(String(raw).trim().toLowerCase());
}

function assertAuditFoundationEnabled(options = {}) {
  if (!isAuditFoundationEnabled(options)) {
    const error = new Error('Audit foundation is disabled by ff_audit_foundation');
    error.code = 'feature_disabled';
    error.statusCode = 503;
    error.details = { feature: 'ff_audit_foundation' };
    throw error;
  }
}

module.exports = {
  isAuditFoundationEnabled,
  assertAuditFoundationEnabled,
};
