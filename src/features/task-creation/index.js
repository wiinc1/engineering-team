const { createTaskCreationApiClient, VALID_PRIORITIES, VALID_TASK_TYPES } = require('./adapter');
const { validateTaskCreatePayload } = require('./schema');
const { generateTaskId, parseTaskId, isValidTaskId, TASK_ID_PREFIX, TASK_ID_PATTERN } = require('./types');

function createTaskCreationModule({ client = createTaskCreationApiClient() } = {}) {
  return {
    async createTask(taskData, sequenceNumber) {
      return client.createTask(taskData, sequenceNumber);
    },
    
    async saveDraft(taskData) {
      return client.saveDraft(taskData);
    },
    
    async fetchTaskDraft(taskId) {
      return client.fetchTaskDraft(taskId);
    },
    
    async deleteTaskDraft(taskId) {
      return client.deleteTaskDraft(taskId);
    },
  };
}

module.exports = {
  createTaskCreationModule,
  createTaskCreationApiClient,
  validateTaskCreatePayload,
  generateTaskId,
  parseTaskId,
  isValidTaskId,
  TASK_ID_PREFIX,
  TASK_ID_PATTERN,
  VALID_PRIORITIES,
  VALID_TASK_TYPES,
};
