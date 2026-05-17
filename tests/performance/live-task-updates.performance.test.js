const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { buildLiveTaskUpdateResponse } = require('../../lib/audit/live-task-updates');

function task(index) {
  return {
    taskId: `TSK-PERF-${String(index).padStart(4, '0')}`,
    tenantId: 'tenant-perf',
    title: `Performance task ${index}`,
    status: index % 3 === 0 ? 'VERIFY' : 'IMPLEMENT',
    priority: index % 2 === 0 ? 'P1' : 'P2',
    version: index + 1,
    updatedAt: new Date(Date.UTC(2026, 4, 17, 12, 0, index % 60, index % 1000)).toISOString(),
  };
}

test('live task update response stays within the endpoint overhead budget for pilot-sized batches', async () => {
  const tasks = Array.from({ length: 750 }, (_, index) => task(index));
  const projects = Array.from({ length: 50 }, (_, index) => ({
    projectId: `PRJ-${String(index).padStart(8, '0')}`.replace(/0/g, 'A').slice(0, 12),
    name: `Project ${index}`,
    status: 'ACTIVE',
    taskCount: index,
    version: index + 1,
    updatedAt: new Date(Date.UTC(2026, 4, 17, 13, 0, index % 60, index % 1000)).toISOString(),
  }));
  const store = { listTaskSummaries: async () => [] };
  const taskPlatform = {
    listTasks: async () => tasks,
    listProjects: async () => projects,
    listProjectMutations: async () => [],
  };

  const startedAt = performance.now();
  const response = await buildLiveTaskUpdateResponse({ store, taskPlatform, tenantId: 'tenant-perf', cursor: '' });
  const elapsedMs = performance.now() - startedAt;

  assert.equal(response.data.updates.length, 800);
  assert.ok(elapsedMs < 250, `expected live update response under 250ms, saw ${elapsedMs.toFixed(1)}ms`);
});
