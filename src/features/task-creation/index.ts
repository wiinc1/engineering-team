import { createTaskCreationApiClient } from './adapter.js';
import { validateTaskCreatePayload, VALID_PRIORITIES, VALID_TASK_TYPES, VALID_STAGES } from './schema';
import { generateTaskId, parseTaskId, isValidTaskId, TASK_ID_PREFIX, TASK_ID_PATTERN } from './types';

export type TaskPriority = typeof VALID_PRIORITIES[number];
export type TaskType = typeof VALID_TASK_TYPES[number];
export type TaskStage = typeof VALID_STAGES[number];
export interface TaskCreatePayload {
  title: string;
  business_context: string;
  acceptance_criteria: string;
  definition_of_done: string;
  priority: TaskPriority;
  task_type: TaskType;
}
export interface Task extends TaskCreatePayload {
  task_id: string;
  stage?: TaskStage;
}
export interface TaskDraft extends Partial<TaskCreatePayload> {
  task_id?: string;
}

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
