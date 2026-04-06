import { createTaskCreationApiClient } from './adapter.js';
import type { TaskCreatePayload, Task, TaskDraft, TaskPriority, TaskType, TaskStage } from './schema';
import { validateTaskCreatePayload, VALID_PRIORITIES, VALID_TASK_TYPES, VALID_STAGES } from './schema';
import { generateTaskId, parseTaskId, isValidTaskId, TASK_ID_PREFIX, TASK_ID_PATTERN } from './types';

export {
  createTaskCreationApiClient,
  validateTaskCreatePayload,
  generateTaskId,
  parseTaskId,
  isValidTaskId,
  TASK_ID_PREFIX,
  TASK_ID_PATTERN,
  VALID_PRIORITIES,
  VALID_TASK_TYPES,
  VALID_STAGES,
};

export type {
  TaskCreatePayload,
  Task,
  TaskDraft,
  TaskPriority,
  TaskType,
  TaskStage,
};

export function createTaskCreationModule({ client = createTaskCreationApiClient() } = {}) {
  return {
    async createTask(taskData: TaskCreatePayload, sequenceNumber: number) {
      return client.createTask(taskData, sequenceNumber);
    },
    
    async saveDraft(taskData: TaskCreatePayload) {
      return client.saveDraft(taskData);
    },
    
    async fetchTaskDraft(taskId: string) {
      return client.fetchTaskDraft(taskId);
    },
    
    async deleteTaskDraft(taskId: string) {
      return client.deleteTaskDraft(taskId);
    },
  };
}

// For CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
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
    VALID_STAGES,
  };
}
