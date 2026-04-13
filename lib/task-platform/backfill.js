async function backfillCanonicalTasks({
  store,
  taskPlatform,
  tenantId,
  logger = null,
  limit = Number.POSITIVE_INFINITY,
} = {}) {
  if (!store || !taskPlatform) {
    throw new Error('store and taskPlatform are required');
  }

  const summaries = await store.listTaskSummaries({ tenantId });
  const results = {
    tenantId,
    scanned: 0,
    synced: 0,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  for (const summary of summaries.slice(0, limit)) {
    results.scanned += 1;
    try {
      const history = await store.getTaskHistory(summary.task_id, {
        tenantId,
        limit: 500,
      });
      const createdEvent = history.find((event) => event.event_type === 'task.created') || null;
      const lastEvent = history[history.length - 1] || null;
      const existing = await taskPlatform.getTask({
        tenantId,
        taskId: summary.task_id,
      });

      await taskPlatform.syncTaskFromProjection({
        tenantId,
        taskId: summary.task_id,
        title: summary.title || createdEvent?.payload?.title || summary.task_id,
        description: createdEvent?.payload?.description || '',
        status: summary.current_stage || 'BACKLOG',
        priority: summary.priority || null,
        ownerAgentId: summary.current_owner || null,
        sourceSystem: 'audit_backfill',
        lastAuditEventId: lastEvent?.event_id || null,
        lastAuditSequenceNumber: lastEvent?.sequence_number || null,
        migrationState: 'backfilled',
        metadata: {
          backfilled_from_audit: true,
          last_backfilled_at: new Date().toISOString(),
        },
      });

      results.synced += 1;
      if (existing) {
        results.updated += 1;
      } else {
        results.created += 1;
      }
    } catch (error) {
      results.failed += 1;
      results.errors.push({
        taskId: summary.task_id,
        message: error.message,
      });
      if (logger?.error) {
        logger.error({
          feature: 'ff_task_platform',
          action: 'canonical_backfill',
          outcome: 'error',
          tenant_id: tenantId,
          task_id: summary.task_id,
          error_message: error.message,
        });
      }
    }
  }

  if (logger?.info) {
    logger.info({
      feature: 'ff_task_platform',
      action: 'canonical_backfill',
      outcome: results.failed ? 'partial' : 'success',
      tenant_id: tenantId,
      scanned: results.scanned,
      synced: results.synced,
      created: results.created,
      updated: results.updated,
      failed: results.failed,
    });
  }

  return results;
}

module.exports = {
  backfillCanonicalTasks,
};
