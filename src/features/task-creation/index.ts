import { createTaskCreationApiClient } from './adapter.js';

export { createTaskCreationApiClient };

export function createTaskCreationModule({ client = createTaskCreationApiClient() } = {}) {
  return {
    async createTask(taskData) {
      return client.createTask(taskData);
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

// For CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createTaskCreationModule,
    createTaskCreationApiClient,
  };
}