const { validateTaskCreatePayload, VALID_PRIORITIES, VALID_TASK_TYPES } = require('./schema');
const { generateTaskId, isValidTaskId } = require('./types');

function parseJsonResponse(response) {
  return response.json().then(payload => {
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `Request failed with status ${response.status}`);
      error.status = response.status;
      error.code = payload?.error?.code;
      error.details = payload?.error?.details;
      error.requestId = payload?.error?.request_id;
      throw error;
    }

    return payload;
  });
}

function createTaskCreationApiClient({ baseUrl = '', fetchImpl = fetch, getHeaders } = {}) {
  const request = async (path, init = {}) => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: init.method || 'GET',
      headers: {
        ...(typeof getHeaders === 'function' ? await getHeaders() : undefined),
        ...(init.headers || {}),
      },
      body: init.body,
    });

    return parseJsonResponse(response);
  };

  return {
    async createTask(taskData, sequenceNumber) {
      const validation = validateTaskCreatePayload(taskData);
      if (!validation.valid) {
        const error = new Error(`Validation failed: ${validation.errors.join(', ')}`);
        error.code = 'VALIDATION_ERROR';
        error.details = validation.errors;
        throw error;
      }

      const taskId = generateTaskId(sequenceNumber);

      return request('/tasks', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ...taskData, taskId }),
      });
    },
    
    async saveDraft(taskData) {
      const validation = validateTaskCreatePayload(taskData);
      if (!validation.valid) {
        const error = new Error(`Validation failed: ${validation.errors.join(', ')}`);
        error.code = 'VALIDATION_ERROR';
        error.details = validation.errors;
        throw error;
      }

      return request('/tasks/draft', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(taskData),
      });
    },
    
    async fetchTaskDraft(taskId) {
      if (!isValidTaskId(taskId)) {
        const error = new Error(`Invalid task ID format: ${taskId}`);
        error.code = 'INVALID_TASK_ID';
        throw error;
      }

      return request(`/tasks/draft/${taskId}`);
    },
    
    async deleteTaskDraft(taskId) {
      if (!isValidTaskId(taskId)) {
        const error = new Error(`Invalid task ID format: ${taskId}`);
        error.code = 'INVALID_TASK_ID';
        throw error;
      }

      return request(`/tasks/draft/${taskId}`, {
        method: 'DELETE'
      });
    },
  };
}

module.exports = {
  createTaskCreationApiClient,
  VALID_PRIORITIES,
  VALID_TASK_TYPES,
};