const test = require('node:test');
const assert = require('node:assert/strict');

const { createTaskCreationModule } = require('../../../../src/features/task-creation/index');

test('task creation module creates tasks with sequence number', async () => {
  const calls = [];
  const module = createTaskCreationModule({
    client: {
      async createTask(taskData, sequenceNumber) {
        calls.push({ action: 'createTask', taskData, sequenceNumber });
        return { taskId: `TSK-${String(sequenceNumber).padStart(3, '0')}`, ...taskData };
      },
    },
  });

  const result = await module.createTask(
    {
      title: 'Test task',
      business_context: 'Test context',
      acceptance_criteria: 'Test criteria',
      definition_of_done: 'Test done',
      priority: 'High',
      task_type: 'Feature',
    },
    42
  );
  
  assert.equal(result.taskId, 'TSK-042');
  assert.equal(result.title, 'Test task');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'createTask');
  assert.equal(calls[0].sequenceNumber, 42);
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

  const result = await module.saveDraft({
    title: 'Draft task',
    business_context: 'Draft context',
    acceptance_criteria: 'Draft criteria',
    definition_of_done: 'Draft done',
    priority: 'Medium',
    task_type: 'Bug',
  });
  
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

test('task creation module deletes drafts', async () => {
  const calls = [];
  const module = createTaskCreationModule({
    client: {
      async deleteTaskDraft(taskId) {
        calls.push({ action: 'deleteTaskDraft', taskId });
        return { success: true, taskId };
      },
    },
  });

  const result = await module.deleteTaskDraft('TSK-001');
  
  assert.equal(result.success, true);
  assert.equal(result.taskId, 'TSK-001');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'deleteTaskDraft');
  assert.equal(calls[0].taskId, 'TSK-001');
});
