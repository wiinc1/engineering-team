'use strict';

const crypto = require('node:crypto');

const ACTOR_ID = 'system:langgraph-runtime';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function assertStore(store) {
  if (store?.kind !== 'postgres' || typeof store?.pool?.query !== 'function'
    || typeof store?.appendEvent !== 'function') {
    throw new Error('Production lifecycle handlers require the canonical PostgreSQL audit store.');
  }
  return store;
}

function normalizeQueueRow(row = {}) {
  return Object.freeze({
    tenantId: row.tenant_id,
    queueId: row.queue_id,
    taskId: row.task_id || null,
    projectId: row.project_id || null,
    title: row.title,
    requirements: row.requirements,
    templateTier: row.template_tier || 'Simple',
    changedFiles: parseJson(row.changed_files, []),
    githubIssueUrl: row.github_issue_url || null,
    metadata: parseJson(row.metadata, {}),
  });
}

async function loadQueueItem(store, run, client = store.pool, lock = false) {
  const result = await client.query(`
    SELECT tenant_id, queue_id, task_id, project_id, title, requirements,
           template_tier, changed_files, github_issue_url, metadata
    FROM factory_delivery_queue
    WHERE tenant_id = $1 AND queue_id = $2
    ${lock ? 'FOR UPDATE' : ''}
  `, [run.tenantId, run.factoryRunId]);
  if (!result.rows[0]) {
    throw Object.assign(new Error('Canonical factory run was not found.'), { code: 'canonical_run_missing' });
  }
  return normalizeQueueRow(result.rows[0]);
}

function intakeIdentity(item) {
  const identity = sha256(`${item.tenantId}:${item.queueId}`).toUpperCase();
  return {
    taskId: `TSK-LG${identity.slice(0, 16)}`,
    projectId: `PRJ-${identity.slice(0, 8)}`,
    projectName: `Factory delivery - ${item.title} [${item.queueId}]`,
  };
}

async function insertProject(client, item, identity) {
  await client.query(`
    INSERT INTO projects (
      tenant_id, project_id, name, summary, status, owner_actor_id, metadata
    ) VALUES ($1,$2,$3,$4,'ACTIVE',$5,$6::jsonb)
    ON CONFLICT (tenant_id, project_id) DO NOTHING
  `, [item.tenantId, identity.projectId, identity.projectName, item.title, ACTOR_ID, JSON.stringify({
    factoryDelivery: true, factoryQueueId: item.queueId, templateTier: item.templateTier,
  })]);
}

async function insertTask(client, item, identity) {
  await client.query(`
    INSERT INTO tasks (
      tenant_id, task_id, title, description, status, priority, project_id,
      source_system, source_of_truth_version, version, migration_state, metadata
    ) VALUES ($1,$2,$3,$4,'DRAFT','P2',$5,'langgraph-runtime',1,1,'active',$6::jsonb)
    ON CONFLICT (tenant_id, task_id) DO NOTHING
  `, [item.tenantId, identity.taskId, item.title, item.requirements, identity.projectId, JSON.stringify({
    factory_delivery: true, factory_queue_id: item.queueId,
    template_tier: item.templateTier, github_issue_url: item.githubIssueUrl,
  })]);
  await client.query(`
    INSERT INTO task_sync_checkpoints (
      tenant_id, task_id, canonical_version, sync_status, last_synced_at
    ) VALUES ($1,$2,1,'active',NOW())
    ON CONFLICT (tenant_id, task_id) DO NOTHING
  `, [item.tenantId, identity.taskId]);
}

async function bindQueue(client, item, identity) {
  await client.query(`
    UPDATE factory_delivery_queue
    SET task_id = $3, project_id = $4, project_name = $5,
        stage = 'intake_complete', last_action = 'langgraph_intake', updated_at = NOW()
    WHERE tenant_id = $1 AND queue_id = $2 AND task_id IS NULL
  `, [item.tenantId, item.queueId, identity.taskId, identity.projectId, identity.projectName]);
  return Object.freeze({ ...item, taskId: identity.taskId, projectId: identity.projectId });
}

async function createIntakeTransaction(store, request) {
  const client = await store.pool.connect();
  try {
    await client.query('BEGIN');
    let item = await loadQueueItem(store, request.run, client, true);
    if (!item.taskId) {
      const identity = intakeIdentity(item);
      await insertProject(client, item, identity);
      await insertTask(client, item, identity);
      item = await bindQueue(client, item, identity);
    }
    await client.query('COMMIT');
    return item;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function recordTaskCreated(store, request, item) {
  await store.appendEvent({
    tenantId: item.tenantId, taskId: item.taskId, eventType: 'task.created',
    actorId: ACTOR_ID, actorType: 'system',
    idempotencyKey: `${request.lifecycle.threadId}:intake:task-created`,
    correlationId: request.lifecycle.threadId, source: 'langgraph-runtime',
    payload: {
      title: item.title, business_context: item.requirements, priority: 'P2',
      task_type: 'software_factory_delivery', initial_stage: 'DRAFT',
      project_id: item.projectId, factory_run_id: item.queueId,
    },
  });
}

async function createIntake(store, request) {
  const item = await createIntakeTransaction(store, request);
  await recordTaskCreated(store, request, item);
  return item;
}

async function closeRun(store, request) {
  const client = await store.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM factory_delivery_queue WHERE tenant_id = $1 AND queue_id = $2 FOR UPDATE', [request.run.tenantId, request.run.factoryRunId]);
    await client.query(`UPDATE tasks SET status = 'CLOSED', closed_at = COALESCE(closed_at, NOW()),
      version = version + CASE WHEN status = 'CLOSED' THEN 0 ELSE 1 END, updated_at = NOW()
      WHERE tenant_id = $1 AND task_id = $2`, [request.run.tenantId, request.run.taskId]);
    await client.query(`UPDATE factory_delivery_queue
      SET stage = 'completed', completed_at = COALESCE(completed_at, NOW()),
          last_action = 'langgraph_closeout', last_error = NULL, updated_at = NOW()
      WHERE tenant_id = $1 AND queue_id = $2`, [request.run.tenantId, request.run.factoryRunId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function createQueueRepository(store) {
  return Object.freeze({
    createIntake: request => createIntake(store, request),
    get: (run, client, lock) => loadQueueItem(store, run, client, lock),
    close: request => closeRun(store, request),
  });
}

module.exports = { assertStore, createQueueRepository, normalizeQueueRow };
