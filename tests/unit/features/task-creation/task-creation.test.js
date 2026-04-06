const test = require('node:test');
const assert = require('node:assert/strict');

const { createTaskCreationModule } = require('../../../../src/features/task-creation/index');

test('task creation module creates tasks', async () => {
  const calls = [];
  const module = createTaskCreationModule({
    client: {
      async createTask(taskData) {
        calls.push({ action: 'createTask', taskData });
        return { taskId: 'TSK-001', ...taskData };
      },
    },
  });

  const result = await module.createTask({ title: 'Test task', description: 'Test description' });
  
  assert.equal(result.taskId, 'TSK-001');
  assert.equal(result.title, 'Test task');
  assert.equal(result.description, 'Test description');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'createTask');
});

test('task creation module saves drafts', async () => {
  const calls = [];
  const module = createTaskCreationModule({
    client: {
      async saveDraft(taskData) {
        calls.push({ action: 'saveDraft', taskData });
        return { draftId: 'draft-1', ...taskData, isDraft: true };
      },
    },
  });

  const result = await module.saveDraft({ title: 'Draft task', description: 'Draft description' });
  
  assert.equal(result.draftId, 'draft-1');
  assert.equal(result.title, 'Draft task');
  assert.equal(result.isDraft, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'saveDraft');
});

test('task creation module fetches drafts', async () => {
  const calls = [];
  const module = createTaskCreationModule({
    client: {
      async fetchTaskDraft(taskId) {
        calls.push({ action: 'fetchTaskDraft', taskId });
        return { taskId, title: 'Fetched task', isDraft: true };
      },
    },
  });

  const result = await module.fetchTaskDraft('TSK-001');
  
  assert.equal(result.taskId, 'TSK-001');
  assert.equal(result.title, 'Fetched task');
  assert.equal(result.isDraft, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'fetchTaskDraft');
  assert.equal(calls[0].taskId, 'TSK-001');
});