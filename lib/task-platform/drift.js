const DRIFT_REMEDIATION = Object.freeze({
  missing_checkpoint: 'Run npm run task-platform:backfill, then npm run task-platform:verify.',
  version_mismatch: 'Rerun the canonical sync/backfill path for the listed task and inspect task_mutations.',
  stale_projection_sequence: 'Run npm run audit:project, then rerun task-platform verification.',
  inactive_sync_status: 'Inspect task_sync_checkpoints.last_error, fix the failed sync, and rerun backfill.',
});

function toInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeTaskDriftRow(row = {}) {
  return {
    taskId: row.taskId || row.task_id,
    canonicalVersion: toInteger(row.canonicalVersion ?? row.version),
    checkpointVersion: row.checkpointVersion ?? row.canonical_version,
    canonicalAuditSequence: row.canonicalAuditSequence ?? row.last_audit_sequence_number,
    checkpointAuditSequence: row.checkpointAuditSequence ?? row.last_projected_sequence_number,
    syncStatus: row.syncStatus || row.sync_status || null,
    lastError: row.lastError || row.last_error || null,
  };
}

function driftFinding(type, row, details = {}) {
  return {
    type,
    taskId: row.taskId,
    details,
    remediation: DRIFT_REMEDIATION[type],
  };
}

function detectTaskPlatformDrift(rows = []) {
  const findings = [];

  for (const input of rows) {
    const row = normalizeTaskDriftRow(input);
    if (!row.taskId) continue;

    if (row.checkpointVersion == null) {
      findings.push(driftFinding('missing_checkpoint', row, {
        canonicalVersion: row.canonicalVersion,
      }));
      continue;
    }

    const checkpointVersion = toInteger(row.checkpointVersion);
    if (checkpointVersion !== row.canonicalVersion) {
      findings.push(driftFinding('version_mismatch', row, {
        canonicalVersion: row.canonicalVersion,
        checkpointVersion,
      }));
    }

    const canonicalSequence = row.canonicalAuditSequence == null ? null : toInteger(row.canonicalAuditSequence);
    const checkpointSequence = row.checkpointAuditSequence == null ? null : toInteger(row.checkpointAuditSequence);
    if (canonicalSequence != null && checkpointSequence != null && checkpointSequence < canonicalSequence) {
      findings.push(driftFinding('stale_projection_sequence', row, {
        canonicalAuditSequence: canonicalSequence,
        checkpointAuditSequence: checkpointSequence,
      }));
    }

    if (row.syncStatus && !['active', 'synced'].includes(row.syncStatus)) {
      findings.push(driftFinding('inactive_sync_status', row, {
        syncStatus: row.syncStatus,
        lastError: row.lastError,
      }));
    }
  }

  return {
    ok: findings.length === 0,
    total: findings.length,
    findings,
    remediation: [...new Set(findings.map(finding => finding.remediation))],
  };
}

module.exports = {
  DRIFT_REMEDIATION,
  detectTaskPlatformDrift,
  normalizeTaskDriftRow,
};
