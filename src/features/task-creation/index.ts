import { createTaskCreationApiClient } from './adapter.js';
import { validateTaskCreatePayload, VALID_PRIORITIES, VALID_TASK_TYPES, VALID_STAGES, UNTITLED_INTAKE_DRAFT_TITLE, INTAKE_DRAFT_TITLE_MAX_LENGTH } from './schema';
import { generateTaskId, parseTaskId, isValidTaskId, TASK_ID_PREFIX, TASK_ID_PATTERN } from './types';

export type TaskPriority = typeof VALID_PRIORITIES[number];
export type TaskType = typeof VALID_TASK_TYPES[number];
export type TaskStage = typeof VALID_STAGES[number];
export interface TaskCreatePayload {
  raw_requirements: string;
  title?: string;
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
  UNTITLED_INTAKE_DRAFT_TITLE,
  INTAKE_DRAFT_TITLE_MAX_LENGTH,
};

export function createTaskCreationModule({ client = createTaskCreationApiClient() } = {}) {
  return {
    async createTask(taskData: TaskCreatePayload, sequenceNumber?: number) {
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
