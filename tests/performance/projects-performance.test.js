const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const { createTaskPlatformService } = require('../../lib/task-platform');

test('project list and hydrated task filters stay bounded for planning-sized workspaces', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-performance-'));
  const service = createTaskPlatformService({ baseDir });
  const tenantId = 'engineering-team';
  const project = await service.createProject({ tenantId, actorId: 'pm', name: 'Performance Plan', status: 'ACTIVE' });

  for (let index = 0; index < 75; index += 1) {
    const task = await service.createTask({
      tenantId,
      actorId: 'pm',
      title: `Planning task ${index}`,
      status: 'BACKLOG',
      priority: index % 2 ? 'P2' : 'P1',
    });
    await service.updateTaskProject({ tenantId, actorId: 'pm', taskId: task.taskId, projectId: project.projectId, version: task.version });
  }

  const startedAt = performance.now();
  const [projects, tasks] = await Promise.all([
    service.listProjects({ tenantId }),
    service.listTasks({ tenantId }),
  ]);
  const durationMs = performance.now() - startedAt;

  assert.equal(projects[0].taskCount, 75);
  assert.equal(tasks.filter(task => task.projectId === project.projectId).length, 75);
  assert.ok(durationMs < 750, `project list and task hydration took ${durationMs}ms`);
});
