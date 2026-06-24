const {
  generateSequentialTaskId,
  makeOpaqueTaskId,
  maxSequentialFromTaskIds,
  TASK_ID_SEQUENCE_MAX,
} = require('../task-platform/task-id');

async function allocateProductionTaskId({
  taskPlatform = null,
  tenantId = null,
  store = null,
} = {}) {
  const ids = [];

  if (taskPlatform && typeof taskPlatform.listTasks === 'function' && tenantId) {
    const tasks = await taskPlatform.listTasks({ tenantId });
    for (const task of tasks || []) {
      ids.push(task.taskId || task.task_id);
    }
  }

  if (store && typeof store.listTaskSummaries === 'function' && tenantId) {
    const summaries = await store.listTaskSummaries({ tenantId });
    for (const summary of summaries || []) {
      ids.push(summary.task_id || summary.taskId);
    }
  }

  const next = maxSequentialFromTaskIds(ids) + 1;
  if (next >= 1 && next <= TASK_ID_SEQUENCE_MAX) {
    return generateSequentialTaskId(next);
  }

  return makeOpaqueTaskId();
}

module.exports = {
  allocateProductionTaskId,
};