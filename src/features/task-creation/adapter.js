async function parseJsonResponse(response) {
  const payload = await response.json();

  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.code = payload?.error?.code;
    error.details = payload?.error?.details;
    error.requestId = payload?.error?.request_id;
    throw error;
  }

  return payload;
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
    createTask(taskData) {
      return request('/tasks', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(taskData),
      });
    },
  };
}

module.exports = {
  createTaskCreationApiClient,
};
